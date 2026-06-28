import type { Db } from "./db.js";
import type { Notifier } from "./notifications.js";
import { addQuest, listMainQuests } from "./quests.js";
import type {
  MainQuestDraft,
  MainQuestSuggestionResult,
} from "./mainQuestAi.js";
import {
  mainQuestDisplayId,
  resolveMainQuestId,
  withMainQuestDisplayIds,
} from "./mainQuestIds.js";
import {
  archiveMainQuest,
  completeMainQuest,
  progressMainQuest,
} from "./mainQuestLifecycle.js";

export type MainCommand =
  | { kind: "suggest"; goal: string }
  | { kind: "accept" }
  | { kind: "reject" }
  | { kind: "list" }
  | { kind: "progress"; questId: string; amount: number }
  | { kind: "complete"; questId: string }
  | { kind: "archive"; questId: string };

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
    "**ID:** Draft",
    `**Title:** ${draft.title}`,
    `**Difficulty:** ${draft.difficulty}`,
    `**Target:** ${draft.progressTarget} ${draft.progressUnit}`,
    `**Reward:** +${draft.rewardXp} XP · ${statSummary(draft.rewardStats)}`,
    "",
    "**Description**",
    draft.description,
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
  ].join("\n");
}

function questProgressUnit(description: string | null): string {
  const unitLine = description
    ?.split(/\r?\n/)
    .find((line) => line.trim().toLowerCase().startsWith("unit:"));
  return unitLine?.replace(/^unit:\s*/i, "").trim() ?? "";
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
        const displayId = mainQuestDisplayId(input.db, userId, quest.id);
        input.onChanged?.("main_quest.created", { userId, quest });
        input.onChanged?.("quest.updated", {
          action: "created",
          userId,
          quest,
        });
        return [
          "Main Quest accepted.",
          "",
          `ID: ${displayId}`,
          `Title: ${quest.title}`,
          `Progress: ${quest.progressCount} / ${quest.targetCount} ${draft.progressUnit}`,
          "",
          "Use:",
          `/main progress ${displayId} 1`,
          `/main complete ${displayId}`,
          `/main archive ${displayId}`,
        ].join("\n");
      }

      if (command.kind === "list") {
        const quests = withMainQuestDisplayIds(
          input.db,
          userId,
          listMainQuests(input.db, userId).filter(
            (quest) => quest.status === "active",
          ),
        );
        if (quests.length === 0) return "No active Main Quests.";
        return [
          "**Active Main Quests**",
          ...quests.map((quest) => {
            const unit = questProgressUnit(quest.description);
            return [
              "",
              `${quest.displayId} — ${quest.title}`,
              `Difficulty: ${quest.questType}`,
              `Progress: ${quest.progressCount} / ${quest.targetCount}${
                unit ? ` ${unit}` : ""
              }`,
              `Reward: +${quest.xpReward} XP`,
              "",
              "Commands:",
              `- /main progress ${quest.displayId} 1`,
              `- /main complete ${quest.displayId}`,
              `- /main archive ${quest.displayId}`,
            ].join("\n");
          }),
        ].join("\n");
      }

      if (command.kind === "progress") {
        const questId = resolveMainQuestId(input.db, userId, command.questId);
        const result = progressMainQuest(input.db, {
          questId,
          userId,
          progressCount: command.amount,
          notifier: input.notifier,
        }, { emit: input.onChanged });
        const quest = result.completion?.quest ?? result.quest;
        if (result.completion) {
          return `Main Quest complete: ${quest.title}. Reward: +${result.completion.award.xpAwarded} XP.`;
        }
        return `Main Quest progress updated: ${quest.title} (${quest.progressCount}/${quest.targetCount}).`;
      }

      if (command.kind === "archive") {
        const questId = resolveMainQuestId(input.db, userId, command.questId);
        const quest = archiveMainQuest(input.db, { questId, userId }, {
          emit: input.onChanged,
        });
        return `Main Quest archived: ${quest.title}`;
      }

      const questId = resolveMainQuestId(input.db, userId, command.questId);
      const result = completeMainQuest(input.db, {
        questId,
        userId,
        notifier: input.notifier,
      }, { emit: input.onChanged });
      return `Main Quest complete: ${result.quest.title}. Reward: +${result.award.xpAwarded} XP.`;
    },
  };
}
