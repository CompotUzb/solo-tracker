import { randomUUID } from "node:crypto";
import type { Db } from "./db.js";
import { awardXp, type XpClock } from "./xp.js";
import {
  applyStatGains,
  getPlayerStats,
  PLAYER_STAT_KEYS,
  type StatKey,
} from "./stats.js";
import type { NotificationInput } from "./notifications.js";

// Real-world Daily Quest engine. A day's quest is a fixed checklist of physical/mental
// metrics scaled by the chosen tier. Completing every metric awards XP + stat points + a
// loot box and advances a streak; a missed day (evaluated at local midnight) breaks the
// streak and triggers a penalty state that lifts only when a recovery "flush" is logged.

export const DAILY_TIERS = ["e", "c", "s"] as const;
export type DailyTier = (typeof DAILY_TIERS)[number];
export const DAILY_TIER_LABELS: Record<DailyTier, string> = {
  e: "E-Rank",
  c: "C-Rank",
  s: "S-Rank",
};
export const DAILY_TIER_NAMES: Record<DailyTier, string> = {
  e: "Beginner",
  c: "Intermediate",
  s: "The Sung Jin-Woo",
};

export const DAILY_METRICS = [
  { key: "pushups", label: "Push-ups", unit: "reps" },
  { key: "situps", label: "Sit-ups", unit: "reps" },
  { key: "squats", label: "Squats", unit: "reps" },
  { key: "pullups", label: "Pull-ups", unit: "reps" },
  { key: "cardio_km", label: "Cardio", unit: "km" },
  { key: "steps", label: "Steps", unit: "steps" },
  { key: "mental_minutes", label: "Mental Focus", unit: "min" },
  { key: "mental_pages", label: "Reading", unit: "pages" },
] as const;
export type DailyMetricKey = (typeof DAILY_METRICS)[number]["key"];

export const DAILY_TIER_TARGETS: Record<
  DailyTier,
  Partial<Record<DailyMetricKey, number>>
> = {
  e: {
    pushups: 30,
    situps: 30,
    squats: 30,
    pullups: 10,
    cardio_km: 2,
    steps: 5000,
    mental_minutes: 15,
    mental_pages: 5,
  },
  c: {
    pushups: 60,
    situps: 60,
    squats: 60,
    pullups: 30,
    cardio_km: 5,
    steps: 10000,
    mental_minutes: 45,
    mental_pages: 15,
  },
  s: {
    pushups: 100,
    situps: 100,
    squats: 100,
    pullups: 60,
    cardio_km: 10,
    mental_minutes: 120,
  },
};

export const DAILY_COMPLETE_XP = 100;
export const DAILY_COMPLETION_STAT_GAINS = [
  { statKey: "strength", delta: 2 },
  { statKey: "health", delta: 2 },
  { statKey: "discipline", delta: 3 },
  { statKey: "intelligence", delta: 1 },
  { statKey: "survival", delta: 1 },
] satisfies { statKey: StatKey; delta: number }[];

const LOOT_REWARDS = {
  common: "30 minutes of guilt-free leisure (gaming, anime, or reading).",
  rare: "A moderate real-world treat (specialty coffee, dining out, or minor hobby gear).",
  legendary:
    "A major reward milestone (fitness apparel, books, or a tech upgrade).",
} as const;

export function isDailyTier(value: string): value is DailyTier {
  return (DAILY_TIERS as readonly string[]).includes(value);
}
export function isDailyMetricKey(value: string): value is DailyMetricKey {
  return DAILY_METRICS.some((m) => m.key === value);
}

export interface DailyState {
  currentStreak: number;
  longestStreak: number;
  statPoints: number;
  penaltyActive: boolean;
  penaltyReason: string | null;
  penaltySince: string | null;
  lastEvaluatedDate: string | null;
}

interface DailyStateRow {
  current_streak: number;
  longest_streak: number;
  stat_points: number;
  penalty_active: number;
  penalty_reason: string | null;
  penalty_since: string | null;
  last_evaluated_date: string | null;
}

function mapState(row: DailyStateRow | undefined): DailyState {
  return {
    currentStreak: row?.current_streak ?? 0,
    longestStreak: row?.longest_streak ?? 0,
    statPoints: row?.stat_points ?? 0,
    penaltyActive: Boolean(row?.penalty_active),
    penaltyReason: row?.penalty_reason ?? null,
    penaltySince: row?.penalty_since ?? null,
    lastEvaluatedDate: row?.last_evaluated_date ?? null,
  };
}

export function getDailyState(db: Db, userId: string): DailyState {
  return mapState(
    db
      .prepare("select * from daily_quest_state where user_id=?")
      .get(userId) as DailyStateRow | undefined,
  );
}

function ensureStateRow(db: Db, userId: string, now: string): void {
  db.prepare(
    `insert into daily_quest_state (user_id,current_streak,longest_streak,stat_points,penalty_active,updated_at)
     values (?,0,0,0,0,?) on conflict(user_id) do nothing`,
  ).run(userId, now);
}

/** Create today's quest + metric rows if missing; if the tier changed, re-snapshot targets (progress kept). */
export function ensureDailyDay(
  db: Db,
  userId: string,
  localDate: string,
  tier: DailyTier,
  clock: XpClock = {},
  hunterRank?: string,
): void {
  const now = clock.now?.() ?? new Date().toISOString();
  const existing = db
    .prepare(
      "select tier,status from daily_quest_days where user_id=? and local_date=?",
    )
    .get(userId, localDate) as { tier: string; status: string } | undefined;

  const run = db.transaction(() => {
    if (!existing) {
      db.prepare(
        `insert into daily_quest_days (user_id,local_date,tier,status,evaluated,created_at,updated_at)
         values (?,?,?,'active',0,?,?)`,
      ).run(userId, localDate, tier, now, now);
    } else if (existing.tier !== tier && existing.status === "active") {
      db.prepare(
        "update daily_quest_days set tier=?, updated_at=? where user_id=? and local_date=?",
      ).run(tier, now, userId, localDate);
    }
    if (hunterRank) {
      db.prepare(
        "update daily_quest_days set hunter_rank=coalesce(hunter_rank,?),updated_at=? where user_id=? and local_date=?",
      ).run(hunterRank, now, userId, localDate);
    }
    // Upsert metric target rows (only adjust targets while the day is still active).
    const status = existing?.status ?? "active";
    const targets = DAILY_TIER_TARGETS[tier];
    if (status === "active") {
      const includedKeys = Object.keys(targets);
      const placeholders = includedKeys.map(() => "?").join(",");
      db.prepare(
        `delete from daily_quest_metrics where user_id=? and local_date=? and metric_key not in (${placeholders})`,
      ).run(userId, localDate, ...includedKeys);
    }
    for (const metric of DAILY_METRICS) {
      const target = targets[metric.key];
      if (target == null) continue;
      if (status === "active") {
        db.prepare(
          `insert into daily_quest_metrics (user_id,local_date,metric_key,target,progress,created_at,updated_at)
           values (?,?,?,?,0,?,?)
           on conflict(user_id,local_date,metric_key) do update set target=excluded.target, updated_at=excluded.updated_at`,
        ).run(userId, localDate, metric.key, target, now, now);
      } else {
        db.prepare(
          `insert into daily_quest_metrics (user_id,local_date,metric_key,target,progress,created_at,updated_at)
           values (?,?,?,?,0,?,?) on conflict(user_id,local_date,metric_key) do nothing`,
        ).run(userId, localDate, metric.key, target, now, now);
      }
    }
  });
  run();
}

export interface DailyMetricView {
  key: DailyMetricKey;
  label: string;
  unit: string;
  target: number;
  progress: number;
  done: boolean;
}

export interface DailyQuestView {
  id: string | null;
  date: string;
  tier: DailyTier;
  tierLabel: string;
  tierName: string;
  hunterRank: string;
  status: string;
  completedAt: string | null;
  metrics: DailyMetricView[];
  complete: boolean;
  completedCount: number;
  totalCount: number;
  discordParentMessageId: string | null;
  discordThreadId: string | null;
  discordThreadName: string | null;
  streakDayNumber: number | null;
  rewardsGranted: boolean;
}

export function getDailyQuest(
  db: Db,
  userId: string,
  localDate: string,
): DailyQuestView | null {
  const day = db
    .prepare(
      "select id,hunter_rank,tier,status,completed_at,discord_parent_message_id,discord_thread_id,discord_thread_name,streak_day_number,rewards_granted from daily_quest_days where user_id=? and local_date=?",
    )
    .get(userId, localDate) as
    | {
        id: string | null;
        hunter_rank: string | null;
        tier: string;
        status: string;
        completed_at: string | null;
        discord_parent_message_id: string | null;
        discord_thread_id: string | null;
        discord_thread_name: string | null;
        streak_day_number: number | null;
        rewards_granted: number;
      }
    | undefined;
  if (!day) return null;
  const rows = db
    .prepare(
      "select metric_key,target,progress from daily_quest_metrics where user_id=? and local_date=?",
    )
    .all(userId, localDate) as {
    metric_key: string;
    target: number;
    progress: number;
  }[];
  const byKey = new Map(rows.map((r) => [r.metric_key, r]));
  const metrics: DailyMetricView[] = DAILY_METRICS.flatMap((m) => {
    const row = byKey.get(m.key);
    if (!row) return [];
    const target = row.target;
    const progress = row?.progress ?? 0;
    return [
      {
        key: m.key,
        label: m.label,
        unit: m.unit,
        target,
        progress,
        done: progress >= target,
      },
    ];
  });
  const required = metrics.filter((m) =>
    ["pushups", "situps", "squats", "pullups"].includes(m.key),
  );
  const cardioDone = metrics.some(
    (m) => (m.key === "cardio_km" || m.key === "steps") && m.done,
  );
  const mentalDone = metrics.some(
    (m) => (m.key === "mental_minutes" || m.key === "mental_pages") && m.done,
  );
  const completedCount =
    required.filter((m) => m.done).length +
    Number(cardioDone) +
    Number(mentalDone);
  const complete = required.every((m) => m.done) && cardioDone && mentalDone;
  return {
    id: day.id,
    date: localDate,
    tier: isDailyTier(day.tier) ? day.tier : "e",
    tierLabel: DAILY_TIER_LABELS[isDailyTier(day.tier) ? day.tier : "e"],
    tierName: DAILY_TIER_NAMES[isDailyTier(day.tier) ? day.tier : "e"],
    hunterRank:
      day.hunter_rank ??
      DAILY_TIER_LABELS[isDailyTier(day.tier) ? day.tier : "e"],
    status: day.status,
    completedAt: day.completed_at,
    metrics,
    complete,
    completedCount,
    totalCount: 6,
    discordParentMessageId: day.discord_parent_message_id,
    discordThreadId: day.discord_thread_id,
    discordThreadName: day.discord_thread_name,
    streakDayNumber: day.streak_day_number,
    rewardsGranted: Boolean(day.rewards_granted),
  };
}

function rarityForStreak(streak: number): "rare" | "legendary" | null {
  if (streak > 0 && streak % 30 === 0) return "legendary";
  if (streak > 0 && streak % 7 === 0) return "rare";
  return null;
}

function createLootBox(
  db: Db,
  userId: string,
  rarity: keyof typeof LOOT_REWARDS,
  source: string,
  now: string,
  genId: () => string,
) {
  db.prepare(
    `insert into loot_boxes (id,user_id,rarity,reward,source,status,created_at) values (?,?,?,?,?,'unopened',?)`,
  ).run(genId(), userId, rarity, LOOT_REWARDS[rarity], source, now);
}

export interface CompleteDailyResult {
  quest: DailyQuestView;
  xpAwarded: number;
  leveledUp: boolean;
  newStreak: number;
  statGains: typeof DAILY_COMPLETION_STAT_GAINS;
  lootBoxes: { rarity: string; reward: string }[];
}

export interface DailyHooks {
  clock?: XpClock;
  notify?: (input: NotificationInput) => void;
}

/** Mark today's quest complete and grant immediate rewards. Streaks advance only at evaluation. */
function completeDailyDay(
  db: Db,
  userId: string,
  localDate: string,
  hooks: DailyHooks,
): CompleteDailyResult {
  const clock = hooks.clock ?? {};
  const now = clock.now?.() ?? new Date().toISOString();
  const genId = clock.genId ?? randomUUID;
  ensureStateRow(db, userId, now);

  const run = db.transaction(
    (): {
      currentStreak: number;
      lootBoxes: { rarity: string; reward: string }[];
    } => {
      db.prepare(
        `update daily_quest_days set status='completed', completed_at=?, rewards_granted=1, updated_at=? where user_id=? and local_date=?`,
      ).run(now, now, userId, localDate);

      const state = db
        .prepare("select current_streak from daily_quest_state where user_id=?")
        .get(userId) as { current_streak: number } | undefined;
      const lootBoxes: { rarity: string; reward: string }[] = [
        { rarity: "common", reward: LOOT_REWARDS.common },
      ];
      createLootBox(db, userId, "common", "daily", now, genId);
      return { currentStreak: state?.current_streak ?? 0, lootBoxes };
    },
  );
  const { currentStreak, lootBoxes } = run();

  const award = awardXp(
    db,
    {
      userId,
      amount: DAILY_COMPLETE_XP,
      reason: "daily_quest_completed",
      source: "daily_quest",
      sourceId: localDate,
    },
    clock.genId ? { now: () => now, genId: clock.genId } : { now: () => now },
  );
  applyStatGains(
    db,
    {
      userId,
      gains: DAILY_COMPLETION_STAT_GAINS,
      reason: "daily_quest_completed",
      source: "daily_quest",
      sourceId: localDate,
    },
    clock.genId ? { now: () => now, genId: clock.genId } : { now: () => now },
  );

  const lootLine =
    lootBoxes.length > 1
      ? `\n🎁 Loot: ${lootBoxes.map((b) => b.rarity).join(", ")} box`
      : "\n🎁 Daily loot box earned";
  hooks.notify?.({
    userId,
    type: "system",
    title: "Daily Quest complete",
    body: `+${DAILY_COMPLETE_XP} XP · automatic stat gains${lootLine}${award.leveledUp ? `\n⬆️ Reached level ${award.current.level}` : ""}`,
    metadata: {
      date: localDate,
      streakPendingEvaluation: true,
      source: "daily_quest",
    },
  });

  return {
    quest: getDailyQuest(db, userId, localDate)!,
    xpAwarded: award.xpAwarded,
    leveledUp: award.leveledUp,
    newStreak: currentStreak,
    statGains: DAILY_COMPLETION_STAT_GAINS,
    lootBoxes,
  };
}

export interface LogMetricResult {
  quest: DailyQuestView;
  completion: CompleteDailyResult | null;
}

/** Set or increment one metric's progress; auto-completes the day when the full checklist is met. */
export function logDailyMetric(
  db: Db,
  userId: string,
  localDate: string,
  metricKey: DailyMetricKey,
  value: { progress?: number; delta?: number },
  hooks: DailyHooks = {},
): LogMetricResult {
  const now = hooks.clock?.now?.() ?? new Date().toISOString();
  const row = db
    .prepare(
      "select target,progress from daily_quest_metrics where user_id=? and local_date=? and metric_key=?",
    )
    .get(userId, localDate, metricKey) as
    { target: number; progress: number } | undefined;
  if (!row) throw new Error(`no daily metric ${metricKey} for ${localDate}`);

  const next =
    value.progress != null ? value.progress : row.progress + (value.delta ?? 0);
  const clamped = Math.max(0, Math.min(next, row.target));
  db.prepare(
    "update daily_quest_metrics set progress=?, updated_at=? where user_id=? and local_date=? and metric_key=?",
  ).run(clamped, now, userId, localDate, metricKey);

  const day = db
    .prepare(
      "select status from daily_quest_days where user_id=? and local_date=?",
    )
    .get(userId, localDate) as { status: string } | undefined;
  const quest = getDailyQuest(db, userId, localDate)!;
  let completion: CompleteDailyResult | null = null;
  if (quest.complete && day?.status === "active") {
    completion = completeDailyDay(db, userId, localDate, hooks);
  }
  return { quest: completion?.quest ?? quest, completion };
}

export interface EvaluationResult {
  failedDates: string[];
  completedDates: string[];
  penaltyTriggered: boolean;
  state: DailyState;
}

/**
 * Finalize every past day that hasn't been evaluated yet (run on startup and at local
 * midnight): a non-completed past day fails — break streak + raise penalty — while a
 * completed day is simply marked evaluated. Creation of today's quest is handled by
 * the Discord scheduler, not by evaluation or dashboard reads.
 */
export function runDailyEvaluation(
  db: Db,
  userId: string,
  todayLocalDate: string,
  hooks: DailyHooks = {},
): EvaluationResult {
  const now = hooks.clock?.now?.() ?? new Date().toISOString();
  ensureStateRow(db, userId, now);

  const pastDue = db
    .prepare(
      `select local_date,status from daily_quest_days where user_id=? and local_date<? and evaluated=0 order by local_date asc`,
    )
    .all(userId, todayLocalDate) as { local_date: string; status: string }[];

  const failedDates: string[] = [];
  const completedDates: string[] = [];
  let penaltyTriggered = false;

  for (const day of pastDue) {
    if (day.status === "completed") {
      const state = getDailyState(db, userId);
      const nextStreak = state.currentStreak + 1;
      const longestStreak = Math.max(state.longestStreak, nextStreak);
      db.prepare(
        `update daily_quest_state set current_streak=?,longest_streak=?,updated_at=? where user_id=?`,
      ).run(nextStreak, longestStreak, now, userId);
      const milestone = rarityForStreak(nextStreak);
      if (milestone) {
        createLootBox(
          db,
          userId,
          milestone,
          milestone === "legendary" ? "streak_30" : "streak_7",
          now,
          hooks.clock?.genId ?? randomUUID,
        );
      }
      db.prepare(
        "update daily_quest_days set evaluated=1, updated_at=? where user_id=? and local_date=?",
      ).run(now, userId, day.local_date);
      completedDates.push(day.local_date);
      hooks.notify?.({
        userId,
        type: "system",
        title: `Daily Quest victory — ${nextStreak} day streak`,
        body: milestone ? `${milestone} box unlocked.` : "Streak advanced.",
        metadata: { date: day.local_date, streak: nextStreak, milestone },
      });
      continue;
    }
    // Missed day: fail it, break the streak, raise the penalty state.
    db.prepare(
      `update daily_quest_days set status='failed', evaluated=1, updated_at=? where user_id=? and local_date=?`,
    ).run(now, userId, day.local_date);
    db.prepare(
      `update daily_quest_state set current_streak=0, penalty_active=1, penalty_reason=?, penalty_since=?, updated_at=? where user_id=?`,
    ).run(`Missed the daily quest on ${day.local_date}`, now, now, userId);
    failedDates.push(day.local_date);
    penaltyTriggered = true;
  }

  if (penaltyTriggered) {
    const last = failedDates[failedDates.length - 1];
    hooks.notify?.({
      userId,
      type: "penalty",
      title: "PENALTY ZONE ACTIVE",
      body: `Daily quest missed on ${last}. Streak reset to 0.\nThe penalty lifts only when you log a recovery flush (e.g. a 5 km walk).`,
      metadata: { failedDates, source: "daily_evaluation" },
    });
  }

  db.prepare(
    "update daily_quest_state set last_evaluated_date=?, updated_at=? where user_id=?",
  ).run(todayLocalDate, now, userId);
  return {
    failedDates,
    completedDates,
    penaltyTriggered,
    state: getDailyState(db, userId),
  };
}

/** Clear the penalty after logging a real-world recovery flush. */
export function clearDailyPenalty(
  db: Db,
  userId: string,
  note: string | undefined,
  hooks: DailyHooks = {},
): DailyState {
  const now = hooks.clock?.now?.() ?? new Date().toISOString();
  ensureStateRow(db, userId, now);
  const state = getDailyState(db, userId);
  if (!state.penaltyActive) return state;
  db.prepare(
    "update daily_quest_state set penalty_active=0, penalty_reason=null, penalty_since=null, updated_at=? where user_id=?",
  ).run(now, userId);
  hooks.notify?.({
    userId,
    type: "system",
    title: "Penalty cleared",
    body: `Recovery flush logged${note ? `: ${note}` : ""}. The System lifts the restriction. Get back on track.`,
    metadata: { source: "daily_flush" },
  });
  return getDailyState(db, userId);
}

/** Spend one unallocated stat point to raise an attribute by 1. */
export function allocateStatPoint(
  db: Db,
  userId: string,
  statKey: StatKey,
  clock: XpClock = {},
) {
  const now = clock.now?.() ?? new Date().toISOString();
  ensureStateRow(db, userId, now);
  const run = db.transaction(() => {
    const row = db
      .prepare("select stat_points from daily_quest_state where user_id=?")
      .get(userId) as { stat_points: number } | undefined;
    if (!row || row.stat_points <= 0) return false;
    db.prepare(
      "update daily_quest_state set stat_points=stat_points-1, updated_at=? where user_id=?",
    ).run(now, userId);
    applyStatGains(
      db,
      {
        userId,
        gains: [{ statKey, delta: 1 }],
        reason: "stat_point_allocation",
        source: "allocation",
      },
      clock,
    );
    return true;
  });
  const ok = run();
  return {
    ok,
    state: getDailyState(db, userId),
    stats: getPlayerStats(db, userId).stats,
  };
}

export interface LootBox {
  id: string;
  rarity: string;
  reward: string;
  source: string;
  status: string;
  createdAt: string;
  claimedAt: string | null;
}

interface LootBoxRow {
  id: string;
  rarity: string;
  reward: string;
  source: string;
  status: string;
  created_at: string;
  claimed_at: string | null;
}

function mapLoot(row: LootBoxRow): LootBox {
  return {
    id: row.id,
    rarity: row.rarity,
    reward: row.reward,
    source: row.source,
    status: row.status,
    createdAt: row.created_at,
    claimedAt: row.claimed_at,
  };
}

export function listLootBoxes(db: Db, userId: string, limit = 20): LootBox[] {
  const rows = db
    .prepare(
      "select * from loot_boxes where user_id=? order by (status='unopened') desc, created_at desc limit ?",
    )
    .all(userId, Math.min(Math.max(limit, 1), 100)) as LootBoxRow[];
  return rows.map(mapLoot);
}

export function claimLootBox(
  db: Db,
  userId: string,
  id: string,
  clock: XpClock = {},
): LootBox | null {
  const now = clock.now?.() ?? new Date().toISOString();
  db.prepare(
    `update loot_boxes set status='claimed', claimed_at=? where id=? and user_id=? and status='unopened'`,
  ).run(now, id, userId);
  const row = db
    .prepare("select * from loot_boxes where id=? and user_id=?")
    .get(id, userId) as LootBoxRow | undefined;
  return row ? mapLoot(row) : null;
}

/** Convenience bundle for the dashboard's daily panel. */
export function getDailySnapshot(
  db: Db,
  userId: string,
  localDate: string,
  clock: XpClock = {},
) {
  ensureStateRow(db, userId, clock.now?.() ?? new Date().toISOString());
  return {
    date: localDate,
    quest: getDailyQuest(db, userId, localDate),
    state: getDailyState(db, userId),
    lootBoxes: listLootBoxes(db, userId),
    statKeys: PLAYER_STAT_KEYS,
  };
}
