import WebSocket from 'ws';
import { ConnectionLostError, FooocusError, QueueFullError } from './types.js';

export type QueueEvent =
  | { type: 'estimation'; rank: number; eta: number | undefined; queueSize: number }
  | { type: 'started' }
  | { type: 'generating'; data: unknown[] }
  | { type: 'completed'; data: unknown[] };

export interface QueuedCall {
  baseUrl: string;
  fnIndex: number;
  data: unknown[];
  sessionHash: string;
  signal?: AbortSignal;
  connectTimeoutMs?: number;
  idleTimeoutMs?: number;
}

interface ServerMessage {
  msg: string;
  rank?: number;
  rank_eta?: number | null;
  queue_size?: number;
  output?: { data?: unknown[]; error?: string | null };
  success?: boolean;
}

export class AbortedError extends FooocusError {
  override name = 'AbortedError';
}

class Inbox<T> {
  private readonly items: (T | Error)[] = [];
  private waiter: (() => void) | undefined;

  push(item: T | Error): void {
    this.items.push(item);
    this.waiter?.();
    this.waiter = undefined;
  }

  async take(timeoutMs: number, signal: AbortSignal | undefined): Promise<T> {
    if (this.items.length === 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          reject(new ConnectionLostError(`No message from Fooocus for ${Math.round(timeoutMs / 1000)}s`));
        }, timeoutMs);
        const onAbort = (): void => {
          cleanup();
          reject(new AbortedError('Cancelled'));
        };
        const cleanup = (): void => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          this.waiter = undefined;
        };
        this.waiter = () => {
          cleanup();
          resolve();
        };
        if (signal?.aborted) {
          onAbort();
          return;
        }
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    }
    const item = this.items.shift()!;
    if (item instanceof Error) {
      throw item;
    }
    return item;
  }
}

export function queueUrl(baseUrl: string): string {
  const url = new URL('/queue/join', baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

export async function* runQueued(call: QueuedCall): AsyncGenerator<QueueEvent> {
  const idleTimeoutMs = call.idleTimeoutMs ?? 180_000;
  const connectTimeoutMs = call.connectTimeoutMs ?? 10_000;
  const inbox = new Inbox<ServerMessage>();
  const socket = new WebSocket(queueUrl(call.baseUrl), { handshakeTimeout: connectTimeoutMs });
  let finished = false;

  socket.on('message', (raw) => {
    try {
      inbox.push(JSON.parse(raw.toString()) as ServerMessage);
    } catch (error) {
      inbox.push(new FooocusError(`Unparseable message from Fooocus: ${String(error)}`));
    }
  });
  socket.on('error', (error) => inbox.push(new ConnectionLostError(error.message)));
  socket.on('close', () => {
    if (!finished) {
      inbox.push(new ConnectionLostError('Fooocus closed the connection'));
    }
  });

  const send = (payload: unknown): void => {
    socket.send(JSON.stringify(payload));
  };

  try {
    while (true) {
      const message = await inbox.take(idleTimeoutMs, call.signal);
      switch (message.msg) {
        case 'send_hash':
          send({ session_hash: call.sessionHash, fn_index: call.fnIndex });
          break;
        case 'estimation':
          yield {
            type: 'estimation',
            rank: message.rank ?? 0,
            eta: message.rank_eta ?? undefined,
            queueSize: message.queue_size ?? 0,
          };
          break;
        case 'queue_full':
          throw new QueueFullError('Fooocus queue is full');
        case 'send_data':
          send({ data: call.data, fn_index: call.fnIndex, session_hash: call.sessionHash, event_data: null });
          break;
        case 'process_starts':
          yield { type: 'started' };
          break;
        case 'process_generating':
          if (message.success === false || message.output?.error) {
            throw new FooocusError(message.output?.error ?? 'Fooocus reported a failure while generating');
          }
          yield { type: 'generating', data: message.output?.data ?? [] };
          break;
        case 'process_completed':
          finished = true;
          if (message.success === false || message.output?.error) {
            throw new FooocusError(message.output?.error ?? 'Fooocus reported a failure');
          }
          yield { type: 'completed', data: message.output?.data ?? [] };
          return;
        default:
          break;
      }
    }
  } finally {
    finished = true;
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  }
}

export async function runToCompletion(call: QueuedCall): Promise<unknown[]> {
  let last: unknown[] = [];
  for await (const event of runQueued(call)) {
    if (event.type === 'completed') {
      last = event.data;
    }
  }
  return last;
}

export async function predictSync(
  baseUrl: string,
  fnIndex: number,
  data: unknown[],
  sessionHash: string,
): Promise<unknown[]> {
  const response = await fetch(new URL('/run/predict', baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fn_index: fnIndex, data, session_hash: sessionHash }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new FooocusError(`POST /run/predict returned ${response.status}`);
  }
  const body = (await response.json()) as { data?: unknown[] };
  return body.data ?? [];
}
