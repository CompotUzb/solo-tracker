import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { createApi } from "./api.js";
import { openDatabase, type Db } from "./db.js";

let db: Db | undefined;
afterEach(() => db?.close());

function makeApi() {
  const config = loadConfig({
    DISCORD_TOKEN: "fake",
    DISCORD_CLIENT_ID: "client",
    TRACKED_GUILD_ID: "guild",
    TRACKED_CHANNEL_IDS: "chan-1",
    DATABASE_PATH: ":memory:",
    SKIP_DISCORD_LOGIN: "true",
  });
  db = openDatabase(":memory:");
  return createApi({ config, discordStatus: () => "skipped", db });
}

describe("quest API routes", () => {
  it("adds a quest, completes it, and reflects awarded XP in stats", async () => {
    const api = makeApi();

    const add = await api.app.inject({
      method: "POST",
      url: "/api/quests",
      payload: { title: "Beat the boss", questType: "boss" },
    });
    expect(add.statusCode).toBe(201);
    const quest = add.json().quest;
    expect(quest).toMatchObject({
      questType: "boss",
      xpReward: 750,
      status: "active",
    });

    const complete = await api.app.inject({
      method: "POST",
      url: `/api/quests/${quest.id}/complete`,
      payload: {},
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json()).toMatchObject({
      xpAwarded: 750,
      leveledUp: true,
      alreadyCompleted: false,
      quest: { status: "completed" },
    });
    expect(complete.json().stats).toMatchObject({ totalXp: 750, level: 4 });

    const list = await api.app.inject({
      method: "GET",
      url: "/api/quests?status=completed",
    });
    expect(list.json().quests).toHaveLength(1);

    await api.close();
  });

  it("validates the quest type", async () => {
    const api = makeApi();
    const res = await api.app.inject({
      method: "POST",
      url: "/api/quests",
      payload: { title: "x", questType: "legendary" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_quest");
    await api.close();
  });

  it("returns 404 for an unknown quest completion", async () => {
    const api = makeApi();
    const res = await api.app.inject({
      method: "POST",
      url: "/api/quests/missing/complete",
      payload: {},
    });
    expect(res.statusCode).toBe(404);
    await api.close();
  });
});
