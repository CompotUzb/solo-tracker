import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type Message,
} from "discord.js";
import type { AppConfig } from "./config.js";
import {
  isMessageInTrackedBoundary,
  type BoundaryConfig,
  type MessageLike,
} from "./boundary.js";
import { persistRawMessage, type RawDiscordMessageInput } from "./db.js";
import type { DailyQuestPublisher } from "./dailyWorkflow.js";

export type SummaryCommandKind = "today" | "week";
export type DailyCommandKind = "show" | "create" | "evaluate" | "thread";

export function parseSummaryCommand(
  content: string | null | undefined,
): SummaryCommandKind | null {
  const normalized = (content ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (normalized === "/summary today" || normalized === "!summary today")
    return "today";
  if (
    normalized === "/summary week" ||
    normalized === "!summary week" ||
    normalized === "/report weekly" ||
    normalized === "!report weekly"
  )
    return "week";
  return null;
}

export function parseDailyCommand(
  content: string | null | undefined,
): DailyCommandKind | null {
  const normalized = (content ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (normalized === "/daily" || normalized === "!daily") return "show";
  if (normalized === "/daily create" || normalized === "!daily create")
    return "create";
  if (normalized === "/daily evaluate" || normalized === "!daily evaluate")
    return "evaluate";
  if (normalized === "/daily thread" || normalized === "!daily thread")
    return "thread";
  return null;
}

// Normalize a discord.js Message into the minimal shape the boundary filter understands.
// DMs have a null guildId and a channel without `parentId`, so they fall through to the boundary's guild check.
export function toMessageLike(message: Message): MessageLike {
  const channel = message.channel as { parentId?: string | null };
  const parentChannelId =
    "parentId" in message.channel ? (channel.parentId ?? null) : null;
  return {
    guildId: message.guildId,
    channelId: message.channelId,
    parentChannelId,
    webhookId: message.webhookId,
    system: message.system,
    author: {
      id: message.author?.id,
      bot: message.author?.bot,
      system: message.author?.system,
    },
  };
}

export function toRawMessageInput(
  message: Message,
  contentPolicy: Pick<AppConfig, "storeMessageContent" | "contentMaxChars"> = {
    storeMessageContent: false,
    contentMaxChars: 0,
  },
): RawDiscordMessageInput {
  const like = toMessageLike(message);
  if (!like.guildId)
    throw new Error("cannot persist Discord DM without guild id");
  if (!like.author?.id)
    throw new Error("cannot persist Discord message without author id");
  const attachments = message.attachments as { size?: number } | undefined;
  const fullContent = message.content ?? "";
  const storedContent = contentPolicy.storeMessageContent
    ? fullContent.slice(0, contentPolicy.contentMaxChars)
    : "";
  // A thread message lives in a thread channel whose id is message.channelId and whose
  // parentId is the configured parent channel. We capture the thread id and (non-sensitive)
  // title so the dashboard can group activity by thread.
  const channel = message.channel as {
    isThread?: () => boolean;
    name?: string | null;
  };
  const isThread =
    typeof channel.isThread === "function"
      ? channel.isThread()
      : Boolean(like.parentChannelId);
  return {
    messageId: message.id,
    guildId: like.guildId,
    channelId: message.channelId,
    parentChannelId: like.parentChannelId ?? null,
    threadId: isThread ? message.channelId : null,
    threadTitle: isThread ? (channel.name ?? null) : null,
    authorId: like.author.id,
    content: storedContent,
    messageTimestamp: message.createdAt.toISOString(),
    metadata: {
      attachmentCount: attachments?.size ?? 0,
      contentLength: fullContent.length,
    },
  };
}

/**
 * Build a sender that posts a plain message to a single Discord channel (the configured
 * system-output channel). Returns the sent message id, or null if the channel cannot be
 * resolved or is not text-based. Used to deliver system notifications.
 */
export function createChannelMessageSender(client: Client, channelId: string) {
  return async (message: string): Promise<string | null> => {
    const channel = (await client.channels.fetch(channelId)) as {
      send?: (content: string) => Promise<{ id: string }>;
    } | null;
    if (!channel || typeof channel.send !== "function") return null;
    const sent = await channel.send(message);
    return sent?.id ?? null;
  };
}

export function createDailyQuestPublisher(client: Client): DailyQuestPublisher {
  return {
    async publish(input) {
      const channel = (await client.channels.fetch(input.channelId)) as {
        send?: (content: string) => Promise<{
          id: string;
          startThread?: (options: {
            name: string;
            autoArchiveDuration: 1440;
          }) => Promise<{
            id: string;
            name: string;
            send?: (content: string) => Promise<unknown>;
          }>;
        }>;
      } | null;
      if (!channel || typeof channel.send !== "function")
        throw new Error("daily quest channel is not text-based");
      const message = await channel.send(input.content);
      if (typeof message.startThread !== "function")
        throw new Error("daily quest message cannot create a thread");
      const thread = await message.startThread({
        name: input.threadName,
        autoArchiveDuration: 1440,
      });
      if (typeof thread.send !== "function")
        throw new Error("daily quest thread is not messageable");
      await thread.send(input.threadContent);
      return {
        parentMessageId: message.id,
        threadId: thread.id,
        threadName: thread.name,
      };
    },
  };
}

export interface DiscordClientOptions {
  storeRawMessage?: (input: RawDiscordMessageInput) => unknown;
  onRawMessageStored?: (input: RawDiscordMessageInput, stored: unknown) => void;
  onSummaryCommand?: (kind: SummaryCommandKind, message: Message) => unknown;
  onDailyCommand?: (kind: DailyCommandKind, message: Message) => unknown;
  onDailyQuestMessage?: (message: Message) => unknown;
}

export function createDiscordClient(
  config: AppConfig,
  boundary: BoundaryConfig,
  options: DiscordClientOptions = {},
) {
  const store =
    options.storeRawMessage ??
    ((input: RawDiscordMessageInput) =>
      persistRawMessage(config.databasePath, input));
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel, Partials.Message],
  });
  client.once(Events.ClientReady, (ready) => {
    console.log(
      `Discord connected as ${ready.user.tag}; tracking guild ${boundary.trackedGuildId}; ${boundary.trackedChannelIds.length} channel(s)`,
    );
  });
  client.on(Events.MessageCreate, (message) => {
    const like = toMessageLike(message);
    const inCommandsChannel = config.commandsChannelId === message.channelId;
    const summaryCommand = inCommandsChannel
      ? parseSummaryCommand(message.content)
      : null;
    if (summaryCommand) {
      options.onSummaryCommand?.(summaryCommand, message);
      return;
    }
    const dailyCommand = inCommandsChannel
      ? parseDailyCommand(message.content)
      : null;
    if (dailyCommand) {
      options.onDailyCommand?.(dailyCommand, message);
      return;
    }
    if (
      !message.author?.bot &&
      !message.author?.system &&
      !message.webhookId &&
      !message.system
    ) {
      if (like.parentChannelId) options.onDailyQuestMessage?.(message);
    }
    if (!isMessageInTrackedBoundary(like, boundary)) return;
    const input = toRawMessageInput(message, config);
    const stored = store(input);
    options.onRawMessageStored?.(input, stored);
    console.log(
      `tracked message ${message.id} in channel ${message.channelId}`,
    );
  });
  return client;
}
