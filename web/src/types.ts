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
  level: number;
  pointsIntoLevel: number;
  pointsForNextLevel: number;
}

export interface PlayerStatsResponse {
  userId: string;
  stats: PlayerStat[];
  updatedAt: string | null;
}

export type NotificationType =
  | "level_up"
  | "achievement"
  | "penalty"
  | "daily_summary"
  | "weekly_summary"
  | "system";

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string | null;
  metadata: Record<string, unknown> | null;
  discordStatus: "skipped" | "pending" | "sent" | "failed";
  discordMessageId: string | null;
  createdAt: string;
}

export interface NotificationsResponse {
  userId: string;
  notifications: Notification[];
  total: number;
}

export interface DailyMetric {
  key: string;
  label: string;
  unit: string;
  target: number;
  progress: number;
  done: boolean;
}

export interface DailyQuest {
  id: string | null;
  date: string;
  tier: "e" | "c" | "s";
  tierLabel: string;
  tierName: string;
  hunterRank: string;
  status: string;
  completedAt: string | null;
  metrics: DailyMetric[];
  complete: boolean;
  completedCount: number;
  totalCount: number;
  discordParentMessageId: string | null;
  discordThreadId: string | null;
  discordThreadName: string | null;
  streakDayNumber: number | null;
  rewardsGranted: boolean;
}

export interface DailyStateView {
  currentStreak: number;
  longestStreak: number;
  statPoints: number;
  penaltyActive: boolean;
  penaltyReason: string | null;
  penaltySince: string | null;
  lastEvaluatedDate: string | null;
}

export interface LootBox {
  id: string;
  rarity: string;
  reward: string;
  source: string;
  status: string;
  createdAt: string;
  claimedAt: string | null;
}

export interface DailySnapshot {
  date: string;
  quest: DailyQuest | null;
  state: DailyStateView;
  lootBoxes: LootBox[];
  statKeys: string[];
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

export type QuestType = "easy" | "normal" | "hard" | "boss" | "raid";
export type QuestStatus = "active" | "completed" | "archived" | "abandoned";

export interface Quest {
  id: string;
  displayId?: string;
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
  totals: {
    messages: number;
    xp: number;
    questsCompleted: number;
    activeDays: number;
  };
}
