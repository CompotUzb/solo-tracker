import { loadConfig } from './config.js';
import { migrate, loadTrackedBoundary, openDatabase, storeRawMessage, SEED_USER_ID } from './db.js';
import { createApi, type DiscordStatus } from './api.js';
import { createDiscordClient, createChannelMessageSender, createDailyQuestPublisher } from './bot.js';
import { createNotifier } from './notifications.js';
import { weeklyReport } from './reports.js';
import { getRankSnapshot } from './xp.js';
import { awardMessageStats } from './stats.js';
import { getDailyQuest, runDailyEvaluation } from './dailyQuests.js';
import {
  createDailyQuestForDate,
  getActiveDailyQuestByThread,
  hasReachedLocalTime,
  localDateFor,
  millisecondsUntilLocalTime,
  recordDailyThreadMessage,
  type DailyQuestPublisher,
} from './dailyWorkflow.js';

async function main() {
  const config = loadConfig();
  migrate(config);
  const db = openDatabase(config.databasePath);
  const boundary = loadTrackedBoundary(config);
  let discordStatus: DiscordStatus = config.skipDiscordLogin ? 'skipped' : 'disconnected';

  // Notifications are always stored locally. Discord delivery is enabled only when a
  // system-output channel is configured and Discord login is active; otherwise the app
  // stays healthy in dashboard-only notification mode.
  if (config.systemOutputChannelId == null) {
    console.log('Discord notifications skipped: SYSTEM_OUTPUT_CHANNEL_ID not configured.');
  }
  const deliveryEnabled = !config.skipDiscordLogin && config.systemOutputChannelId != null;
  let broadcast: (event: string, data: unknown) => void = () => {};
  let systemSend: ((message: string) => Promise<string | null>) | null = null;
  const notifier = createNotifier({
    db,
    send: deliveryEnabled ? (message) => (systemSend ? systemSend(message) : Promise.resolve(null)) : null,
    onStored: (record) =>
      broadcast('notification', { id: record.id, type: record.type, title: record.title, createdAt: record.createdAt }),
    onError: (error) => console.error('notification delivery failed:', error instanceof Error ? error.message : error),
  });

  const api = createApi({ config, db, notifier, discordStatus: () => discordStatus });
  broadcast = api.broadcast;

  const publishSummary = (kind: 'today' | 'week') => {
    if (kind === 'today') {
      const today = localDateFor(new Date(), config.timezone);
      const stats = db
        .prepare('select messages_count,xp_earned,streak_eligible from daily_stats where user_id=? and local_date=?')
        .get(SEED_USER_ID, today) as { messages_count: number; xp_earned: number; streak_eligible: number } | undefined;
      const completed = db
        .prepare(`select count(*) as n from quests where user_id=? and status='completed' and completed_at>=? and completed_at<?`)
        .get(SEED_USER_ID, `${today}T00:00:00.000Z`, `${today}T23:59:59.999Z`) as { n: number };
      const body =
        completed.n === 0
          ? `No completed quests today.\n\nStreak: ${stats?.streak_eligible ? 'active' : 'reset or unchanged'}.\nFocus for tomorrow: complete one small quest before noon.`
          : `✅ Completed: ${completed.n}\nXP today: ${stats?.xp_earned ?? 0}\nMessages: ${stats?.messages_count ?? 0}`;
      notifier.notify({ userId: SEED_USER_ID, type: 'daily_summary', title: `Daily Summary — ${today}`, body, metadata: { date: today, source: 'discord_command' } });
      return;
    }

    const report = weeklyReport(db, SEED_USER_ID, config.timezone);
    const body =
      report.totals.questsCompleted === 0
        ? `No quests completed this week.\n\nRecommended focus: Start with one 10-minute quest in coding or study.`
        : `Level: ${getRankSnapshot(db, SEED_USER_ID).level} | XP this week: ${report.totals.xp} | Active days: ${report.totals.activeDays}/7\n\n✅ Completed: ${report.totals.questsCompleted}\nRecommended focus: Keep the streak alive: complete one quest before noon tomorrow.`;
    notifier.notify({
      userId: SEED_USER_ID,
      type: 'weekly_summary',
      title: `Weekly Report — ${report.rangeStart} to ${report.rangeEnd}`,
      body,
      metadata: { rangeStart: report.rangeStart, rangeEnd: report.rangeEnd, source: 'discord_command' },
    });
  };

  // Finalize overdue days on startup, then at the configured local evaluation time.
  const runDailyEval = () => {
    try {
      const today = localDateFor(new Date(), config.timezone);
      const result = runDailyEvaluation(db, SEED_USER_ID, today, { notify: (input) => notifier.notify(input) });
      api.broadcast('daily.updated', { userId: SEED_USER_ID, reason: 'scheduled' });
      if (result.penaltyTriggered) api.broadcast('notification', { type: 'penalty', userId: SEED_USER_ID, title: 'PENALTY ZONE ACTIVE' });
    } catch (error) {
      console.error('daily evaluation failed:', error instanceof Error ? error.message : error);
    }
  };
  runDailyEval();
  const scheduleEvaluation = () => {
    setTimeout(() => {
      runDailyEval();
      scheduleEvaluation();
    }, millisecondsUntilLocalTime(new Date(), config.timezone, config.dailyEvaluationTime)).unref();
  };
  scheduleEvaluation();

  if (!config.skipDiscordLogin) {
    let dailyPublisher: DailyQuestPublisher | null = null;
    const runDailyCreate = async (force = false) => {
      if (!config.dailyQuestsChannelId || !dailyPublisher) return null;
      const now = new Date();
      if (!force && !hasReachedLocalTime(now, config.timezone, config.dailyQuestCreateTime)) return null;
      const result = await createDailyQuestForDate({
        db,
        userId: SEED_USER_ID,
        localDate: localDateFor(now, config.timezone),
        hunterRank: getRankSnapshot(db, SEED_USER_ID).rankName,
        tierOverride: config.dailyQuestTierOverride,
        channelId: config.dailyQuestsChannelId,
        publisher: dailyPublisher,
      });
      if (result.created) {
        notifier.notify({
          userId: SEED_USER_ID,
          type: 'system',
          title: 'Daily Quest generated',
          body: `${result.quest.discordThreadName ?? 'Daily thread'} is ready.`,
          metadata: { date: result.quest.date, threadId: result.quest.discordThreadId },
        });
        api.broadcast('daily.updated', { userId: SEED_USER_ID, reason: 'generated' });
      }
      return result;
    };
    const scheduleCreation = () => {
      setTimeout(() => {
        void runDailyCreate(true).catch((error) =>
          console.error('daily quest creation failed:', error instanceof Error ? error.message : error),
        );
        scheduleCreation();
      }, millisecondsUntilLocalTime(new Date(), config.timezone, config.dailyQuestCreateTime)).unref();
    };

    const client = createDiscordClient(config, boundary, {
      storeRawMessage: (input) => storeRawMessage(db, input),
      onRawMessageStored(input, stored) {
        api.broadcast('discord.message', {
          messageId: input.messageId,
          channelId: input.channelId,
          authorId: input.authorId,
          timestamp: input.messageTimestamp,
          stored: Boolean(stored),
        });
        if (stored) {
          // A thread message resolves its stat category from the parent channel.
          const category =
            config.channelCategories[input.channelId] ??
            (input.parentChannelId ? config.channelCategories[input.parentChannelId] : undefined);
          if (category) {
            const contentLength = Number((input.metadata as { contentLength?: number } | null)?.contentLength ?? input.content.length);
            const result = awardMessageStats(db, {
              userId: SEED_USER_ID,
              category,
              contentLength,
              content: config.storeMessageContent ? input.content : '',
              localDate: localDateFor(new Date(input.messageTimestamp), config.timezone),
              sourceId: input.messageId,
            });
            if (result?.changed.length) api.broadcast('stats.player.updated', { userId: SEED_USER_ID });
          }
        }
        api.broadcast('stats.updated', { reason: 'discord.message', channelId: input.channelId });
      },
      onSummaryCommand(kind) {
        publishSummary(kind);
        api.broadcast('notification', { type: kind === 'today' ? 'daily_summary' : 'weekly_summary', userId: SEED_USER_ID });
      },
      async onDailyCommand(kind, message) {
        try {
          if (kind === 'create') await runDailyCreate(true);
          if (kind === 'evaluate') runDailyEval();
          const today = localDateFor(new Date(), config.timezone);
          const quest = getActiveDailyQuestByThread(db, message.channelId) ?? getDailyQuest(db, SEED_USER_ID, today);
          if (!quest) {
            await message.reply('No Daily Quest generated yet. Waiting for scheduled creation.');
            return;
          }
          if (kind === 'thread') {
            await message.reply(quest.discordThreadId ? `<#${quest.discordThreadId}> (${quest.discordThreadName})` : 'Today has no Discord thread.');
            return;
          }
          const progress = quest.metrics.map((metric) => `${metric.label}: ${metric.progress}/${metric.target} ${metric.unit}`).join('\n');
          await message.reply(
            `${quest.discordThreadName ?? `Day-${quest.streakDayNumber ?? 1}`} · Rank ${quest.hunterRank} · ${quest.tierName} · ${quest.status}\n${progress}`,
          );
        } catch (error) {
          await message.reply(`Daily command failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
      onDailyQuestMessage(message) {
        const result = recordDailyThreadMessage({
          db,
          userId: SEED_USER_ID,
          threadId: message.channelId,
          messageId: message.id,
          content: message.content ?? '',
          storeRawMatch: config.storeMessageContent,
          hooks: { notify: (input) => notifier.notify(input) },
        });
        if (result.accepted && result.parsed.length > 0) {
          api.broadcast('daily.updated', { userId: SEED_USER_ID, reason: 'thread_message' });
          if (result.completion) {
            api.broadcast('xp', { userId: SEED_USER_ID, xpAwarded: result.completion.xpAwarded });
            api.broadcast('stats.player.updated', { userId: SEED_USER_ID });
            api.broadcast('notification', { type: 'system', userId: SEED_USER_ID, title: 'Daily Quest complete' });
          }
        }
      },
    });
    client.on('clientReady', () => {
      discordStatus = 'connected';
      dailyPublisher = createDailyQuestPublisher(client);
      if (deliveryEnabled && config.systemOutputChannelId) {
        systemSend = createChannelMessageSender(client, config.systemOutputChannelId);
      }
      api.broadcast('discord.connected', { connected: true });
      void runDailyCreate().catch((error) =>
        console.error('daily quest creation failed:', error instanceof Error ? error.message : error),
      );
      scheduleCreation();
    });
    client.on('shardDisconnect', () => {
      discordStatus = 'disconnected';
      api.broadcast('discord.disconnected', { connected: false });
    });
    await client.login(config.discordToken);
  }

  await api.app.listen({ host: config.apiHost, port: config.apiPort });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
