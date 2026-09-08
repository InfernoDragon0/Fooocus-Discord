import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import type { FooocusClient } from '../src/fooocus/client.js';
import type { GenerationEvent, GenerationRequest } from '../src/fooocus/types.js';
import { JobStore, newJobId } from '../src/queue/job-store.js';
import type { JobRecord } from '../src/queue/job-store.js';
import { WorkerQueue } from '../src/queue/worker-queue.js';
import { ProgressEditor } from '../src/discord/progress-editor.js';

const silent = pino({ level: 'silent' });

function fakeClient(delayMs: number): FooocusClient {
  return {
    connected: true,
    async *generate(_request: GenerationRequest, options: { signal?: AbortSignal }): AsyncGenerator<GenerationEvent> {
      yield { type: 'progress', progress: { percent: 10, text: 'go' } };
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (options.signal?.aborted) {
        throw new Error('aborted');
      }
      yield { type: 'done', result: { images: [], seed: '1', elapsedMs: delayMs } };
    },
    fetchFile: vi.fn(),
    stop: vi.fn(async () => undefined),
  } as unknown as FooocusClient;
}

function job(userId: string): JobRecord {
  return {
    id: newJobId(),
    userId,
    userName: userId,
    channelId: 'c',
    request: { mode: 'txt2img', prompt: 'x' },
    label: 'Imagine',
    state: 'queued',
    createdAt: Date.now(),
  };
}

const options = { maxPendingPerUser: 1, maxQueueSize: 3, jobTimeoutMs: 10_000, imagesDir: 'data/test-images' };

describe('WorkerQueue', () => {
  it('runs jobs one at a time in order and caps per-user pending jobs', async () => {
    const queue = new WorkerQueue(fakeClient(30), new JobStore(), options, silent);
    const order: string[] = [];
    queue.on('started', (started) => order.push(started.userId));
    const first = job('a');
    const second = job('b');
    expect(queue.enqueue(first)).toEqual({ ok: true, position: 1 });
    expect(queue.enqueue(job('a'))).toEqual({ ok: false, reason: 'user-limit' });
    expect(queue.enqueue(second)).toEqual({ ok: true, position: 2 });
    expect(queue.positionOf(second.id)).toBe(1);
    await new Promise((resolve) => queue.on('finished', (finished) => finished.id === second.id && resolve(undefined)));
    expect(order).toEqual(['a', 'b']);
    expect(first.state).toBe('done');
  });

  it('cancels queued and running jobs', async () => {
    const client = fakeClient(200);
    const queue = new WorkerQueue(client, new JobStore(), options, silent);
    const running = job('a');
    const waiting = job('b');
    queue.enqueue(running);
    queue.enqueue(waiting);
    expect(queue.cancel(waiting.id, 'someone-else')).toBe(false);
    expect(queue.cancel(waiting.id, 'b')).toBe(true);
    expect(waiting.state).toBe('cancelled');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(queue.cancel(running.id, 'a')).toBe(true);
    await new Promise((resolve) => queue.on('finished', (finished) => finished.id === running.id && resolve(undefined)));
    expect(running.state).toBe('cancelled');
  });
});

describe('ProgressEditor', () => {
  it('coalesces rapid updates and always sends the final flush', async () => {
    const sent: unknown[] = [];
    const editor = new ProgressEditor(
      async (payload) => {
        sent.push(payload);
      },
      50,
      silent,
    );
    editor.update({ n: 1 });
    editor.update({ n: 2 });
    editor.update({ n: 3 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(sent).toEqual([{ n: 3 }]);
    editor.update({ n: 4 });
    await editor.flush({ n: 'final' });
    expect(sent.at(-1)).toEqual({ n: 'final' });
    expect(sent.length).toBeLessThanOrEqual(3);
  });
});
