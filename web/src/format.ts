import type { Quest } from './types.js';

// Pure presentation helpers shared across sections. Kept side-effect free so they
// can be unit tested without a DOM.

/** Quest difficulty tiers treated as recurring "daily" work vs longer "main" arcs. */
export const DAILY_QUEST_TYPES = new Set(['easy', 'normal']);

/**
 * Split a user's quests into the dashboard's two boards. Daily quests are the
 * lighter recurring tiers (easy/normal); main quests are the heavier arcs
 * (hard/boss/raid). Completed and abandoned quests are excluded from both boards.
 */
export function splitQuests(quests: Quest[]): { daily: Quest[]; main: Quest[] } {
  const active = quests.filter((q) => q.status === 'active');
  return {
    daily: active.filter((q) => DAILY_QUEST_TYPES.has(q.questType)),
    main: active.filter((q) => !DAILY_QUEST_TYPES.has(q.questType)),
  };
}

/** Percentage [0,100] of progress toward the next level, clamped and divide-by-zero safe. */
export function xpProgressPercent(xpIntoLevel: number, xpForNextLevel: number): number {
  if (!Number.isFinite(xpForNextLevel) || xpForNextLevel <= 0) return 0;
  return Math.max(0, Math.min(100, (xpIntoLevel / xpForNextLevel) * 100));
}

/** Percentage [0,100] of a count toward a target. */
export function ratioPercent(value: number, target: number): number {
  if (!Number.isFinite(target) || target <= 0) return 0;
  return Math.max(0, Math.min(100, (value / target) * 100));
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

/** Compact human label for how long ago an ISO instant was, relative to `now`. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 'unknown';
  const diffSeconds = Math.round((now - then) / 1000);
  if (diffSeconds < 0) return 'just now';
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const minutes = Math.floor(diffSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

/** Short weekday + day label for a YYYY-MM-DD local date string. */
export function weekdayLabel(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) return date;
  const d = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(d);
}
