import type { Attachment } from 'discord.js';
import type { NormalizedImage } from '../fooocus/images.js';
import { normalizeImage } from '../fooocus/images.js';
import type { BotContext } from './context.js';
import { UserError } from './context.js';

export async function fetchAttachmentImage(attachment: Attachment, ctx: BotContext): Promise<NormalizedImage> {
  if (!attachment.contentType?.startsWith('image/')) {
    throw new UserError(`${attachment.name} is not an image`);
  }
  if (attachment.size > ctx.config.discord.maxInputBytes) {
    throw new UserError(`${attachment.name} is larger than ${Math.round(ctx.config.discord.maxInputBytes / 1e6)} MB`);
  }
  const response = await fetch(attachment.url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new UserError(`Could not download ${attachment.name}`);
  }
  try {
    return await normalizeImage(Buffer.from(await response.arrayBuffer()));
  } catch {
    throw new UserError(`${attachment.name} could not be decoded as an image`);
  }
}
