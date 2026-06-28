import { describe, expect, it, vi } from "vitest";
import type { Message } from "discord.js";
import {
  parseDailyCommand,
  parseMainCommand,
  parseSummaryCommand,
  toMessageLike,
  createDiscordClient,
  createDailyQuestPublisher,
} from "./bot.js";
import { loadConfig } from "./config.js";
import { isMessageInTrackedBoundary, type BoundaryConfig } from "./boundary.js";

const boundary: BoundaryConfig = {
  trackedGuildId: "guild-1",
  trackedChannelIds: ["channel-1", "forum-parent"],
};

// Build a structurally-minimal stand-in for a discord.js Message. We only touch the fields
// toMessageLike reads, so the unsafe cast keeps the test focused on the normalization contract.
function fakeMessage(overrides: {
  id?: string;
  content?: string;
  guildId?: string | null;
  channelId: string;
  channel: object;
  webhookId?: string | null;
  system?: boolean | null;
  author?: {
    id?: string | null;
    bot?: boolean | null;
    system?: boolean | null;
  } | null;
}): Message {
  return {
    id: overrides.id ?? "msg-1",
    content: overrides.content ?? "",
    createdAt: new Date("2026-06-23T10:00:00.000Z"),
    guildId: overrides.guildId ?? null,
    webhookId: overrides.webhookId ?? null,
    system: overrides.system ?? false,
    author: overrides.author ?? { id: "user-1", bot: false, system: false },
    attachments: { size: 0 },
    ...overrides,
  } as unknown as Message;
}

describe("bot message normalization", () => {
  it("tracks a human message in a configured guild channel", () => {
    const message = fakeMessage({
      guildId: "guild-1",
      channelId: "channel-1",
      channel: { id: "channel-1" },
    });
    expect(isMessageInTrackedBoundary(toMessageLike(message), boundary)).toBe(
      true,
    );
  });

  it("resolves the parent of a thread for the whitelist check", () => {
    const message = fakeMessage({
      guildId: "guild-1",
      channelId: "thread-9",
      channel: { id: "thread-9", parentId: "forum-parent" },
    });
    expect(isMessageInTrackedBoundary(toMessageLike(message), boundary)).toBe(
      true,
    );
  });

  it("ignores direct messages (no guild, DM channel has no parentId)", () => {
    const dm = fakeMessage({
      guildId: null,
      channelId: "dm-channel",
      channel: { id: "dm-channel" },
    });
    const like = toMessageLike(dm);
    expect(like.guildId).toBeNull();
    expect(like.parentChannelId).toBeNull();
    expect(isMessageInTrackedBoundary(like, boundary)).toBe(false);
  });

  it("ignores configured-guild messages in an unconfigured channel", () => {
    const message = fakeMessage({
      guildId: "guild-1",
      channelId: "random",
      channel: { id: "random" },
    });
    expect(isMessageInTrackedBoundary(toMessageLike(message), boundary)).toBe(
      false,
    );
  });
});

describe("summary command routing", () => {
  it("parses supported summary command aliases", () => {
    expect(parseSummaryCommand("/summary today")).toBe("today");
    expect(parseSummaryCommand("!summary week")).toBe("week");
    expect(parseSummaryCommand("/report weekly")).toBe("week");
    expect(parseSummaryCommand("/summary tomorrow")).toBeNull();
  });

  it("dispatches summary commands only from the configured commands channel", () => {
    const config = loadConfig({
      DISCORD_TOKEN: "fake",
      DISCORD_CLIENT_ID: "client",
      TRACKED_GUILD_ID: "guild-1",
      TRACKED_CHANNEL_IDS: "channel-1",
      COMMANDS_CHANNEL_ID: "commands",
      DATABASE_PATH: ":memory:",
      SKIP_DISCORD_LOGIN: "true",
    });
    const onSummaryCommand = vi.fn();
    const client = createDiscordClient(config, boundary, {
      storeRawMessage: vi.fn(),
      onSummaryCommand,
    });

    const emitMessage = (
      client as unknown as {
        emit: (event: string, message: unknown) => boolean;
      }
    ).emit.bind(client);
    emitMessage(
      "messageCreate",
      fakeMessage({
        guildId: "guild-1",
        channelId: "commands",
        channel: { id: "commands" },
        content: "/summary today",
      }),
    );
    emitMessage(
      "messageCreate",
      fakeMessage({
        guildId: "guild-1",
        channelId: "random",
        channel: { id: "random" },
        content: "/summary week",
      }),
    );

    expect(onSummaryCommand).toHaveBeenCalledOnce();
    expect(onSummaryCommand).toHaveBeenCalledWith("today", expect.anything());
    client.destroy();
  });
});

describe("daily command parsing", () => {
  it("parses the local Daily Quest development commands", () => {
    expect(parseDailyCommand("/daily")).toBe("show");
    expect(parseDailyCommand("/daily create")).toBe("create");
    expect(parseDailyCommand("/daily evaluate")).toBe("evaluate");
    expect(parseDailyCommand("/daily thread")).toBe("thread");
    expect(parseDailyCommand("/daily unknown")).toBeNull();
  });
});

describe("main command parsing", () => {
  it("parses Main Quest MVP commands", () => {
    expect(parseMainCommand("/main suggest prepare for probability exam")).toEqual({
      kind: "suggest",
      goal: "prepare for probability exam",
    });
    expect(parseMainCommand("/main accept")).toEqual({ kind: "accept" });
    expect(parseMainCommand("/main reject")).toEqual({ kind: "reject" });
    expect(parseMainCommand("/main list")).toEqual({ kind: "list" });
    expect(parseMainCommand("/main progress quest-1 3")).toEqual({
      kind: "progress",
      questId: "quest-1",
      amount: 3,
    });
    expect(parseMainCommand("/main complete quest-1")).toEqual({
      kind: "complete",
      questId: "quest-1",
    });
    expect(parseMainCommand("/main archive quest-1")).toEqual({
      kind: "archive",
      questId: "quest-1",
    });
    expect(parseMainCommand("/main unknown")).toBeNull();
  });

  it("dispatches main commands only from the configured commands channel", () => {
    const config = loadConfig({
      DISCORD_TOKEN: "fake",
      DISCORD_CLIENT_ID: "client",
      TRACKED_GUILD_ID: "guild-1",
      TRACKED_CHANNEL_IDS: "channel-1",
      COMMANDS_CHANNEL_ID: "commands",
      DATABASE_PATH: ":memory:",
      SKIP_DISCORD_LOGIN: "true",
    });
    const onMainCommand = vi.fn();
    const client = createDiscordClient(config, boundary, {
      storeRawMessage: vi.fn(),
      onMainCommand,
    });

    const emitMessage = (
      client as unknown as {
        emit: (event: string, message: unknown) => boolean;
      }
    ).emit.bind(client);
    emitMessage(
      "messageCreate",
      fakeMessage({
        guildId: "guild-1",
        channelId: "commands",
        channel: { id: "commands" },
        content: "/main suggest finish deployment",
      }),
    );
    emitMessage(
      "messageCreate",
      fakeMessage({
        guildId: "guild-1",
        channelId: "thread-1",
        channel: { id: "thread-1", parentId: "channel-1" },
        content: "/main suggest ignored in thread",
      }),
    );

    expect(onMainCommand).toHaveBeenCalledOnce();
    expect(onMainCommand).toHaveBeenCalledWith(
      { kind: "suggest", goal: "finish deployment" },
      expect.anything(),
    );
    client.destroy();
  });
});

describe("daily quest publisher", () => {
  it("posts the checklist, creates a message thread, and sends only the short intro to the thread", async () => {
    const threadSend = vi.fn(async () => ({ id: "thread-message-1" }));
    const startThread = vi.fn(async () => ({
      id: "thread-1",
      name: "Day-1",
      send: threadSend,
    }));
    const channelSend = vi.fn(async () => ({
      id: "parent-message-1",
      startThread,
    }));
    const client = {
      channels: {
        fetch: vi.fn(async () => ({
          send: channelSend,
        })),
      },
    };

    const result = await createDailyQuestPublisher(client as never).publish({
      channelId: "daily-channel",
      content: "SYSTEM DAILY QUEST — Day-1\nRequired:\n[ ] Push-ups: 0 / 30",
      threadName: "Day-1",
      threadContent:
        "SYSTEM THREAD ACTIVE — Day-1\n\nSend your activity logs here.",
    });

    expect(result).toEqual({
      parentMessageId: "parent-message-1",
      dailyQuestMessageId: "parent-message-1",
      threadId: "thread-1",
      threadName: "Day-1",
      threadIntroMessageId: "thread-message-1",
    });
    expect(channelSend).toHaveBeenCalledWith(
      "SYSTEM DAILY QUEST — Day-1\nRequired:\n[ ] Push-ups: 0 / 30",
    );
    expect(startThread).toHaveBeenCalledWith({
      name: "Day-1",
      autoArchiveDuration: 1440,
    });
    expect(threadSend).toHaveBeenCalledWith(
      "SYSTEM THREAD ACTIVE — Day-1\n\nSend your activity logs here.",
    );
    expect(threadSend).not.toHaveBeenCalledWith(
      expect.stringContaining("Required:"),
    );
    expect(threadSend).not.toHaveBeenCalledWith(expect.stringContaining("[ ]"));
  });

  it("edits the original daily quest message", async () => {
    const edit = vi.fn(async () => undefined);
    const fetchMessage = vi.fn(async () => ({ edit }));
    const client = {
      channels: {
        fetch: vi.fn(async () => ({
          messages: { fetch: fetchMessage },
        })),
      },
    };

    const edited = await createDailyQuestPublisher(
      client as never,
    ).editDailyQuestMessage?.({
      channelId: "daily-channel",
      messageId: "parent-message-1",
      content: "updated daily quest",
    });

    expect(edited).toBe(true);
    expect(client.channels.fetch).toHaveBeenCalledWith("daily-channel");
    expect(fetchMessage).toHaveBeenCalledWith("parent-message-1");
    expect(edit).toHaveBeenCalledWith("updated daily quest");
  });
});
