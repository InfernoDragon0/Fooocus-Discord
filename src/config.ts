import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

export const projectRoot = fileURLToPath(new URL('..', import.meta.url));

const performanceSchema = z.enum(['Quality', 'Speed', 'Extreme Speed', 'Lightning', 'Hyper-SD']);

const configSchema = z.object({
  fooocus: z.object({
    baseUrl: z.string().url().default('http://127.0.0.1:7865'),
    autoStart: z.boolean().default(true),
    installDir: z.string(),
    pythonExe: z.string().default('python_embeded\\python.exe'),
    launchScript: z.string().default('Fooocus\\launch.py'),
    preset: z.string().nullable().default(null),
    extraArgs: z.array(z.string()).default([]),
    startupTimeoutSec: z.number().int().positive().default(300),
    idleTimeoutSec: z.number().int().positive().default(180),
    jobTimeoutSec: z.number().int().positive().default(1200),
    healthIntervalSec: z.number().int().positive().default(15),
    restartOnCrash: z.boolean().default(true),
    outputsDir: z.string().optional(),
  }),
  queue: z
    .object({
      maxPendingPerUser: z.number().int().positive().default(1),
      maxQueueSize: z.number().int().positive().default(20),
    })
    .prefault({}),
  generation: z
    .object({
      defaultCount: z.number().int().min(1).max(8).default(2),
      maxCount: z.number().int().min(1).max(8).default(4),
      defaultPerformance: performanceSchema.default('Speed'),
      defaultStyles: z.array(z.string()).nullable().default(null),
      presetLoras: z.boolean().default(true),
      allowedModels: z.array(z.string()).nullable().default(null),
    })
    .prefault({}),
  discord: z
    .object({
      progressEditIntervalMs: z.number().int().min(1000).default(2500),
      maxUploadBytes: z.number().int().positive().default(10_000_000),
      previewJpegQuality: z.number().int().min(10).max(100).default(70),
      maxInputBytes: z.number().int().positive().default(8_000_000),
    })
    .prefault({}),
  gpu: z
    .object({
      powerLimitWatts: z.number().int().positive().nullable().default(null),
      method: z.enum(['nvidia-smi', 'scheduled-task']).default('nvidia-smi'),
      elevate: z.enum(['auto', 'never']).default('auto'),
      taskNames: z
        .object({
          apply: z.string().default('MeowyFooocusPowerLimit'),
          restore: z.string().default('MeowyFooocusPowerRestore'),
        })
        .prefault({}),
    })
    .prefault({}),
  tray: z.object({ enabled: z.boolean().default(true) }).prefault({}),
  log: z.object({ level: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info') }).prefault({}),
});

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  CLIENT_ID: z.string().min(1),
  GUILD_ID: z.string().optional(),
});

export type AppConfig = z.infer<typeof configSchema>;
export type Secrets = z.infer<typeof envSchema>;

export function loadConfig(configPath = path.join(projectRoot, 'config.json')): AppConfig {
  const raw = JSON.parse(readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')) as unknown;
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid ${configPath}:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export function loadSecrets(): Secrets {
  dotenv.config({ path: path.join(projectRoot, '.env'), quiet: true });
  const result = envSchema.safeParse({
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    CLIENT_ID: process.env.CLIENT_ID,
    GUILD_ID: process.env.GUILD_ID || undefined,
  });
  if (!result.success) {
    throw new Error(`Invalid .env:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
