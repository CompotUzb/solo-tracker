import { z } from "zod";
import { QUEST_XP_REWARDS, type QuestType } from "./quests.js";
import { questStatGains, STAT_LABELS } from "./stats.js";

export type MainQuestDifficulty = Extract<QuestType, "hard" | "boss" | "raid">;

const MAIN_DIFFICULTIES = ["hard", "boss", "raid"] as const;

const aiDraftSchema = z.object({
  title: z.string().min(1).max(80),
  description: z.string().min(1).max(500),
  difficulty: z.enum(MAIN_DIFFICULTIES).default("hard"),
  progress_target: z.coerce.number().int().min(1).max(100).default(10),
  progress_unit: z.string().min(1).max(40).default("sessions"),
  reward_xp: z.coerce.number().int().optional(),
  reward_stats: z.record(z.coerce.number().int()).optional(),
  suggested_steps: z.array(z.string().min(1).max(120)).min(1).max(8),
  confidence: z.coerce.number().min(0).max(1).default(0.7),
});

export interface MainQuestDraft {
  title: string;
  description: string;
  difficulty: MainQuestDifficulty;
  progressTarget: number;
  progressUnit: string;
  rewardXp: number;
  rewardStats: Record<string, number>;
  suggestedSteps: string[];
  confidence: number;
}

export type MainQuestSuggestionResult =
  | { ok: true; draft: MainQuestDraft }
  | { ok: false; reason: "disabled" | "invalid_goal" | "ai_error"; message: string };

export interface MainQuestAiConfig {
  enabled: boolean;
  apiKey: string;
  model: string;
}

type FetchLike = typeof fetch;

function stripCodeFence(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function deterministicRewardStats(
  difficulty: MainQuestDifficulty,
): Record<string, number> {
  return Object.fromEntries(
    questStatGains(difficulty).map((gain) => [
      STAT_LABELS[gain.statKey],
      gain.delta,
    ]),
  );
}

export function normalizeMainQuestDraft(raw: unknown): MainQuestDraft {
  const parsed = aiDraftSchema.parse(raw);
  const difficulty = parsed.difficulty;
  return {
    title: parsed.title.trim(),
    description: parsed.description.trim(),
    difficulty,
    progressTarget: parsed.progress_target,
    progressUnit: parsed.progress_unit.trim(),
    rewardXp: QUEST_XP_REWARDS[difficulty],
    rewardStats: deterministicRewardStats(difficulty),
    suggestedSteps: parsed.suggested_steps.map((step) => step.trim()),
    confidence: parsed.confidence,
  };
}

export async function suggestMainQuestDraft(input: {
  goal: string;
  config: MainQuestAiConfig;
  fetchImpl?: FetchLike;
}): Promise<MainQuestSuggestionResult> {
  const goal = input.goal.trim();
  if (!goal) {
    return {
      ok: false,
      reason: "invalid_goal",
      message: "Use /main suggest <goal>.",
    };
  }
  if (!input.config.enabled || !input.config.apiKey) {
    return {
      ok: false,
      reason: "disabled",
      message: "AI Main Quest generation is disabled.",
    };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: input.config.model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Convert the user's larger goal into one RPG Main Quest draft. Return JSON only with: title, description, difficulty (hard|boss|raid), progress_target, progress_unit, reward_xp, reward_stats, suggested_steps, confidence. Do not mark progress, complete quests, award XP, affect rank, mention Daily Quest, or create penalties.",
          },
          { role: "user", content: goal },
        ],
      }),
    });
    if (!response.ok) {
      return {
        ok: false,
        reason: "ai_error",
        message: `AI Main Quest generation failed (${response.status}).`,
      };
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("missing AI response content");
    const raw = JSON.parse(stripCodeFence(content));
    return { ok: true, draft: normalizeMainQuestDraft(raw) };
  } catch {
    return {
      ok: false,
      reason: "ai_error",
      message: "AI Main Quest generation failed.",
    };
  }
}
