import { loadConfig } from './config.js';
import { migrate, loadTrackedBoundary, openDatabase, storeRawMessage, SEED_USER_ID } from './db.js';
import { createApi, type DiscordStatus } from './api.js';
import { createDiscordClient, createChannelMessageSender } from './bot.js';
import { createNotifier } from './notifications.js';
import { awardMessageStats } from './stats.js';

/** Local calendar date (YYYY-MM-DD) for an ISO instant in the configured timezone. */
function localDateFor(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(iso),
  );
}

async function main() {
  const config = loadConfig();
  migrate(config);
  const db = openDatabase(config.databasePath);
  const boundary = loadTrackedBoundary(config);
  let discordStatus: DiscordStatus = config.skipDiscordLogin ? 'skipped' : 'disconnected';

  // Notifications are always stored locally. Discord delivery is enabled only when a
  // system-output channel is configured and Discord login is active; otherwise the app
  // stays healthy in dashboard-only notification mode.
  if (config.systemOutputChannelId == null) {
    console.log('Discord notifications skipped: SYSTEM_OUTPUT_CHANNEL_ID not configured.');
  }
  const deliveryEnabled = !config.skipDiscordLogin && config.systemOutputChannelId != null;
  let broadcast: (event: string, data: unknown) => void = () => {};
  let systemSend: ((message: string) => Promise<string | null>) | null = null;
  const notifier = createNotifier({
    db,
    send: deliveryEnabled ? (message) => (systemSend ? systemSend(message) : Promise.resolve(null)) : null,
    onStored: (record) =>
      broadcast('notification', { id: record.id, type: record.type, title: record.title, createdAt: record.createdAt }),
    onError: (error) => console.error('notification delivery failed:', error instanceof Error ? error.message : error),
  });

  const api = createApi({ config, db, notifier, discordStatus: () => discordStatus });
  broadcast = api.broadcast;

  if (!config.skipDiscordLogin) {
    const client = createDiscordClient(config, boundary, {
      storeRawMessage: (input) => storeRawMessage(db, input),
      onRawMessageStored(input, stored) {
        api.broadcast('discord.message', {
          messageId: input.messageId,
          channelId: input.channelId,
          authorId: input.authorId,
          timestamp: input.messageTimestamp,
          stored: Boolean(stored),
        });
        if (stored) {
          // A thread message resolves its stat category from the parent channel.
          const category =
            config.channelCategories[input.channelId] ??
            (input.parentChannelId ? config.channelCategories[input.parentChannelId] : undefined);
          if (category) {
            const contentLength = Number((input.metadata as { contentLength?: number } | null)?.contentLength ?? input.content.length);
            const result = awardMessageStats(db, {
              userId: SEED_USER_ID,
              category,
              contentLength,
              content: config.storeMessageContent ? input.content : '',
              localDate: localDateFor(input.messageTimestamp, config.timezone),
              sourceId: input.messageId,
            });
            if (result?.changed.length) api.broadcast('stats.player.updated', { userId: SEED_USER_ID });
          }
        }
        api.broadcast('stats.updated', { reason: 'discord.message', channelId: input.channelId });
      },
    });
    client.on('clientReady', () => {
      discordStatus = 'connected';
      if (deliveryEnabled && config.systemOutputChannelId) {
        systemSend = createChannelMessageSender(client, config.systemOutputChannelId);
      }
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
