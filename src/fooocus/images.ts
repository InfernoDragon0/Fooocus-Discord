import sharp from 'sharp';
import type { DataUri } from './types.js';

export const maxInputSide = 2048;

export function toDataUri(buffer: Buffer, mime = 'image/png'): DataUri {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

export function fromDataUri(uri: DataUri): Buffer {
  const comma = uri.indexOf(',');
  return Buffer.from(uri.slice(comma + 1), 'base64');
}

export interface NormalizedImage {
  png: Buffer;
  width: number;
  height: number;
}

export async function normalizeImage(input: Buffer): Promise<NormalizedImage> {
  const image = sharp(input, { failOn: 'none' }).rotate();
  const metadata = await image.metadata();
  const pipeline =
    (metadata.width ?? 0) > maxInputSide || (metadata.height ?? 0) > maxInputSide
      ? image.resize({ width: maxInputSide, height: maxInputSide, fit: 'inside', withoutEnlargement: true })
      : image;
  const { data, info } = await pipeline.removeAlpha().png().toBuffer({ resolveWithObject: true });
  return { png: data, width: info.width, height: info.height };
}

export async function blackMask(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .png()
    .toBuffer();
}

export interface DiscordImage {
  buffer: Buffer;
  extension: 'png' | 'jpg';
}

export async function fitForDiscord(input: Buffer, maxBytes: number): Promise<DiscordImage> {
  if (input.byteLength <= maxBytes) {
    return { buffer: input, extension: 'png' };
  }
  for (const quality of [92, 85, 75, 65]) {
    const jpeg = await sharp(input).jpeg({ quality, mozjpeg: true }).toBuffer();
    if (jpeg.byteLength <= maxBytes) {
      return { buffer: jpeg, extension: 'jpg' };
    }
  }
  const shrunk = await sharp(input).resize({ width: 2048, height: 2048, fit: 'inside' }).jpeg({ quality: 70 }).toBuffer();
  return { buffer: shrunk, extension: 'jpg' };
}

export async function previewJpeg(uri: DataUri, quality: number): Promise<Buffer> {
  return sharp(fromDataUri(uri)).jpeg({ quality }).toBuffer();
}

export async function compositeGrid(images: Buffer[], quality: number): Promise<Buffer> {
  const columns = images.length <= 2 ? images.length : 2;
  const rows = Math.ceil(images.length / columns);
  const metas = await Promise.all(images.map((buffer) => sharp(buffer).metadata()));
  const cellWidth = Math.max(...metas.map((meta) => meta.width ?? 0));
  const cellHeight = Math.max(...metas.map((meta) => meta.height ?? 0));
  const gap = 8;
  const canvasWidth = columns * cellWidth + (columns - 1) * gap;
  const canvasHeight = rows * cellHeight + (rows - 1) * gap;
  const composites = images.map((buffer, index) => ({
    input: buffer,
    left: (index % columns) * (cellWidth + gap),
    top: Math.floor(index / columns) * (cellHeight + gap),
  }));
  return sharp({ create: { width: canvasWidth, height: canvasHeight, channels: 3, background: { r: 24, g: 24, b: 28 } } })
    .composite(composites)
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
}
