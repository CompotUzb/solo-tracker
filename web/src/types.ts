// Shapes returned by the local Solo System API. Kept in sync with server/src/api.ts
// and server/src/reports.ts. These are the contract the dashboard renders against.

export interface Health {
  ok: boolean;
  db: string;
  discord: string;
}

export interface Boundaries {
  guildId: string;
  trackedChannelIds: string[];
  channelCategories: Record<string, string>;
  systemOutputConfigured: boolean;
  storeMessageContent: boolean;
  apiHost: string;
  apiPort: number;
  databasePath: string;
  timezone: string;
}

export interface PlayerStat {
  key: string;
  label: string;
  value: number;
}

export interface PlayerStatsResponse {
  userId: string;
  stats: PlayerStat[];
  updatedAt: string | null;
}

export type NotificationType = 'level_up' | 'achievement' | 'penalty' | 'daily_summary' | 'weekly_summary' | 'system';

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string | null;
  metadata: Record<string, unknown> | null;
  discordStatus: 'skipped' | 'pending' | 'sent' | 'failed';
  discordMessageId: string | null;
  createdAt: string;
}

export interface NotificationsResponse {
  userId: string;
  notifications: Notification[];
}

export interface Rank {
  totalXp: number;
  level: number;
  rankCode: string;
  rankName: string;
  xpIntoLevel: number;
  xpForNextLevel: number;
  currentStreakDays: number;
  longestStreakDays: number;
}

export interface Summary {
  userId: string;
  today: { messages: number; xp: number; streakEligible: boolean };
  week: { messages: number; xp: number; activeDays: number };
  rank: Rank;
}

export type QuestType = 'easy' | 'normal' | 'hard' | 'boss' | 'raid';
export type QuestStatus = 'active' | 'completed' | 'abandoned';

export interface Quest {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  questType: QuestType;
  status: QuestStatus;
  targetCount: number;
  progressCount: number;
  xpReward: number;
  startsAt: string | null;
  dueAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QuestsResponse {
  userId: string;
  quests: Quest[];
}

export interface TimelineItem {
  id: string;
  type: string;
  channelId: string;
  occurredAt: string;
  contentLength: number;
  attachmentCount: number;
  xpAwarded: number;
}

export interface TimelineResponse {
  items: TimelineItem[];
}

export interface Achievement {
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

export interface AchievementsResponse {
  userId: string;
  achievements: Achievement[];
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
  totals: { messages: number; xp: number; questsCompleted: number; activeDays: number };
}
