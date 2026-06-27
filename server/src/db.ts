import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "./config.js";
import type { BoundaryConfig } from "./boundary.js";
export type Db = Database.Database;
export function openDatabase(databasePath: string): Db {
  if (databasePath !== ":memory:")
    fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}
export function migrationDirectory() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../migrations"),
    path.resolve(process.cwd(), "migrations"),
    path.resolve(process.cwd(), "../migrations"),
  ];
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found)
    throw new Error(
      `migrations directory not found. Tried: ${candidates.join(", ")}`,
    );
  return found;
}
export function applyMigrations(db: Db) {
  const dir = migrationDirectory();
  const sqlFiles = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of sqlFiles)
    db.exec(fs.readFileSync(path.join(dir, file), "utf8"));
  applyColumnPatches(db);
  return sqlFiles.at(-1) ?? "none";
}
// ALTER TABLE ADD COLUMN is not idempotent in SQLite, so column additions to existing
// tables are applied in code by checking the current schema. Re-running is a no-op.
function ensureColumn(db: Db, table: string, column: string, ddl: string) {
  const cols = db.prepare(`pragma table_info(${table})`).all() as {
    name: string;
  }[];
  if (!cols.some((c) => c.name === column))
    db.exec(`alter table ${table} add column ${ddl}`);
}
function applyColumnPatches(db: Db) {
  ensureColumn(db, "raw_messages", "thread_id", "thread_id text null");
  ensureColumn(db, "raw_messages", "thread_title", "thread_title text null");
  ensureColumn(db, "daily_quest_days", "id", "id text null");
  ensureColumn(db, "daily_quest_days", "hunter_rank", "hunter_rank text null");
  ensureColumn(
    db,
    "daily_quest_days",
    "discord_parent_message_id",
    "discord_parent_message_id text null",
  );
  ensureColumn(
    db,
    "daily_quest_days",
    "discord_daily_quest_message_id",
    "discord_daily_quest_message_id text null",
  );
  ensureColumn(
    db,
    "daily_quest_days",
    "discord_thread_intro_message_id",
    "discord_thread_intro_message_id text null",
  );
  ensureColumn(
    db,
    "daily_quest_days",
    "discord_thread_id",
    "discord_thread_id text null",
  );
  ensureColumn(
    db,
    "daily_quest_days",
    "discord_thread_name",
    "discord_thread_name text null",
  );
  ensureColumn(
    db,
    "daily_quest_days",
    "streak_day_number",
    "streak_day_number integer null",
  );
  ensureColumn(
    db,
    "daily_quest_days",
    "rewards_granted",
    "rewards_granted integer not null default 0",
  );
}
// Default local single-player identity. Matches the api.ts query default.
export const SEED_USER_ID = "local-user";
export function seedDatabase(
  db: Db,
  config: Pick<AppConfig, "trackedGuildId" | "trackedChannelIds">,
  schemaVersion: string,
) {
  const now = new Date().toISOString();
  const upsertChannel = db.prepare(
    `insert into tracked_channels (channel_id,guild_id,created_at) values (?,?,?) on conflict(channel_id) do update set guild_id=excluded.guild_id,enabled=1`,
  );
  const upsertUser = db.prepare(
    `insert into users (user_id,display_name,is_player,timezone,created_at,updated_at) values (?,?,1,?,?,?) on conflict(user_id) do update set updated_at=excluded.updated_at`,
  );
  const setMeta = db.prepare(
    "insert or replace into app_meta (key,value) values (?,?)",
  );
  db.transaction(() => {
    upsertUser.run(
      SEED_USER_ID,
      "Player",
      (config as Partial<AppConfig>).timezone ?? null,
      now,
      now,
    );
    for (const ch of config.trackedChannelIds)
      upsertChannel.run(ch, config.trackedGuildId, now);
    setMeta.run("schema_version", schemaVersion);
    setMeta.run("seeded_at", now);
  })();
}
export function migrate(
  config: Pick<
    AppConfig,
    "databasePath" | "trackedGuildId" | "trackedChannelIds" | "timezone"
  >,
): void {
  const db = openDatabase(config.databasePath);
  try {
    const ver = applyMigrations(db);
    seedDatabase(db, config, ver);
  } finally {
    db.close();
  }
}
// Runtime whitelist comes from the database (seeded from env on migrate), not directly from env,
// so channels can be managed in the DB without changing the bot's enforcement source of truth.
export function readTrackedChannelIds(db: Db): string[] {
  const rows = db
    .prepare(
      "select channel_id from tracked_channels where enabled=1 order by channel_id",
    )
    .all() as { channel_id: string }[];
  return rows.map((r) => r.channel_id);
}
export interface RawDiscordMessageInput {
  messageId: string;
  guildId: string;
  channelId: string;
  parentChannelId?: string | null;
  threadId?: string | null;
  threadTitle?: string | null;
  authorId: string;
  content: string;
  messageTimestamp: string;
  receivedAt?: string;
  metadata?: Record<string, unknown> | null;
}
export function storeRawMessage(
  db: Db,
  input: RawDiscordMessageInput,
): boolean {
  const receivedAt = input.receivedAt ?? new Date().toISOString();
  const metadataJson =
    input.metadata == null ? null : JSON.stringify(input.metadata);
  const result = db
    .prepare(
      `insert or ignore into raw_messages (message_id,guild_id,channel_id,parent_channel_id,thread_id,thread_title,author_id,content,message_timestamp,received_at,metadata_json) values (@messageId,@guildId,@channelId,@parentChannelId,@threadId,@threadTitle,@authorId,@content,@messageTimestamp,@receivedAt,@metadataJson)`,
    )
    .run({
      ...input,
      parentChannelId: input.parentChannelId ?? null,
      threadId: input.threadId ?? null,
      threadTitle: input.threadTitle ?? null,
      receivedAt,
      metadataJson,
    });
  return result.changes === 1;
}
export function persistRawMessage(
  databasePath: string,
  input: RawDiscordMessageInput,
): boolean {
  const db = openDatabase(databasePath);
  try {
    return storeRawMessage(db, input);
  } finally {
    db.close();
  }
}
export function loadTrackedBoundary(
  config: Pick<AppConfig, "databasePath" | "trackedGuildId">,
): BoundaryConfig {
  const db = openDatabase(config.databasePath);
  try {
    return {
      trackedGuildId: config.trackedGuildId,
      trackedChannelIds: readTrackedChannelIds(db),
    };
  } finally {
    db.close();
  }
}
