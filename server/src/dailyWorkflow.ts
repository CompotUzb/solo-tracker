import { randomUUID } from "node:crypto";
import type { Db } from "./db.js";
import {
  DAILY_COMPLETE_XP,
  DAILY_COMPLETION_STAT_GAINS,
  DAILY_TIER_NAMES,
  DAILY_TIER_TARGETS,
  ensureDailyDay,
  getDailyQuest,
  getDailyState,
  logDailyMetric,
  type DailyHooks,
  type CompleteDailyResult,
  type DailyMetricKey,
  type DailyQuestView,
  type DailyTier,
} from "./dailyQuests.js";

export interface ParsedDailyMetric {
  metricKey: DailyMetricKey;
  amount: number;
  rawMatch: string;
}

const REP_PATTERNS: Array<{ metricKey: DailyMetricKey; expression: RegExp }> = [
  {
    metricKey: "pushups",
    expression:
      /(\d+(?:\.\d+)?)(?:\s*[x×]\s*(\d+(?:\.\d+)?))?\s*push[\s-]*ups?\b/gi,
  },
  {
    metricKey: "situps",
    expression:
      /(\d+(?:\.\d+)?)(?:\s*[x×]\s*(\d+(?:\.\d+)?))?\s*sit[\s-]*ups?\b/gi,
  },
  {
    metricKey: "squats",
    expression: /(\d+(?:\.\d+)?)(?:\s*[x×]\s*(\d+(?:\.\d+)?))?\s*squats?\b/gi,
  },
  {
    metricKey: "pullups",
    expression:
      /(\d+(?:\.\d+)?)(?:\s*[x×]\s*(\d+(?:\.\d+)?))?\s*pull[\s-]*ups?\b/gi,
  },
];

function add(
  matches: ParsedDailyMetric[],
  metricKey: DailyMetricKey,
  amount: number,
  rawMatch: string,
): void {
  if (Number.isFinite(amount) && amount > 0)
    matches.push({ metricKey, amount, rawMatch });
}

export function parseDailyProgress(content: string): ParsedDailyMetric[] {
  const matches: ParsedDailyMetric[] = [];

  for (const { metricKey, expression } of REP_PATTERNS) {
    for (const match of content.matchAll(expression)) {
      const first = Number(match[1]);
      const second = match[2] == null ? 1 : Number(match[2]);
      add(matches, metricKey, first * second, match[0]);
    }
  }

  for (const match of content.matchAll(/(\d+(?:\.\d+)?)\s*km\b/gi)) {
    add(matches, "cardio_km", Number(match[1]), match[0]);
  }
  for (const match of content.matchAll(/(\d+(?:\.\d+)?)\s*steps?\b/gi)) {
    add(matches, "steps", Number(match[1]), match[0]);
  }
  for (const match of content.matchAll(
    /\b(?:studied|study|focused|focus|meditated|meditate)\s+(?:for\s+)?(\d+(?:\.\d+)?)\s*(?:m|min|mins|minutes?)\b/gi,
  )) {
    add(matches, "mental_minutes", Number(match[1]), match[0]);
  }
  for (const match of content.matchAll(
    /\bread\s+(\d+(?:\.\d+)?)\s*pages?\b/gi,
  )) {
    add(matches, "mental_pages", Number(match[1]), match[0]);
  }

  const totals = new Map<DailyMetricKey, ParsedDailyMetric>();
  for (const match of matches) {
    const current = totals.get(match.metricKey);
    totals.set(match.metricKey, {
      metricKey: match.metricKey,
      amount: (current?.amount ?? 0) + match.amount,
      rawMatch: current
        ? `${current.rawMatch}, ${match.rawMatch}`
        : match.rawMatch,
    });
  }
  return [...totals.values()];
}

export interface DailyQuestPublisher {
  publish(input: {
    channelId: string;
    content: string;
    threadName: string;
    threadContent: string;
  }): Promise<{
    parentMessageId: string;
    threadId: string;
    threadName: string;
  }>;
}

function dailyTierFromNumber(tier: number): DailyTier {
  if (tier === 2) return "c";
  if (tier === 3) return "s";
  return "e";
}

const TIER_WEIGHT: Record<DailyTier, number> = { e: 1, c: 2, s: 3 };

export function getDailyQuestTierForRank(rank: string): DailyTier {
  const normalized = rank
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  if (
    [
      "s",
      "srank",
      "national",
      "nationallevel",
      "nationallevelhunter",
      "monarch",
    ].includes(normalized)
  )
    return "s";
  if (["c", "crank", "b", "brank", "a", "arank"].includes(normalized))
    return "c";
  return "e";
}

export function resolveDailyQuestTier(
  rank: string,
  override: number | null = null,
): DailyTier {
  const allowed = getDailyQuestTierForRank(rank);
  if (override == null) return allowed;
  const requested = dailyTierFromNumber(override);
  return TIER_WEIGHT[requested] <= TIER_WEIGHT[allowed] ? requested : allowed;
}

function target(tier: DailyTier, key: DailyMetricKey): number | null {
  return DAILY_TIER_TARGETS[tier][key] ?? null;
}

export function formatDailyQuestMessage(
  streakDayNumber: number,
  hunterRank: string,
  tier: DailyTier,
): string {
  const steps = target(tier, "steps");
  const pages = target(tier, "mental_pages");
  const cardio = `[ ] Cardio: 0 / ${target(tier, "cardio_km")} km${steps == null ? "" : ` OR 0 / ${steps} steps`}`;
  const mental = `[ ] Mental Focus: 0 / ${target(tier, "mental_minutes")} min${pages == null ? "" : ` OR 0 / ${pages} pages`}`;
  return [
    `SYSTEM DAILY QUEST — Day-${streakDayNumber}`,
    `Rank: ${hunterRank}`,
    `Tier: ${DAILY_TIER_NAMES[tier]}`,
    "",
    "Required:",
    `[ ] Push-ups: 0 / ${target(tier, "pushups")}`,
    `[ ] Sit-ups: 0 / ${target(tier, "situps")}`,
    `[ ] Squats: 0 / ${target(tier, "squats")}`,
    `[ ] Pull-ups: 0 / ${target(tier, "pullups")}`,
    cardio,
    mental,
    "",
    "Reward:",
    `+${DAILY_COMPLETE_XP} XP`,
    `Automatic stat gains (${DAILY_COMPLETION_STAT_GAINS.map((gain) => `${gain.statKey} +${gain.delta}`).join(", ")})`,
    "Daily Common Box",
    "",
    "Instructions:",
    "Log your progress inside this thread only.",
    `Examples: ${target(tier, "pushups")} pushups, 3x10 situps, walked ${target(tier, "cardio_km")}km, studied ${target(tier, "mental_minutes")}m${pages == null ? "" : `, read ${pages} pages`}`,
  ].join("\n");
}

export function formatDailyQuestThreadMessage(streakDayNumber: number): string {
  return [
    `SYSTEM THREAD ACTIVE — Day-${streakDayNumber}`,
    "",
    "Send your activity logs here.",
    "",
    "Examples:",
    "- 30 pushups",
    "- 3x10 situps",
    "- 30 squats",
    "- 10 pullups",
    "- walked 2km",
    "- 5000 steps",
    "- studied 15m",
    "- read 5 pages",
    "",
    "The System will automatically parse your logs and update the dashboard.",
  ].join("\n");
}

function ensureWorkflowDay(
  db: Db,
  userId: string,
  localDate: string,
  hunterRank: string,
  tier: DailyTier,
  now: string,
): DailyQuestView {
  ensureDailyDay(db, userId, localDate, tier, { now: () => now }, hunterRank);
  const state = getDailyState(db, userId);
  const id = randomUUID();
  db.prepare(
    `update daily_quest_days
        set id=coalesce(id,?), streak_day_number=coalesce(streak_day_number,?), updated_at=?
      where user_id=? and local_date=?`,
  ).run(id, state.currentStreak + 1, now, userId, localDate);
  return getDailyQuest(db, userId, localDate)!;
}

export async function createDailyQuestForDate(input: {
  db: Db;
  userId: string;
  localDate: string;
  hunterRank: string;
  tierOverride?: number | null;
  channelId: string;
  publisher: DailyQuestPublisher;
  now?: string;
}): Promise<{ created: boolean; quest: DailyQuestView }> {
  const now = input.now ?? new Date().toISOString();
  const tier = resolveDailyQuestTier(input.hunterRank, input.tierOverride);
  const quest = ensureWorkflowDay(
    input.db,
    input.userId,
    input.localDate,
    input.hunterRank,
    tier,
    now,
  );
  if (quest.discordParentMessageId && quest.discordThreadId)
    return { created: false, quest };

  const streakDayNumber = quest.streakDayNumber ?? 1;
  const published = await input.publisher.publish({
    channelId: input.channelId,
    content: formatDailyQuestMessage(streakDayNumber, input.hunterRank, tier),
    threadName: `Day-${streakDayNumber}`,
    threadContent: formatDailyQuestThreadMessage(streakDayNumber),
  });
  input.db
    .prepare(
      `update daily_quest_days
        set discord_parent_message_id=?, discord_thread_id=?, discord_thread_name=?, updated_at=?
      where user_id=? and local_date=?`,
    )
    .run(
      published.parentMessageId,
      published.threadId,
      published.threadName,
      now,
      input.userId,
      input.localDate,
    );
  return {
    created: true,
    quest: getDailyQuest(input.db, input.userId, input.localDate)!,
  };
}

export function getActiveDailyQuestByThread(
  db: Db,
  threadId: string,
): DailyQuestView | null {
  const row = db
    .prepare(
      `select user_id,local_date from daily_quest_days where discord_thread_id=? and status='active' order by local_date desc limit 1`,
    )
    .get(threadId) as { user_id: string; local_date: string } | undefined;
  return row ? getDailyQuest(db, row.user_id, row.local_date) : null;
}

export function recordDailyThreadMessage(input: {
  db: Db;
  userId: string;
  threadId: string;
  messageId: string;
  content: string;
  storeRawMatch: boolean;
  hooks?: DailyHooks;
  now?: string;
}): {
  accepted: boolean;
  parsed: ParsedDailyMetric[];
  quest: DailyQuestView | null;
  completion: CompleteDailyResult | null;
} {
  const quest = getActiveDailyQuestByThread(input.db, input.threadId);
  if (!quest || quest.id == null || quest.date == null)
    return { accepted: false, parsed: [], quest: null, completion: null };
  const parsed = parseDailyProgress(input.content);
  if (parsed.length === 0)
    return { accepted: true, parsed, quest, completion: null };

  const now = input.now ?? new Date().toISOString();
  let completion: CompleteDailyResult | null = null;
  for (const metric of parsed) {
    const inserted = input.db
      .prepare(
        `insert or ignore into daily_quest_metric_events
        (id,daily_quest_day_id,discord_message_id,metric_key,amount,raw_match,created_at)
       values (?,?,?,?,?,?,?)`,
      )
      .run(
        randomUUID(),
        quest.id,
        input.messageId,
        metric.metricKey,
        metric.amount,
        input.storeRawMatch ? metric.rawMatch : null,
        now,
      );
    if (inserted.changes === 0) continue;
    const result = logDailyMetric(
      input.db,
      input.userId,
      quest.date,
      metric.metricKey,
      { delta: metric.amount },
      input.hooks,
    );
    completion ??= result.completion;
  }
  return {
    accepted: true,
    parsed,
    quest: getDailyQuest(input.db, input.userId, quest.date),
    completion,
  };
}

export function localDateFor(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

export function millisecondsUntilLocalTime(
  now: Date,
  timezone: string,
  localTime: string,
): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(now);
  const part = (type: string) =>
    Number(parts.find((item) => item.type === type)?.value ?? 0);
  const currentSeconds =
    (part("hour") % 24) * 3600 + part("minute") * 60 + part("second");
  const [hour, minute] = localTime.split(":").map(Number);
  const targetSeconds = hour * 3600 + minute * 60;
  const deltaSeconds =
    targetSeconds > currentSeconds
      ? targetSeconds - currentSeconds
      : 86400 - currentSeconds + targetSeconds;
  return deltaSeconds * 1000 + 1000;
}

export function hasReachedLocalTime(
  now: Date,
  timezone: string,
  localTime: string,
): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(now);
  const part = (type: string) =>
    Number(parts.find((item) => item.type === type)?.value ?? 0);
  const currentMinutes = (part("hour") % 24) * 60 + part("minute");
  const [hour, minute] = localTime.split(":").map(Number);
  return currentMinutes >= hour * 60 + minute;
}
