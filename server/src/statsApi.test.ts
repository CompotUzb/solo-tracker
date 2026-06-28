import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { createApi } from "./api.js";
import { openDatabase, type Db } from "./db.js";
import { createNotifier } from "./notifications.js";

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
  const notifier = createNotifier({ db });
  return createApi({ config, discordStatus: () => "skipped", db, notifier });
}

describe("player stats + notifications API", () => {
  it("exposes all eight stats, starting at zero", async () => {
    const api = makeApi();
    const res = await api.app.inject({
      method: "GET",
      url: "/api/stats/player",
    });
    const body = res.json();
    expect(body.stats).toHaveLength(8);
    expect(body.stats.map((s: { key: string }) => s.key)).toContain(
      "discipline",
    );
    expect(body.stats.every((s: { value: number }) => s.value === 0)).toBe(
      true,
    );
    await api.close();
  });

  it("awards stats and stores a level-up notification when a quest is completed", async () => {
    const api = makeApi();
    const add = await api.app.inject({
      method: "POST",
      url: "/api/quests",
      payload: { title: "Boss", questType: "boss" },
    });
    const quest = add.json().quest;

    const complete = await api.app.inject({
      method: "POST",
      url: `/api/quests/${quest.id}/complete`,
      payload: {},
    });
    expect(complete.statusCode).toBe(200);
    const discipline = complete
      .json()
      .playerStats.find((s: { key: string }) => s.key === "discipline");
    expect(discipline.value).toBe(5); // boss quest -> +5 discipline

    const stats = await api.app.inject({
      method: "GET",
      url: "/api/stats/player",
    });
    expect(
      stats.json().stats.find((s: { key: string }) => s.key === "discipline")
        .value,
    ).toBe(5);

    const notes = await api.app.inject({
      method: "GET",
      url: "/api/notifications",
    });
    const list = notes.json().notifications;
    expect(list.some((n: { type: string }) => n.type === "level_up")).toBe(
      true,
    );
    expect(
      list.every(
        (n: { discordStatus: string }) => n.discordStatus === "skipped",
      ),
    ).toBe(true);

    await api.close();
  });

  it("does not double-award stats on idempotent re-completion", async () => {
    const api = makeApi();
    const add = await api.app.inject({
      method: "POST",
      url: "/api/quests",
      payload: { title: "Daily", questType: "normal" },
    });
    const quest = add.json().quest;
    await api.app.inject({
      method: "POST",
      url: `/api/quests/${quest.id}/complete`,
      payload: {},
    });
    await api.app.inject({
      method: "POST",
      url: `/api/quests/${quest.id}/complete`,
      payload: {},
    });

    const stats = await api.app.inject({
      method: "GET",
      url: "/api/stats/player",
    });
    expect(
      stats.json().stats.find((s: { key: string }) => s.key === "discipline")
        .value,
    ).toBe(2);
    await api.close();
  });
});
