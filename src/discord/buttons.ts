import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { JobRecord } from '../queue/job-store.js';

export type ButtonAction =
  | 'u'
  | 'vs'
  | 'vS'
  | 'up15'
  | 'up2'
  | 'zoom'
  | 'pl'
  | 'pr'
  | 'pt'
  | 'pb'
  | 'rr'
  | 'cancel'
  | 'imagine';

const prefix = 'mf';

export interface ButtonRef {
  action: ButtonAction;
  jobId: string;
  index: number;
}

export function encodeCustomId(action: ButtonAction, jobId: string, index = 0): string {
  return `${prefix}|${action}|${jobId}|${index}`;
}

export function decodeCustomId(customId: string): ButtonRef | undefined {
  const [tag, action, jobId, index] = customId.split('|');
  if (tag !== prefix || !action || !jobId) {
    return undefined;
  }
  return { action: action as ButtonAction, jobId, index: Number(index ?? 0) };
}

function button(action: ButtonAction, jobId: string, label: string, index = 0, style = ButtonStyle.Secondary): ButtonBuilder {
  return new ButtonBuilder().setCustomId(encodeCustomId(action, jobId, index)).setLabel(label).setStyle(style);
}

export function cancelRow(jobId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(button('cancel', jobId, 'Cancel', 0, ButtonStyle.Danger)),
  ];
}

export function singleImageRows(jobId: string, index: number): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      button('vs', jobId, 'Vary (Subtle)', index),
      button('vS', jobId, 'Vary (Strong)', index),
      button('up15', jobId, 'Upscale 1.5x', index),
      button('up2', jobId, 'Upscale 2x', index),
      button('rr', jobId, 'Reroll', index, ButtonStyle.Primary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      button('zoom', jobId, 'Zoom Out', index),
      button('pl', jobId, '←', index),
      button('pr', jobId, '→', index),
      button('pt', jobId, '↑', index),
      button('pb', jobId, '↓', index),
    ),
  ];
}

export function gridRows(jobId: string, count: number): ActionRowBuilder<ButtonBuilder>[] {
  const indexes = [...Array(Math.min(count, 4)).keys()];
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...indexes.map((index) => button('u', jobId, `U${index + 1}`, index, ButtonStyle.Primary)),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...indexes.map((index) => button('vs', jobId, `V${index + 1}`, index)),
      button('rr', jobId, 'Reroll', 0),
    ),
  ];
}

export function rerollRow(jobId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(button('rr', jobId, 'Reroll', 0, ButtonStyle.Primary))];
}

export function imagineRow(jobId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(button('imagine', jobId, 'Imagine this', 0, ButtonStyle.Primary)),
  ];
}

export function resultRows(job: JobRecord): ActionRowBuilder<ButtonBuilder>[] {
  const count = job.result?.images.length ?? 0;
  if (count === 0) {
    return rerollRow(job.id);
  }
  return count === 1 ? singleImageRows(job.id, 0) : gridRows(job.id, count);
}
