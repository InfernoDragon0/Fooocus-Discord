import { SlashCommandBuilder } from 'discord.js';
import { toDataUri } from '../../fooocus/images.js';
import type { InpaintMode } from '../../fooocus/types.js';
import { fetchAttachmentImage } from '../attachments.js';
import { handleAutocomplete } from '../autocomplete.js';
import { addCommonOptions, readCommonOptions } from '../options.js';
import type { Command } from './index.js';

export const inpaint: Command = {
  data: addCommonOptions(
    new SlashCommandBuilder()
      .setName('inpaint')
      .setDescription('Change part of an image described by text')
      .addAttachmentOption((option) => option.setName('image').setDescription('Image to edit').setRequired(true))
      .addStringOption((option) =>
        option
          .setName('detect')
          .setDescription('What to select for editing, e.g. "the hat" or "background"')
          .setRequired(true)
          .setMaxLength(200),
      )
      .addStringOption((option) =>
        option.setName('prompt').setDescription('What the selected area should become').setRequired(true).setMaxLength(2000),
      )
      .addStringOption((option) =>
        option
          .setName('mode')
          .setDescription('Inpaint method')
          .addChoices(
            { name: 'Inpaint or Outpaint (default)', value: 'default' },
            { name: 'Improve Detail (face, hand, eyes)', value: 'detail' },
            { name: 'Modify Content (add objects, change background)', value: 'modify' },
          ),
      ),
  ),
  async execute(interaction, { ctx, presenter }) {
    const prompt = interaction.options.getString('prompt', true);
    const detect = interaction.options.getString('detect', true);
    const mode = (interaction.options.getString('mode') as InpaintMode | null) ?? 'default';
    const params = readCommonOptions(interaction, ctx, prompt);
    const file = interaction.options.getAttachment('image', true);
    await interaction.deferReply();
    const normalized = await fetchAttachmentImage(file, ctx);
    const image = toDataUri(normalized.png);
    await interaction.editReply({ content: `Finding "${detect}" in the image …` });
    const mask = await ctx.fooocus.generateMask(image, detect);
    await presenter.submit(
      interaction,
      { ...params, mode: 'inpaint', image, mask, inpaintMode: mode, additionalPrompt: prompt, imageNumber: 1 },
      'Inpaint',
    );
  },
  autocomplete: handleAutocomplete,
};
