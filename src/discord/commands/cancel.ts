import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from './index.js';

export const cancel: Command = {
  data: new SlashCommandBuilder().setName('cancel').setDescription('Cancel your queued or running jobs'),
  async execute(interaction, { ctx }) {
    const count = ctx.queue.cancelOwnedBy(interaction.user.id);
    await interaction.reply({
      content: count === 0 ? 'You have no jobs in the queue.' : `Cancelled ${count} job${count === 1 ? '' : 's'}.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
