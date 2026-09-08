import type { Client } from 'discord.js';
import type { AppConfig, Secrets } from '../config.js';
import type { FooocusClient } from '../fooocus/client.js';
import type { Logger } from '../logger.js';
import type { JobStore } from '../queue/job-store.js';
import type { WorkerQueue } from '../queue/worker-queue.js';

export interface BotContext {
  config: AppConfig;
  secrets: Secrets;
  fooocus: FooocusClient;
  queue: WorkerQueue;
  store: JobStore;
  logger: Logger;
  discord: Client;
}

export class UserError extends Error {
  override name = 'UserError';
}
