import type { SlashCommandOptionsOnlyBuilder } from 'discord.js';
import { SlashCommandBuilder } from 'discord.js';
import { toDataUri } from '../../fooocus/images.js';
import type { CnType, ImagePromptEntry } from '../../fooocus/types.js';
import { cnTypes } from '../../fooocus/types.js';
import { fetchAttachmentImage } from '../attachments.js';
import { handleAutocomplete } from '../autocomplete.js';
import { addCommonOptions, readCommonOptions } from '../options.js';
import type { Command } from './index.js';

const slots = [1, 2, 3, 4];
const typeChoices = cnTypes.map((name) => ({ name, value: name }));

function withSlots(builder: SlashCommandOptionsOnlyBuilder): SlashCommandOptionsOnlyBuilder {
  builder.addAttachmentOption((option) =>
    option.setName('image1').setDescription('Reference image 1').setRequired(true),
  );
  builder.addStringOption((option) =>
    option.setName('prompt').setDescription('Optional prompt to combine with the references').setMaxLength(2000),
  );
  for (const slot of slots.slice(1)) {
    builder.addAttachmentOption((option) =>
      option.setName(`image${slot}`).setDescription(`Reference image ${slot}`),
    );
  }
  builder.addStringOption((option) =>
    option
      .setName('type')
      .setDescription('How to use the reference images')
      .addChoices(...typeChoices),
  );
  builder.addNumberOption((option) =>
    option.setName('weight').setDescription('Influence of the references (0-2)').setMinValue(0).setMaxValue(2),
  );
  builder.addNumberOption((option) =>
    option.setName('stop').setDescription('Stop applying references at this fraction (0-1)').setMinValue(0).setMaxValue(1),
  );
  for (const slot of slots.slice(1)) {
    builder.addStringOption((option) =>
      option
        .setName(`type${slot}`)
        .setDescription(`Type override for image ${slot}`)
        .addChoices(...typeChoices),
    );
  }
  return builder;
}

export const blend: Command = {
  data: addCommonOptions(
    withSlots(
      new SlashCommandBuilder()
        .setName('blend')
        .setDescription('Generate using reference images (image prompt, face swap, canny, CPDS)'),
    ),
  ),
  async execute(interaction, { ctx, presenter }) {
    const prompt = interaction.options.getString('prompt') ?? '';
    const params = readCommonOptions(interaction, ctx, prompt);
    const defaultType = (interaction.options.getString('type') as CnType | null) ?? 'ImagePrompt';
    const weight = interaction.options.getNumber('weight');
    const stop = interaction.options.getNumber('stop');
    const images: ImagePromptEntry[] = [];
    for (const slot of slots) {
      const file = interaction.options.getAttachment(`image${slot}`);
      if (!file) {
        continue;
      }
      const normalized = await fetchAttachmentImage(file, ctx);
      const type = (slot === 1 ? null : (interaction.options.getString(`type${slot}`) as CnType | null)) ?? defaultType;
      images.push({
        image: toDataUri(normalized.png),
        type,
        ...(weight !== null ? { weight } : {}),
        ...(stop !== null ? { stop } : {}),
      });
    }
    await presenter.submit(interaction, { ...params, mode: 'imageprompt', images }, 'Blend');
  },
  autocomplete: handleAutocomplete,
};
