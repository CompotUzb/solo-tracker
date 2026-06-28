import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyMigrations, openDatabase, type Db } from "./db.js";
import { createMainQuestCommandHandler } from "./mainQuestCommands.js";
import type { MainQuestDraft } from "./mainQuestAi.js";

const USER = "local-user";
let db: Db;

beforeEach(() => {
  db = openDatabase(":memory:");
  applyMigrations(db);
});

afterEach(() => db.close());

function draft(overrides: Partial<MainQuestDraft> = {}): MainQuestDraft {
  return {
    title: "Probability & Statistics Exam Prep",
    description: "Prepare through structured study and problem solving.",
    difficulty: "hard",
    progressTarget: 10,
    progressUnit: "study sessions",
    rewardXp: 300,
    rewardStats: { Discipline: 3, "Technical Skill": 3 },
    suggestedSteps: ["Review fundamentals", "Solve mock problems"],
    confidence: 0.9,
    ...overrides,
  };
}

describe("Main Quest command handler", () => {
  it("returns the disabled AI message without creating a quest", async () => {
    const handler = createMainQuestCommandHandler({
      db,
      ai: {
        suggest: async () => ({
          ok: false,
          reason: "disabled",
          message: "AI Main Quest generation is disabled.",
        }),
      },
    });

    await expect(
      handler.handle({ kind: "suggest", goal: "prepare exam" }, USER),
    ).resolves.toBe("AI Main Quest generation is disabled.");
    expect(
      db.prepare("select count(*) as n from quests").get(),
    ).toMatchObject({ n: 0 });
  });

  it("stores a draft, creates a deterministic Main Quest on accept, and does not award XP", async () => {
    const onChanged = vi.fn();
    const handler = createMainQuestCommandHandler({
      db,
      ai: { suggest: async () => ({ ok: true, draft: draft() }) },
      onChanged,
    });

    const proposed = await handler.handle(
      { kind: "suggest", goal: "prepare probability exam" },
      USER,
    );
    expect(proposed).toContain("**Proposed Main Quest**");
    expect(proposed).toContain("Confirm with `/main accept`");

    const accepted = await handler.handle({ kind: "accept" }, USER);
    expect(accepted).toContain("Main Quest created:");

    const quest = db.prepare("select * from quests").get() as {
      title: string;
      quest_type: string;
      target_count: number;
      xp_reward: number;
      description: string;
    };
    expect(quest).toMatchObject({
      title: "Probability & Statistics Exam Prep",
      quest_type: "hard",
      target_count: 10,
      xp_reward: 300,
    });
    expect(quest.description).toContain("Unit: study sessions");
    expect(
      db.prepare("select count(*) as n from xp_awards").get(),
    ).toMatchObject({ n: 0 });
    expect(onChanged).toHaveBeenCalledWith(
      "main_quest.created",
      expect.objectContaining({ userId: USER }),
    );
  });

  it("stores a compact accepted description while preserving suggested steps", async () => {
    const handler = createMainQuestCommandHandler({
      db,
      ai: {
        suggest: async () => ({
          ok: true,
          draft: draft({
            description:
              "Prepare for the final exam through structured review, practice problems, mock exams, weak-topic correction, mistake review, repeated timed drills, and final summary notes before the deadline.",
            suggestedSteps: [
              "Review all core lecture topics.",
              "Complete 50 practice problems.",
              "Complete 3 mock exams.",
              "Rework mistakes until understood.",
            ],
          }),
        }),
      },
    });

    await handler.handle({ kind: "suggest", goal: "prepare exam" }, USER);
    await handler.handle({ kind: "accept" }, USER);

    const row = db
      .prepare("select description from quests")
      .get() as { description: string };
    const objective = row.description.split("\n")[0];
    expect(objective).toHaveLength(160);
    expect(objective.endsWith("…")).toBe(true);
    expect(row.description).toContain("Suggested steps:");
    expect(row.description).toContain("- Complete 3 mock exams.");
    expect(row.description).toContain("- Rework mistakes until understood.");
  });

  it("updates progress and completes Main Quests through deterministic logic", async () => {
    const handler = createMainQuestCommandHandler({
      db,
      ai: { suggest: async () => ({ ok: true, draft: draft() }) },
    });
    await handler.handle({ kind: "suggest", goal: "prepare exam" }, USER);
    await handler.handle({ kind: "accept" }, USER);
    const quest = db.prepare("select id from quests").get() as { id: string };

    await expect(
      handler.handle({ kind: "progress", questId: quest.id, amount: 4 }, USER),
    ).resolves.toContain("(4/10)");
    await expect(
      handler.handle({ kind: "complete", questId: quest.id }, USER),
    ).resolves.toContain("Reward: +300 XP");
    expect(
      db.prepare("select count(*) as n from xp_awards").get(),
    ).toMatchObject({ n: 1 });
  });
});
