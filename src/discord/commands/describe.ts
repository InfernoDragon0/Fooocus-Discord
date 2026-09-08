import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { toDataUri } from '../../fooocus/images.js';
import type { DescribeMethod } from '../../fooocus/types.js';
import { newJobId } from '../../queue/job-store.js';
import { fetchAttachmentImage } from '../attachments.js';
import { imagineRow } from '../buttons.js';
import { truncate } from '../render.js';
import type { Command } from './index.js';

export const describe: Command = {
  data: new SlashCommandBuilder()
    .setName('describe')
    .setDescription('Turn an image into a prompt')
    .addAttachmentOption((option) => option.setName('image').setDescription('Image to describe').setRequired(true))
    .addStringOption((option) =>
      option
        .setName('type')
        .setDescription('Which describer to use')
        .addChoices(
          { name: 'Photograph', value: 'Photograph' },
          { name: 'Art/Anime', value: 'Art/Anime' },
          { name: 'Both', value: 'both' },
        ),
    ),
  async execute(interaction, { ctx }) {
    const file = interaction.options.getAttachment('image', true);
    const choice = interaction.options.getString('type') ?? 'Photograph';
    const methods: DescribeMethod[] = choice === 'both' ? ['Photograph', 'Art/Anime'] : [choice as DescribeMethod];
    await interaction.deferReply();
    const normalized = await fetchAttachmentImage(file, ctx);
    const result = await ctx.fooocus.describe(toDataUri(normalized.png), methods, true);
    if (!result.prompt) {
      await interaction.editReply({ content: 'Fooocus could not describe that image.' });
      return;
    }
    const job = {
      id: newJobId(),
      userId: interaction.user.id,
      userName: interaction.user.displayName,
      channelId: interaction.channelId,
      request: {
        mode: 'txt2img' as const,
        prompt: result.prompt,
        ...(result.styles ? { styles: result.styles } : {}),
        performance: ctx.config.generation.defaultPerformance,
        ...(ctx.config.generation.presetLoras ? {} : { clearPresetLoras: true }),
      },
      label: 'Describe',
      state: 'done' as const,
      createdAt: Date.now(),
      result: { images: [], seed: '0', elapsedMs: 0 },
    };
    ctx.store.put(job);
    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('Description')
      .setDescription(truncate(result.prompt, 4000))
      .setThumbnail(file.url)
      .setFooter({ text: `${interaction.user.displayName} · ${methods.join(' + ')}` });
    await interaction.editReply({ embeds: [embed], components: imagineRow(job.id) });
  },
};
