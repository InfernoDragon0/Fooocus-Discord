import type { ChildProcess } from 'node:child_process';
import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';

export type FooocusServerConfig = AppConfig['fooocus'];

export interface ServerEvents {
  up: [];
  down: [];
}

export class FooocusServer extends EventEmitter<ServerEvents> {
  private child: ChildProcess | undefined;
  private readonly recent: string[] = [];
  private healthTimer: NodeJS.Timeout | undefined;
  private up = false;
  private stopping = false;
  spawnedByUs = false;

  constructor(
    private readonly config: FooocusServerConfig,
    private readonly logger: Logger,
  ) {
    super();
  }

  get isUp(): boolean {
    return this.up;
  }

  recentLog(): string[] {
    return [...this.recent];
  }

  async probe(): Promise<boolean> {
    try {
      const response = await fetch(new URL('/config', this.config.baseUrl), { signal: AbortSignal.timeout(3000) });
      return response.ok;
    } catch {
      return false;
    }
  }

  async ensureRunning(): Promise<'attached' | 'started'> {
    if (await this.probe()) {
      this.up = true;
      this.logger.info({ baseUrl: this.config.baseUrl }, 'Attached to a running Fooocus');
      return 'attached';
    }
    if (!this.config.autoStart) {
      throw new Error(`Fooocus is not reachable at ${this.config.baseUrl} and autoStart is disabled`);
    }
    this.spawnProcess();
    await this.waitUntilUp(this.config.startupTimeoutSec * 1000);
    this.up = true;
    return 'started';
  }

  private launchArgs(): string[] {
    const url = new URL(this.config.baseUrl);
    const args = [
      '-s',
      this.config.launchScript,
      '--listen',
      url.hostname,
      '--port',
      url.port || '7865',
      '--disable-in-browser',
      '--disable-analytics',
      '--disable-preset-download',
    ];
    if (this.config.preset) {
      args.push('--preset', this.config.preset);
    }
    return [...args, ...this.config.extraArgs];
  }

  private spawnProcess(): void {
    const python = path.resolve(this.config.installDir, this.config.pythonExe);
    const args = this.launchArgs();
    this.logger.info({ python, args }, 'Starting Fooocus');
    const child = spawn(python, args, {
      cwd: this.config.installDir,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });
    this.child = child;
    this.spawnedByUs = true;
    const onLine = (line: string): void => {
      this.recent.push(line);
      if (this.recent.length > 200) {
        this.recent.shift();
      }
      this.logger.debug({ fooocus: line }, 'fooocus');
    };
    let stdoutBuffer = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? '';
      lines.forEach(onLine);
    });
    let stderrBuffer = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBuffer += chunk.toString();
      const lines = stderrBuffer.split(/\r?\n/);
      stderrBuffer = lines.pop() ?? '';
      lines.forEach(onLine);
    });
    child.on('exit', (code, signal) => {
      this.logger[this.stopping ? 'info' : 'error']({ code, signal }, 'Fooocus process exited');
      this.child = undefined;
      if (this.up) {
        this.up = false;
        this.emit('down');
      }
      if (!this.stopping && this.config.restartOnCrash) {
        setTimeout(() => {
          if (!this.stopping && !this.child) {
            this.spawnProcess();
          }
        }, 5000);
      }
    });
  }

  private async waitUntilUp(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!this.child && this.spawnedByUs) {
        throw new Error(`Fooocus exited during startup. Last output:\n${this.recent.slice(-20).join('\n')}`);
      }
      if (await this.probe()) {
        this.logger.info('Fooocus is up');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error(`Fooocus did not come up within ${Math.round(timeoutMs / 1000)}s`);
  }

  startHealthLoop(intervalMs: number): void {
    this.healthTimer = setInterval(() => {
      void this.probe().then((ok) => {
        if (ok && !this.up) {
          this.up = true;
          this.logger.info('Fooocus is reachable again');
          this.emit('up');
        } else if (!ok && this.up) {
          this.up = false;
          this.logger.warn('Fooocus stopped responding');
          this.emit('down');
        }
      });
    }, intervalMs);
    this.healthTimer.unref();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
    }
    const child = this.child;
    if (!child || child.pid === undefined) {
      return;
    }
    this.logger.info({ pid: child.pid }, 'Stopping Fooocus');
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
    } else {
      child.kill('SIGTERM');
    }
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) {
        resolve();
        return;
      }
      child.once('exit', () => resolve());
      setTimeout(resolve, 5000);
    });
  }
}
