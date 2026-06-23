import type { AsyncState } from './api.js';
import { formatNumber, ratioPercent, relativeTime, splitQuests, weekdayLabel, xpProgressPercent } from './format.js';
import type {
  AchievementsResponse,
  Boundaries,
  Health,
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
    <Card title="Hunter Profile" icon="◈" span={2} accent>
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
    <Card title="Experience" icon="⚡">
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

export function StatsPanel({ summary }: { summary: AsyncState<Summary> }) {
  return (
    <Card title="Vital Stats" icon="📊">
      <Async state={summary} loadingLabel="Loading stats…">
        {(data) => (
          <div className="stat-grid">
            <Stat label="Messages today" value={formatNumber(data.today.messages)} />
            <Stat label="XP today" value={formatNumber(data.today.xp)} />
            <Stat label="Messages / 7d" value={formatNumber(data.week.messages)} />
            <Stat label="XP / 7d" value={formatNumber(data.week.xp)} />
            <Stat label="Active days / 7d" value={`${data.week.activeDays}/7`} />
            <Stat label="Longest streak" value={`${data.rank.longestStreakDays}d`} />
          </div>
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
    <Card title="Daily Quests" icon="🗡">
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
    <Card title="Main Quests" icon="🏰">
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
    <Card title="Recent Activity" icon="🛰" span={2}>
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

export function Achievements({ achievements }: { achievements: AsyncState<AchievementsResponse> }) {
  return (
    <Card title="Achievements" icon="🏆">
      <Async
        state={achievements}
        isEmpty={(data) => data.achievements.length === 0}
        emptyMessage="No achievements yet. They unlock as you stay active."
        loadingLabel="Loading achievements…"
      >
        {(data) => (
          <ul className="achievement-list">
            {data.achievements.map((a) => (
              <li key={a.id} className={`achievement ${a.unlocked ? 'unlocked' : 'locked'}`}>
                <span className="achievement-glyph" aria-hidden>
                  {a.unlocked ? '★' : '☆'}
                </span>
                <span className="achievement-main">
                  <span className="achievement-name">{a.name}</span>
                  {a.description ? <span className="muted">{a.description}</span> : null}
                  {!a.unlocked ? (
                    <span className="muted">
                      {a.progress}/{a.target}
                    </span>
                  ) : null}
                </span>
                {a.tier ? <Badge tone="muted">{a.tier}</Badge> : null}
              </li>
            ))}
          </ul>
        )}
      </Async>
    </Card>
  );
}

export function WeeklyReportSection({ report }: { report: AsyncState<WeeklyReport> }) {
  return (
    <Card title="Weekly Report" icon="📜" span={3}>
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
