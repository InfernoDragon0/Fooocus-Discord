import { REST, Routes } from 'discord.js';
import { loadSecrets } from '../config.js';
import { commands } from './commands/index.js';

const secrets = loadSecrets();
const global = process.argv.includes('--global') || !secrets.GUILD_ID;
const rest = new REST().setToken(secrets.DISCORD_TOKEN);
const body = commands.map((command) => command.data.toJSON());

if (global) {
  const registered = (await rest.put(Routes.applicationCommands(secrets.CLIENT_ID), { body })) as unknown[];
  console.log(`Registered ${registered.length} global commands (can take a few minutes to appear everywhere)`);
  if (secrets.GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(secrets.CLIENT_ID, secrets.GUILD_ID), { body: [] });
    console.log(`Cleared guild commands in ${secrets.GUILD_ID} so they do not appear twice`);
  }
} else {
  const registered = (await rest.put(Routes.applicationGuildCommands(secrets.CLIENT_ID, secrets.GUILD_ID!), {
    body,
  })) as unknown[];
  console.log(`Registered ${registered.length} commands in guild ${secrets.GUILD_ID}`);
}
