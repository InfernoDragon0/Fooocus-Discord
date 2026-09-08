import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
} from 'discord.js';
import { ApplicationIntegrationType, InteractionContextType } from 'discord.js';
import type { BotContext } from '../context.js';
import type { JobPresenter } from '../jobs.js';
import { blend } from './blend.js';
import { cancel } from './cancel.js';
import { describe } from './describe.js';
import { imagine } from './imagine.js';
import { inpaint } from './inpaint.js';
import { models } from './models.js';
import { queue } from './queue.js';

export interface CommandRuntime {
  ctx: BotContext;
  presenter: JobPresenter;
}

export interface Command {
  data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder;
  execute(interaction: ChatInputCommandInteraction, runtime: CommandRuntime): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction, ctx: BotContext): Promise<void>;
}

export const commands: Command[] = [imagine, blend, inpaint, describe, queue, cancel, models];

for (const command of commands) {
  command.data
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel);
}
