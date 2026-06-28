import { describe, expect, it } from "vitest";
import { loadConfig, publicConfig } from "./config.js";

const baseEnv = {
  DISCORD_TOKEN: "fake-token",
  DISCORD_CLIENT_ID: "client-id",
  TRACKED_GUILD_ID: "guild-id",
  TRACKED_CHANNEL_IDS: "channel-1, channel-2",
  DATABASE_PATH: ":memory:",
};

describe("loadConfig", () => {
  it("parses false-like boolean environment strings as false", () => {
    const config = loadConfig({
      ...baseEnv,
      STORE_MESSAGE_CONTENT: "false",
      SKIP_DISCORD_LOGIN: "false",
    });

    expect(config.storeMessageContent).toBe(false);
    expect(config.contentMaxChars).toBe(0);
    expect(config.skipDiscordLogin).toBe(false);
  });

  it("parses true-like boolean environment strings as true", () => {
    const config = loadConfig({
      ...baseEnv,
      STORE_MESSAGE_CONTENT: "true",
      CONTENT_MAX_CHARS: "500",
      SKIP_DISCORD_LOGIN: "1",
    });

    expect(config.storeMessageContent).toBe(true);
    expect(config.contentMaxChars).toBe(500);
    expect(config.skipDiscordLogin).toBe(true);
  });

  it("trims tracked channel IDs", () => {
    const config = loadConfig(baseEnv);

    expect(config.trackedChannelIds).toEqual(["channel-1", "channel-2"]);
  });

  it("reads the bot token from the provided env only", () => {
    const config = loadConfig({ ...baseEnv, DISCORD_TOKEN: "env-only-token" });

    expect(config.discordToken).toBe("env-only-token");
  });

  it("maps named channels to stat categories and merges them into the tracked set", () => {
    const config = loadConfig({
      ...baseEnv,
      TRACKED_CHANNEL_IDS: "legacy-1",
      DAILY_QUESTS_CHANNEL_ID: "dq",
      MIND_TRAINING_CHANNEL_ID: "mt",
      BODY_TRAINING_CHANNEL_ID: "bt",
      WORK_SKILL_CHANNEL_ID: "ws",
      COMMANDS_CHANNEL_ID: "cmd",
      SYSTEM_OUTPUT_CHANNEL_ID: "sys",
    });

    expect(config.channelCategories).toEqual({
      dq: "daily-quests",
      mt: "mind-training",
      bt: "body-training",
      ws: "work-skill",
    });
    // Stat channels are tracked; the command and system-output channels are not.
    expect(config.trackedChannelIds).toEqual([
      "legacy-1",
      "dq",
      "mt",
      "bt",
      "ws",
    ]);
    expect(config.commandsChannelId).toBe("cmd");
    expect(config.dailyQuestsChannelId).toBe("dq");
    expect(config.systemOutputChannelId).toBe("sys");
    expect(publicConfig(config).systemOutputConfigured).toBe(true);
  });

  it("treats unset/placeholder named channels as absent (dashboard-only mode)", () => {
    const config = loadConfig({
      ...baseEnv,
      SYSTEM_OUTPUT_CHANNEL_ID: "replace_with_system_output_channel_id",
      DAILY_QUESTS_CHANNEL_ID: "   ",
    });
    expect(config.systemOutputChannelId).toBeNull();
    expect(config.dailyQuestsChannelId).toBeNull();
    expect(config.channelCategories).toEqual({});
    expect(publicConfig(config).systemOutputConfigured).toBe(false);
  });

  it("loads the Daily Quest schedule and development override", () => {
    const config = loadConfig({
      ...baseEnv,
      DAILY_QUEST_CREATE_TIME: "06:30",
      DAILY_EVALUATION_TIME: "00:15",
      DAILY_QUEST_TIER_OVERRIDE: "2",
      NODE_ENV: "test",
    });
    expect(config.dailyQuestCreateTime).toBe("06:30");
    expect(config.dailyEvaluationTime).toBe("00:15");
    expect(config.dailyQuestTierOverride).toBe(2);
  });

  it("ignores the tier override in production", () => {
    const config = loadConfig({
      ...baseEnv,
      DAILY_QUEST_TIER_OVERRIDE: "3",
      NODE_ENV: "production",
    });
    expect(config.dailyQuestTierOverride).toBeNull();
  });

  it("keeps AI Main Quest generation disabled by default and opt-in by env", () => {
    const disabled = loadConfig(baseEnv);
    expect(disabled.aiMainQuestEnabled).toBe(false);
    expect(disabled.openAiApiKey).toBe("");
    expect(disabled.openAiModel).toBe("gpt-4o");

    const enabled = loadConfig({
      ...baseEnv,
      AI_MAIN_QUEST_ENABLED: "true",
      OPENAI_API_KEY: "  test-key  ",
      OPENAI_MODEL: "gpt-test",
    });
    expect(enabled.aiMainQuestEnabled).toBe(true);
    expect(enabled.openAiApiKey).toBe("test-key");
    expect(enabled.openAiModel).toBe("gpt-test");
  });

  it("omits secrets from the public config surface", () => {
    const config = loadConfig({
      ...baseEnv,
      DISCORD_TOKEN: "super-secret-token",
    });
    const safe = publicConfig(config);
    const serialized = JSON.stringify(safe);

    expect(serialized).not.toContain("super-secret-token");
    expect(serialized).not.toContain(baseEnv.DISCORD_CLIENT_ID);
    expect(safe).not.toHaveProperty("discordToken");
    expect(safe).not.toHaveProperty("discordClientId");
    expect(safe).not.toHaveProperty("openAiApiKey");
  });
});
