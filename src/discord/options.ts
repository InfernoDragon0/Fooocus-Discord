import type { ChatInputCommandInteraction, SlashCommandOptionsOnlyBuilder } from 'discord.js';
import type { BaseParams, Performance } from '../fooocus/types.js';
import { performances } from '../fooocus/types.js';
import type { BotContext } from './context.js';
import { UserError } from './context.js';

export const promptExpansionStyle = 'Fooocus V2';
const maxSeed = 9223372036854775807n;

export function addCommonOptions(builder: SlashCommandOptionsOnlyBuilder): SlashCommandOptionsOnlyBuilder {
  return builder
    .addStringOption((option) =>
      option.setName('negative').setDescription('Things to avoid in the image').setMaxLength(1000),
    )
    .addStringOption((option) =>
      option.setName('model').setDescription('SDXL checkpoint to use').setAutocomplete(true),
    )
    .addStringOption((option) =>
      option.setName('styles').setDescription('Comma-separated style names').setAutocomplete(true),
    )
    .addStringOption((option) =>
      option.setName('aspect').setDescription('Aspect ratio, e.g. 1152*896').setAutocomplete(true),
    )
    .addStringOption((option) =>
      option
        .setName('performance')
        .setDescription('Speed/quality trade-off')
        .addChoices(...performances.map((name) => ({ name, value: name }))),
    )
    .addIntegerOption((option) =>
      option.setName('count').setDescription('Number of images').setMinValue(1).setMaxValue(8),
    )
    .addStringOption((option) => option.setName('seed').setDescription('Seed for reproducible results'))
    .addStringOption((option) => option.setName('lora').setDescription('Extra LoRA to apply').setAutocomplete(true))
    .addNumberOption((option) =>
      option.setName('lora_weight').setDescription('Weight for the extra LoRA').setMinValue(-2).setMaxValue(2),
    )
    .addNumberOption((option) =>
      option.setName('cfg').setDescription('Guidance scale').setMinValue(1).setMaxValue(30),
    )
    .addNumberOption((option) =>
      option.setName('sharpness').setDescription('Image sharpness').setMinValue(0).setMaxValue(30),
    )
    .addBooleanOption((option) =>
      option.setName('no_expansion').setDescription('Disable Fooocus V2 prompt expansion'),
    );
}

export function parseStyles(input: string, available: string[]): string[] {
  const lookup = new Map(available.map((name) => [name.toLowerCase(), name]));
  const chosen: string[] = [];
  for (const token of input.split(',')) {
    const trimmed = token.trim();
    if (!trimmed) {
      continue;
    }
    const match = lookup.get(trimmed.toLowerCase());
    if (!match) {
      throw new UserError(`Unknown style: ${trimmed}`);
    }
    if (!chosen.includes(match)) {
      chosen.push(match);
    }
  }
  return chosen;
}

export function resolveModel(input: string, available: string[], allowed: string[] | null): string {
  const candidates = allowed ? available.filter((name) => allowed.includes(name)) : available;
  const lower = input.toLowerCase();
  const match =
    candidates.find((name) => name.toLowerCase() === lower) ??
    candidates.find((name) => name.toLowerCase() === `${lower}.safetensors`) ??
    candidates.find((name) => name.toLowerCase().includes(lower));
  if (!match) {
    throw new UserError(`Unknown model: ${input}`);
  }
  return match;
}

export function readCommonOptions(interaction: ChatInputCommandInteraction, ctx: BotContext, prompt: string): BaseParams {
  const caps = ctx.fooocus.capabilities();
  const params: BaseParams = { prompt };
  const negative = interaction.options.getString('negative');
  if (negative) {
    params.negativePrompt = negative;
  }
  const model = interaction.options.getString('model');
  if (model) {
    params.baseModel = resolveModel(model, caps.models, ctx.config.generation.allowedModels);
  }
  const stylesInput = interaction.options.getString('styles');
  let styles = stylesInput
    ? parseStyles(stylesInput, caps.styles)
    : [...(ctx.config.generation.defaultStyles ?? caps.defaults.styles)];
  if (interaction.options.getBoolean('no_expansion')) {
    styles = styles.filter((name) => name !== promptExpansionStyle);
  }
  params.styles = styles;
  if (!ctx.config.generation.presetLoras) {
    params.clearPresetLoras = true;
  }
  const aspect = interaction.options.getString('aspect');
  if (aspect) {
    const normalized = aspect.replace(/[x×:]/g, '*').replace(/\s+/g, '');
    if (!caps.aspectRatios.some((ratio) => ratio.raw === normalized)) {
      throw new UserError(`Unknown aspect ratio: ${aspect}`);
    }
    params.aspect = normalized;
  }
  const performance = interaction.options.getString('performance') as Performance | null;
  params.performance = performance ?? ctx.config.generation.defaultPerformance;
  const count = interaction.options.getInteger('count');
  params.imageNumber = Math.min(count ?? ctx.config.generation.defaultCount, ctx.config.generation.maxCount);
  const seed = interaction.options.getString('seed');
  if (seed) {
    if (!/^\d+$/.test(seed) || BigInt(seed) > maxSeed) {
      throw new UserError('Seed must be a non-negative integer');
    }
    params.seed = seed;
  }
  const lora = interaction.options.getString('lora');
  if (lora) {
    const match = caps.loras.find((name) => name.toLowerCase().includes(lora.toLowerCase()));
    if (!match) {
      throw new UserError(`Unknown LoRA: ${lora}`);
    }
    params.loras = [{ name: match, weight: interaction.options.getNumber('lora_weight') ?? 1 }];
  }
  const cfg = interaction.options.getNumber('cfg');
  if (cfg !== null) {
    params.cfgScale = cfg;
  }
  const sharpness = interaction.options.getNumber('sharpness');
  if (sharpness !== null) {
    params.sharpness = sharpness;
  }
  return params;
}
