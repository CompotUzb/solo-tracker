import type { AsyncState } from './api.js';
import { formatDate, formatNumber, ratioPercent, relativeTime, splitQuests, weekdayLabel, xpProgressPercent } from './format.js';
import type {
  AchievementsResponse,
  Boundaries,
  Health,
  NotificationsResponse,
  NotificationType,
  PlayerStatsResponse,
  Quest,
  QuestsResponse,
  Summary,
  TimelineResponse,
  WeeklyReport,
} from './types.js';
import { Async, Badge, Card, EmptyState, ProgressBar, Stat } from './ui.js';

const QUEST_TONES: Record<string, string> = {
  easy: 'easy',
  normal: 'normal',
  hard: 'hard',
  boss: 'boss',
  raid: 'raid',
};

function statusDot(ok: boolean | undefined, value: string | undefined): string {
  if (value === undefined) return 'unknown';
  if (ok === false) return 'down';
  return 'up';
}

export function Profile({
  summary,
  health,
  boundaries,
}: {
  summary: AsyncState<Summary>;
  health: AsyncState<Health>;
  boundaries: AsyncState<Boundaries>;
}) {
  return (
    <Card title="Hunter Profile" icon="◈" area="profile" accent>
      <Async state={summary} loadingLabel="Reading profile…">
        {(data) => (
          <div className="profile">
            <div className="profile-sigil" data-rank={data.rank.rankCode}>
              <span className="profile-level">{data.rank.level}</span>
              <span className="profile-level-label">LVL</span>
            </div>
            <div className="profile-meta">
              <p className="eyebrow">Rank {data.rank.rankCode.toUpperCase()}</p>
              <h3>{data.rank.rankName}</h3>
              <p className="muted">{formatNumber(data.rank.totalXp)} total XP accumulated</p>
              <div className="chips">
                <Badge tone="streak">🔥 {data.rank.currentStreakDays}d streak</Badge>
                <Badge tone="muted">Best {data.rank.longestStreakDays}d</Badge>
                <Badge tone={data.today.streakEligible ? 'easy' : 'muted'}>
                  {data.today.streakEligible ? 'Today secured' : 'Today at risk'}
                </Badge>
              </div>
            </div>
          </div>
        )}
      </Async>
      <div className="system-status">
        <span className={`dot dot-${statusDot(health.data?.ok, health.data?.db)}`} aria-hidden />
        <span>API {health.data ? (health.data.ok ? 'online' : 'degraded') : '…'}</span>
        <span className="sep">·</span>
        <span>DB {health.data?.db ?? '…'}</span>
        <span className="sep">·</span>
        <span>Discord {health.data?.discord ?? '…'}</span>
        {boundaries.data ? (
          <>
            <span className="sep">·</span>
            <span>{boundaries.data.trackedChannelIds.length} channels tracked</span>
          </>
        ) : null}
      </div>
    </Card>
  );
}

export function XpBar({ summary }: { summary: AsyncState<Summary> }) {
  return (
    <Card title="Experience" icon="⚡" area="experience">
      <Async state={summary} loadingLabel="Calculating XP…">
        {(data) => {
          const percent = xpProgressPercent(data.rank.xpIntoLevel, data.rank.xpForNextLevel);
          const remaining = Math.max(0, data.rank.xpForNextLevel - data.rank.xpIntoLevel);
          return (
            <div className="xp">
              <div className="xp-row">
                <span>Level {data.rank.level}</span>
                <span className="muted">Level {data.rank.level + 1}</span>
              </div>
              <ProgressBar percent={percent} />
              <div className="xp-row">
                <span className="muted">
                  {formatNumber(data.rank.xpIntoLevel)} / {formatNumber(data.rank.xpForNextLevel)} XP
                </span>
                <span className="accent">{formatNumber(remaining)} XP to next</span>
              </div>
            </div>
          );
        }}
      </Async>
    </Card>
  );
}

// The main player-progression card. The eight RPG attributes grow slowly from tracked
// activity and quests; bars are drawn relative to the player's current strongest stat so
// the spread between attributes is legible even before any hard cap is reached.
export function PlayerStats({ player }: { player: AsyncState<PlayerStatsResponse> }) {
  return (
    <Card title="Hunter Stats" icon="⚔" area="stats" accent>
      <Async state={player} loadingLabel="Reading attributes…">
        {(data) => {
          const max = Math.max(1, ...data.stats.map((s) => s.value));
          return (
            <ul className="player-stats">
              {data.stats.map((stat) => (
                <li key={stat.key} className="player-stat">
                  <div className="player-stat-head">
                    <span className="player-stat-label">{stat.label}</span>
                    <span className="player-stat-value accent">{formatNumber(stat.value)}</span>
                  </div>
                  <ProgressBar percent={(stat.value / max) * 100} />
                </li>
              ))}
            </ul>
          );
        }}
      </Async>
    </Card>
  );
}

// Demoted secondary metrics — activity counts that used to be the "Vital Stats" focus.
export function ActivityMetrics({ summary }: { summary: AsyncState<Summary> }) {
  return (
    <Card title="Activity Metrics" icon="📊" area="metrics">
      <Async state={summary} loadingLabel="Loading metrics…">
        {(data) => (
          <div className="stat-grid">
            <Stat label="XP today" value={formatNumber(data.today.xp)} />
            <Stat label="Active days / 7d" value={`${data.week.activeDays}/7`} />
            <Stat label="Longest streak" value={`${data.rank.longestStreakDays}d`} />
            <Stat label="XP / 7d" value={formatNumber(data.week.xp)} />
          </div>
        )}
      </Async>
    </Card>
  );
}

const NOTIFICATION_META: Record<NotificationType, { glyph: string; tone: string }> = {
  level_up: { glyph: '⬆', tone: 'easy' },
  achievement: { glyph: '🏆', tone: 'streak' },
  penalty: { glyph: '⚠', tone: 'hard' },
  daily_summary: { glyph: '📅', tone: 'muted' },
  weekly_summary: { glyph: '📜', tone: 'muted' },
  system: { glyph: '🔔', tone: 'normal' },
};

export function Notifications({ notifications }: { notifications: AsyncState<NotificationsResponse> }) {
  return (
    <Card title="System Notifications" icon="🔔" area="notify">
      <Async
        state={notifications}
        isEmpty={(data) => data.notifications.length === 0}
        emptyMessage="No notifications yet. Level ups and system events will appear here."
        loadingLabel="Loading notifications…"
      >
        {(data) => (
          <ul className="notification-list">
            {data.notifications.map((n) => {
              const meta = NOTIFICATION_META[n.type] ?? NOTIFICATION_META.system;
              return (
                <li key={n.id} className="notification">
                  <span className="notification-glyph" aria-hidden>{meta.glyph}</span>
                  <span className="notification-main">
                    <span className="notification-title">{n.title}</span>
                    {n.body ? <span className="muted">{n.body}</span> : null}
                  </span>
                  <span className="notification-side">
                    <Badge tone={n.discordStatus === 'sent' ? 'easy' : 'muted'}>
                      {n.discordStatus === 'sent' ? 'sent' : n.discordStatus === 'skipped' ? 'local' : n.discordStatus}
                    </Badge>
                    <span className="muted">{relativeTime(n.createdAt)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Async>
    </Card>
  );
}

function QuestList({ quests, emptyMessage }: { quests: Quest[]; emptyMessage: string }) {
  if (quests.length === 0) return <EmptyState message={emptyMessage} />;
  return (
    <ul className="quest-list">
      {quests.map((quest) => {
        const percent = ratioPercent(quest.progressCount, quest.targetCount);
        return (
          <li key={quest.id} className="quest">
            <div className="quest-head">
              <span className="quest-title">{quest.title}</span>
              <Badge tone={QUEST_TONES[quest.questType] ?? 'normal'}>{quest.questType}</Badge>
            </div>
            {quest.description ? <p className="quest-desc muted">{quest.description}</p> : null}
            <div className="quest-foot">
              <ProgressBar percent={percent} />
              <span className="muted">
                {quest.progressCount}/{quest.targetCount} · +{quest.xpReward} XP
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function DailyQuests({ quests }: { quests: AsyncState<QuestsResponse> }) {
  return (
    <Card title="Daily Quests" icon="🗡" area="daily">
      <Async state={quests} loadingLabel="Fetching quests…">
        {(data) => (
          <QuestList
            quests={splitQuests(data.quests).daily}
            emptyMessage="No daily quests active. Add an easy or normal quest to begin."
          />
        )}
      </Async>
    </Card>
  );
}

export function MainQuests({ quests }: { quests: AsyncState<QuestsResponse> }) {
  return (
    <Card title="Main Quests" icon="🏰" area="main">
      <Async state={quests} loadingLabel="Fetching quests…">
        {(data) => (
          <QuestList
            quests={splitQuests(data.quests).main}
            emptyMessage="No main quests active. Take on a hard, boss, or raid quest."
          />
        )}
      </Async>
    </Card>
  );
}

export function RecentActivity({ timeline }: { timeline: AsyncState<TimelineResponse> }) {
  return (
    <Card title="Recent Activity" icon="🛰" area="recent">
      <Async
        state={timeline}
        isEmpty={(data) => data.items.length === 0}
        emptyMessage="No tracked activity yet. Messages in tracked channels will appear here."
        loadingLabel="Loading timeline…"
      >
        {(data) => (
          <ul className="activity-list">
            {data.items.slice(0, 12).map((item) => (
              <li key={item.id} className="activity">
                <span className="activity-glyph" aria-hidden>›</span>
                <span className="activity-main">
                  <code>#{item.channelId}</code>
                  <span className="muted">
                    {item.contentLength} chars
                    {item.attachmentCount > 0 ? ` · ${item.attachmentCount} att` : ''}
                  </span>
                </span>
                <span className="activity-xp accent">+{item.xpAwarded} XP</span>
                <span className="activity-time muted">{relativeTime(item.occurredAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Async>
    </Card>
  );
}

// Core progression section: a full-width grid of every achievement, unlocked first.
// Each cell shows its icon, title, description, status, and either its unlock date
// (unlocked) or progress toward the target (locked / in progress).
export function Achievements({ achievements }: { achievements: AsyncState<AchievementsResponse> }) {
  return (
    <Card title="Achievements" icon="🏆" area="achievements">
      <Async
        state={achievements}
        isEmpty={(data) => data.achievements.length === 0}
        emptyMessage="No achievements yet. They unlock as you stay active."
        loadingLabel="Loading achievements…"
      >
        {(data) => (
          <ul className="achievement-grid">
            {data.achievements.map((a) => {
              const inProgress = !a.unlocked && a.progress > 0;
              const status = a.unlocked ? 'unlocked' : inProgress ? 'in progress' : 'locked';
              const statusTone = a.unlocked ? 'easy' : inProgress ? 'normal' : 'muted';
              const stateClass = a.unlocked ? 'unlocked' : inProgress ? 'in-progress' : 'locked';
              return (
                <li key={a.id} className={`achievement ${stateClass}`}>
                  <span className="achievement-glyph" aria-hidden>
                    {a.unlocked ? '★' : '☆'}
                  </span>
                  <div className="achievement-main">
                    <div className="achievement-head">
                      <span className="achievement-name">{a.name}</span>
                      <Badge tone={statusTone}>{status}</Badge>
                    </div>
                    {a.description ? <span className="achievement-desc muted">{a.description}</span> : null}
                    {a.unlocked ? (
                      <span className="achievement-meta muted">
                        {a.unlockedAt ? `Unlocked ${formatDate(a.unlockedAt)}` : 'Unlocked'}
                      </span>
                    ) : (
                      <div className="achievement-progress">
                        <ProgressBar percent={ratioPercent(a.progress, a.target)} />
                        <span className="achievement-meta muted">
                          {a.progress}/{a.target}
                        </span>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Async>
    </Card>
  );
}

export function WeeklyReportSection({ report }: { report: AsyncState<WeeklyReport> }) {
  return (
    <Card title="Weekly Report" icon="📜" area="weekly">
      <Async state={report} loadingLabel="Compiling weekly report…">
        {(data) => {
          const maxXp = Math.max(1, ...data.days.map((d) => d.xp));
          return (
            <div className="weekly">
              <div className="weekly-totals">
                <Stat label="Messages" value={formatNumber(data.totals.messages)} />
                <Stat label="XP earned" value={formatNumber(data.totals.xp)} />
                <Stat label="Quests done" value={formatNumber(data.totals.questsCompleted)} />
                <Stat label="Active days" value={`${data.totals.activeDays}/7`} />
              </div>
              <div className="weekly-chart" aria-hidden>
                {data.days.map((day) => (
                  <div key={day.date} className="weekly-bar">
                    <div className="weekly-bar-track">
                      <span style={{ height: `${ratioPercent(day.xp, maxXp)}%` }} />
                    </div>
                    <span className="weekly-bar-value">{day.xp}</span>
                    <span className="weekly-bar-label muted">{weekdayLabel(day.date)}</span>
                  </div>
                ))}
              </div>
              <p className="muted weekly-range">
                {data.rangeStart} → {data.rangeEnd}
              </p>
            </div>
          );
        }}
      </Async>
    </Card>
  );
}
