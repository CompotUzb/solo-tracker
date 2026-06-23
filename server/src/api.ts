import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { computeRankState } from '@solo-system/shared';
import type { AppConfig } from './config.js';
import { publicConfig } from './config.js';
import { applyMigrations, openDatabase, type Db } from './db.js';
import { addQuest, completeQuest, getQuest, listQuests, QUEST_TYPES, type QuestStatus } from './quests.js';
import { listAchievements, weeklyReport } from './reports.js';
import { getRankSnapshot } from './xp.js';
import { applyStatGains, getPlayerStats, questStatGains } from './stats.js';
import { listNotifications, type Notifier } from './notifications.js';

export type DiscordStatus = 'connected' | 'disconnected' | 'skipped';

const DEFAULT_USER_ID = 'local-user';

const addQuestBody = z.object({
  userId: z.string().min(1).optional(),
  title: z.string().min(1),
  questType: z.enum(QUEST_TYPES as [string, ...string[]]),
  description: z.string().optional(),
  targetCount: z.number().int().positive().optional(),
  startsAt: z.string().optional(),
  dueAt: z.string().optional(),
});

const completeQuestBody = z.object({ userId: z.string().min(1).optional() });

function resolveWebDistRoot(): string | null {
  const candidates = [
    path.resolve(process.cwd(), 'web/dist'),
    path.resolve(process.cwd(), '../web/dist'),
    path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../web/dist'),
  ];
  return candidates.find((candidate) => fs.existsSync(path.join(candidate, 'index.html'))) ?? null;
}

export function createApi({
  config,
  discordStatus,
  db: providedDb,
  notifier,
}: {
  config: AppConfig;
  discordStatus: () => DiscordStatus;
  db?: Db;
  notifier?: Notifier;
}) {
  const app = Fastify({ logger: true });
  const db = providedDb ?? openDatabase(config.databasePath);
  applyMigrations(db);

  const listeners = new Set<(payload: string) => void>();
  const broadcast = (event: string, data: unknown) => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const listener of listeners) listener(payload);
  };

  app.register(cors, { origin: true });

  app.get('/api/health', async () => {
    try {
      db.prepare('select 1').get();
      return { ok: true, db: 'ok', discord: discordStatus() };
    } catch {
      return { ok: false, db: 'error', discord: discordStatus() };
    }
  });

  app.get('/api/config/boundaries', async () => publicConfig(config));

  app.get<{ Querystring: { userId?: string } }>('/api/stats/summary', async (req) => {
    const userId = req.query.userId ?? DEFAULT_USER_ID;
    const snapshot = getRankSnapshot(db, userId);
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: config.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const row = db
      .prepare('select messages_count,xp_earned,streak_eligible from daily_stats where user_id=? and local_date=?')
      .get(userId, today) as { messages_count: number; xp_earned: number; streak_eligible: number } | undefined;
    const week = weeklyReport(db, userId, config.timezone).totals;
    return {
      userId,
      today: {
        messages: row?.messages_count ?? 0,
        xp: row?.xp_earned ?? 0,
        streakEligible: Boolean(row?.streak_eligible),
      },
      week: { messages: week.messages, xp: week.xp, activeDays: week.activeDays },
      rank: {
        ...computeRankState(snapshot.totalXp),
        currentStreakDays: snapshot.currentStreakDays,
        longestStreakDays: snapshot.longestStreakDays,
      },
    };
  });

  app.get<{ Querystring: { userId?: string } }>('/api/stats/player', async (req) => {
    const userId = req.query.userId ?? DEFAULT_USER_ID;
    return getPlayerStats(db, userId);
  });

  app.get<{ Querystring: { userId?: string; limit?: string } }>('/api/notifications', async (req) => {
    const userId = req.query.userId ?? DEFAULT_USER_ID;
    const limit = Number(req.query.limit ?? 50);
    return { userId, notifications: listNotifications(db, userId, Number.isFinite(limit) ? limit : 50) };
  });

  app.get<{ Querystring: { userId?: string; limit?: string } }>('/api/timeline', async (req) => {
    const limit = Math.min(Number(req.query.limit ?? 50), 100);
    const userId = req.query.userId;
    const rows = db
      .prepare(
        `select a.id,
                a.activity_type as type,
                a.channel_id as channelId,
                a.occurred_at as occurredAt,
                d.content_length as contentLength,
                d.attachment_count as attachmentCount,
                coalesce((select sum(xp_delta) from xp_ledger x where x.activity_event_id=a.id),0) as xpAwarded
           from activity_events a
           join discord_events d on d.id=a.source_event_id
          where (? is null or a.user_id=?)
          order by a.occurred_at desc
          limit ?`,
      )
      .all(userId ?? null, userId ?? null, limit);
    return { items: rows };
  });

  app.get<{ Querystring: { userId?: string; status?: string } }>('/api/quests', async (req) => {
    const userId = req.query.userId ?? DEFAULT_USER_ID;
    const status = req.query.status as QuestStatus | undefined;
    return { userId, quests: listQuests(db, userId, status) };
  });

  app.post('/api/quests', async (req, reply) => {
    const parsed = addQuestBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_quest', details: parsed.error.flatten() };
    }
    const userId = parsed.data.userId ?? DEFAULT_USER_ID;
    const quest = addQuest(db, {
      userId,
      title: parsed.data.title,
      questType: parsed.data.questType as (typeof QUEST_TYPES)[number],
      description: parsed.data.description,
      targetCount: parsed.data.targetCount,
      startsAt: parsed.data.startsAt,
      dueAt: parsed.data.dueAt,
    });
    broadcast('quest.created', { userId, questId: quest.id, questType: quest.questType, xpReward: quest.xpReward });
    broadcast('quest.updated', { action: 'created', userId, quest });
    reply.code(201);
    return { quest };
  });

  app.post<{ Params: { id: string } }>('/api/quests/:id/complete', async (req, reply) => {
    const parsed = completeQuestBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_request', details: parsed.error.flatten() };
    }
    const userId = parsed.data.userId ?? DEFAULT_USER_ID;
    const existing = getQuest(db, req.params.id);
    if (!existing) {
      reply.code(404);
      return { error: 'quest_not_found' };
    }
    if (existing.userId !== userId) {
      reply.code(403);
      return { error: 'forbidden' };
    }
    const result = completeQuest(db, { questId: req.params.id, userId });

    // Completing a quest builds player stats (Discipline, scaled by difficulty). Skip on
    // an idempotent re-complete so stats are not double-awarded.
    let playerStats = getPlayerStats(db, userId).stats;
    if (!result.alreadyCompleted) {
      const statResult = applyStatGains(db, {
        userId,
        gains: questStatGains(result.quest.questType),
        reason: 'quest_completed',
        source: 'quest',
        sourceId: result.quest.id,
      });
      playerStats = statResult.stats;
      broadcast('stats.player.updated', { userId });

      // System notifications: a level-up is the headline event; a rank change is a notable
      // system update. Both are stored locally and delivered to Discord when configured.
      if (result.award.leveledUp) {
        notifier?.notify({
          userId,
          type: 'level_up',
          title: `Level ${result.award.current.level} reached`,
          body: `Completed "${result.quest.title}" (+${result.award.xpAwarded} XP).`,
          metadata: { level: result.award.current.level, rankCode: result.award.current.rankCode, questId: result.quest.id },
        });
      }
      if (result.award.rankChanged) {
        notifier?.notify({
          userId,
          type: 'system',
          title: `New rank: ${result.award.current.rankName}`,
          body: `Promoted to ${result.award.current.rankName}.`,
          metadata: { rankCode: result.award.current.rankCode },
        });
      }
    }

    broadcast('quest.updated', { action: 'completed', userId, quest: result.quest });
    broadcast('xp', {
      userId,
      xpAwarded: result.award.xpAwarded,
      level: result.award.current.level,
      rankCode: result.award.current.rankCode,
    });
    broadcast('quest.completed', {
      userId,
      questId: result.quest.id,
      xpAwarded: result.award.xpAwarded,
      alreadyCompleted: result.alreadyCompleted,
    });
    broadcast('stats.updated', { reason: 'quest.completed', userId });
    return {
      quest: result.quest,
      xpAwarded: result.award.xpAwarded,
      leveledUp: result.award.leveledUp,
      rankChanged: result.award.rankChanged,
      stats: getRankSnapshot(db, userId),
      playerStats,
      alreadyCompleted: result.alreadyCompleted,
    };
  });

  app.get<{ Querystring: { userId?: string } }>('/api/achievements', async (req) => {
    const userId = req.query.userId ?? DEFAULT_USER_ID;
    return { userId, achievements: listAchievements(db, userId) };
  });

  app.get<{ Querystring: { userId?: string } }>('/api/reports/weekly', async (req) => {
    const userId = req.query.userId ?? DEFAULT_USER_ID;
    return weeklyReport(db, userId, config.timezone);
  });

  app.get('/api/events/stream', async (_req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const send = (payload: string) => reply.raw.write(payload);
    listeners.add(send);
    send('retry: 2000\nevent: connected\ndata: {"ok":true}\n\n');
    reply.raw.on('close', () => listeners.delete(send));
  });

  const webDistRoot = resolveWebDistRoot();
  if (webDistRoot) {
    app.register(fastifyStatic, { root: webDistRoot, prefix: '/', wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'not_found' });
    });
  }

  return {
    app,
    broadcast,
    async close() {
      await app.close();
      if (!providedDb) db.close();
    },
  };
}
