import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from './index.js';

const strip = (name: string): string => name.replace(/\.safetensors$/i, '');

export const models: Command = {
  data: new SlashCommandBuilder().setName('models').setDescription('List available models, LoRAs and defaults'),
  async execute(interaction, { ctx }) {
    if (!ctx.fooocus.connected) {
      await interaction.reply({ content: 'Fooocus is not available right now.', flags: MessageFlags.Ephemeral });
      return;
    }
    const caps = ctx.fooocus.capabilities();
    const allowed = ctx.config.generation.allowedModels;
    const modelList = (allowed ? caps.models.filter((name) => allowed.includes(name)) : caps.models).map(strip);
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('Fooocus capabilities')
      .addFields(
        { name: `Models (${modelList.length})`, value: modelList.join('\n') || 'none' },
        { name: `LoRAs (${caps.loras.length})`, value: caps.loras.map(strip).join('\n') || 'none' },
        { name: 'Performance', value: caps.performances.join(', ') },
        {
          name: 'Styles',
          value: `${caps.styles.length} available; default: ${(ctx.config.generation.defaultStyles ?? caps.defaults.styles).join(', ') || 'none'}`,
        },
        {
          name: 'Preset LoRAs',
          value: ctx.config.generation.presetLoras
            ? caps.defaults.loras
                .filter((lora) => lora.enabled && lora.name !== 'None')
                .map((lora) => `${strip(lora.name)} (${lora.weight})`)
                .join(', ') || 'none'
            : 'disabled',
        },
        {
          name: 'Defaults',
          value: `${strip(caps.defaults.model)} · ${caps.defaults.aspect.replace('*', '×')} · ${ctx.config.generation.defaultPerformance} · ${ctx.config.generation.defaultCount} image(s)`,
        },
      );
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
