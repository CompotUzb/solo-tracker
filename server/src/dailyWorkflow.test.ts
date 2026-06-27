import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyMigrations, openDatabase, type Db } from "./db.js";
import {
  createDailyQuestForDate,
  formatDailyQuestMessage,
  formatDailyQuestThreadMessage,
  getDailyQuestTierForRank,
  parseDailyProgress,
  recordDailyThreadMessage,
  resolveDailyQuestTier,
  type DailyQuestPublisher,
} from "./dailyWorkflow.js";

const USER = "local-user";
let db: Db;

beforeEach(() => {
  db = openDatabase(":memory:");
  applyMigrations(db);
});

describe("daily progress parser", () => {
  it("extracts supported metrics and multiplies set notation", () => {
    expect(
      parseDailyProgress(
        "3x10 pushups, 30 squats, walked 1km, studied 20m, read 5 pages",
      ),
    ).toEqual([
      expect.objectContaining({ metricKey: "pushups", amount: 30 }),
      expect.objectContaining({ metricKey: "squats", amount: 30 }),
      expect.objectContaining({ metricKey: "cardio_km", amount: 1 }),
      expect.objectContaining({ metricKey: "mental_minutes", amount: 20 }),
      expect.objectContaining({ metricKey: "mental_pages", amount: 5 }),
    ]);
  });

  it("aggregates repeated metrics in one message", () => {
    expect(parseDailyProgress("10 pushups then 2x10 push-ups")).toEqual([
      expect.objectContaining({ metricKey: "pushups", amount: 30 }),
    ]);
  });
});

describe("rank-based daily tier", () => {
  it.each([
    ["Seed", "e"],
    ["E-Rank", "e"],
    ["D", "e"],
    ["C-Rank", "c"],
    ["B", "c"],
    ["A-Rank", "c"],
    ["S-Rank", "s"],
    ["National Level", "s"],
    ["Monarch", "s"],
  ])("maps %s to %s tier", (rank, tier) => {
    expect(getDailyQuestTierForRank(rank)).toBe(tier);
  });

  it("never lets a development override exceed the rank tier", () => {
    expect(resolveDailyQuestTier("E-Rank", 3)).toBe("e");
    expect(resolveDailyQuestTier("C-Rank", 3)).toBe("c");
    expect(resolveDailyQuestTier("S-Rank", 2)).toBe("c");
  });

  it("formats the exact E-Rank matrix with pull-ups", () => {
    const message = formatDailyQuestMessage(1, "E-Rank", "e");
    expect(message).toBe(
      [
        "**📋 SYSTEM DAILY QUEST — Day-1**",
        "",
        "**Rank:** `E-Rank`  **Tier:** `Beginner`  **Status:** `ACTIVE`",
        "",
        "**Required**",
        "- [ ] **Push-ups:** `0 / 30 reps`",
        "- [ ] **Sit-ups:** `0 / 30 reps`",
        "- [ ] **Squats:** `0 / 30 reps`",
        "- [ ] **Pull-ups:** `0 / 10 reps`",
        "- [ ] **Cardio:** `0 / 2 km` OR `0 / 5000 steps`",
        "- [ ] **Mental Focus:** `0 / 15 min` OR `0 / 5 pages`",
        "",
        "**Reward:** `+100 XP` · stat gains · `Daily Common Box`",
        "",
        "Log progress inside the **Day-1** thread only.",
      ].join("\n"),
    );
    expect(message).not.toContain("---");
    expect(message).not.toContain("```");
  });

  it("formats a short thread instruction message without the checklist", () => {
    const message = formatDailyQuestThreadMessage(1);
    expect(message).toBe(
      [
        "**🧭 SYSTEM THREAD ACTIVE — Day-1**",
        "",
        "Send your activity logs here. The System will parse them automatically.",
        "",
        "Examples: `30 pushups`, `3x10 situps`, `walked 2km`, `studied 15m`, `read 5 pages`",
      ].join("\n"),
    );
    expect(message).not.toContain("**Required**");
    expect(message).not.toContain("**Reward**");
    expect(message).not.toContain("[ ]");
    expect(message).not.toContain("```");
  });
});

describe("daily Discord workflow", () => {
  it("creates one Discord message and thread per local date", async () => {
    const publish = vi.fn(async () => ({
        parentMessageId: "message-1",
        dailyQuestMessageId: "message-1",
        threadId: "thread-1",
        threadName: "Day-1",
        threadIntroMessageId: "thread-message-1",
    }));
    const publisher: DailyQuestPublisher = { publish };
    const input = {
      db,
      userId: USER,
      localDate: "2026-06-23",
      hunterRank: "E-Rank",
      channelId: "daily-channel",
      publisher,
      now: "2026-06-23T01:00:00.000Z",
    };

    const first = await createDailyQuestForDate(input);
    const second = await createDailyQuestForDate(input);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith({
      channelId: "daily-channel",
      content: expect.stringContaining("SYSTEM DAILY QUEST — Day-1"),
      threadName: "Day-1",
      threadContent: formatDailyQuestThreadMessage(1),
    });
    expect(first.quest.discordThreadName).toBe("Day-1");
    expect(first.quest.hunterRank).toBe("E-Rank");
    expect(first.quest.tierName).toBe("Beginner");
    expect(
      db
        .prepare(
          "select discord_daily_quest_message_id,discord_thread_intro_message_id from daily_quest_days where user_id=? and local_date=?",
        )
        .get(USER, "2026-06-23"),
    ).toEqual({
      discord_daily_quest_message_id: "message-1",
      discord_thread_intro_message_id: "thread-message-1",
    });
  });

  it("accepts only the stored active thread and does not persist raw matches when disabled", async () => {
    await createDailyQuestForDate({
      db,
      userId: USER,
      localDate: "2026-06-23",
      hunterRank: "E-Rank",
      channelId: "daily-channel",
      publisher: {
        publish: async () => ({
          parentMessageId: "message-1",
          dailyQuestMessageId: "message-1",
          threadId: "thread-1",
          threadName: "Day-1",
          threadIntroMessageId: "thread-message-1",
        }),
      },
      now: "2026-06-23T01:00:00.000Z",
    });

    const ignored = recordDailyThreadMessage({
      db,
      userId: USER,
      threadId: "old-thread",
      messageId: "message-old",
      content: "30 pushups",
      storeRawMatch: false,
    });
    const accepted = recordDailyThreadMessage({
      db,
      userId: USER,
      threadId: "thread-1",
      messageId: "message-progress",
      content: "3x10 pushups",
      storeRawMatch: false,
    });

    expect(ignored.accepted).toBe(false);
    expect(
      accepted.quest?.metrics.find((metric) => metric.key === "pushups")
        ?.progress,
    ).toBe(30);
    const event = db
      .prepare(
        "select raw_match from daily_quest_metric_events where discord_message_id=?",
      )
      .get("message-progress") as {
      raw_match: string | null;
    };
    expect(event.raw_match).toBeNull();
  });

  it("does not double-count a retried Discord message", async () => {
    await createDailyQuestForDate({
      db,
      userId: USER,
      localDate: "2026-06-23",
      hunterRank: "E-Rank",
      channelId: "daily-channel",
      publisher: {
        publish: async () => ({
          parentMessageId: "message-1",
          dailyQuestMessageId: "message-1",
          threadId: "thread-1",
          threadName: "Day-1",
          threadIntroMessageId: "thread-message-1",
        }),
      },
    });
    const input = {
      db,
      userId: USER,
      threadId: "thread-1",
      messageId: "same-message",
      content: "10 squats",
      storeRawMatch: true,
    };
    recordDailyThreadMessage(input);
    const result = recordDailyThreadMessage(input);
    expect(
      result.quest?.metrics.find((metric) => metric.key === "squats")?.progress,
    ).toBe(10);
  });
});
