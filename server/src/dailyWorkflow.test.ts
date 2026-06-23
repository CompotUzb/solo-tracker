import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, openDatabase, type Db } from './db.js';
import {
  createDailyQuestForDate,
  formatDailyQuestMessage,
  getDailyQuestTierForRank,
  parseDailyProgress,
  recordDailyThreadMessage,
  resolveDailyQuestTier,
  type DailyQuestPublisher,
} from './dailyWorkflow.js';

const USER = 'local-user';
let db: Db;

beforeEach(() => {
  db = openDatabase(':memory:');
  applyMigrations(db);
});

describe('daily progress parser', () => {
  it('extracts supported metrics and multiplies set notation', () => {
    expect(parseDailyProgress('3x10 pushups, 30 squats, walked 1km, studied 20m, read 5 pages')).toEqual([
      expect.objectContaining({ metricKey: 'pushups', amount: 30 }),
      expect.objectContaining({ metricKey: 'squats', amount: 30 }),
      expect.objectContaining({ metricKey: 'cardio_km', amount: 1 }),
      expect.objectContaining({ metricKey: 'mental_minutes', amount: 20 }),
      expect.objectContaining({ metricKey: 'mental_pages', amount: 5 }),
    ]);
  });

  it('aggregates repeated metrics in one message', () => {
    expect(parseDailyProgress('10 pushups then 2x10 push-ups')).toEqual([
      expect.objectContaining({ metricKey: 'pushups', amount: 30 }),
    ]);
  });
});

describe('rank-based daily tier', () => {
  it.each([
    ['Seed', 'e'],
    ['E-Rank', 'e'],
    ['D', 'e'],
    ['C-Rank', 'c'],
    ['B', 'c'],
    ['A-Rank', 'c'],
    ['S-Rank', 's'],
    ['National Level', 's'],
    ['Monarch', 's'],
  ])('maps %s to %s tier', (rank, tier) => {
    expect(getDailyQuestTierForRank(rank)).toBe(tier);
  });

  it('never lets a development override exceed the rank tier', () => {
    expect(resolveDailyQuestTier('E-Rank', 3)).toBe('e');
    expect(resolveDailyQuestTier('C-Rank', 3)).toBe('c');
    expect(resolveDailyQuestTier('S-Rank', 2)).toBe('c');
  });

  it('formats the exact E-Rank matrix with pull-ups', () => {
    const message = formatDailyQuestMessage(1, 'E-Rank', 'e');
    expect(message).toContain('Rank: E-Rank');
    expect(message).toContain('Tier: Beginner');
    expect(message).toContain('Pull-ups: 0 / 10');
    expect(message).toContain('Cardio: 0 / 2 km OR 0 / 5000 steps');
  });
});

describe('daily Discord workflow', () => {
  it('creates one Discord message and thread per local date', async () => {
    const publish = vi.fn(async () => ({ parentMessageId: 'message-1', threadId: 'thread-1', threadName: 'Day-1' }));
    const publisher: DailyQuestPublisher = { publish };
    const input = {
      db,
      userId: USER,
      localDate: '2026-06-23',
      hunterRank: 'E-Rank',
      channelId: 'daily-channel',
      publisher,
      now: '2026-06-23T01:00:00.000Z',
    };

    const first = await createDailyQuestForDate(input);
    const second = await createDailyQuestForDate(input);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(publish).toHaveBeenCalledOnce();
    expect(first.quest.discordThreadName).toBe('Day-1');
    expect(first.quest.hunterRank).toBe('E-Rank');
    expect(first.quest.tierName).toBe('Beginner');
  });

  it('accepts only the stored active thread and does not persist raw matches when disabled', async () => {
    await createDailyQuestForDate({
      db,
      userId: USER,
      localDate: '2026-06-23',
      hunterRank: 'E-Rank',
      channelId: 'daily-channel',
      publisher: { publish: async () => ({ parentMessageId: 'message-1', threadId: 'thread-1', threadName: 'Day-1' }) },
      now: '2026-06-23T01:00:00.000Z',
    });

    const ignored = recordDailyThreadMessage({
      db,
      userId: USER,
      threadId: 'old-thread',
      messageId: 'message-old',
      content: '30 pushups',
      storeRawMatch: false,
    });
    const accepted = recordDailyThreadMessage({
      db,
      userId: USER,
      threadId: 'thread-1',
      messageId: 'message-progress',
      content: '3x10 pushups',
      storeRawMatch: false,
    });

    expect(ignored.accepted).toBe(false);
    expect(accepted.quest?.metrics.find((metric) => metric.key === 'pushups')?.progress).toBe(30);
    const event = db.prepare('select raw_match from daily_quest_metric_events where discord_message_id=?').get('message-progress') as {
      raw_match: string | null;
    };
    expect(event.raw_match).toBeNull();
  });

  it('does not double-count a retried Discord message', async () => {
    await createDailyQuestForDate({
      db,
      userId: USER,
      localDate: '2026-06-23',
      hunterRank: 'E-Rank',
      channelId: 'daily-channel',
      publisher: { publish: async () => ({ parentMessageId: 'message-1', threadId: 'thread-1', threadName: 'Day-1' }) },
    });
    const input = {
      db,
      userId: USER,
      threadId: 'thread-1',
      messageId: 'same-message',
      content: '10 squats',
      storeRawMatch: true,
    };
    recordDailyThreadMessage(input);
    const result = recordDailyThreadMessage(input);
    expect(result.quest?.metrics.find((metric) => metric.key === 'squats')?.progress).toBe(10);
  });
});
