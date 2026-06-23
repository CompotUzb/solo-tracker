import type { Db } from './db.js';

// Read-only projections that back the dashboard's achievements and weekly-report
// sections. These never mutate state; they only read existing tables (achievements,
// daily_stats, quests) so they are safe to expose over the local API.

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
  return value.toString().padStart(2, '0');
}

/** Local calendar date (YYYY-MM-DD) for an instant, in the configured timezone. */
function localDate(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** The seven local calendar dates ending on `now`'s local date, oldest first. */
function lastSevenLocalDates(now: Date, timezone: string): string[] {
  const today = localDate(now, timezone);
  const [year, month, day] = today.split('-').map(Number);
  const base = Date.UTC(year, month - 1, day);
  const dates: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(base - i * 86_400_000);
    dates.push(`${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`);
  }
  return dates;
}

interface DailyStatsRow {
  local_date: string;
  messages_count: number;
  xp_earned: number;
}

/**
 * Summarize the last seven local days for a user from already-stored data:
 * message counts and XP from `daily_stats`, completed quests bucketed by the
 * local date of their completion. Returns one entry per day so empty days
 * render as zeros rather than gaps.
 */
export function weeklyReport(db: Db, userId: string, timezone: string, now: Date = new Date()): WeeklyReport {
  const dates = lastSevenLocalDates(now, timezone);
  const rangeStart = dates[0];
  const rangeEnd = dates[dates.length - 1];

  const statsRows = db
    .prepare(
      `select local_date,messages_count,xp_earned from daily_stats
       where user_id=? and local_date>=? and local_date<=?`,
    )
    .all(userId, rangeStart, rangeEnd) as DailyStatsRow[];
  const statsByDate = new Map(statsRows.map((row) => [row.local_date, row]));

  const completedRows = db
    .prepare(`select completed_at from quests where user_id=? and status='completed' and completed_at is not null`)
    .all(userId) as { completed_at: string }[];
  const questsByDate = new Map<string, number>();
  for (const row of completedRows) {
    const date = localDate(new Date(row.completed_at), timezone);
    questsByDate.set(date, (questsByDate.get(date) ?? 0) + 1);
  }

  const days: WeeklyReportDay[] = dates.map((date) => {
    const stats = statsByDate.get(date);
    return {
      date,
      messages: stats?.messages_count ?? 0,
      xp: stats?.xp_earned ?? 0,
      questsCompleted: questsByDate.get(date) ?? 0,
    };
  });

  const totals = days.reduce(
    (acc, day) => ({
      messages: acc.messages + day.messages,
      xp: acc.xp + day.xp,
      questsCompleted: acc.questsCompleted + day.questsCompleted,
      activeDays: acc.activeDays + (day.messages > 0 ? 1 : 0),
    }),
    { messages: 0, xp: 0, questsCompleted: 0, activeDays: 0 },
  );

  return { userId, rangeStart, rangeEnd, days, totals };
}
