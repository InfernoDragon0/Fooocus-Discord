import { EventEmitter } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FooocusClient } from '../fooocus/client.js';
import type { GenerationEvent, JobResult } from '../fooocus/types.js';
import type { Logger } from '../logger.js';
import type { JobRecord, JobStore } from './job-store.js';

export interface QueueOptions {
  maxPendingPerUser: number;
  maxQueueSize: number;
  jobTimeoutMs: number;
  imagesDir: string;
}

export type EnqueueResult =
  | { ok: true; position: number }
  | { ok: false; reason: 'user-limit' | 'queue-full' | 'offline' };

export interface QueueEvents {
  position: [job: JobRecord, position: number];
  started: [job: JobRecord];
  progress: [job: JobRecord, event: GenerationEvent];
  finished: [job: JobRecord];
}

export class WorkerQueue extends EventEmitter<QueueEvents> {
  private readonly pending: JobRecord[] = [];
  private running: { job: JobRecord; controller: AbortController } | undefined;
  private paused = false;

  constructor(
    private readonly client: FooocusClient,
    private readonly store: JobStore,
    private readonly options: QueueOptions,
    private readonly logger: Logger,
  ) {
    super();
  }

  get size(): number {
    return this.pending.length + (this.running ? 1 : 0);
  }

  get current(): JobRecord | undefined {
    return this.running?.job;
  }

  snapshot(): JobRecord[] {
    return [...(this.running ? [this.running.job] : []), ...this.pending];
  }

  canEnqueue(userId: string): EnqueueResult {
    if (!this.client.connected || this.paused) {
      return { ok: false, reason: 'offline' };
    }
    const owned = this.snapshot().filter((job) => job.userId === userId).length;
    if (owned >= this.options.maxPendingPerUser) {
      return { ok: false, reason: 'user-limit' };
    }
    if (this.pending.length >= this.options.maxQueueSize) {
      return { ok: false, reason: 'queue-full' };
    }
    return { ok: true, position: this.size + 1 };
  }

  enqueue(job: JobRecord): EnqueueResult {
    const check = this.canEnqueue(job.userId);
    if (!check.ok) {
      return check;
    }
    job.state = 'queued';
    this.store.put(job);
    this.pending.push(job);
    this.logger.info({ jobId: job.id, user: job.userName, position: check.position }, 'Job queued');
    void this.pump();
    return check;
  }

  positionOf(jobId: string): number | undefined {
    if (this.running?.job.id === jobId) {
      return 0;
    }
    const index = this.pending.findIndex((job) => job.id === jobId);
    return index === -1 ? undefined : index + 1;
  }

  cancel(jobId: string, byUserId: string | undefined): boolean {
    const index = this.pending.findIndex((job) => job.id === jobId);
    if (index !== -1) {
      const job = this.pending[index]!;
      if (byUserId && job.userId !== byUserId) {
        return false;
      }
      this.pending.splice(index, 1);
      this.store.update(job.id, { state: 'cancelled', finishedAt: Date.now() });
      this.emit('finished', job);
      this.broadcastPositions();
      return true;
    }
    if (this.running?.job.id === jobId) {
      if (byUserId && this.running.job.userId !== byUserId) {
        return false;
      }
      this.running.controller.abort();
      const hash = this.running.job.sessionHash;
      if (hash) {
        this.client.stop(hash).catch((error: unknown) => this.logger.warn({ error }, 'Stop request failed'));
      }
      return true;
    }
    return false;
  }

  cancelOwnedBy(userId: string): number {
    return this.snapshot()
      .filter((job) => job.userId === userId)
      .map((job) => this.cancel(job.id, userId))
      .filter(Boolean).length;
  }

  pause(): void {
    this.paused = true;
    if (this.running) {
      this.running.controller.abort();
    }
  }

  resume(): void {
    this.paused = false;
    void this.pump();
  }

  async drain(): Promise<void> {
    this.paused = true;
    for (const job of [...this.pending]) {
      this.cancel(job.id, undefined);
    }
    if (this.running) {
      this.cancel(this.running.job.id, undefined);
      while (this.running) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }

  private broadcastPositions(): void {
    this.pending.forEach((job, index) => this.emit('position', job, index + 1));
  }

  private async pump(): Promise<void> {
    if (this.running || this.paused) {
      return;
    }
    const job = this.pending.shift();
    if (!job) {
      return;
    }
    const controller = new AbortController();
    this.running = { job, controller };
    this.broadcastPositions();
    const timeout = setTimeout(() => controller.abort(), this.options.jobTimeoutMs);
    try {
      await this.run(job, controller.signal);
    } finally {
      clearTimeout(timeout);
      this.running = undefined;
      void this.pump();
    }
  }

  private async run(job: JobRecord, signal: AbortSignal): Promise<void> {
    this.store.update(job.id, { state: 'running', startedAt: Date.now() });
    this.emit('started', job);
    try {
      for await (const event of this.client.generate(job.request, {
        signal,
        onSession: (sessionHash) => this.store.update(job.id, { sessionHash }),
      })) {
        if (event.type === 'done') {
          const result = await this.download(job, event.result);
          this.store.update(job.id, { state: 'done', result, finishedAt: Date.now() });
        } else {
          this.emit('progress', job, event);
        }
      }
      if (job.state !== 'done') {
        throw new Error('Generation ended without a result');
      }
      this.logger.info({ jobId: job.id, elapsedMs: job.result?.elapsedMs }, 'Job finished');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = signal.aborted;
      this.store.update(job.id, {
        state: cancelled ? 'cancelled' : 'failed',
        error: cancelled ? 'Cancelled' : message,
        finishedAt: Date.now(),
      });
      this.logger[cancelled ? 'info' : 'warn'](
        { jobId: job.id, error: message },
        cancelled ? 'Job cancelled' : 'Job failed',
      );
    } finally {
      this.emit('finished', job);
    }
  }

  private async download(job: JobRecord, result: JobResult): Promise<JobResult> {
    await mkdir(this.options.imagesDir, { recursive: true });
    const images = await Promise.all(
      result.images.map(async (image) => {
        const bytes = await this.client.fetchFile(image.path);
        const localPath = path.join(this.options.imagesDir, `${job.id}-${image.index}.png`);
        await writeFile(localPath, bytes);
        return { ...image, localPath };
      }),
    );
    return { ...result, images };
  }
}
