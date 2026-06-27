import type { Db } from "./db.js";

// Read-only projections that back the dashboard's achievements and weekly-report
// sections. These never mutate state; they only read existing tables so they are
// safe to expose over the local API.

export interface AchievementView {
  id: string;
  code: string;
  name: string;
  description: string | null;
  tier: string | null;
  progress: number;
  target: number;
  unlocked: boolean;
  unlockedAt: string | null;
}

interface AchievementRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  tier: string | null;
  progress: number;
  target: number;
  unlocked_at: string | null;
}

/** List a user's achievements, unlocked ones first (most recent first), then in-progress. */
export function listAchievements(db: Db, userId: string): AchievementView[] {
  const rows = db
    .prepare(
      `select id,code,name,description,tier,progress,target,unlocked_at
       from achievements where user_id=?
       order by (unlocked_at is null) asc, unlocked_at desc, created_at desc`,
    )
    .all(userId) as AchievementRow[];

  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    tier: row.tier,
    progress: row.progress,
    target: row.target,
    unlocked: row.unlocked_at != null,
    unlockedAt: row.unlocked_at,
  }));
}

export interface WeeklyReportDay {
  date: string;
  messages: number;
  xp: number;
  questsCompleted: number;
}

export interface WeeklyReport {
  userId: string;
  rangeStart: string;
  rangeEnd: string;
  days: WeeklyReportDay[];
  totals: {
    messages: number;
    xp: number;
    questsCompleted: number;
    activeDays: number;
  };
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

/** Local calendar date (YYYY-MM-DD) for an instant, in the configured timezone. */
function localDate(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** The current local calendar week, Monday through Sunday. */
function currentLocalWeekDates(now: Date, timezone: string): string[] {
  const today = localDate(now, timezone);
  const [year, month, day] = today.split("-").map(Number);
  const base = Date.UTC(year, month - 1, day);
  const weekday = new Date(base).getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  const monday = base - daysSinceMonday * 86_400_000;
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday + i * 86_400_000);
    dates.push(
      `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`,
    );
  }
  return dates;
}

interface DailyStatsRow {
  local_date: string;
  messages_count: number;
  xp_earned: number;
}

interface XpRow {
  occurred_at: string;
  xp_delta: number;
}

interface ActivityRow {
  occurred_at: string;
}

interface DailyQuestCompletionRow {
  local_date: string;
  completed_at: string | null;
}

function addToMap(map: Map<string, number>, key: string, value: number): void {
  map.set(key, (map.get(key) ?? 0) + value);
}

/**
 * Summarize the current Monday-Sunday local week from already-stored data:
 * message counts from `daily_stats`, XP from structured ledgers, and completed
 * quests bucketed by the local date of their completion. Returns one entry per
 * day so empty days render as zeros rather than gaps.
 */
export function weeklyReport(
  db: Db,
  userId: string,
  timezone: string,
  now: Date = new Date(),
): WeeklyReport {
  const dates = currentLocalWeekDates(now, timezone);
  const rangeStart = dates[0];
  const rangeEnd = dates[dates.length - 1];

  const statsRows = db
    .prepare(
      `select local_date,messages_count,xp_earned from daily_stats
       where user_id=? and local_date>=? and local_date<=?`,
    )
    .all(userId, rangeStart, rangeEnd) as DailyStatsRow[];
  const statsByDate = new Map(statsRows.map((row) => [row.local_date, row]));

  const xpRows = [
    ...(db
      .prepare(
        `select occurred_at,xp_delta from xp_awards
         where user_id=?`,
      )
      .all(userId) as XpRow[]),
    ...(db
      .prepare(
        `select occurred_at,xp_delta from xp_ledger
         where user_id=?`,
      )
      .all(userId) as XpRow[]),
  ];
  const xpByDate = new Map<string, number>();
  for (const row of xpRows) {
    const date = localDate(new Date(row.occurred_at), timezone);
    if (date >= rangeStart && date <= rangeEnd) {
      addToMap(xpByDate, date, row.xp_delta);
    }
  }

  const statActivityRows = db
    .prepare(
      `select occurred_at from stat_awards
       where user_id=?`,
    )
    .all(userId) as ActivityRow[];
  const activeDates = new Set<string>();
  for (const row of statActivityRows) {
    const date = localDate(new Date(row.occurred_at), timezone);
    if (date >= rangeStart && date <= rangeEnd) activeDates.add(date);
  }

  const completedRows = db
    .prepare(
      `select completed_at from quests where user_id=? and status='completed' and completed_at is not null`,
    )
    .all(userId) as { completed_at: string }[];
  const questsByDate = new Map<string, number>();
  for (const row of completedRows) {
    const date = localDate(new Date(row.completed_at), timezone);
    if (date >= rangeStart && date <= rangeEnd) addToMap(questsByDate, date, 1);
  }

  const dailyQuestRows = db
    .prepare(
      `select local_date,completed_at from daily_quest_days
       where user_id=? and status='completed'`,
    )
    .all(userId) as DailyQuestCompletionRow[];
  for (const row of dailyQuestRows) {
    const date = row.completed_at
      ? localDate(new Date(row.completed_at), timezone)
      : row.local_date;
    if (date >= rangeStart && date <= rangeEnd) addToMap(questsByDate, date, 1);
  }

  const days: WeeklyReportDay[] = dates.map((date) => {
    const stats = statsByDate.get(date);
    const structuredXp = xpByDate.get(date) ?? 0;
    const legacyStatsXp = stats?.xp_earned ?? 0;
    return {
      date,
      messages: stats?.messages_count ?? 0,
      xp: structuredXp || legacyStatsXp,
      questsCompleted: questsByDate.get(date) ?? 0,
    };
  });

  const totals = days.reduce(
    (acc, day) => ({
      messages: acc.messages + day.messages,
      xp: acc.xp + day.xp,
      questsCompleted: acc.questsCompleted + day.questsCompleted,
      activeDays:
        acc.activeDays +
        (day.messages > 0 ||
        day.xp > 0 ||
        day.questsCompleted > 0 ||
        activeDates.has(day.date)
          ? 1
          : 0),
    }),
    { messages: 0, xp: 0, questsCompleted: 0, activeDays: 0 },
  );

  return { userId, rangeStart, rangeEnd, days, totals };
}
