import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createApi } from "./api.js";
import { loadConfig } from "./config.js";
import { applyMigrations, openDatabase, type Db } from "./db.js";
import { listAchievements, weeklyReport } from "./reports.js";

let db: Db | undefined;
afterEach(() => db?.close());

function freshDb(): Db {
  const fresh = openDatabase(":memory:");
  applyMigrations(fresh);
  return fresh;
}

const USER = "local-user";
const TZ = "UTC";

describe("weeklyReport", () => {
  it("summarizes seven days of stats and buckets completed quests by local date", () => {
    db = freshDb();
    const now = new Date("2026-06-23T12:00:00.000Z");
    const today = "2026-06-23";
    const earlier = "2026-06-22";

    const insertStats = db.prepare(
      `insert into daily_stats (user_id,local_date,messages_count,active_channels_count,xp_earned,streak_eligible,created_at,updated_at)
       values (?,?,?,?,?,?,?,?)`,
    );
    insertStats.run(
      USER,
      today,
      5,
      1,
      40,
      1,
      now.toISOString(),
      now.toISOString(),
    );
    insertStats.run(
      USER,
      earlier,
      2,
      1,
      15,
      1,
      now.toISOString(),
      now.toISOString(),
    );

    db.prepare(
      `insert into quests (id,user_id,title,quest_type,status,target_count,progress_count,xp_reward,completed_at,created_at,updated_at)
       values (?,?,?,?,'completed',1,1,?,?,?,?)`,
    ).run(
      randomUUID(),
      USER,
      "Daily grind",
      "normal",
      25,
      `${today}T09:00:00.000Z`,
      now.toISOString(),
      now.toISOString(),
    );

    const report = weeklyReport(db, USER, TZ, now);

    expect(report.days).toHaveLength(7);
    expect(report.rangeStart).toBe("2026-06-22");
    expect(report.rangeEnd).toBe("2026-06-28");
    expect(report.days.map((day) => day.date)).toEqual([
      "2026-06-22",
      "2026-06-23",
      "2026-06-24",
      "2026-06-25",
      "2026-06-26",
      "2026-06-27",
      "2026-06-28",
    ]);
    expect(report.totals).toEqual({
      messages: 7,
      xp: 55,
      questsCompleted: 1,
      activeDays: 2,
    });

    const todayEntry = report.days.find((d) => d.date === today);
    expect(todayEntry).toEqual({
      date: today,
      messages: 5,
      xp: 40,
      questsCompleted: 1,
    });
  });

  it("returns all-zero days for a user with no data", () => {
    db = freshDb();
    const report = weeklyReport(
      db,
      USER,
      TZ,
      new Date("2026-06-23T12:00:00.000Z"),
    );
    expect(report.days).toHaveLength(7);
    expect(report.totals).toEqual({
      messages: 0,
      xp: 0,
      questsCompleted: 0,
      activeDays: 0,
    });
  });

  it("includes completed daily quests and structured XP awards without requiring messages", () => {
    db = freshDb();
    const now = new Date("2026-06-23T12:00:00.000Z");
    const today = "2026-06-23";

    db.prepare(
      `insert into daily_quest_days (user_id,local_date,tier,status,completed_at,evaluated,created_at,updated_at)
       values (?,?,?,?,?,?,?,?)`,
    ).run(
      USER,
      today,
      "e",
      "completed",
      now.toISOString(),
      0,
      now.toISOString(),
      now.toISOString(),
    );

    db.prepare(
      `insert into xp_awards (id,user_id,source,source_id,reason,xp_delta,occurred_at,created_at)
       values (?,?,?,?,?,?,?,?)`,
    ).run(
      randomUUID(),
      USER,
      "daily_quest",
      today,
      "daily_quest_completed",
      100,
      now.toISOString(),
      now.toISOString(),
    );

    const report = weeklyReport(db, USER, TZ, now);

    expect(report.totals).toEqual({
      messages: 0,
      xp: 100,
      questsCompleted: 1,
      activeDays: 1,
    });

    const todayEntry = report.days.find((d) => d.date === today);
    expect(todayEntry).toEqual({
      date: today,
      messages: 0,
      xp: 100,
      questsCompleted: 1,
    });
  });

  it("counts stat-only training logs as active days", () => {
    db = freshDb();
    const now = new Date("2026-06-23T12:00:00.000Z");

    db.prepare(
      `insert into stat_awards (id,user_id,stat_key,delta,reason,source,source_id,occurred_at,created_at)
       values (?,?,?,?,?,?,?,?,?)`,
    ).run(
      randomUUID(),
      USER,
      "strength",
      1,
      "message:body-training",
      "discord",
      "message-1",
      now.toISOString(),
      now.toISOString(),
    );

    const report = weeklyReport(db, USER, TZ, now);

    expect(report.totals).toEqual({
      messages: 0,
      xp: 0,
      questsCompleted: 0,
      activeDays: 1,
    });
  });
});

describe("listAchievements", () => {
  it("orders unlocked achievements before in-progress ones", () => {
    db = freshDb();
    const now = new Date("2026-06-23T12:00:00.000Z").toISOString();
    const insert = db.prepare(
      `insert into achievements (id,user_id,code,name,description,tier,progress,target,unlocked_at,created_at,updated_at)
       values (?,?,?,?,?,?,?,?,?,?,?)`,
    );
    insert.run(
      randomUUID(),
      USER,
      "first_blood",
      "First Blood",
      "Post your first message",
      "bronze",
      1,
      1,
      now,
      now,
      now,
    );
    insert.run(
      randomUUID(),
      USER,
      "marathon",
      "Marathon",
      "Stay active 30 days",
      "gold",
      4,
      30,
      null,
      now,
      now,
    );

    const achievements = listAchievements(db, USER);
    expect(achievements).toHaveLength(2);
    expect(achievements[0]).toMatchObject({
      code: "first_blood",
      unlocked: true,
    });
    expect(achievements[1]).toMatchObject({
      code: "marathon",
      unlocked: false,
      progress: 4,
      target: 30,
    });
  });
});

describe("read-only report routes", () => {
  it("serves achievements and the weekly report", async () => {
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

    const achievements = await api.app.inject({
      method: "GET",
      url: "/api/achievements",
    });
    expect(achievements.statusCode).toBe(200);
    expect(achievements.json()).toMatchObject({
      userId: "local-user",
      achievements: [],
    });

    const weekly = await api.app.inject({
      method: "GET",
      url: "/api/reports/weekly",
    });
    expect(weekly.statusCode).toBe(200);
    expect(weekly.json().days).toHaveLength(7);

    await api.close();
  });
});
