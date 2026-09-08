import type { Logger } from './logger.js';

type Hook = () => void | Promise<void>;

interface Registered {
  name: string;
  hook: Hook;
}

export class Shutdown {
  private readonly hooks: Registered[] = [];
  private started = false;

  constructor(
    private readonly logger: Logger,
    private readonly deadlineMs = 15_000,
  ) {}

  register(name: string, hook: Hook): void {
    this.hooks.push({ name, hook });
  }

  install(): void {
    const trigger = (reason: string, code: number) => (): void => {
      void this.run(reason, code);
    };
    process.on('SIGINT', trigger('SIGINT', 0));
    process.on('SIGTERM', trigger('SIGTERM', 0));
    process.on('SIGBREAK', trigger('SIGBREAK', 0));
    process.on('SIGHUP', trigger('SIGHUP', 0));
    process.on('uncaughtException', (error) => {
      this.logger.fatal({ error }, 'Uncaught exception');
      void this.run('uncaughtException', 1);
    });
    process.on('unhandledRejection', (reason) => {
      this.logger.fatal({ reason }, 'Unhandled rejection');
      void this.run('unhandledRejection', 1);
    });
  }

  async run(reason: string, code = 0): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;
    this.logger.info({ reason }, 'Shutting down');
    const deadline = setTimeout(() => {
      this.logger.error('Shutdown deadline reached, exiting');
      process.exit(code);
    }, this.deadlineMs);
    for (const { name, hook } of [...this.hooks].reverse()) {
      try {
        await hook();
        this.logger.debug({ hook: name }, 'Shutdown hook done');
      } catch (error) {
        this.logger.warn({ hook: name, error }, 'Shutdown hook failed');
      }
    }
    clearTimeout(deadline);
    process.exit(code);
  }
}
