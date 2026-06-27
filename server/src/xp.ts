import { randomUUID } from "node:crypto";
import { computeRankState, type RankState } from "@solo-system/shared";
import type { Db } from "./db.js";

// The XP engine owns the materialized player-stats row (rank_snapshots) and the
// auditable award ledger (xp_awards). All XP that affects level/rank flows through
// awardXp so that total_xp, level, rank and progress stay consistent in one place.

export interface RankSnapshot extends RankState {
  userId: string;
  currentStreakDays: number;
  longestStreakDays: number;
  updatedAt: string | null;
}

export interface AwardXpInput {
  userId: string;
  amount: number;
  reason: string;
  source: string;
  sourceId?: string | null;
}

export interface AwardXpResult {
  userId: string;
  xpAwarded: number;
  previous: RankSnapshot;
  current: RankSnapshot;
  leveledUp: boolean;
  levelsGained: number;
  rankChanged: boolean;
}

export interface XpClock {
  now?: () => string;
  genId?: () => string;
}

interface RankSnapshotRow {
  user_id: string;
  total_xp: number;
  current_streak_days: number;
  longest_streak_days: number;
  updated_at: string | null;
}

function toSnapshot(
  userId: string,
  totalXp: number,
  streaks: { current: number; longest: number },
  updatedAt: string | null,
): RankSnapshot {
  return {
    userId,
    ...computeRankState(totalXp),
    currentStreakDays: streaks.current,
    longestStreakDays: streaks.longest,
    updatedAt,
  };
}

/** Read the player's current stats, materializing a zeroed snapshot if none exists yet. */
export function getRankSnapshot(db: Db, userId: string): RankSnapshot {
  const row = db
    .prepare(
      "select user_id,total_xp,current_streak_days,longest_streak_days,updated_at from rank_snapshots where user_id=?",
    )
    .get(userId) as RankSnapshotRow | undefined;
  if (!row) return toSnapshot(userId, 0, { current: 0, longest: 0 }, null);
  return toSnapshot(
    userId,
    row.total_xp,
    { current: row.current_streak_days, longest: row.longest_streak_days },
    row.updated_at,
  );
}

/**
 * Award (or, with a negative amount, deduct) XP for a user and recompute their
 * level/rank. Records an xp_awards ledger row and upserts rank_snapshots atomically.
 * Total XP is floored at 0; streak counters are preserved.
 */
export function awardXp(
  db: Db,
  input: AwardXpInput,
  clock: XpClock = {},
): AwardXpResult {
  if (!Number.isFinite(input.amount) || !Number.isInteger(input.amount)) {
    throw new Error("xp amount must be an integer");
  }
  const now = clock.now?.() ?? new Date().toISOString();
  const genId = clock.genId ?? randomUUID;

  const run = db.transaction((): AwardXpResult => {
    const existing = db
      .prepare(
        "select user_id,total_xp,current_streak_days,longest_streak_days,updated_at from rank_snapshots where user_id=?",
      )
      .get(input.userId) as RankSnapshotRow | undefined;

    const previousTotal = existing?.total_xp ?? 0;
    const streaks = {
      current: existing?.current_streak_days ?? 0,
      longest: existing?.longest_streak_days ?? 0,
    };
    const nextTotal = Math.max(0, previousTotal + input.amount);
    const appliedDelta = nextTotal - previousTotal;

    const previous = toSnapshot(
      input.userId,
      previousTotal,
      streaks,
      existing?.updated_at ?? null,
    );
    const current = toSnapshot(input.userId, nextTotal, streaks, now);

    db.prepare(
      `insert into rank_snapshots
        (user_id,total_xp,level,rank_code,rank_name,xp_into_level,xp_for_next_level,current_streak_days,longest_streak_days,updated_at)
       values (@user_id,@total_xp,@level,@rank_code,@rank_name,@xp_into_level,@xp_for_next_level,@current_streak_days,@longest_streak_days,@updated_at)
       on conflict(user_id) do update set
        total_xp=excluded.total_xp,
        level=excluded.level,
        rank_code=excluded.rank_code,
        rank_name=excluded.rank_name,
        xp_into_level=excluded.xp_into_level,
        xp_for_next_level=excluded.xp_for_next_level,
        updated_at=excluded.updated_at`,
    ).run({
      user_id: input.userId,
      total_xp: current.totalXp,
      level: current.level,
      rank_code: current.rankCode,
      rank_name: current.rankName,
      xp_into_level: current.xpIntoLevel,
      xp_for_next_level: current.xpForNextLevel,
      current_streak_days: streaks.current,
      longest_streak_days: streaks.longest,
      updated_at: now,
    });

    if (appliedDelta !== 0) {
      db.prepare(
        `insert into xp_awards (id,user_id,source,source_id,reason,xp_delta,occurred_at,created_at)
         values (?,?,?,?,?,?,?,?)`,
      ).run(
        genId(),
        input.userId,
        input.source,
        input.sourceId ?? null,
        input.reason,
        appliedDelta,
        now,
        now,
      );
    }

    return {
      userId: input.userId,
      xpAwarded: appliedDelta,
      previous,
      current,
      leveledUp: current.level > previous.level,
      levelsGained: Math.max(0, current.level - previous.level),
      rankChanged: current.rankCode !== previous.rankCode,
    };
  });

  return run();
}
