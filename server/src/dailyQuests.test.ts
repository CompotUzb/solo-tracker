import { beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, openDatabase, type Db } from './db.js';
import { getRankSnapshot } from './xp.js';
import { getPlayerStats } from './stats.js';
import {
  allocateStatPoint,
  clearDailyPenalty,
  DAILY_METRICS,
  getDailyQuest,
  getDailySnapshot,
  getDailyState,
  logDailyMetric,
  runDailyEvaluation,
  setDailyTier,
  ensureDailyDay,
  getDailyTier,
} from './dailyQuests.js';

const USER = 'local-user';
let db: Db;
let counter: number;

function clock(now: string) {
  return { now: () => now, genId: () => `id-${counter++}` };
}

beforeEach(() => {
  db = openDatabase(':memory:');
  applyMigrations(db);
  counter = 0;
});

function finishAllMetrics(date: string, hooks: { notify?: (i: unknown) => void } = {}) {
  let last;
  for (const metric of DAILY_METRICS) {
    last = logDailyMetric(db, USER, date, metric.key, { progress: 1e9 }, { clock: clock('2026-06-23T10:00:00.000Z'), ...hooks });
  }
  return last!;
}

describe('daily quest engine', () => {
  it('defaults to E-Rank tier with the E targets', () => {
    ensureDailyDay(db, USER, '2026-06-23', getDailyTier(db, USER), clock('2026-06-23T08:00:00.000Z'));
    const quest = getDailyQuest(db, USER, '2026-06-23')!;
    expect(quest.tier).toBe('e');
    expect(quest.metrics.find((m) => m.key === 'pushups')?.target).toBe(30);
    expect(quest.metrics.find((m) => m.key === 'cardio')?.target).toBe(1);
    expect(quest.complete).toBe(false);
  });

  it('re-snapshots targets when the tier changes', () => {
    ensureDailyDay(db, USER, '2026-06-23', 'e', clock('2026-06-23T08:00:00.000Z'));
    setDailyTier(db, USER, 's', clock('2026-06-23T08:01:00.000Z'));
    ensureDailyDay(db, USER, '2026-06-23', 's', clock('2026-06-23T08:02:00.000Z'));
    const quest = getDailyQuest(db, USER, '2026-06-23')!;
    expect(quest.tier).toBe('s');
    expect(quest.metrics.find((m) => m.key === 'pushups')?.target).toBe(100);
  });

  it('completing the full checklist awards XP, stat points, streak, and a loot box', () => {
    ensureDailyDay(db, USER, '2026-06-23', 'e', clock('2026-06-23T08:00:00.000Z'));
    const result = finishAllMetrics('2026-06-23');
    expect(result.completion).not.toBeNull();
    expect(result.completion!.xpAwarded).toBe(100);
    expect(result.completion!.newStreak).toBe(1);
    expect(result.completion!.statPointsGranted).toBe(3);
    expect(result.completion!.lootBoxes).toHaveLength(1);
    expect(result.completion!.lootBoxes[0].rarity).toBe('common');

    expect(getRankSnapshot(db, USER).totalXp).toBe(100);
    const state = getDailyState(db, USER);
    expect(state.currentStreak).toBe(1);
    expect(state.statPoints).toBe(3);
    expect(getDailyQuest(db, USER, '2026-06-23')!.status).toBe('completed');
  });

  it('grants a rare loot box on a 7-day streak', () => {
    // Complete six prior days, then the seventh.
    for (let d = 17; d <= 23; d++) {
      const date = `2026-06-${d}`;
      ensureDailyDay(db, USER, date, 'e', clock(`2026-06-${d}T08:00:00.000Z`));
      const r = finishAllMetrics(date);
      if (d === 23) {
        expect(r.completion!.newStreak).toBe(7);
        expect(r.completion!.lootBoxes.map((b) => b.rarity)).toContain('rare');
      }
    }
  });

  it('fails a missed past day: breaks streak and raises a penalty', () => {
    // Day 1 completed.
    ensureDailyDay(db, USER, '2026-06-22', 'e', clock('2026-06-22T08:00:00.000Z'));
    finishAllMetrics('2026-06-22');
    expect(getDailyState(db, USER).currentStreak).toBe(1);

    // Day 2 created but left incomplete.
    ensureDailyDay(db, USER, '2026-06-23', 'e', clock('2026-06-23T08:00:00.000Z'));

    const notifications: { type: string; title: string }[] = [];
    const evaln = runDailyEvaluation(db, USER, '2026-06-24', { clock: clock('2026-06-24T00:00:00.000Z'), notify: (i) => notifications.push(i as { type: string; title: string }) });
    expect(evaln.penaltyTriggered).toBe(true);
    expect(evaln.failedDates).toContain('2026-06-23');

    const state = getDailyState(db, USER);
    expect(state.currentStreak).toBe(0);
    expect(state.penaltyActive).toBe(true);
    expect(notifications.some((n) => n.type === 'penalty')).toBe(true);
    // A new day for 2026-06-24 was ensured.
    expect(getDailyQuest(db, USER, '2026-06-24')).not.toBeNull();
  });

  it('clears the penalty when a flush is logged', () => {
    ensureDailyDay(db, USER, '2026-06-23', 'e', clock('2026-06-23T08:00:00.000Z'));
    runDailyEvaluation(db, USER, '2026-06-24', { clock: clock('2026-06-24T00:00:00.000Z') });
    expect(getDailyState(db, USER).penaltyActive).toBe(true);

    const state = clearDailyPenalty(db, USER, '5 km recovery walk', { clock: clock('2026-06-24T07:00:00.000Z') });
    expect(state.penaltyActive).toBe(false);
  });

  it('allocates a stat point into an attribute', () => {
    ensureDailyDay(db, USER, '2026-06-23', 'e', clock('2026-06-23T08:00:00.000Z'));
    finishAllMetrics('2026-06-23'); // grants 3 points
    expect(getDailyState(db, USER).statPoints).toBe(3);

    const res = allocateStatPoint(db, USER, 'strength', clock('2026-06-23T11:00:00.000Z'));
    expect(res.ok).toBe(true);
    expect(res.state.statPoints).toBe(2);
    expect(getPlayerStats(db, USER).stats.find((s) => s.key === 'strength')?.value).toBe(1);
  });

  it('getDailySnapshot bootstraps today and returns the bundle', () => {
    const snap = getDailySnapshot(db, USER, '2026-06-23', clock('2026-06-23T08:00:00.000Z'));
    expect(snap.quest).not.toBeNull();
    expect(snap.state.statPoints).toBe(0);
    expect(snap.lootBoxes).toEqual([]);
  });
});
