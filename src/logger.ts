import pino from 'pino';

const pretty = process.env.NODE_ENV !== 'production' && process.stdout.isTTY;

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  ...(pretty
    ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }
    : {}),
});

export function setLogLevel(level: string): void {
  logger.level = level;
}

export type Logger = pino.Logger;
