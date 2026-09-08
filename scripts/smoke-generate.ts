import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig, projectRoot } from '../src/config.js';
import { FooocusClient } from '../src/fooocus/client.js';
import { logger, setLogLevel } from '../src/logger.js';

setLogLevel('debug');
const config = loadConfig();
const client = new FooocusClient({
  baseUrl: config.fooocus.baseUrl,
  idleTimeoutMs: config.fooocus.idleTimeoutSec * 1000,
  logger,
});
await client.connect();

const prompt = process.argv[2] ?? 'a cat wearing sunglasses, studio photo';
let previews = 0;
for await (const event of client.generate({
  mode: 'txt2img',
  prompt,
  imageNumber: 1,
  performance: 'Speed',
})) {
  if (event.type === 'queued') {
    console.log(`queued rank=${event.rank} eta=${event.eta ?? '?'}`);
  } else if (event.type === 'progress') {
    if (event.progress.preview) {
      previews += 1;
    }
    console.log(`${String(event.progress.percent).padStart(3)}% ${event.progress.text}`);
  } else {
    console.log(`done in ${(event.result.elapsedMs / 1000).toFixed(1)}s seed=${event.result.seed} previews=${previews}`);
    for (const image of event.result.images) {
      const bytes = await client.fetchFile(image.path);
      const target = path.join(projectRoot, 'data', `smoke-${image.index}.png`);
      writeFileSync(target, bytes);
      console.log(`  ${image.path} -> ${target} (${bytes.byteLength} bytes)`);
      if (bytes.byteLength < 50_000) {
        throw new Error('Image is suspiciously small');
      }
    }
  }
}
