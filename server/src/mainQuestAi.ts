import { z } from "zod";
import { QUEST_XP_REWARDS, type QuestType } from "./quests.js";
export type MainQuestDifficulty = Extract<QuestType, "hard" | "boss" | "raid">;

const MAIN_DIFFICULTIES = ["hard", "boss", "raid"] as const;
const VAGUE_TARGET_UNITS = [
  "percent",
  "percentage",
  "%",
  "completion",
  "progress",
  "mastery",
];
const FLUFFY_WORDS = ["embark", "journey", "conquer", "destiny", "legendary"];
const GENERIC_STEPS = [
  "attend all lectures",
  "form a study group",
  "stay motivated",
  "work hard",
  "do your best",
];

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
type GoalCategory = "exam" | "fitness" | "technical" | "project" | "streak" | "general";

function stripCodeFence(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function inferGoalCategory(text: string): GoalCategory {
  const normalized = text.toLowerCase();
  if (
    /\b(exam|final|midterm|quiz|probability|statistics|calculus|lecture|study|studying)\b/.test(
      normalized,
    )
  )
    return "exam";
  if (/\b(body|strength|fitness|workout|pushups?|pullups?|squats?|gym)\b/.test(normalized))
    return "fitness";
  if (/\b(computer vision|machine learning|ai|coding|code|programming|technical)\b/.test(normalized))
    return "technical";
  if (/\b(deploy|deployment|ship|finish|project|tracker|release|tasks?)\b/.test(normalized))
    return "project";
  if (/\b(streak|habit|days?)\b/.test(normalized)) return "streak";
  return "general";
}

function categoryPlan(category: GoalCategory): {
  target: number;
  unit: string;
  description: string;
  steps: string[];
  stats: Record<string, number>;
} {
  switch (category) {
    case "exam":
      return {
        target: 12,
        unit: "study sessions",
        description:
          "Prepare through structured review, practice problems, mock exams, and weak-topic correction.",
        steps: [
          "Review all core lecture topics.",
          "Complete 50 practice problems.",
          "Complete 3 mock exams.",
          "Summarize weak topics after each session.",
          "Rework mistakes until they are understood.",
        ],
        stats: { Intelligence: 3, Discipline: 3, "Technical Skill": 2 },
      };
    case "fitness":
      return {
        target: 20,
        unit: "training sessions",
        description:
          "Build strength through scheduled workouts, progressive volume, recovery, and form tracking.",
        steps: [
          "Complete 20 strength sessions.",
          "Track push, pull, squat, and core work each session.",
          "Increase one exercise target every week.",
          "Record recovery notes after hard sessions.",
        ],
        stats: { Strength: 3, Health: 3, Discipline: 2 },
      };
    case "technical":
      return {
        target: 8,
        unit: "completed modules",
        description:
          "Improve the skill through focused lessons, implementation practice, and review of mistakes.",
        steps: [
          "Complete 8 focused learning modules.",
          "Build one small implementation per module.",
          "Write notes for errors and concepts that repeat.",
          "Review one finished implementation at the end.",
        ],
        stats: { "Technical Skill": 3, Intelligence: 3, Discipline: 2 },
      };
    case "project":
      return {
        target: 6,
        unit: "completed tasks",
        description:
          "Finish the project through scoped implementation tasks, verification, and deployment checks.",
        steps: [
          "Define 6 concrete project tasks.",
          "Complete and test one task at a time.",
          "Run build and health checks after major changes.",
          "Write down remaining blockers before each session ends.",
        ],
        stats: { "Technical Skill": 3, Discipline: 3, Intelligence: 1 },
      };
    case "streak":
      return {
        target: 7,
        unit: "days",
        description:
          "Complete the streak by clearing the required daily action for seven consecutive days.",
        steps: [
          "Complete the required action each day.",
          "Log progress before the day ends.",
          "Review missed-risk points after each day.",
          "Keep the streak visible on the dashboard.",
        ],
        stats: { Discipline: 4, Survival: 2, Health: 1 },
      };
    case "general":
      return {
        target: 10,
        unit: "completed tasks",
        description:
          "Complete the goal through concrete tasks, progress review, and correction of weak points.",
        steps: [
          "Break the goal into 10 concrete tasks.",
          "Complete one task per work session.",
          "Review blockers after each session.",
          "Rework weak points before final completion.",
        ],
        stats: { Discipline: 3, Intelligence: 2, "Technical Skill": 1 },
      };
  }
}

function hasVagueUnit(unit: string): boolean {
  const normalized = unit.toLowerCase();
  return VAGUE_TARGET_UNITS.some((value) => normalized.includes(value));
}

function hasFluffyText(text: string): boolean {
  const normalized = text.toLowerCase();
  return FLUFFY_WORDS.some((value) => normalized.includes(value));
}

function hasGenericSteps(steps: string[]): boolean {
  return steps.some((step) => {
    const normalized = step.toLowerCase();
    return (
      hasFluffyText(normalized) ||
      GENERIC_STEPS.some((value) => normalized.includes(value))
    );
  });
}

export function normalizeMainQuestDraft(raw: unknown, goal = ""): MainQuestDraft {
  const parsed = aiDraftSchema.parse(raw);
  const difficulty = parsed.difficulty;
  const category = inferGoalCategory(
    [goal, parsed.title, parsed.description, parsed.progress_unit].join(" "),
  );
  const plan = categoryPlan(category);
  const usePlanTarget = hasVagueUnit(parsed.progress_unit);
  const description = hasFluffyText(parsed.description)
    ? plan.description
    : parsed.description.trim();
  const suggestedSteps = hasGenericSteps(parsed.suggested_steps)
    ? plan.steps
    : parsed.suggested_steps.map((step) => step.trim());
  return {
    title: parsed.title.trim(),
    description,
    difficulty,
    progressTarget: usePlanTarget ? plan.target : parsed.progress_target,
    progressUnit: usePlanTarget ? plan.unit : parsed.progress_unit.trim(),
    rewardXp: QUEST_XP_REWARDS[difficulty],
    rewardStats: plan.stats,
    suggestedSteps,
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
              "Convert the user's larger goal into one concise RPG System Main Quest draft. Return JSON only with: title, description, difficulty (hard|boss|raid), progress_target, progress_unit, reward_xp, reward_stats, suggested_steps, confidence. Rules: never use percent/percentage/100 percent as a target; use measurable units such as study sessions, practice problems, mock exams, days, completed modules, or completed tasks. Keep steps practical and specific. Avoid generic advice like attend all lectures, form a study group, stay motivated, or work hard. Avoid fluffy words like embark, journey, conquer, destiny, legendary. For exam prep, prefer targets like 10-12 study sessions, 50 practice problems, 3 mock exams, or 5 reviewed weak topics. Do not mark progress, complete quests, award XP, affect rank, mention Daily Quest, or create penalties.",
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
    return { ok: true, draft: normalizeMainQuestDraft(raw, goal) };
  } catch {
    return {
      ok: false,
      reason: "ai_error",
      message: "AI Main Quest generation failed.",
    };
  }
}
