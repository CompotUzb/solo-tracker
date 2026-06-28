import type { Db } from "./db.js";
import type { Notifier } from "./notifications.js";
import {
  addQuest,
  completeQuest,
  getQuest,
  listMainQuests,
  updateQuestProgress,
} from "./quests.js";
import { getRankSnapshot } from "./xp.js";
import { applyStatGains, questStatGains } from "./stats.js";
import type {
  MainQuestDraft,
  MainQuestSuggestionResult,
} from "./mainQuestAi.js";

export type MainCommand =
  | { kind: "suggest"; goal: string }
  | { kind: "accept" }
  | { kind: "reject" }
  | { kind: "list" }
  | { kind: "progress"; questId: string; amount: number }
  | { kind: "complete"; questId: string };

export interface MainQuestAiService {
  suggest(goal: string): Promise<MainQuestSuggestionResult>;
}

export interface MainQuestCommandHandler {
  handle(command: MainCommand, userId: string): Promise<string>;
}

function statSummary(stats: Record<string, number>): string {
  return Object.entries(stats)
    .map(([label, delta]) => `${label} +${delta}`)
    .join(" · ");
}

export function formatMainQuestDraft(draft: MainQuestDraft): string {
  return [
    "**Proposed Main Quest**",
    `**Title:** ${draft.title}`,
    `**Difficulty:** ${draft.difficulty}`,
    `**Target:** ${draft.progressTarget} ${draft.progressUnit}`,
    `**Reward:** +${draft.rewardXp} XP · ${statSummary(draft.rewardStats)}`,
    "",
    "**Description**",
    draft.description,
    "",
    "**Steps**",
    ...draft.suggestedSteps.map((step) => `- ${step}`),
    "",
    "Confirm with `/main accept` or reject with `/main reject`.",
  ].join("\n");
}

function draftDescription(draft: MainQuestDraft): string {
  const description =
    draft.description.length > 160
      ? `${draft.description.slice(0, 159).trimEnd()}…`
      : draft.description;
  return [
    description,
    `Unit: ${draft.progressUnit}`,
    "",
    "Suggested steps:",
    ...draft.suggestedSteps.map((step) => `- ${step}`),
  ].join("\n");
}

export function createMainQuestCommandHandler(input: {
  db: Db;
  ai: MainQuestAiService;
  notifier?: Notifier;
  onChanged?: (event: string, data: unknown) => void;
}): MainQuestCommandHandler {
  const drafts = new Map<string, MainQuestDraft>();

  return {
    async handle(command, userId) {
      if (command.kind === "suggest") {
        const result = await input.ai.suggest(command.goal);
        if (!result.ok) return result.message;
        drafts.set(userId, result.draft);
        return formatMainQuestDraft(result.draft);
      }

      if (command.kind === "reject") {
        drafts.delete(userId);
        return "Main Quest draft rejected.";
      }

      if (command.kind === "accept") {
        const draft = drafts.get(userId);
        if (!draft)
          return "No Main Quest draft pending. Use `/main suggest <goal>` first.";
        const quest = addQuest(input.db, {
          userId,
          title: draft.title,
          questType: draft.difficulty,
          description: draftDescription(draft),
          targetCount: draft.progressTarget,
        });
        drafts.delete(userId);
        input.onChanged?.("main_quest.created", { userId, quest });
        input.onChanged?.("quest.updated", {
          action: "created",
          userId,
          quest,
        });
        return `Main Quest created: ${quest.title}\nID: ${quest.id}`;
      }

      if (command.kind === "list") {
        const quests = listMainQuests(input.db, userId).filter(
          (quest) => quest.status === "active",
        );
        if (quests.length === 0) return "No active Main Quests.";
        return [
          "**Main Quests**",
          ...quests.map(
            (quest) =>
              `- ${quest.id} · ${quest.title} · ${quest.progressCount}/${quest.targetCount} · ${quest.questType}`,
          ),
        ].join("\n");
      }

      if (command.kind === "progress") {
        const quest = updateQuestProgress(input.db, {
          questId: command.questId,
          userId,
          progressCount: command.amount,
        });
        input.onChanged?.("main_quest.progress", { userId, quest });
        input.onChanged?.("quest.updated", {
          action: "progress",
          userId,
          quest,
        });
        return `Main Quest progress updated: ${quest.title} (${quest.progressCount}/${quest.targetCount}).`;
      }

      const existing = getQuest(input.db, command.questId);
      if (!existing) return "Main Quest not found.";
      if (!["hard", "boss", "raid"].includes(existing.questType)) {
        return "That quest is not a Main Quest.";
      }
      const result = completeQuest(input.db, {
        questId: command.questId,
        userId,
      });
      if (!result.alreadyCompleted) {
        applyStatGains(input.db, {
          userId,
          gains: questStatGains(result.quest.questType),
          reason: "main_quest_completed",
          source: "quest",
          sourceId: result.quest.id,
        });
        input.notifier?.notify({
          userId,
          type: "system",
          title: "🏰 Main Quest Cleared",
          body: `${result.quest.title}. Reward: +${result.award.xpAwarded} XP.`,
          metadata: {
            questId: result.quest.id,
            questType: result.quest.questType,
          },
        });
        input.onChanged?.("stats.player.updated", { userId });
      }
      input.onChanged?.("main_quest.completed", {
        userId,
        quest: result.quest,
        xpAwarded: result.award.xpAwarded,
        alreadyCompleted: result.alreadyCompleted,
      });
      input.onChanged?.("quest.updated", {
        action: "completed",
        userId,
        quest: result.quest,
      });
      input.onChanged?.("xp", {
        userId,
        xpAwarded: result.award.xpAwarded,
        level: getRankSnapshot(input.db, userId).level,
      });
      return `Main Quest complete: ${result.quest.title}. Reward: +${result.award.xpAwarded} XP.`;
    },
  };
}
