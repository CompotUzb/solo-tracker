import { describe, expect, it, vi } from "vitest";
import {
  normalizeMainQuestDraft,
  suggestMainQuestDraft,
} from "./mainQuestAi.js";

describe("AI Main Quest generation", () => {
  it("returns a clear disabled result without calling OpenAI", async () => {
    const fetchImpl = vi.fn();
    const result = await suggestMainQuestDraft({
      goal: "prepare probability exam",
      config: { enabled: false, apiKey: "", model: "gpt-4o" },
      fetchImpl: fetchImpl as never,
    });

    expect(result).toEqual({
      ok: false,
      reason: "disabled",
      message: "AI Main Quest generation is disabled.",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("normalizes AI XP and category stats for exam-prep goals", () => {
    expect(
      normalizeMainQuestDraft(
        {
          title: "Probability & Statistics Exam Prep",
          description: "Prepare through structured study.",
          difficulty: "hard",
          progress_target: 10,
          progress_unit: "study sessions",
          reward_xp: 9999,
          reward_stats: { Intelligence: 99 },
          suggested_steps: ["Review fundamentals"],
          confidence: 0.9,
        },
        "I want to prepare probability and statistics for my exam",
      ),
    ).toMatchObject({
      title: "Probability & Statistics Exam Prep",
      difficulty: "hard",
      progressTarget: 10,
      progressUnit: "study sessions",
      rewardXp: 300,
      rewardStats: { Intelligence: 3, Discipline: 3, "Technical Skill": 2 },
      confidence: 0.9,
    });
  });

  it("replaces vague percent targets and fluffy exam steps with measurable work", () => {
    const draft = normalizeMainQuestDraft(
      {
        title: "Defeat the Engineering Fundamentals Final Exam",
        description: "Embark on a journey to conquer every exam topic.",
        difficulty: "hard",
        progress_target: 100,
        progress_unit: "percent",
        suggested_steps: [
          "Attend all lectures",
          "Form a study group",
          "Stay motivated",
        ],
        confidence: 0.8,
      },
      "I want to prepare for engineering fundamentals final exam",
    );

    expect(draft.progressTarget).toBe(12);
    expect(draft.progressUnit).toBe("study sessions");
    expect(draft.description).toBe(
      "Prepare through structured review, practice problems, mock exams, and weak-topic correction.",
    );
    expect(draft.suggestedSteps).toEqual([
      "Review all core lecture topics.",
      "Complete 50 practice problems.",
      "Complete 3 mock exams.",
      "Summarize weak topics after each session.",
      "Rework mistakes until they are understood.",
    ]);
  });

  it("calls OpenAI with a JSON-only Main Quest prompt and parses the draft", async () => {
    let requestBody = "";
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      requestBody = String(init?.body ?? "");
      return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: "Solo Tracker Deployment",
                description: "Finish and verify the Solo Tracker deployment.",
                difficulty: "boss",
                progress_target: 5,
                progress_unit: "deployment milestones",
                suggested_steps: ["Build Docker image", "Verify health checks"],
                confidence: 0.88,
              }),
            },
          },
        ],
      }),
    };
    });

    const result = await suggestMainQuestDraft({
      goal: "I want to finish Solo Tracker deployment",
      config: { enabled: true, apiKey: "test-key", model: "gpt-4o" },
      fetchImpl: fetchImpl as never,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
        }),
      }),
    );
    expect(requestBody).toContain("never use percent/percentage/100 percent");
    expect(requestBody).toContain("Do not mark progress, complete quests, award XP");
    expect(result).toEqual({
      ok: true,
      draft: expect.objectContaining({
        title: "Solo Tracker Deployment",
        difficulty: "boss",
        rewardXp: 750,
        progressTarget: 5,
      }),
    });
  });
});
