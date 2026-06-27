import { randomUUID } from "node:crypto";
import { computeStatLevel } from "@solo-system/shared";
import type { ChannelCategory } from "./config.js";
import type { Db } from "./db.js";
import type { XpClock } from "./xp.js";

// Player ("Hunter") stats: eight RPG attributes that grow from tracked Discord activity
// and quest completion. Unlike XP, stats are meant to grow slowly — a meaningful log
// grants +1 to the channel's primary stat, and at most +1 to a clearly-relevant
// secondary stat detected from message content (only when content is available).

export const PLAYER_STAT_KEYS = [
  "strength",
  "intelligence",
  "discipline",
  "technical",
  "health",
  "communication",
  "wealth",
  "survival",
] as const;

export type StatKey = (typeof PLAYER_STAT_KEYS)[number];

export const STAT_LABELS: Record<StatKey, string> = {
  strength: "Strength",
  intelligence: "Intelligence",
  discipline: "Discipline",
  technical: "Technical Skill",
  health: "Health",
  communication: "Communication",
  wealth: "Wealth / Career",
  survival: "Survival",
};

/** Primary stat earned by any meaningful log in a tracked channel category. */
const PRIMARY_STAT: Record<ChannelCategory, StatKey> = {
  "daily-quests": "discipline",
  "mind-training": "intelligence",
  "body-training": "strength",
  "work-skill": "technical",
};

// Secondary stats are only granted when the message content clearly relates to them.
// Detection is keyword-based and therefore only fires when message content is stored
// (STORE_MESSAGE_CONTENT=true); with content disabled, only the primary stat is earned.
const SECONDARY_KEYWORDS: Record<
  ChannelCategory,
  Partial<Record<StatKey, string[]>>
> = {
  "daily-quests": {
    health: [
      "sleep",
      "food",
      "eat",
      "meal",
      "exercise",
      "workout",
      "recovery",
      "rest",
      "hydrate",
      "water",
    ],
    intelligence: ["study", "read", "learn", "reason", "analy", "research"],
    technical: ["code", "coding", "program", "bug", "deploy", "build"],
  },
  "mind-training": {
    communication: [
      "writ",
      "speak",
      "language",
      "english",
      "vocab",
      "essay",
      "journal",
      "blog",
    ],
    survival: [
      "decision",
      "risk",
      "surviv",
      "practical",
      "real-world",
      "prepare",
      "plan",
    ],
    discipline: [
      "focus",
      "consistent",
      "habit",
      "routine",
      "discipline",
      "streak",
    ],
  },
  "body-training": {
    health: [
      "health",
      "recovery",
      "rest",
      "sleep",
      "nutrition",
      "diet",
      "stretch",
    ],
    discipline: [
      "consistent",
      "habit",
      "routine",
      "discipline",
      "streak",
      "daily",
    ],
    survival: ["surviv", "practical", "readiness", "endurance", "conditioning"],
  },
  "work-skill": {
    wealth: [
      "wealth",
      "career",
      "money",
      "client",
      "invoice",
      "salary",
      "business",
      "revenue",
      "ship",
      "launch",
    ],
    communication: [
      "report",
      "meeting",
      "message",
      "email",
      "present",
      "standup",
      "doc",
    ],
    intelligence: ["learn", "study", "architecture", "design", "research"],
    discipline: ["consistent", "session", "focus", "habit", "routine"],
  },
};

/** Minimum content length (chars) for a message to count as a meaningful log. */
export const MIN_CONTENT_LENGTH_FOR_STAT = 2;
/** Per-category cap on message-driven stat gains per local day, to keep growth slow. */
export const MAX_MESSAGE_STAT_GAINS_PER_CATEGORY_PER_DAY = 5;

export interface StatGain {
  statKey: StatKey;
  delta: number;
}

/**
 * Stat gains for a meaningful message in a tracked category: +1 primary, plus +1 to any
 * secondary stat whose keywords appear in the (optional) content. Returns [] when the
 * message is too short to be meaningful.
 */
export function messageStatGains(
  category: ChannelCategory,
  contentLength: number,
  content = "",
): StatGain[] {
  if (contentLength < MIN_CONTENT_LENGTH_FOR_STAT) return [];
  const gains: StatGain[] = [{ statKey: PRIMARY_STAT[category], delta: 1 }];
  const primary = PRIMARY_STAT[category];
  const text = content.toLowerCase();
  if (text) {
    for (const [statKey, keywords] of Object.entries(
      SECONDARY_KEYWORDS[category],
    ) as [StatKey, string[]][]) {
      if (statKey === primary) continue;
      if (keywords.some((kw) => text.includes(kw)))
        gains.push({ statKey, delta: 1 });
    }
  }
  return gains;
}

/** Stat gains for completing a quest. Quests build Discipline, scaled by difficulty. */
export function questStatGains(questType: string): StatGain[] {
  const amount: Record<string, number> = {
    easy: 2,
    normal: 2,
    hard: 3,
    boss: 4,
    raid: 5,
  };
  return [{ statKey: "discipline", delta: amount[questType] ?? 2 }];
}

export interface PlayerStat {
  key: StatKey;
  label: string;
  value: number;
  level: number;
  pointsIntoLevel: number;
  pointsForNextLevel: number;
}

/** Read all eight stats for a user, defaulting missing attributes to 0, with per-stat level. */
export function getPlayerStats(
  db: Db,
  userId: string,
): { userId: string; stats: PlayerStat[]; updatedAt: string | null } {
  const rows = db
    .prepare(
      "select stat_key,value,updated_at from player_stats where user_id=?",
    )
    .all(userId) as { stat_key: string; value: number; updated_at: string }[];
  const byKey = new Map(rows.map((r) => [r.stat_key, r]));
  const updatedAt = rows.reduce<string | null>(
    (acc, r) => (acc && acc > r.updated_at ? acc : r.updated_at),
    null,
  );
  const stats = PLAYER_STAT_KEYS.map((key) => {
    const value = byKey.get(key)?.value ?? 0;
    return { key, label: STAT_LABELS[key], value, ...computeStatLevel(value) };
  });
  return { userId, stats, updatedAt };
}

export interface ApplyStatGainsInput {
  userId: string;
  gains: StatGain[];
  reason: string;
  source: string;
  sourceId?: string | null;
}

export interface ApplyStatGainsResult {
  changed: { statKey: StatKey; from: number; to: number }[];
  stats: PlayerStat[];
}

/**
 * Apply a set of stat gains atomically: materialize each attribute (floored at 0) and
 * append an audit row to stat_awards. Returns the attributes that actually changed.
 */
export function applyStatGains(
  db: Db,
  input: ApplyStatGainsInput,
  clock: XpClock = {},
): ApplyStatGainsResult {
  const now = clock.now?.() ?? new Date().toISOString();
  const genId = clock.genId ?? randomUUID;

  const run = db.transaction((): ApplyStatGainsResult => {
    const changed: { statKey: StatKey; from: number; to: number }[] = [];
    for (const gain of input.gains) {
      if (!gain.delta) continue;
      const row = db
        .prepare(
          "select value from player_stats where user_id=? and stat_key=?",
        )
        .get(input.userId, gain.statKey) as { value: number } | undefined;
      const from = row?.value ?? 0;
      const to = Math.max(0, from + gain.delta);
      const applied = to - from;
      if (applied === 0) continue;
      db.prepare(
        `insert into player_stats (user_id,stat_key,value,updated_at) values (?,?,?,?)
         on conflict(user_id,stat_key) do update set value=excluded.value, updated_at=excluded.updated_at`,
      ).run(input.userId, gain.statKey, to, now);
      db.prepare(
        `insert into stat_awards (id,user_id,stat_key,delta,reason,source,source_id,occurred_at,created_at)
         values (?,?,?,?,?,?,?,?,?)`,
      ).run(
        genId(),
        input.userId,
        gain.statKey,
        applied,
        input.reason,
        input.source,
        input.sourceId ?? null,
        now,
        now,
      );
      changed.push({ statKey: gain.statKey, from, to });
    }
    return { changed, stats: getPlayerStats(db, input.userId).stats };
  });

  return run();
}

/**
 * Award stats for a tracked message, enforcing the per-category daily cap so high-volume
 * chatter cannot inflate attributes. `localDate` is the user's local calendar day.
 * Returns the applied result, or null when nothing was awarded (too short or capped).
 */
export function awardMessageStats(
  db: Db,
  params: {
    userId: string;
    category: ChannelCategory;
    contentLength: number;
    content?: string;
    localDate: string;
    sourceId?: string | null;
  },
  clock: XpClock = {},
): ApplyStatGainsResult | null {
  const gains = messageStatGains(
    params.category,
    params.contentLength,
    params.content,
  );
  if (!gains.length) return null;

  const dayStart = `${params.localDate}T00:00:00.000Z`;
  const used = db
    .prepare(
      `select count(*) as n from stat_awards where user_id=? and source=? and reason=? and occurred_at>=?`,
    )
    .get(params.userId, "discord", `message:${params.category}`, dayStart) as {
    n: number;
  };
  if (used.n >= MAX_MESSAGE_STAT_GAINS_PER_CATEGORY_PER_DAY) return null;

  return applyStatGains(
    db,
    {
      userId: params.userId,
      gains,
      reason: `message:${params.category}`,
      source: "discord",
      sourceId: params.sourceId ?? null,
    },
    clock,
  );
}
