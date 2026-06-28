import { describe, expect, it, vi } from "vitest";
import type { Message } from "discord.js";
import { createDiscordClient, toRawMessageInput } from "./bot.js";
import type { BoundaryConfig } from "./boundary.js";
import type { AppConfig } from "./config.js";

const boundary: BoundaryConfig = {
  trackedGuildId: "guild-1",
  trackedChannelIds: ["channel-1", "daily-quests"],
};

function fakeMessage(overrides: {
  id?: string;
  guildId?: string | null;
  channelId: string;
  channel?: object;
  author?: {
    id?: string | null;
    bot?: boolean | null;
    system?: boolean | null;
  } | null;
  content?: string;
  createdAt?: Date;
  webhookId?: string | null;
  system?: boolean | null;
  attachmentsSize?: number;
}): Message {
  return {
    id: overrides.id ?? "msg-1",
    guildId: overrides.guildId ?? null,
    channelId: overrides.channelId,
    channel: overrides.channel ?? { id: overrides.channelId },
    author: overrides.author ?? { id: "user-1", bot: false, system: false },
    content: overrides.content ?? "progress update",
    createdAt: overrides.createdAt ?? new Date("2026-06-23T06:00:00.000Z"),
    webhookId: overrides.webhookId ?? null,
    system: overrides.system ?? false,
    attachments: { size: overrides.attachmentsSize ?? 0 },
  } as unknown as Message;
}

const config = {
  databasePath: ":memory:",
  discordToken: "token",
  discordClientId: "client-id",
  trackedGuildId: "guild-1",
  trackedChannelIds: ["channel-1", "daily-quests"],
  channelCategories: {},
  commandsChannelId: null,
  dailyQuestsChannelId: null,
  systemOutputChannelId: null,
  apiHost: "127.0.0.1",
  apiPort: 3333,
  storeMessageContent: true,
  contentMaxChars: 4000,
  skipDiscordLogin: true,
  timezone: "Asia/Tashkent",
  dailyQuestCreateTime: "06:00",
  dailyEvaluationTime: "00:00",
  dailyQuestTierOverride: null,
  aiMainQuestEnabled: false,
  openAiApiKey: "",
  openAiModel: "gpt-4o",
} satisfies AppConfig;

describe("raw Discord message ingestion", () => {
  it("maps a Discord message into a raw-message input with metadata", () => {
    const raw = toRawMessageInput(
      fakeMessage({
        id: "msg-9",
        guildId: "guild-1",
        channelId: "channel-1",
        content: "studied 1h",
      }),
      {
        storeMessageContent: true,
        contentMaxChars: 7,
      },
    );

    expect(raw).toEqual({
      messageId: "msg-9",
      guildId: "guild-1",
      channelId: "channel-1",
      parentChannelId: null,
      threadId: null,
      threadTitle: null,
      authorId: "user-1",
      content: "studied",
      messageTimestamp: "2026-06-23T06:00:00.000Z",
      metadata: { attachmentCount: 0, contentLength: 10 },
    });
  });

  it("omits content by default and stores only content length metadata", () => {
    const raw = toRawMessageInput(
      fakeMessage({
        id: "msg-private",
        guildId: "guild-1",
        channelId: "channel-1",
        content: "private details",
      }),
    );

    expect(raw.content).toBe("");
    expect(raw.metadata).toMatchObject({
      attachmentCount: 0,
      contentLength: 15,
    });
  });

  it("persists tracked human guild messages only and emits a live hook for stored messages", () => {
    const stored: unknown[] = [];
    const liveEvents: unknown[] = [];
    const client = createDiscordClient(config, boundary, {
      storeRawMessage: (input) => {
        stored.push(input);
        return true;
      },
      onRawMessageStored: (input, result) => liveEvents.push({ input, result }),
    });
    const emitMessageCreate = (message: Message) =>
      (client as { emit(event: string, ...args: unknown[]): boolean }).emit(
        "messageCreate",
        message,
      );

    emitMessageCreate(
      fakeMessage({
        id: "tracked",
        guildId: "guild-1",
        channelId: "channel-1",
      }),
    );
    emitMessageCreate(
      fakeMessage({
        id: "bot",
        guildId: "guild-1",
        channelId: "channel-1",
        author: { id: "bot-1", bot: true },
      }),
    );
    emitMessageCreate(
      fakeMessage({ id: "dm", guildId: null, channelId: "dm-channel" }),
    );
    emitMessageCreate(
      fakeMessage({
        id: "other-channel",
        guildId: "guild-1",
        channelId: "other",
      }),
    );

    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      messageId: "tracked",
      channelId: "channel-1",
      authorId: "user-1",
      content: "progress update",
    });
    expect(liveEvents).toHaveLength(1);
    expect(liveEvents[0]).toMatchObject({
      input: { messageId: "tracked", channelId: "channel-1" },
      result: true,
    });
    client.destroy();
  });

  it("routes Daily Quest parsing only for thread messages while still storing channel logs", () => {
    const stored: unknown[] = [];
    const onDailyQuestMessage = vi.fn();
    const client = createDiscordClient(config, boundary, {
      storeRawMessage: (input) => {
        stored.push(input);
        return true;
      },
      onDailyQuestMessage,
    });
    const emitMessageCreate = (message: Message) =>
      (client as { emit(event: string, ...args: unknown[]): boolean }).emit(
        "messageCreate",
        message,
      );

    emitMessageCreate(
      fakeMessage({
        id: "body-log",
        guildId: "guild-1",
        channelId: "channel-1",
        content: "30 pushups",
      }),
    );
    emitMessageCreate(
      fakeMessage({
        id: "daily-thread-log",
        guildId: "guild-1",
        channelId: "thread-1",
        channel: {
          id: "thread-1",
          parentId: "daily-quests",
          isThread: () => true,
          name: "Day-1",
        },
        content: "30 pushups",
      }),
    );

    expect(stored).toHaveLength(2);
    expect(stored).toEqual([
      expect.objectContaining({
        messageId: "body-log",
        channelId: "channel-1",
        threadId: null,
      }),
      expect.objectContaining({
        messageId: "daily-thread-log",
        channelId: "thread-1",
        parentChannelId: "daily-quests",
        threadId: "thread-1",
      }),
    ]);
    expect(onDailyQuestMessage).toHaveBeenCalledOnce();
    expect(onDailyQuestMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: "daily-thread-log" }),
    );
    client.destroy();
  });
});
