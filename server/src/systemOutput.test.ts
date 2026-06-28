import { afterEach, describe, expect, it, vi } from "vitest";
import { createApi } from "./api.js";
import { loadConfig } from "./config.js";
import { openDatabase, type Db } from "./db.js";
import type { NotificationInput, Notifier } from "./notifications.js";

let db: Db | undefined;
afterEach(() => db?.close());

function makeApi(
  notify = vi.fn(),
): ReturnType<typeof createApi> & { notify: ReturnType<typeof vi.fn> } {
  const config = loadConfig({
    DISCORD_TOKEN: "fake",
    DISCORD_CLIENT_ID: "client",
    TRACKED_GUILD_ID: "guild",
    TRACKED_CHANNEL_IDS: "chan-1",
    DATABASE_PATH: ":memory:",
    SKIP_DISCORD_LOGIN: "true",
    TIMEZONE: "UTC",
  });
  db = openDatabase(":memory:");
  const notifier: Notifier = {
    deliveryEnabled: true,
    notify: notify as unknown as (
      input: NotificationInput,
    ) => ReturnType<Notifier["notify"]>,
  };
  return Object.assign(
    createApi({ config, discordStatus: () => "skipped", db, notifier }),
    { notify },
  );
}

describe("system output notifications", () => {
  it("emits level-up and achievement notifications when a quest completion crosses level 2", async () => {
    const api = makeApi();

    const add = await api.app.inject({
      method: "POST",
      url: "/api/quests",
      payload: { title: "First boss", questType: "boss" },
    });
    const quest = add.json().quest;
    const complete = await api.app.inject({
      method: "POST",
      url: `/api/quests/${quest.id}/complete`,
      payload: {},
    });

    expect(complete.statusCode).toBe(200);
    expect(api.notify).toHaveBeenCalledWith(
      expect.objectContaining({ type: "level_up", title: "Level 4 reached" }),
    );
    expect(api.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "achievement",
        title: "Achievement unlocked: First Quest",
        metadata: expect.objectContaining({
          achievementCode: "A001_FIRST_QUEST_COMPLETED",
          questId: quest.id,
        }),
      }),
    );

    const achievements = await api.app.inject({
      method: "GET",
      url: "/api/achievements",
    });
    expect(achievements.json().achievements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "A001_FIRST_QUEST_COMPLETED",
          unlocked: true,
          progress: 1,
          target: 1,
        }),
        expect.objectContaining({
          code: "A002_FIRST_LEVEL_UP",
          unlocked: true,
          progress: 1,
          target: 1,
        }),
      ]),
    );
    await api.close();
  });

  it("deduplicates achievement notifications on idempotent quest completion", async () => {
    const api = makeApi();
    const add = await api.app.inject({
      method: "POST",
      url: "/api/quests",
      payload: { title: "One time", questType: "normal" },
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

    const achievementCalls = api.notify.mock.calls.filter(
      ([input]) => input.type === "achievement",
    );
    expect(achievementCalls).toHaveLength(1);
    await api.close();
  });

  it("creates a penalty warning notification through the API", async () => {
    const api = makeApi();

    const res = await api.app.inject({
      method: "POST",
      url: "/api/penalties",
      payload: { reason: "Missed daily review", severity: "warning" },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      penalty: { reason: "Missed daily review", severity: "warning" },
    });
    expect(api.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "penalty",
        title: "Penalty warning",
        body: "Missed daily review",
        metadata: { severity: "warning" },
      }),
    );
    await api.close();
  });

  it("publishes on-demand daily and weekly summary notifications", async () => {
    const api = makeApi();

    const today = await api.app.inject({
      method: "POST",
      url: "/api/summaries/today",
      payload: {},
    });
    const week = await api.app.inject({
      method: "POST",
      url: "/api/summaries/week",
      payload: {},
    });

    expect(today.statusCode).toBe(201);
    expect(week.statusCode).toBe(201);
    expect(api.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "daily_summary",
        title: expect.stringContaining("Daily Summary"),
      }),
    );
    expect(api.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "weekly_summary",
        title: expect.stringContaining("Weekly Report"),
      }),
    );
    await api.close();
  });
});
