import type { ButtonInteraction, ChatInputCommandInteraction, Message } from 'discord.js';
import { MessageFlags } from 'discord.js';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { blackMask, fitForDiscord, previewJpeg, toDataUri } from '../fooocus/images.js';
import type { GenerationEvent, GenerationRequest, JobProgress } from '../fooocus/types.js';
import type { JobRecord } from '../queue/job-store.js';
import { newJobId } from '../queue/job-store.js';
import type { EnqueueResult } from '../queue/worker-queue.js';
import type { ButtonAction } from './buttons.js';
import { cancelRow, resultRows, singleImageRows } from './buttons.js';
import type { BotContext } from './context.js';
import { UserError } from './context.js';
import { ProgressEditor } from './progress-editor.js';
import { attachment, doneEmbed, failedEmbed, queuedEmbed, runningEmbed } from './render.js';

type Interaction = ChatInputCommandInteraction | ButtonInteraction;

const interactionTokenLifetimeMs = 14 * 60_000;

interface Presentation {
  message: Message;
  editor: ProgressEditor;
  lastPreview: string | undefined;
}

export function enqueueFailureText(result: EnqueueResult & { ok: false }): string {
  switch (result.reason) {
    case 'user-limit':
      return 'You already have a job in the queue. Wait for it to finish or use /cancel.';
    case 'queue-full':
      return 'The queue is full right now. Try again in a bit.';
    case 'offline':
      return 'Fooocus is not available right now.';
  }
}

export class JobPresenter {
  private readonly active = new Map<string, Presentation>();

  constructor(private readonly ctx: BotContext) {
    ctx.queue.on('position', (job, position) => this.onPosition(job, position));
    ctx.queue.on('started', (job) => this.onStarted(job));
    ctx.queue.on('progress', (job, event) => this.onProgress(job, event));
    ctx.queue.on('finished', (job) => void this.onFinished(job));
  }

  async submit(
    interaction: Interaction,
    request: GenerationRequest,
    label: string,
    parentJobId?: string,
  ): Promise<void> {
    const check = this.ctx.queue.canEnqueue(interaction.user.id);
    if (!check.ok) {
      await interaction.reply({ content: enqueueFailureText(check), flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply();
    const message = await interaction.fetchReply();
    const job: JobRecord = {
      id: newJobId(),
      userId: interaction.user.id,
      userName: interaction.user.displayName,
      channelId: interaction.channelId ?? message.channelId,
      messageId: message.id,
      request,
      label,
      state: 'queued',
      createdAt: Date.now(),
      ...(parentJobId ? { parentJobId } : {}),
    };
    const edit = (payload: Record<string, unknown>): Promise<unknown> => this.editMessage(interaction, job, payload);
    this.active.set(job.id, {
      message,
      editor: new ProgressEditor(edit, this.ctx.config.discord.progressEditIntervalMs, this.ctx.logger),
      lastPreview: undefined,
    });
    const result = this.ctx.queue.enqueue(job);
    if (!result.ok) {
      this.active.delete(job.id);
      await interaction.editReply({ content: enqueueFailureText(result) });
      return;
    }
    await edit({ embeds: [queuedEmbed(job, result.position)], components: cancelRow(job.id) });
  }

  private async editMessage(interaction: Interaction, job: JobRecord, payload: Record<string, unknown>): Promise<unknown> {
    if (Date.now() - interaction.createdTimestamp < interactionTokenLifetimeMs) {
      return interaction.editReply(payload);
    }
    const channel = await this.ctx.discord.channels.fetch(job.channelId);
    if (!channel?.isTextBased() || !job.messageId) {
      throw new Error('Channel or message unavailable for editing');
    }
    return channel.messages.edit(job.messageId, payload);
  }

  private onPosition(job: JobRecord, position: number): void {
    const presentation = this.active.get(job.id);
    presentation?.editor.update({ embeds: [queuedEmbed(job, position)], components: cancelRow(job.id) });
  }

  private onStarted(job: JobRecord): void {
    const presentation = this.active.get(job.id);
    presentation?.editor.update({ embeds: [runningEmbed(job, undefined, false)], components: cancelRow(job.id) });
  }

  private onProgress(job: JobRecord, event: GenerationEvent): void {
    const presentation = this.active.get(job.id);
    if (!presentation || event.type !== 'progress') {
      return;
    }
    void this.renderProgress(job, presentation, event.progress);
  }

  private async renderProgress(job: JobRecord, presentation: Presentation, progress: JobProgress): Promise<void> {
    const hasPreview = progress.preview !== undefined;
    const payload: Record<string, unknown> = {
      embeds: [runningEmbed(job, progress, hasPreview)],
      components: cancelRow(job.id),
    };
    if (hasPreview && progress.preview !== presentation.lastPreview) {
      presentation.lastPreview = progress.preview;
      const jpeg = await previewJpeg(progress.preview!, this.ctx.config.discord.previewJpegQuality);
      payload.files = [attachment(jpeg, 'preview.jpg')];
      payload.attachments = [];
    }
    presentation.editor.update(payload);
  }

  private async onFinished(job: JobRecord): Promise<void> {
    const presentation = this.active.get(job.id);
    if (!presentation) {
      return;
    }
    this.active.delete(job.id);
    try {
      const payload = job.state === 'done' ? await this.resultPayload(job) : this.failurePayload(job);
      await presentation.editor.flush(payload);
    } catch (error) {
      this.ctx.logger.error({ error, jobId: job.id }, 'Failed to post result');
      await presentation.editor
        .flush({ embeds: [failedEmbed({ ...job, state: 'failed', error: 'Could not upload the result' })], components: [], attachments: [] })
        .catch(() => undefined);
    }
  }

  private failurePayload(job: JobRecord): Record<string, unknown> {
    const { result: _result, ...withoutResult } = job;
    return { embeds: [failedEmbed(job)], components: resultRows(withoutResult), files: [], attachments: [] };
  }

  async resultPayload(job: JobRecord): Promise<Record<string, unknown>> {
    const images = job.result?.images ?? [];
    const buffers = await Promise.all(images.map((image) => this.imageBytes(job, image.index)));
    const maxBytes = this.ctx.config.discord.maxUploadBytes;
    if (buffers.length === 1) {
      const fitted = await fitForDiscord(buffers[0]!, maxBytes);
      const name = `${job.id}-0.${fitted.extension}`;
      return {
        embeds: [doneEmbed(job, name)],
        files: [attachment(fitted.buffer, name)],
        components: resultRows(job),
        attachments: [],
      };
    }
    const files = await Promise.all(
      buffers.map(async (buffer, index) => {
        const fitted = await fitForDiscord(buffer, maxBytes);
        return attachment(fitted.buffer, `${job.id}-${index}.${fitted.extension}`);
      }),
    );
    return {
      embeds: [doneEmbed(job, undefined)],
      files,
      components: resultRows(job),
      attachments: [],
    };
  }

  async imageBytes(job: JobRecord, index: number): Promise<Buffer> {
    const image = job.result?.images[index];
    if (!image) {
      throw new UserError('That image is no longer available.');
    }
    if (image.localPath) {
      try {
        return await readFile(image.localPath);
      } catch {
        return this.ctx.fooocus.fetchFile(image.path);
      }
    }
    return this.ctx.fooocus.fetchFile(image.path);
  }

  async postSingle(interaction: ButtonInteraction, job: JobRecord, index: number): Promise<void> {
    await interaction.deferReply();
    const bytes = await this.imageBytes(job, index);
    const fitted = await fitForDiscord(bytes, this.ctx.config.discord.maxUploadBytes);
    const name = `${job.id}-${index}.${fitted.extension}`;
    const single: JobRecord = { ...job, userName: interaction.user.displayName };
    await interaction.editReply({
      embeds: [doneEmbed(single, name)],
      files: [attachment(fitted.buffer, name)],
      components: singleImageRows(job.id, index),
    });
  }

  async derive(job: JobRecord, action: ButtonAction, index: number): Promise<GenerationRequest> {
    const base = {
      prompt: job.request.prompt,
      ...(job.request.negativePrompt ? { negativePrompt: job.request.negativePrompt } : {}),
      ...(job.request.styles ? { styles: job.request.styles } : {}),
      ...(job.request.performance ? { performance: job.request.performance } : {}),
      ...(job.request.baseModel ? { baseModel: job.request.baseModel } : {}),
      ...(job.request.loras ? { loras: job.request.loras } : {}),
      ...(job.request.clearPresetLoras ? { clearPresetLoras: true } : {}),
      ...(job.request.cfgScale !== undefined ? { cfgScale: job.request.cfgScale } : {}),
      ...(job.request.sharpness !== undefined ? { sharpness: job.request.sharpness } : {}),
      ...(job.request.aspect ? { aspect: job.request.aspect } : {}),
      imageNumber: 1,
    };
    if (action === 'rr') {
      const { seed: _seed, ...rest } = job.request;
      return { ...rest, imageNumber: job.request.imageNumber ?? 1 } as GenerationRequest;
    }
    if (action === 'imagine') {
      return { ...base, mode: 'txt2img', imageNumber: this.ctx.config.generation.defaultCount };
    }
    const bytes = await this.imageBytes(job, index);
    const image = toDataUri(bytes);
    switch (action) {
      case 'vs':
        return { ...base, mode: 'uov', image, method: 'Vary (Subtle)' };
      case 'vS':
        return { ...base, mode: 'uov', image, method: 'Vary (Strong)' };
      case 'up15':
        return { ...base, mode: 'uov', image, method: 'Upscale (1.5x)' };
      case 'up2':
        return { ...base, mode: 'uov', image, method: 'Upscale (2x)' };
      case 'zoom':
      case 'pl':
      case 'pr':
      case 'pt':
      case 'pb': {
        const meta = await sharp(bytes).metadata();
        const mask = toDataUri(await blackMask(meta.width ?? 1024, meta.height ?? 1024));
        const directions = {
          zoom: ['Left', 'Right', 'Top', 'Bottom'],
          pl: ['Left'],
          pr: ['Right'],
          pt: ['Top'],
          pb: ['Bottom'],
        }[action] as GenerationRequest extends { directions: infer D } ? D : never;
        return { ...base, mode: 'outpaint', image, mask, directions };
      }
      default:
        throw new UserError('Unknown action');
    }
  }
}
