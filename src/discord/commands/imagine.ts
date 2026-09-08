import { SlashCommandBuilder } from 'discord.js';
import { handleAutocomplete } from '../autocomplete.js';
import { addCommonOptions, readCommonOptions } from '../options.js';
import type { Command } from './index.js';

export const imagine: Command = {
  data: addCommonOptions(
    new SlashCommandBuilder()
      .setName('imagine')
      .setDescription('Generate images from a prompt')
      .addStringOption((option) =>
        option.setName('prompt').setDescription('What to draw').setRequired(true).setMaxLength(2000),
      ),
  ),
  async execute(interaction, { ctx, presenter }) {
    const prompt = interaction.options.getString('prompt', true);
    const params = readCommonOptions(interaction, ctx, prompt);
    await presenter.submit(interaction, { ...params, mode: 'txt2img' }, 'Imagine');
  },
  autocomplete: handleAutocomplete,
};
