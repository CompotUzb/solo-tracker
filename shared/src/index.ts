export const XP_RULES = {
  BASE_MESSAGE_XP: 5,
  FIRST_MESSAGE_OF_DAY_BONUS_XP: 10,
  DAILY_CAP_XP: 100,
  MIN_CONTENT_LENGTH_FOR_XP: 2,
  MAX_AWARDED_MESSAGES_PER_DAY: 20,
  STREAK_MIN_MESSAGES_PER_DAY: 1,
} as const;
export type RankCode =
  | "seed"
  | "apprentice"
  | "builder"
  | "specialist"
  | "expert"
  | "master";
export interface RankState {
  totalXp: number;
  level: number;
  rankCode: RankCode;
  rankName: string;
  xpIntoLevel: number;
  xpForNextLevel: number;
}
export function xpRequiredForLevel(level: number) {
  if (!Number.isInteger(level) || level < 1)
    throw new Error("level must be a positive integer");
  return (100 * (level - 1) * level) / 2;
}
export function computeLevel(totalXp: number) {
  if (!Number.isFinite(totalXp) || totalXp < 0) return 1;
  let level = 1;
  while (xpRequiredForLevel(level + 1) <= totalXp) level++;
  return level;
}
export function rankForLevel(level: number): {
  rankCode: RankCode;
  rankName: string;
} {
  if (level >= 17) return { rankCode: "master", rankName: "Master" };
  if (level >= 12) return { rankCode: "expert", rankName: "Expert" };
  if (level >= 8) return { rankCode: "specialist", rankName: "Specialist" };
  if (level >= 5) return { rankCode: "builder", rankName: "Builder" };
  if (level >= 3) return { rankCode: "apprentice", rankName: "Apprentice" };
  return { rankCode: "seed", rankName: "Seed" };
}
export function computeRankState(totalXp: number): RankState {
  const safeXp = Math.max(0, Math.floor(totalXp));
  const level = computeLevel(safeXp);
  const currentLevelStart = xpRequiredForLevel(level);
  const nextLevelStart = xpRequiredForLevel(level + 1);
  return {
    totalXp: safeXp,
    level,
    ...rankForLevel(level),
    xpIntoLevel: safeXp - currentLevelStart,
    xpForNextLevel: nextLevelStart - currentLevelStart,
  };
}
// Per-stat (Hunter attribute) leveling. Each attribute has its own level that climbs as
// its point value grows. The curve is gentle so slow-growing stats still level up: the
// cumulative points needed for level L is STEP * L*(L-1)/2, so reaching level L+1 from L
// costs STEP*L more points (5, 10, 15, ...). Deterministic and shared so the dashboard and
// API agree.
export const STAT_LEVEL_STEP = 5;

export interface StatLevelState {
  level: number;
  pointsIntoLevel: number;
  pointsForNextLevel: number;
}

function statPointsForLevel(level: number) {
  return (STAT_LEVEL_STEP * level * (level - 1)) / 2;
}

export function computeStatLevel(value: number): StatLevelState {
  const safeValue = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  let level = 1;
  while (statPointsForLevel(level + 1) <= safeValue) level++;
  const currentLevelStart = statPointsForLevel(level);
  return {
    level,
    pointsIntoLevel: safeValue - currentLevelStart,
    pointsForNextLevel: statPointsForLevel(level + 1) - currentLevelStart,
  };
}

export interface TimelineItem {
  id: string;
  type: "message_posted";
  channelId: string;
  occurredAt: string;
  contentLength: number;
  attachmentCount: number;
  xpAwarded: number;
}
