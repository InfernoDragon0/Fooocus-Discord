import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { truncate } from '../render.js';
import type { Command } from './index.js';

export const queue: Command = {
  data: new SlashCommandBuilder().setName('queue').setDescription('Show the generation queue'),
  async execute(interaction, { ctx }) {
    const jobs = ctx.queue.snapshot();
    if (jobs.length === 0) {
      await interaction.reply({ content: 'The queue is empty.', flags: MessageFlags.Ephemeral });
      return;
    }
    const lines = jobs.map((job, index) => {
      const state = index === 0 && job.state === 'running' ? 'running' : `#${index}`;
      return `${state} · ${job.userName} · ${job.label} · ${truncate(job.request.prompt || '(no prompt)', 60)}`;
    });
    await interaction.reply({ content: lines.join('\n'), flags: MessageFlags.Ephemeral });
  },
};
