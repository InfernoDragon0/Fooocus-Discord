import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import type { Logger } from '../logger.js';

export interface TrayEvents {
  exit: [];
}

export interface TrayOptions {
  title: string;
  uiUrl: string;
  outputsDir: string | undefined;
}

const scriptPath = fileURLToPath(new URL('../../assets/tray.ps1', import.meta.url));

export function openInBrowser(url: string): void {
  spawn('cmd.exe', ['/c', 'start', '', url], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
}

export function openFolder(dir: string): void {
  spawn('explorer.exe', [dir], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
}

export class Tray extends EventEmitter<TrayEvents> {
  private child: ChildProcess | undefined;
  private stopping = false;

  constructor(
    private readonly options: TrayOptions,
    private readonly logger: Logger,
  ) {
    super();
  }

  start(): void {
    if (process.platform !== 'win32') {
      this.logger.warn('Tray icon is only supported on Windows');
      return;
    }
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-STA',
        '-WindowStyle',
        'Hidden',
        '-File',
        scriptPath,
        '-Title',
        this.options.title,
      ],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    this.child = child;
    let buffer = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      lines.map((line) => line.trim()).filter(Boolean).forEach((line) => this.handle(line));
    });
    child.stderr?.on('data', (chunk: Buffer) => this.logger.warn({ tray: chunk.toString().trim() }, 'tray'));
    child.on('exit', (code) => {
      this.child = undefined;
      if (!this.stopping) {
        this.logger.warn({ code }, 'Tray helper exited');
      }
    });
    this.logger.info('Tray icon started');
  }

  private handle(command: string): void {
    switch (command) {
      case 'open-ui':
        openInBrowser(this.options.uiUrl);
        break;
      case 'open-outputs':
        if (this.options.outputsDir) {
          openFolder(this.options.outputsDir);
        }
        break;
      case 'exit':
        this.emit('exit');
        break;
      default:
        this.logger.debug({ command }, 'Unknown tray command');
    }
  }

  setTooltip(text: string): void {
    this.child?.stdin?.write(`tooltip ${text.replace(/\r?\n/g, ' ')}\n`);
  }

  stop(): void {
    this.stopping = true;
    const child = this.child;
    if (!child) {
      return;
    }
    child.stdin?.end();
    setTimeout(() => {
      if (this.child) {
        this.child.kill();
      }
    }, 2000).unref();
  }
}
