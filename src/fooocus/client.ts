import { randomBytes, randomInt } from 'node:crypto';
import type { Logger } from '../logger.js';
import type { Endpoints, GradioConfig } from './gradio-config.js';
import { fetchGradioConfig, resolveEndpoints } from './gradio-config.js';
import { CtrlLayout } from './params.js';
import type {
  DataUri,
  DescribeMethod,
  FooocusCapabilities,
  GenerationEvent,
  GenerationRequest,
  ImageRef,
  JobProgress,
} from './types.js';
import { FooocusError } from './types.js';
import { predictSync, runQueued, runToCompletion } from './ws.js';

export interface FooocusClientOptions {
  baseUrl: string;
  idleTimeoutMs: number;
  logger: Logger;
}

export interface GenerateOptions {
  signal?: AbortSignal;
  onSession?: (sessionHash: string) => void;
}

export interface MaskOptions {
  model?: string;
  samModel?: string;
  boxThreshold?: number;
  textThreshold?: number;
  maxDetections?: number;
  erodeOrDilate?: number;
}

interface GalleryFile {
  name: string;
  is_file?: boolean;
}

export function unwrapUpdate(value: unknown): unknown {
  if (value && typeof value === 'object' && (value as { __type__?: string }).__type__ === 'update') {
    return (value as { value?: unknown }).value;
  }
  return value;
}

export function parseProgressHtml(html: unknown): { percent: number; text: string } | undefined {
  if (typeof html !== 'string') {
    return undefined;
  }
  const percent = /<progress value="(\d+)"/.exec(html);
  const text = /<span>([\s\S]*?)<\/span>/.exec(html);
  if (!percent) {
    return undefined;
  }
  return { percent: Number(percent[1]), text: (text?.[1] ?? '').trim() };
}

export function newSessionHash(): string {
  return randomBytes(6).toString('hex');
}

export function randomSeed(): string {
  return String(randomInt(0, 2 ** 31 - 1));
}

export class FooocusClient {
  private config: GradioConfig | undefined;
  private endpoints: Endpoints | undefined;
  private layout: CtrlLayout | undefined;
  private readonly baseUrl: string;
  private readonly idleTimeoutMs: number;
  private readonly logger: Logger;

  constructor(options: FooocusClientOptions) {
    this.baseUrl = options.baseUrl;
    this.idleTimeoutMs = options.idleTimeoutMs;
    this.logger = options.logger;
  }

  get connected(): boolean {
    return this.layout !== undefined;
  }

  async connect(): Promise<void> {
    const config = await fetchGradioConfig(this.baseUrl);
    const endpoints = resolveEndpoints(config);
    const layout = new CtrlLayout(config, config.dependencies[endpoints.getTask]!.inputs);
    this.config = config;
    this.endpoints = endpoints;
    this.layout = layout;
    this.logger.info(
      { gradio: config.version, endpoints, models: layout.capabilities.models.length, styles: layout.capabilities.styles.length },
      'Connected to Fooocus',
    );
  }

  async isReachable(): Promise<boolean> {
    try {
      const response = await fetch(new URL('/config', this.baseUrl), { signal: AbortSignal.timeout(3000) });
      return response.ok;
    } catch {
      return false;
    }
  }

  capabilities(): FooocusCapabilities {
    return this.requireLayout().capabilities;
  }

  ctrlLayout(): CtrlLayout {
    return this.requireLayout();
  }

  gradioConfig(): GradioConfig {
    if (!this.config) {
      throw new FooocusError('Not connected to Fooocus');
    }
    return this.config;
  }

  private requireLayout(): CtrlLayout {
    if (!this.layout) {
      throw new FooocusError('Not connected to Fooocus');
    }
    return this.layout;
  }

  private requireEndpoints(): Endpoints {
    if (!this.endpoints) {
      throw new FooocusError('Not connected to Fooocus');
    }
    return this.endpoints;
  }

  async *generate(request: GenerationRequest, options: GenerateOptions = {}): AsyncGenerator<GenerationEvent> {
    const layout = this.requireLayout();
    const endpoints = this.requireEndpoints();
    const seed = request.seed ?? randomSeed();
    const sessionHash = newSessionHash();
    options.onSession?.(sessionHash);
    const startedAt = Date.now();
    const data = layout.buildData(request, seed);
    this.logger.debug({ sessionHash, mode: request.mode, seed }, 'Submitting task');

    await runToCompletion({
      baseUrl: this.baseUrl,
      fnIndex: endpoints.getTask,
      data: [null, ...data],
      sessionHash,
      ...(options.signal ? { signal: options.signal } : {}),
      idleTimeoutMs: this.idleTimeoutMs,
    });

    let lastProgress: JobProgress | undefined;
    for await (const event of runQueued({
      baseUrl: this.baseUrl,
      fnIndex: endpoints.generate,
      data: [null],
      sessionHash,
      ...(options.signal ? { signal: options.signal } : {}),
      idleTimeoutMs: this.idleTimeoutMs,
    })) {
      if (event.type === 'estimation') {
        yield { type: 'queued', rank: event.rank, eta: event.eta };
      } else if (event.type === 'generating') {
        const progress = this.toProgress(event.data, lastProgress);
        if (progress) {
          lastProgress = progress;
          yield { type: 'progress', progress };
        }
      } else if (event.type === 'completed') {
        const images = this.toImages(event.data, seed, request);
        if (images.length === 0) {
          throw new FooocusError('Fooocus finished without producing images; check the Fooocus log');
        }
        yield { type: 'done', result: { images, seed, elapsedMs: Date.now() - startedAt } };
      }
    }
  }

  private toProgress(data: unknown[], previous: JobProgress | undefined): JobProgress | undefined {
    const parsed = parseProgressHtml(unwrapUpdate(data[0]));
    const preview = unwrapUpdate(data[1]);
    const previewUri = typeof preview === 'string' && preview.startsWith('data:image') ? preview : undefined;
    if (!parsed && !previewUri) {
      return undefined;
    }
    return {
      percent: parsed?.percent ?? previous?.percent ?? 0,
      text: parsed?.text ?? previous?.text ?? '',
      ...(previewUri ? { preview: previewUri } : previous?.preview ? { preview: previous.preview } : {}),
    };
  }

  private toImages(data: unknown[], seed: string, request: GenerationRequest): ImageRef[] {
    const gallery = unwrapUpdate(data[3]);
    if (!Array.isArray(gallery)) {
      return [];
    }
    const increment = request.mode === 'txt2img' || request.mode === 'imageprompt';
    return gallery.flatMap((entry, index) => {
      const file = entry as GalleryFile | string;
      const name = typeof file === 'string' ? file : file.name;
      if (!name) {
        return [];
      }
      const imageSeed = increment ? String(BigInt(seed) + BigInt(index)) : seed;
      return [{ path: name, url: this.fileUrl(name), index, seed: imageSeed }];
    });
  }

  fileUrl(absolutePath: string): string {
    return new URL(`/file=${encodeURI(absolutePath)}`, this.baseUrl).toString();
  }

  async fetchFile(absolutePath: string): Promise<Buffer> {
    const response = await fetch(this.fileUrl(absolutePath), { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) {
      throw new FooocusError(`Fetching ${absolutePath} returned ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async stop(sessionHash: string): Promise<void> {
    const endpoints = this.requireEndpoints();
    await predictSync(this.baseUrl, endpoints.stop, [null], sessionHash);
  }

  async describe(
    image: DataUri,
    methods: DescribeMethod[],
    applyStyles: boolean,
    signal?: AbortSignal,
  ): Promise<{ prompt: string | undefined; styles: string[] | undefined }> {
    const endpoints = this.requireEndpoints();
    const data = await runToCompletion({
      baseUrl: this.baseUrl,
      fnIndex: endpoints.describe,
      data: [methods, image, applyStyles],
      sessionHash: newSessionHash(),
      ...(signal ? { signal } : {}),
      idleTimeoutMs: this.idleTimeoutMs,
    });
    const prompt = unwrapUpdate(data[0]);
    const styles = unwrapUpdate(data[1]);
    return {
      prompt: typeof prompt === 'string' ? prompt : undefined,
      styles: Array.isArray(styles) ? (styles as string[]) : undefined,
    };
  }

  async generateMask(image: DataUri, detectPrompt: string, options: MaskOptions = {}, signal?: AbortSignal): Promise<DataUri> {
    const endpoints = this.requireEndpoints();
    const data = await runToCompletion({
      baseUrl: this.baseUrl,
      fnIndex: endpoints.mask,
      data: [
        { image, mask: image },
        options.model ?? 'sam',
        'full',
        detectPrompt,
        options.samModel ?? 'vit_b',
        options.boxThreshold ?? 0.3,
        options.textThreshold ?? 0.25,
        options.maxDetections ?? 0,
        options.erodeOrDilate ?? 0,
        false,
      ],
      sessionHash: newSessionHash(),
      ...(signal ? { signal } : {}),
      idleTimeoutMs: this.idleTimeoutMs,
    });
    const mask = unwrapUpdate(data[0]);
    if (typeof mask !== 'string' || !mask.startsWith('data:image')) {
      throw new FooocusError('Fooocus did not return a mask image');
    }
    return mask;
  }
}
