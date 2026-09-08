import path from 'node:path';
import { loadConfig, loadSecrets, projectRoot } from './config.js';
import { startDiscord } from './discord/client.js';
import { FooocusClient } from './fooocus/client.js';
import { FooocusServer } from './fooocus/server.js';
import { applyPowerLimit, ensureElevatedForGpu } from './gpu/tdp.js';
import { logger, setLogLevel } from './logger.js';
import { JobStore } from './queue/job-store.js';
import { WorkerQueue } from './queue/worker-queue.js';
import { Shutdown } from './shutdown.js';
import { Tray } from './tray/tray.js';

const config = loadConfig();
const secrets = loadSecrets();
setLogLevel(config.log.level);

if (ensureElevatedForGpu(config.gpu, logger.child({ module: 'gpu' })) === 'relaunched') {
  process.exit(0);
}

const shutdown = new Shutdown(logger);
shutdown.install();

const power = applyPowerLimit(config.gpu, logger.child({ module: 'gpu' }));
if (power) {
  shutdown.register('gpu', () => power.restore());
  process.on('exit', () => power.restore());
}

const server = new FooocusServer(config.fooocus, logger.child({ module: 'server' }));
await server.ensureRunning();
shutdown.register('fooocus', () => server.stop());

const dataDir = path.join(projectRoot, 'data');
const fooocus = new FooocusClient({
  baseUrl: config.fooocus.baseUrl,
  idleTimeoutMs: config.fooocus.idleTimeoutSec * 1000,
  logger: logger.child({ module: 'fooocus' }),
});
await fooocus.connect();

const store = new JobStore(dataDir);
const queue = new WorkerQueue(
  fooocus,
  store,
  {
    maxPendingPerUser: config.queue.maxPendingPerUser,
    maxQueueSize: config.queue.maxQueueSize,
    jobTimeoutMs: config.fooocus.jobTimeoutSec * 1000,
    imagesDir: path.join(dataDir, 'images'),
  },
  logger.child({ module: 'queue' }),
);
shutdown.register('queue', () => queue.drain());

server.on('down', () => queue.pause());
server.on('up', () => {
  fooocus
    .connect()
    .then(() => queue.resume())
    .catch((error: unknown) => logger.error({ error }, 'Reconnect to Fooocus failed'));
});
server.startHealthLoop(config.fooocus.healthIntervalSec * 1000);

const discord = await startDiscord({
  config,
  secrets,
  fooocus,
  queue,
  store,
  logger: logger.child({ module: 'discord' }),
});
shutdown.register('discord', async () => {
  await discord.destroy();
});

if (config.tray.enabled) {
  const tray = new Tray(
    { title: 'Meowy Fooocus', uiUrl: config.fooocus.baseUrl, outputsDir: config.fooocus.outputsDir },
    logger.child({ module: 'tray' }),
  );
  tray.start();
  tray.on('exit', () => void shutdown.run('tray'));
  shutdown.register('tray', () => tray.stop());
  const refreshTooltip = (): void => {
    const current = queue.current;
    const waiting = queue.size - (current ? 1 : 0);
    tray.setTooltip(
      current
        ? `Meowy Fooocus · generating for ${current.userName}${waiting ? ` · ${waiting} waiting` : ''}`
        : 'Meowy Fooocus · idle',
    );
  };
  queue.on('started', refreshTooltip);
  queue.on('finished', refreshTooltip);
  refreshTooltip();
}

logger.info('Meowy Fooocus is ready');
