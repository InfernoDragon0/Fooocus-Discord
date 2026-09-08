import type { Logger } from '../logger.js';

export type EditPayload = Record<string, unknown>;

export class ProgressEditor {
  private latest: EditPayload | undefined;
  private inFlight: Promise<void> | undefined;
  private lastSentAt = 0;
  private timer: NodeJS.Timeout | undefined;
  private closed = false;

  constructor(
    private readonly send: (payload: EditPayload) => Promise<unknown>,
    private readonly intervalMs: number,
    private readonly logger: Logger,
  ) {}

  update(payload: EditPayload): void {
    if (this.closed) {
      return;
    }
    this.latest = payload;
    this.schedule();
  }

  async flush(payload: EditPayload): Promise<void> {
    this.closed = true;
    this.latest = undefined;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.inFlight;
    await this.send(payload);
  }

  private schedule(): void {
    if (this.timer || this.inFlight) {
      return;
    }
    const wait = Math.max(0, this.lastSentAt + this.intervalMs - Date.now());
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.fire();
    }, wait);
  }

  private async fire(): Promise<void> {
    const payload = this.latest;
    this.latest = undefined;
    if (!payload || this.closed) {
      return;
    }
    this.lastSentAt = Date.now();
    this.inFlight = this.send(payload)
      .then(() => undefined)
      .catch((error: unknown) => this.logger.warn({ error }, 'Progress edit failed'));
    await this.inFlight;
    this.inFlight = undefined;
    if (this.latest) {
      this.schedule();
    }
  }
}
