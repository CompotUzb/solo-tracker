import type { Db } from "./db.js";
import type { Notifier } from "./notifications.js";
import {
  archiveQuest,
  completeQuest,
  getQuest,
  updateQuestProgress,
  type CompleteQuestResult,
  type Quest,
} from "./quests.js";
import {
  applyStatGains,
  getPlayerStats,
  questStatGains,
  type PlayerStat,
} from "./stats.js";
import { getRankSnapshot, type RankSnapshot } from "./xp.js";

export interface MainQuestLifecycleEvents {
  emit?: (event: string, data: unknown) => void;
}

export interface CompleteMainQuestResult extends CompleteQuestResult {
  stats: RankSnapshot;
  playerStats: PlayerStat[];
}

export interface ProgressMainQuestResult {
  quest: Quest;
  completion: CompleteMainQuestResult | null;
}

function assertMainQuest(quest: Quest): void {
  if (!["hard", "boss", "raid"].includes(quest.questType)) {
    throw new Error("not a Main Quest");
  }
}

export function archiveMainQuest(
  db: Db,
  input: { questId: string; userId: string },
  events: MainQuestLifecycleEvents = {},
): Quest {
  const existing = getQuest(db, input.questId);
  if (!existing) throw new Error("Main Quest not found");
  if (existing.userId !== input.userId)
    throw new Error("quest does not belong to this user");
  assertMainQuest(existing);
  const quest = archiveQuest(db, input);
  events.emit?.("main_quest.archived", { userId: input.userId, quest });
  events.emit?.("quest.updated", {
    action: "archived",
    userId: input.userId,
    quest,
  });
  return quest;
}

export function completeMainQuest(
  db: Db,
  input: { questId: string; userId: string; notifier?: Notifier },
  events: MainQuestLifecycleEvents = {},
): CompleteMainQuestResult {
  const existing = getQuest(db, input.questId);
  if (!existing) throw new Error("Main Quest not found");
  if (existing.userId !== input.userId)
    throw new Error("quest does not belong to this user");
  assertMainQuest(existing);

  const result = completeQuest(db, {
    questId: input.questId,
    userId: input.userId,
  });
  let playerStats = getPlayerStats(db, input.userId).stats;
  if (!result.alreadyCompleted) {
    const statResult = applyStatGains(db, {
      userId: input.userId,
      gains: questStatGains(result.quest.questType),
      reason: "main_quest_completed",
      source: "quest",
      sourceId: result.quest.id,
    });
    playerStats = statResult.stats;
    input.notifier?.notify({
      userId: input.userId,
      type: "system",
      title: "🏰 Main Quest Cleared",
      body: `${result.quest.title}. Reward: +${result.award.xpAwarded} XP.`,
      metadata: {
        questId: result.quest.id,
        questType: result.quest.questType,
      },
    });
    events.emit?.("stats.player.updated", { userId: input.userId });
  }

  events.emit?.("main_quest.completed", {
    userId: input.userId,
    quest: result.quest,
    xpAwarded: result.award.xpAwarded,
    alreadyCompleted: result.alreadyCompleted,
  });
  events.emit?.("quest.updated", {
    action: "completed",
    userId: input.userId,
    quest: result.quest,
  });
  events.emit?.("xp", {
    userId: input.userId,
    xpAwarded: result.award.xpAwarded,
    level: result.award.current.level,
    rankCode: result.award.current.rankCode,
  });

  return {
    ...result,
    stats: getRankSnapshot(db, input.userId),
    playerStats,
  };
}

export function progressMainQuest(
  db: Db,
  input: {
    questId: string;
    userId: string;
    progressCount: number;
    notifier?: Notifier;
  },
  events: MainQuestLifecycleEvents = {},
): ProgressMainQuestResult {
  const existing = getQuest(db, input.questId);
  if (!existing) throw new Error("Main Quest not found");
  if (existing.userId !== input.userId)
    throw new Error("quest does not belong to this user");
  assertMainQuest(existing);

  if (existing.status === "completed") {
    return {
      quest: existing,
      completion: completeMainQuest(db, input, events),
    };
  }

  const quest = updateQuestProgress(db, {
    questId: input.questId,
    userId: input.userId,
    progressCount: input.progressCount,
  });
  events.emit?.("main_quest.progress", { userId: input.userId, quest });
  events.emit?.("quest.updated", {
    action: "progress",
    userId: input.userId,
    quest,
  });

  if (quest.progressCount >= quest.targetCount) {
    return {
      quest,
      completion: completeMainQuest(db, input, events),
    };
  }

  return { quest, completion: null };
}
