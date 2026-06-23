import { loadConfig } from './config.js';
import { migrate, loadTrackedBoundary } from './db.js';
import { createApi, type DiscordStatus } from './api.js';
import { createDiscordClient } from './bot.js';

async function main() {
  const config = loadConfig();
  migrate(config);
  const boundary = loadTrackedBoundary(config);
  let discordStatus: DiscordStatus = config.skipDiscordLogin ? 'skipped' : 'disconnected';
  const api = createApi({ config, discordStatus: () => discordStatus });

  if (!config.skipDiscordLogin) {
    const client = createDiscordClient(config, boundary, {
      onRawMessageStored(input, stored) {
        api.broadcast('discord.message', {
          messageId: input.messageId,
          channelId: input.channelId,
          authorId: input.authorId,
          timestamp: input.messageTimestamp,
          stored: Boolean(stored),
        });
        api.broadcast('stats.updated', { reason: 'discord.message', channelId: input.channelId });
      },
    });
    client.on('clientReady', () => {
      discordStatus = 'connected';
      api.broadcast('discord.connected', { connected: true });
    });
    client.on('shardDisconnect', () => {
      discordStatus = 'disconnected';
      api.broadcast('discord.disconnected', { connected: false });
    });
    await client.login(config.discordToken);
  }

  await api.app.listen({ host: config.apiHost, port: config.apiPort });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
