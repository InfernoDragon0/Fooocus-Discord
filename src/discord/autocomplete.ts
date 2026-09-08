import type { AutocompleteInteraction } from 'discord.js';
import type { BotContext } from './context.js';

interface Choice {
  name: string;
  value: string;
}

const maxChoices = 25;
const maxValueLength = 100;

function rank(candidates: string[], query: string): string[] {
  const lower = query.toLowerCase();
  const starts = candidates.filter((name) => name.toLowerCase().startsWith(lower));
  const contains = candidates.filter((name) => !starts.includes(name) && name.toLowerCase().includes(lower));
  return [...starts, ...contains];
}

function orientation(width: number, height: number): string {
  if (width === height) {
    return 'square';
  }
  return width > height ? 'landscape' : 'portrait';
}

export function modelChoices(ctx: BotContext, query: string): Choice[] {
  const caps = ctx.fooocus.capabilities();
  const allowed = ctx.config.generation.allowedModels;
  const models = allowed ? caps.models.filter((name) => allowed.includes(name)) : caps.models;
  return rank(models, query)
    .slice(0, maxChoices)
    .map((name) => ({ name: name.replace(/\.safetensors$/i, ''), value: name }));
}

export function loraChoices(ctx: BotContext, query: string): Choice[] {
  return rank(ctx.fooocus.capabilities().loras, query)
    .slice(0, maxChoices)
    .map((name) => ({ name: name.replace(/\.safetensors$/i, ''), value: name }));
}

export function aspectChoices(ctx: BotContext, query: string): Choice[] {
  const ratios = ctx.fooocus.capabilities().aspectRatios;
  const normalized = query.replace(/[x×:]/g, '*').replace(/\s+/g, '');
  const matches = ratios.filter((ratio) => ratio.raw.includes(normalized) || ratio.label.includes(normalized));
  return matches.slice(0, maxChoices).map((ratio) => {
    const text = /∣ ([\d:]+)/.exec(ratio.label)?.[1] ?? '';
    return {
      name: `${ratio.width}×${ratio.height} (${text}) ${orientation(ratio.width, ratio.height)}`,
      value: ratio.raw,
    };
  });
}

export function styleChoices(ctx: BotContext, query: string): Choice[] {
  const styles = ctx.fooocus.capabilities().styles;
  const parts = query.split(',');
  const current = parts.pop()?.trim() ?? '';
  const prefix = parts.map((part) => part.trim()).filter(Boolean);
  const prefixText = prefix.length ? `${prefix.join(', ')}, ` : '';
  const candidates = rank(
    styles.filter((name) => !prefix.some((chosen) => chosen.toLowerCase() === name.toLowerCase())),
    current,
  );
  return candidates
    .map((name) => ({ name: `${prefixText}${name}`, value: `${prefixText}${name}` }))
    .filter((choice) => choice.value.length <= maxValueLength)
    .slice(0, maxChoices)
    .map((choice) => ({ ...choice, name: choice.name.length > 100 ? `…${choice.name.slice(-99)}` : choice.name }));
}

export async function handleAutocomplete(interaction: AutocompleteInteraction, ctx: BotContext): Promise<void> {
  if (!ctx.fooocus.connected) {
    await interaction.respond([]);
    return;
  }
  const focused = interaction.options.getFocused(true);
  const query = focused.value;
  const choices = (() => {
    switch (focused.name) {
      case 'model':
        return modelChoices(ctx, query);
      case 'lora':
        return loraChoices(ctx, query);
      case 'aspect':
        return aspectChoices(ctx, query);
      case 'styles':
        return styleChoices(ctx, query);
      default:
        return [];
    }
  })();
  await interaction.respond(choices);
}
