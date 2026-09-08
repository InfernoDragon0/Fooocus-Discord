import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import type { GenerationRequest, JobProgress } from '../fooocus/types.js';
import type { JobRecord } from '../queue/job-store.js';

const colors = { queued: 0x8899aa, running: 0x5865f2, done: 0x57f287, failed: 0xed4245, cancelled: 0x99aab5 };

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function progressBar(percent: number, width = 12): string {
  const filled = Math.round((Math.max(0, Math.min(100, percent)) / 100) * width);
  return `${'▰'.repeat(filled)}${'▱'.repeat(width - filled)} ${Math.round(percent)}%`;
}

function modeLabel(request: GenerationRequest): string {
  switch (request.mode) {
    case 'txt2img':
      return 'Imagine';
    case 'uov':
      return request.method;
    case 'outpaint':
      return request.directions.length === 4 ? 'Zoom Out' : `Pan ${request.directions.join('/')}`;
    case 'inpaint':
      return 'Inpaint';
    case 'imageprompt':
      return 'Blend';
  }
}

function detailsLine(job: JobRecord): string {
  const request = job.request;
  const parts = [modeLabel(request)];
  if (request.baseModel) {
    parts.push(request.baseModel.replace(/\.safetensors$/i, ''));
  }
  if (request.aspect && request.mode === 'txt2img') {
    parts.push(request.aspect.replace('*', '×'));
  }
  if (request.performance) {
    parts.push(request.performance);
  }
  if (request.imageNumber && request.imageNumber > 1) {
    parts.push(`×${request.imageNumber}`);
  }
  return parts.join(' · ');
}

function baseEmbed(job: JobRecord): EmbedBuilder {
  const request = job.request;
  const embed = new EmbedBuilder().setTitle(truncate(request.prompt || job.label, 256));
  const lines = [detailsLine(job)];
  if (request.negativePrompt) {
    lines.push(`Negative: ${truncate(request.negativePrompt, 300)}`);
  }
  if (request.prompt.length > 256) {
    lines.unshift(truncate(request.prompt, 1500));
  }
  embed.setDescription(lines.join('\n'));
  return embed;
}

export function queuedEmbed(job: JobRecord, position: number): EmbedBuilder {
  return baseEmbed(job)
    .setColor(colors.queued)
    .setFooter({ text: `${job.userName} · queued #${position}` });
}

export function runningEmbed(job: JobRecord, progress: JobProgress | undefined, hasPreview: boolean): EmbedBuilder {
  const embed = baseEmbed(job).setColor(colors.running);
  const bar = progress ? `${progressBar(progress.percent)} · ${progress.text}` : 'Starting …';
  embed.setDescription(`${embed.data.description ?? ''}\n\n${bar}`);
  embed.setFooter({ text: `${job.userName} · generating` });
  if (hasPreview) {
    embed.setImage('attachment://preview.jpg');
  }
  return embed;
}

export function doneEmbed(job: JobRecord, imageName: string | undefined): EmbedBuilder {
  const result = job.result;
  const seconds = result ? (result.elapsedMs / 1000).toFixed(1) : '?';
  const embed = baseEmbed(job)
    .setColor(colors.done)
    .setFooter({ text: `${job.userName} · seed ${result?.seed ?? '?'} · ${seconds}s` })
    .setTimestamp();
  if (imageName) {
    embed.setImage(`attachment://${imageName}`);
  }
  return embed;
}

export function failedEmbed(job: JobRecord): EmbedBuilder {
  const cancelled = job.state === 'cancelled';
  return baseEmbed(job)
    .setColor(cancelled ? colors.cancelled : colors.failed)
    .setDescription(cancelled ? 'Cancelled.' : `Failed: ${truncate(job.error ?? 'unknown error', 900)}`)
    .setFooter({ text: job.userName });
}

export function attachment(buffer: Buffer, name: string): AttachmentBuilder {
  return new AttachmentBuilder(buffer, { name });
}
