import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { createApi } from "./api.js";
import { openDatabase, type Db } from "./db.js";
let db: Db | undefined;
afterEach(() => db?.close());
describe("API", () => {
  it("returns health and privacy-safe boundaries", async () => {
    const config = loadConfig({
      DISCORD_TOKEN: "fake",
      DISCORD_CLIENT_ID: "client",
      TRACKED_GUILD_ID: "guild",
      TRACKED_CHANNEL_IDS: "chan-1,chan-2",
      DATABASE_PATH: ":memory:",
      SKIP_DISCORD_LOGIN: "true",
    });
    db = openDatabase(":memory:");
    const api = createApi({ config, discordStatus: () => "skipped", db });
    const health = await api.app.inject({ method: "GET", url: "/api/health" });
    expect(health.json()).toMatchObject({
      ok: true,
      db: "ok",
      discord: "skipped",
    });
    const boundaries = await api.app.inject({
      method: "GET",
      url: "/api/config/boundaries",
    });
    expect(boundaries.json()).toMatchObject({
      guildId: "guild",
      trackedChannelIds: ["chan-1", "chan-2"],
      storeMessageContent: false,
    });
    await api.close();
  });

  it("supports MVP main quest endpoints and stores one completion notification", async () => {
    const config = loadConfig({
      DISCORD_TOKEN: "fake",
      DISCORD_CLIENT_ID: "client",
      TRACKED_GUILD_ID: "guild",
      TRACKED_CHANNEL_IDS: "chan-1",
      DATABASE_PATH: ":memory:",
      SKIP_DISCORD_LOGIN: "true",
    });
    db = openDatabase(":memory:");
    const storedNotifications: unknown[] = [];
    const api = createApi({
      config,
      discordStatus: () => "skipped",
      db,
      notifier: {
        deliveryEnabled: false,
        notify(input) {
          storedNotifications.push(input);
          return {
            id: `notification-${storedNotifications.length}`,
            userId: input.userId,
            type: input.type,
            title: input.title,
            body: input.body ?? null,
            metadata: input.metadata ?? null,
            discordStatus: "skipped",
            discordMessageId: null,
            createdAt: "2026-06-23T10:00:00.000Z",
          };
        },
      },
    });

    const create = await api.app.inject({
      method: "POST",
      url: "/api/main-quests",
      payload: {
        title: "Complete 7-Day Daily Quest Streak",
        difficulty: "boss",
        target: 7,
        unit: "days",
      },
    });
    expect(create.statusCode).toBe(201);
    const questId = create.json().quest.id;
    expect(create.json().quest).toMatchObject({
      title: "Complete 7-Day Daily Quest Streak",
      questType: "boss",
      targetCount: 7,
      xpReward: 750,
    });

    const progress = await api.app.inject({
      method: "PATCH",
      url: `/api/main-quests/${questId}/progress`,
      payload: { amount: 2 },
    });
    expect(progress.statusCode).toBe(200);
    expect(progress.json().quest.progressCount).toBe(2);
    expect(progress.json().completion).toBeNull();

    const list = await api.app.inject({ method: "GET", url: "/api/main-quests" });
    expect(list.json().quests).toHaveLength(1);
    expect(list.json().quests[0]).toMatchObject({ displayId: "MQ-1" });

    const genericList = await api.app.inject({ method: "GET", url: "/api/quests" });
    expect(genericList.json().quests[0]).toMatchObject({ displayId: "MQ-1" });

    const autoComplete = await api.app.inject({
      method: "PATCH",
      url: "/api/main-quests/MQ-1/progress",
      payload: { amount: 7 },
    });
    expect(autoComplete.statusCode).toBe(200);
    expect(autoComplete.json()).toMatchObject({
      quest: { status: "completed", progressCount: 7 },
      completion: { xpAwarded: 750, alreadyCompleted: false },
    });

    const again = await api.app.inject({
      method: "POST",
      url: "/api/main-quests/1/complete",
      payload: {},
    });
    expect(again.json()).toMatchObject({ xpAwarded: 0, alreadyCompleted: true });
    expect(storedNotifications).toEqual([
      expect.objectContaining({
        type: "system",
        title: "🏰 Main Quest Cleared",
        body: "Complete 7-Day Daily Quest Streak. Reward: +750 XP.",
      }),
    ]);
    await api.close();
  });

  it("archives Main Quests without deleting them", async () => {
    const config = loadConfig({
      DISCORD_TOKEN: "fake",
      DISCORD_CLIENT_ID: "client",
      TRACKED_GUILD_ID: "guild",
      TRACKED_CHANNEL_IDS: "chan-1",
      DATABASE_PATH: ":memory:",
      SKIP_DISCORD_LOGIN: "true",
    });
    db = openDatabase(":memory:");
    const api = createApi({ config, discordStatus: () => "skipped", db });

    const create = await api.app.inject({
      method: "POST",
      url: "/api/main-quests",
      payload: {
        title: "Finish Solo Tracker Deployment",
        difficulty: "hard",
        target: 5,
        unit: "tasks",
      },
    });
    const questId = create.json().quest.id;

    const archive = await api.app.inject({
      method: "POST",
      url: `/api/main-quests/${questId}/archive`,
      payload: {},
    });
    expect(archive.statusCode).toBe(200);
    expect(archive.json().quest).toMatchObject({ status: "archived" });
    expect(
      db.prepare("select count(*) as n from quests where id=?").get(questId),
    ).toMatchObject({ n: 1 });

    const list = await api.app.inject({ method: "GET", url: "/api/main-quests" });
    expect(list.json().quests).toHaveLength(0);
    await api.close();
  });
});
