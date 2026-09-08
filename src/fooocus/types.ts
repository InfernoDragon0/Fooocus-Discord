export type Performance = 'Quality' | 'Speed' | 'Extreme Speed' | 'Lightning' | 'Hyper-SD';
export const performances: Performance[] = ['Quality', 'Speed', 'Extreme Speed', 'Lightning', 'Hyper-SD'];

export type UovMethod = 'Vary (Subtle)' | 'Vary (Strong)' | 'Upscale (1.5x)' | 'Upscale (2x)' | 'Upscale (Fast 2x)';
export type CnType = 'ImagePrompt' | 'PyraCanny' | 'CPDS' | 'FaceSwap';
export const cnTypes: CnType[] = ['ImagePrompt', 'PyraCanny', 'CPDS', 'FaceSwap'];
export type OutpaintDirection = 'Left' | 'Right' | 'Top' | 'Bottom';
export type InpaintMode = 'default' | 'detail' | 'modify';
export type DescribeMethod = 'Photograph' | 'Art/Anime';
export type OutputFormat = 'png' | 'jpeg' | 'webp';

export type DataUri = string;

export interface LoraSelection {
  name: string;
  weight: number;
}

export interface BaseParams {
  prompt: string;
  negativePrompt?: string;
  styles?: string[];
  performance?: Performance;
  aspect?: string;
  imageNumber?: number;
  seed?: string;
  baseModel?: string;
  refiner?: string;
  loras?: LoraSelection[];
  clearPresetLoras?: boolean;
  cfgScale?: number;
  sharpness?: number;
  outputFormat?: OutputFormat;
}

export interface ImagePromptEntry {
  image: DataUri;
  type: CnType;
  stop?: number;
  weight?: number;
}

export type ModeParams =
  | { mode: 'txt2img' }
  | { mode: 'uov'; image: DataUri; method: UovMethod }
  | { mode: 'outpaint'; image: DataUri; mask: DataUri; directions: OutpaintDirection[] }
  | { mode: 'inpaint'; image: DataUri; mask: DataUri; inpaintMode: InpaintMode; additionalPrompt?: string }
  | { mode: 'imageprompt'; images: ImagePromptEntry[] };

export type GenerationRequest = BaseParams & ModeParams;

export interface JobProgress {
  percent: number;
  text: string;
  preview?: DataUri;
}

export interface ImageRef {
  path: string;
  url: string;
  index: number;
  seed: string;
  localPath?: string;
}

export interface JobResult {
  images: ImageRef[];
  seed: string;
  elapsedMs: number;
}

export type GenerationEvent =
  | { type: 'queued'; rank: number; eta: number | undefined }
  | { type: 'progress'; progress: JobProgress }
  | { type: 'done'; result: JobResult };

export interface AspectRatio {
  raw: string;
  width: number;
  height: number;
  label: string;
}

export interface FooocusCapabilities {
  models: string[];
  refiners: string[];
  loras: string[];
  styles: string[];
  aspectRatios: AspectRatio[];
  performances: string[];
  samplers: string[];
  schedulers: string[];
  defaults: {
    model: string;
    refiner: string;
    styles: string[];
    aspect: string;
    performance: string;
    negativePrompt: string;
    imageNumber: number;
    cfgScale: number;
    sharpness: number;
    loras: { enabled: boolean; name: string; weight: number }[];
  };
}

export class FooocusError extends Error {
  override name = 'FooocusError';
}

export class LayoutError extends FooocusError {
  override name = 'LayoutError';
}

export class QueueFullError extends FooocusError {
  override name = 'QueueFullError';
}

export class ConnectionLostError extends FooocusError {
  override name = 'ConnectionLostError';
}
