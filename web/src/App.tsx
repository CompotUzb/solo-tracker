import { useEffect, useState } from 'react';
import { useEndpoint } from './api.js';
import { subscribeToDashboardEvents } from './live.js';
import {
  Achievements,
  DailyQuests,
  MainQuests,
  Profile,
  RecentActivity,
  StatsPanel,
  WeeklyReportSection,
  XpBar,
} from './sections.js';
import type {
  AchievementsResponse,
  Boundaries,
  Health,
  QuestsResponse,
  Summary,
  TimelineResponse,
  WeeklyReport,
} from './types.js';

/**
 * The dashboard composes one independent data fetch per live section. A shared
 * `refreshKey` lets server-sent XP/stat events re-pull the stat-driven sections
 * without a full reload, while static config (health, boundaries) loads once.
 */
export function App() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [live, setLive] = useState(false);

  const health = useEndpoint<Health>('/api/health', [refreshKey]);
  const boundaries = useEndpoint<Boundaries>('/api/config/boundaries', []);
  const summary = useEndpoint<Summary>('/api/stats/summary', [refreshKey]);
  const quests = useEndpoint<QuestsResponse>('/api/quests', [refreshKey]);
  const timeline = useEndpoint<TimelineResponse>('/api/timeline?limit=20', [refreshKey]);
  const achievements = useEndpoint<AchievementsResponse>('/api/achievements', [refreshKey]);
  const weekly = useEndpoint<WeeklyReport>('/api/reports/weekly', [refreshKey]);

  useEffect(() => {
    return subscribeToDashboardEvents({
      onLiveChange: setLive,
      onRefresh: () => setRefreshKey((key) => key + 1),
    });
  }, []);

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Solo System · Local Tracker</p>
          <h1>System Dashboard</h1>
        </div>
        <span className={`live ${live ? 'live-on' : 'live-off'}`}>
          <span className="live-dot" aria-hidden />
          {live ? 'Live' : 'Offline'}
        </span>
      </header>

      <div className="grid">
        <Profile summary={summary} health={health} boundaries={boundaries} />
        <XpBar summary={summary} />
        <DailyQuests quests={quests} />
        <MainQuests quests={quests} />
        <StatsPanel summary={summary} />
        <RecentActivity timeline={timeline} />
        <Achievements achievements={achievements} />
        <WeeklyReportSection report={weekly} />
      </div>

      <footer className="footer muted">
        Local-first · only tracked channels are stored · message content disabled by default
      </footer>
    </main>
  );
}
