import { randomUUID } from "node:crypto";
import type { Db } from "./db.js";
import type { Quest } from "./quests.js";
import type { AwardXpResult } from "./xp.js";
import type { NotificationInput } from "./notifications.js";

export interface AchievementUnlock {
  id: string;
  userId: string;
  code: string;
  name: string;
  description: string;
  tier: string;
  context: Record<string, unknown>;
  unlockedAt: string;
}

interface AchievementDefinition {
  code: string;
  name: string;
  description: string;
  tier: string;
  target: number;
}

const DEFINITIONS = {
  firstQuest: {
    code: "A001_FIRST_QUEST_COMPLETED",
    name: "First Quest",
    description: "Complete your first quest.",
    tier: "bronze",
    target: 1,
  },
  firstLevelUp: {
    code: "A002_FIRST_LEVEL_UP",
    name: "First Level Up",
    description: "Level up for the first time.",
    tier: "bronze",
    target: 1,
  },
} as const satisfies Record<string, AchievementDefinition>;

interface AchievementRow {
  id: string;
  user_id: string;
  code: string;
  name: string;
  description: string;
  tier: string;
  unlocked_at: string;
}

function unlockAchievement(
  db: Db,
  userId: string,
  definition: AchievementDefinition,
  context: Record<string, unknown>,
  now = new Date().toISOString(),
): AchievementUnlock | null {
  const id = randomUUID();
  const result = db
    .prepare(
      `insert or ignore into achievements
        (id,user_id,code,name,description,tier,progress,target,unlocked_at,created_at,updated_at)
       values (?,?,?,?,?,?,1,?,?,?,?)`,
    )
    .run(
      id,
      userId,
      definition.code,
      definition.name,
      definition.description,
      definition.tier,
      definition.target,
      now,
      now,
      now,
    );
  if (result.changes !== 1) return null;

  const row = db
    .prepare(
      "select id,user_id,code,name,description,tier,unlocked_at from achievements where id=?",
    )
    .get(id) as AchievementRow;
  return {
    id: row.id,
    userId: row.user_id,
    code: row.code,
    name: row.name,
    description: row.description,
    tier: row.tier,
    context,
    unlockedAt: row.unlocked_at,
  };
}

export function checkAchievementsAfterQuestCompleted(
  db: Db,
  quest: Quest,
  xpAwarded: number,
): AchievementUnlock[] {
  const completedCount = db
    .prepare(
      `select count(*) as n from quests where user_id=? and status='completed'`,
    )
    .get(quest.userId) as { n: number };
  if (completedCount.n !== 1) return [];

  const unlocked = unlockAchievement(db, quest.userId, DEFINITIONS.firstQuest, {
    questId: quest.id,
    questTitle: quest.title,
    questType: quest.questType,
    xpAwarded,
  });
  return unlocked ? [unlocked] : [];
}

export function checkAchievementsAfterLevelUp(
  db: Db,
  award: AwardXpResult,
): AchievementUnlock[] {
  if (!award.leveledUp) return [];
  const unlocked = unlockAchievement(
    db,
    award.userId,
    DEFINITIONS.firstLevelUp,
    {
      oldLevel: award.previous.level,
      newLevel: award.current.level,
      xpTotal: award.current.totalXp,
    },
  );
  return unlocked ? [unlocked] : [];
}

export function achievementNotification(
  unlock: AchievementUnlock,
): NotificationInput {
  if (unlock.code === DEFINITIONS.firstQuest.code) {
    return {
      userId: unlock.userId,
      type: "achievement",
      title: "Achievement unlocked: First Quest",
      body: `You completed your first quest: "${String(unlock.context.questTitle)}".\n+${Number(unlock.context.xpAwarded ?? 0)} XP`,
      metadata: {
        achievementCode: unlock.code,
        achievementId: unlock.id,
        ...unlock.context,
      },
    };
  }

  if (unlock.code === DEFINITIONS.firstLevelUp.code) {
    return {
      userId: unlock.userId,
      type: "achievement",
      title: "Achievement unlocked: First Level Up",
      body: `Level ${Number(unlock.context.oldLevel ?? 0)} → ${Number(unlock.context.newLevel ?? 0)}. The system recognizes your growth.`,
      metadata: {
        achievementCode: unlock.code,
        achievementId: unlock.id,
        ...unlock.context,
      },
    };
  }

  return {
    userId: unlock.userId,
    type: "achievement",
    title: `Achievement unlocked: ${unlock.name}`,
    body: unlock.description,
    metadata: {
      achievementCode: unlock.code,
      achievementId: unlock.id,
      ...unlock.context,
    },
  };
}
