import type { ButtonInteraction, Interaction } from 'discord.js';
import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import type { AppConfig, Secrets } from '../config.js';
import type { FooocusClient } from '../fooocus/client.js';
import type { Logger } from '../logger.js';
import type { JobStore } from '../queue/job-store.js';
import type { WorkerQueue } from '../queue/worker-queue.js';
import { decodeCustomId } from './buttons.js';
import { commands } from './commands/index.js';
import type { BotContext } from './context.js';
import { UserError } from './context.js';
import { JobPresenter } from './jobs.js';

export interface DiscordBotDeps {
  config: AppConfig;
  secrets: Secrets;
  fooocus: FooocusClient;
  queue: WorkerQueue;
  store: JobStore;
  logger: Logger;
}

async function replyError(interaction: Interaction, message: string): Promise<void> {
  if (!interaction.isRepliable()) {
    return;
  }
  const payload = { content: message, embeds: [], components: [], files: [] };
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload).catch(() => undefined);
  } else {
    await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => undefined);
  }
}

export async function startDiscord(deps: DiscordBotDeps): Promise<Client> {
  const discord = new Client({ intents: [GatewayIntentBits.Guilds] });
  const ctx: BotContext = { ...deps, discord };
  const presenter = new JobPresenter(ctx);
  const byName = new Map(commands.map((command) => [command.data.name, command]));

  const handleButton = async (interaction: ButtonInteraction): Promise<void> => {
    const ref = decodeCustomId(interaction.customId);
    if (!ref) {
      return;
    }
    if (ref.action === 'cancel') {
      const cancelled = ctx.queue.cancel(ref.jobId, interaction.user.id);
      await interaction.reply({
        content: cancelled ? 'Cancelling …' : 'Only the requester can cancel this job.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const job = ctx.store.get(ref.jobId);
    if (!job || job.state !== 'done') {
      await interaction.reply({
        content: 'That result is no longer available. Run the command again.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (ref.action === 'u') {
      await presenter.postSingle(interaction, job, ref.index);
      return;
    }
    const request = await presenter.derive(job, ref.action, ref.index);
    const labels: Record<string, string> = {
      vs: 'Vary (Subtle)',
      vS: 'Vary (Strong)',
      up15: 'Upscale 1.5x',
      up2: 'Upscale 2x',
      zoom: 'Zoom Out',
      pl: 'Pan left',
      pr: 'Pan right',
      pt: 'Pan up',
      pb: 'Pan down',
      rr: 'Reroll',
      imagine: 'Imagine',
    };
    await presenter.submit(interaction, request, labels[ref.action] ?? ref.action, job.id);
  };

  discord.on(Events.InteractionCreate, (interaction) => {
    void (async () => {
      try {
        if (interaction.isChatInputCommand()) {
          const command = byName.get(interaction.commandName);
          if (!command) {
            await replyError(interaction, 'Unknown command.');
            return;
          }
          await command.execute(interaction, { ctx, presenter });
        } else if (interaction.isAutocomplete()) {
          const command = byName.get(interaction.commandName);
          await command?.autocomplete?.(interaction, ctx);
        } else if (interaction.isButton()) {
          await handleButton(interaction);
        }
      } catch (error) {
        if (error instanceof UserError) {
          await replyError(interaction, error.message);
          return;
        }
        deps.logger.error({ error }, 'Interaction failed');
        await replyError(interaction, 'Something went wrong while handling that command.');
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    discord.once(Events.ClientReady, (client) => {
      deps.logger.info({ user: client.user.tag, guilds: client.guilds.cache.size }, 'Discord ready');
      resolve();
    });
    discord.login(deps.secrets.DISCORD_TOKEN).catch(reject);
  });
  return discord;
}
