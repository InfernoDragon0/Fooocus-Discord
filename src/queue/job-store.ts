import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { GenerationRequest, JobResult } from '../fooocus/types.js';

export type JobState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface JobRecord {
  id: string;
  userId: string;
  userName: string;
  channelId: string;
  messageId?: string;
  request: GenerationRequest;
  parentJobId?: string;
  label: string;
  state: JobState;
  sessionHash?: string;
  result?: JobResult;
  error?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
}

type PersistedJob = Omit<JobRecord, 'request'> & { request: Omit<GenerationRequest, 'image' | 'mask' | 'images'> };

let counter = 0;

export function newJobId(): string {
  counter = (counter + 1) % 1296;
  return `${Date.now().toString(36)}${counter.toString(36).padStart(2, '0')}`;
}

function stripImages(request: GenerationRequest): PersistedJob['request'] {
  const copy: Record<string, unknown> = { ...request };
  delete copy.image;
  delete copy.mask;
  delete copy.images;
  return copy as PersistedJob['request'];
}

export class JobStore {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly file: string | undefined;

  constructor(dataDir?: string) {
    this.file = dataDir ? path.join(dataDir, 'jobs.json') : undefined;
    this.load();
  }

  get(id: string): JobRecord | undefined {
    return this.jobs.get(id);
  }

  put(job: JobRecord): void {
    this.jobs.set(job.id, job);
    this.persist();
  }

  update(id: string, patch: Partial<JobRecord>): JobRecord | undefined {
    const job = this.jobs.get(id);
    if (!job) {
      return undefined;
    }
    Object.assign(job, patch);
    this.persist();
    return job;
  }

  all(): JobRecord[] {
    return [...this.jobs.values()];
  }

  private load(): void {
    if (!this.file) {
      return;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as PersistedJob[];
      for (const job of parsed) {
        if (job.state === 'done') {
          this.jobs.set(job.id, job as JobRecord);
        }
      }
    } catch {
      return;
    }
  }

  private persist(): void {
    if (!this.file) {
      return;
    }
    const finished = this.all()
      .filter((job) => job.state === 'done')
      .slice(-500)
      .map((job) => ({ ...job, request: stripImages(job.request) }));
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(finished));
  }
}
