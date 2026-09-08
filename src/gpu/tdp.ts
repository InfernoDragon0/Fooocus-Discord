import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { isElevated, readPowerLimit, relaunchElevated, runScheduledTask, setPowerLimit } from './nvidia-smi.js';

export interface PowerLimitHandle {
  restore(): void;
}

export function ensureElevatedForGpu(config: AppConfig['gpu'], logger: Logger): 'continue' | 'relaunched' {
  if (config.powerLimitWatts === null || config.method !== 'nvidia-smi' || config.elevate === 'never') {
    return 'continue';
  }
  if (isElevated()) {
    return 'continue';
  }
  logger.info('Power limit configured; relaunching with administrator rights');
  relaunchElevated();
  return 'relaunched';
}

export function applyPowerLimit(config: AppConfig['gpu'], logger: Logger): PowerLimitHandle | undefined {
  const target = config.powerLimitWatts;
  if (target === null) {
    return undefined;
  }
  if (config.method === 'scheduled-task') {
    runScheduledTask(config.taskNames.apply);
    logger.info({ task: config.taskNames.apply }, 'Ran GPU power limit task');
    let restored = false;
    return {
      restore: () => {
        if (restored) {
          return;
        }
        restored = true;
        try {
          runScheduledTask(config.taskNames.restore);
          logger.info({ task: config.taskNames.restore }, 'Ran GPU power restore task');
        } catch (error) {
          logger.warn({ error }, 'Could not run the GPU restore task');
        }
      },
    };
  }
  const previous = readPowerLimit();
  if (previous === undefined) {
    logger.warn('Could not read the current GPU power limit; leaving it unchanged');
    return undefined;
  }
  if (previous === target) {
    logger.info({ watts: target }, 'GPU power limit already at target');
    return undefined;
  }
  setPowerLimit(target);
  logger.info({ from: previous, to: target }, 'GPU power limit applied');
  let restored = false;
  return {
    restore: () => {
      if (restored) {
        return;
      }
      restored = true;
      try {
        setPowerLimit(previous);
        logger.info({ watts: previous }, 'GPU power limit restored');
      } catch (error) {
        logger.warn({ error }, 'Could not restore the GPU power limit');
      }
    },
  };
}
