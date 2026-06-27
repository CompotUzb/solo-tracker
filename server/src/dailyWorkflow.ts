import { randomUUID } from "node:crypto";
import type { Db } from "./db.js";
import {
  DAILY_COMPLETE_XP,
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
    dailyQuestMessageId: string;
    threadId: string;
    threadName: string;
    threadIntroMessageId: string | null;
  }>;
  editDailyQuestMessage?(input: {
    channelId: string;
    messageId: string;
    content: string;
  }): Promise<boolean>;
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

function statusLabel(status: string): string {
  if (status === "completed") return "COMPLETED";
  if (status === "failed") return "FAILED";
  if (status === "penalty") return "PENALTY ACTIVE";
  return "ACTIVE";
}

function metricProgress(
  quest: DailyQuestView | null | undefined,
  key: DailyMetricKey,
): number {
  return quest?.metrics.find((metric) => metric.key === key)?.progress ?? 0;
}

function metricDone(
  quest: DailyQuestView | null | undefined,
  key: DailyMetricKey,
): boolean {
  return Boolean(quest?.metrics.find((metric) => metric.key === key)?.done);
}

function singleMetricLine(
  quest: DailyQuestView | null | undefined,
  key: DailyMetricKey,
  label: string,
  unit: string,
  tier: DailyTier,
): string {
  const icon = metricDone(quest, key) ? "✅" : "⬜";
  return `- ${icon} **${label}:** \`${metricProgress(quest, key)} / ${target(tier, key)} ${unit}\``;
}

function dualMetricLine(
  quest: DailyQuestView | null | undefined,
  label: string,
  first: { key: DailyMetricKey; unit: string },
  second: { key: DailyMetricKey; unit: string },
  tier: DailyTier,
): string {
  const icon =
    metricDone(quest, first.key) || metricDone(quest, second.key) ? "✅" : "⬜";
  const firstTarget = target(tier, first.key);
  const secondTarget = target(tier, second.key);
  const firstPart =
    firstTarget == null
      ? null
      : `\`${metricProgress(quest, first.key)} / ${firstTarget} ${first.unit}\``;
  const secondPart =
    secondTarget == null
      ? null
      : `\`${metricProgress(quest, second.key)} / ${secondTarget} ${second.unit}\``;
  return `- ${icon} **${label}:** ${[firstPart, secondPart].filter(Boolean).join(" OR ")}`;
}

export function formatDailyQuestMessage(
  streakDayNumber: number,
  hunterRank: string,
  tier: DailyTier,
  quest?: DailyQuestView | null,
): string {
  return [
    `**📋 SYSTEM DAILY QUEST — Day-${streakDayNumber}**`,
    "",
    `**Rank:** \`${hunterRank}\`  **Tier:** \`${DAILY_TIER_NAMES[tier]}\`  **Status:** \`${statusLabel(quest?.status ?? "active")}\``,
    "",
    "**Required**",
    singleMetricLine(quest, "pushups", "Push-ups", "reps", tier),
    singleMetricLine(quest, "situps", "Sit-ups", "reps", tier),
    singleMetricLine(quest, "squats", "Squats", "reps", tier),
    singleMetricLine(quest, "pullups", "Pull-ups", "reps", tier),
    dualMetricLine(
      quest,
      "Cardio",
      { key: "cardio_km", unit: "km" },
      { key: "steps", unit: "steps" },
      tier,
    ),
    dualMetricLine(
      quest,
      "Mental Focus",
      { key: "mental_minutes", unit: "min" },
      { key: "mental_pages", unit: "pages" },
      tier,
    ),
    "",
    `**Reward:** \`+${DAILY_COMPLETE_XP} XP\` · stat gains · \`Daily Common Box\``,
    "",
    quest?.status === "completed"
      ? "Daily Quest complete."
      : `Log progress inside the **Day-${streakDayNumber}** thread only.`,
  ].join("\n");
}

export function formatDailyQuestThreadMessage(streakDayNumber: number): string {
  return [
    `**🧭 SYSTEM THREAD ACTIVE — Day-${streakDayNumber}**`,
    "",
    "Send your activity logs here. The System will parse them automatically.",
    "",
    "Examples: `30 pushups`, `3x10 situps`, `walked 2km`, `studied 15m`, `read 5 pages`",
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
    content: formatDailyQuestMessage(
      streakDayNumber,
      input.hunterRank,
      tier,
      quest,
    ),
    threadName: `Day-${streakDayNumber}`,
    threadContent: formatDailyQuestThreadMessage(streakDayNumber),
  });
  input.db
    .prepare(
      `update daily_quest_days
        set discord_parent_message_id=?,
            discord_daily_quest_message_id=?,
            discord_thread_id=?,
            discord_thread_name=?,
            discord_thread_intro_message_id=?,
            updated_at=?
      where user_id=? and local_date=?`,
    )
    .run(
      published.parentMessageId,
      published.dailyQuestMessageId,
      published.threadId,
      published.threadName,
      published.threadIntroMessageId,
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
  progressChanged: boolean;
} {
  const quest = getActiveDailyQuestByThread(input.db, input.threadId);
  if (!quest || quest.id == null || quest.date == null)
    return {
      accepted: false,
      parsed: [],
      quest: null,
      completion: null,
      progressChanged: false,
    };
  const parsed = parseDailyProgress(input.content);
  if (parsed.length === 0)
    return {
      accepted: true,
      parsed,
      quest,
      completion: null,
      progressChanged: false,
    };

  const now = input.now ?? new Date().toISOString();
  let completion: CompleteDailyResult | null = null;
  let progressChanged = false;
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
    progressChanged = true;
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
    progressChanged,
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
