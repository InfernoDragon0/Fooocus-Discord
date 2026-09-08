import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export function nvidiaSmiPath(): string {
  const system32 = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'nvidia-smi.exe');
  return existsSync(system32) ? system32 : 'nvidia-smi';
}

function run(args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync(nvidiaSmiPath(), args, { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  return { ok: result.status === 0, stdout: result.stdout ?? '', stderr: result.stderr ?? String(result.error ?? '') };
}

export function readPowerLimit(gpuIndex = 0): number | undefined {
  const result = run(['--query-gpu=power.limit', '--format=csv,noheader,nounits', `--id=${gpuIndex}`]);
  if (!result.ok) {
    return undefined;
  }
  const value = Number.parseFloat(result.stdout.trim());
  return Number.isFinite(value) ? Math.round(value) : undefined;
}

export function setPowerLimit(watts: number, gpuIndex = 0): void {
  const result = run(['-i', String(gpuIndex), '-pl', String(watts)]);
  if (!result.ok) {
    throw new Error(`nvidia-smi -pl ${watts} failed: ${(result.stderr || result.stdout).trim()}`);
  }
}

export function isElevated(): boolean {
  if (process.platform !== 'win32') {
    return process.getuid?.() === 0;
  }
  const result = spawnSync('net', ['session'], { windowsHide: true, timeout: 10_000 });
  return result.status === 0;
}

function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function relaunchElevated(): void {
  const args = [...process.execArgv, ...process.argv.slice(1)];
  const script = [
    'Start-Process',
    '-FilePath',
    quote(process.execPath),
    '-ArgumentList',
    `@(${args.map(quote).join(',')})`,
    '-WorkingDirectory',
    quote(process.cwd()),
    '-Verb',
    'RunAs',
  ].join(' ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error('Elevation was refused or failed');
  }
}

export function runScheduledTask(name: string): void {
  const result = spawnSync('schtasks', ['/Run', '/TN', name], { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  if (result.status !== 0) {
    throw new Error(`schtasks /Run ${name} failed: ${(result.stderr || result.stdout).trim()}`);
  }
}
