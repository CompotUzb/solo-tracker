import { Client, Events, GatewayIntentBits, Partials, type Message } from 'discord.js';
import type { AppConfig } from './config.js';
import { isMessageInTrackedBoundary, type BoundaryConfig, type MessageLike } from './boundary.js';
import { persistRawMessage, type RawDiscordMessageInput } from './db.js';

// Normalize a discord.js Message into the minimal shape the boundary filter understands.
// DMs have a null guildId and a channel without `parentId`, so they fall through to the boundary's guild check.
export function toMessageLike(message: Message): MessageLike {
  const channel = message.channel as { parentId?: string | null };
  const parentChannelId = 'parentId' in message.channel ? channel.parentId ?? null : null;
  return {
    guildId: message.guildId,
    channelId: message.channelId,
    parentChannelId,
    webhookId: message.webhookId,
    system: message.system,
    author: { id: message.author?.id, bot: message.author?.bot, system: message.author?.system },
  };
}

export function toRawMessageInput(
  message: Message,
  contentPolicy: Pick<AppConfig, 'storeMessageContent' | 'contentMaxChars'> = { storeMessageContent: false, contentMaxChars: 0 },
): RawDiscordMessageInput {
  const like = toMessageLike(message);
  if (!like.guildId) throw new Error('cannot persist Discord DM without guild id');
  if (!like.author?.id) throw new Error('cannot persist Discord message without author id');
  const attachments = message.attachments as { size?: number } | undefined;
  const fullContent = message.content ?? '';
  const storedContent = contentPolicy.storeMessageContent ? fullContent.slice(0, contentPolicy.contentMaxChars) : '';
  return {
    messageId: message.id,
    guildId: like.guildId,
    channelId: message.channelId,
    parentChannelId: like.parentChannelId ?? null,
    authorId: like.author.id,
    content: storedContent,
    messageTimestamp: message.createdAt.toISOString(),
    metadata: { attachmentCount: attachments?.size ?? 0, contentLength: fullContent.length },
  };
}

export interface DiscordClientOptions {
  storeRawMessage?: (input: RawDiscordMessageInput) => unknown;
  onRawMessageStored?: (input: RawDiscordMessageInput, stored: unknown) => void;
}

export function createDiscordClient(config: AppConfig, boundary: BoundaryConfig, options: DiscordClientOptions = {}) {
  const store = options.storeRawMessage ?? ((input: RawDiscordMessageInput) => persistRawMessage(config.databasePath, input));
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Channel, Partials.Message],
  });
  client.once(Events.ClientReady, (ready) => {
    console.log(`Discord connected as ${ready.user.tag}; tracking guild ${boundary.trackedGuildId}; ${boundary.trackedChannelIds.length} channel(s)`);
  });
  client.on(Events.MessageCreate, (message) => {
    if (!isMessageInTrackedBoundary(toMessageLike(message), boundary)) return;
    const input = toRawMessageInput(message, config);
    const stored = store(input);
    options.onRawMessageStored?.(input, stored);
    console.log(`tracked message ${message.id} in channel ${message.channelId}`);
  });
  return client;
}
