import { describe, expect, it } from "vitest";
import {
  applyMigrations,
  openDatabase,
  seedDatabase,
  SEED_USER_ID,
  type Db,
} from "./db.js";

// Logical table groups required by the spec, each satisfied by at least one concrete table.
const REQUIRED_TABLES = [
  "users",
  "tracked_channels", // discord_channels / tracked channels
  "discord_events", // raw_messages / discord_events
  "quests",
  "activity_events", // quest_events / activity_events
  "xp_ledger", // xp_events / xp_ledger
  "rank_snapshots", // player_stats
  "daily_stats",
  "achievements",
  "daily_reviews",
  "app_meta", // system_settings / app_meta
];

function freshDb(): Db {
  const db = openDatabase(":memory:");
  applyMigrations(db);
  return db;
}

function tableNames(db: Db): Set<string> {
  const rows = db
    .prepare("select name from sqlite_master where type='table'")
    .all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

describe("schema", () => {
  it("creates every required table", () => {
    const db = freshDb();
    try {
      const tables = tableNames(db);
      for (const t of REQUIRED_TABLES)
        expect(tables.has(t), `missing table: ${t}`).toBe(true);
    } finally {
      db.close();
    }
  });

  it("is reproducible / idempotent when migrations run twice", () => {
    const db = freshDb();
    try {
      expect(() => applyMigrations(db)).not.toThrow();
      const tables = tableNames(db);
      for (const t of REQUIRED_TABLES) expect(tables.has(t)).toBe(true);
    } finally {
      db.close();
    }
  });

  it("seeds the player/user row and the configured channel whitelist", () => {
    const db = freshDb();
    try {
      const config = {
        trackedGuildId: "guild-1",
        trackedChannelIds: ["chan-1", "chan-2"],
        timezone: "Asia/Tashkent",
      };
      seedDatabase(db, config, "002_rpg_schema.sql");

      const user = db
        .prepare("select user_id,is_player from users where user_id=?")
        .get(SEED_USER_ID) as
        { user_id: string; is_player: number } | undefined;
      expect(user).toBeDefined();
      expect(user?.is_player).toBe(1);

      const channels = db
        .prepare("select channel_id from tracked_channels order by channel_id")
        .all() as {
        channel_id: string;
      }[];
      expect(channels.map((c) => c.channel_id)).toEqual(["chan-1", "chan-2"]);

      const version = db
        .prepare("select value from app_meta where key='schema_version'")
        .get() as { value: string } | undefined;
      expect(version?.value).toBe("002_rpg_schema.sql");
    } finally {
      db.close();
    }
  });

  it("seeding is idempotent", () => {
    const db = freshDb();
    try {
      const config = {
        trackedGuildId: "guild-1",
        trackedChannelIds: ["chan-1"],
        timezone: "Asia/Tashkent",
      };
      seedDatabase(db, config, "002_rpg_schema.sql");
      seedDatabase(db, config, "002_rpg_schema.sql");

      const userCount = db.prepare("select count(*) as n from users").get() as {
        n: number;
      };
      expect(userCount.n).toBe(1);
      const channelCount = db
        .prepare("select count(*) as n from tracked_channels")
        .get() as { n: number };
      expect(channelCount.n).toBe(1);
    } finally {
      db.close();
    }
  });
});
