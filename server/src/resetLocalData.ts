import type { Db } from "./db.js";

export const LOCAL_DATA_TABLES = [
  "daily_quest_metric_events",
  "daily_quest_metrics",
  "daily_quest_days",
  "daily_quest_settings",
  "daily_quest_state",
  "loot_boxes",
  "xp_ledger",
  "activity_events",
  "discord_events",
  "raw_messages",
  "stat_awards",
  "player_stats",
  "xp_awards",
  "rank_snapshots",
  "daily_stats",
  "daily_reviews",
  "achievements",
  "quests",
  "notifications",
] as const;

export interface ResetTableResult {
  table: string;
  rowsCleared: number;
}

export function resetLocalData(db: Db): ResetTableResult[] {
  return db.transaction(() =>
    LOCAL_DATA_TABLES.map((table) => {
      const result = db.prepare(`delete from ${table}`).run();
      return { table, rowsCleared: result.changes };
    }),
  )();
}
