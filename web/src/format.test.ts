import { describe, expect, it } from "vitest";
import {
  dashboardNotifications,
  mainQuestObjective,
  mainQuestProgressUnit,
  mainQuestRewardSummary,
  ratioPercent,
  relativeTime,
  splitQuests,
  weekdayLabel,
  xpProgressPercent,
} from "./format.js";
import type { Notification, Quest } from "./types.js";

function quest(partial: Partial<Quest>): Quest {
  return {
    id: "q",
    userId: "local-user",
    title: "Quest",
    description: null,
    questType: "normal",
    status: "active",
    targetCount: 1,
    progressCount: 0,
    xpReward: 25,
    startsAt: null,
    dueAt: null,
    completedAt: null,
    createdAt: "2026-06-23T00:00:00.000Z",
    updatedAt: "2026-06-23T00:00:00.000Z",
    ...partial,
  };
}

function notification(
  partial: Partial<Notification> & Pick<Notification, "id" | "title">,
): Notification {
  return {
    userId: "local-user",
    type: "system",
    body: null,
    metadata: null,
    discordStatus: "skipped",
    discordMessageId: null,
    createdAt: "2026-06-23T00:00:00.000Z",
    ...partial,
  };
}

describe("splitQuests", () => {
  it("routes light tiers to daily and heavy tiers to main, excluding non-active", () => {
    const quests = [
      quest({ id: "1", questType: "easy" }),
      quest({ id: "2", questType: "normal" }),
      quest({ id: "3", questType: "hard" }),
      quest({ id: "4", questType: "boss" }),
      quest({ id: "5", questType: "raid" }),
      quest({ id: "6", questType: "easy", status: "completed" }),
    ];
    const { daily, main } = splitQuests(quests);
    expect(daily.map((q) => q.id)).toEqual(["1", "2"]);
    expect(main.map((q) => q.id)).toEqual(["3", "4", "5"]);
  });
});

describe("mainQuestRewardSummary", () => {
  it("renders deterministic MVP main quest rewards", () => {
    expect(mainQuestRewardSummary(quest({ questType: "boss", xpReward: 750 }))).toBe(
      "+750 XP · Technical +7 · Discipline +5",
    );
    expect(mainQuestRewardSummary(quest({ questType: "raid", xpReward: 1500 }))).toBe(
      "+1500 XP · Technical +15 · Discipline +10 · Survival +5",
    );
  });
});

describe("dashboardNotifications", () => {
  it("shows at most twenty notifications newest first", () => {
    const notes = Array.from({ length: 25 }, (_, index) =>
      notification({
        id: `n-${index}`,
        title: `System event ${index}`,
        createdAt: `2026-06-23T00:${String(index).padStart(2, "0")}:00.000Z`,
      }),
    );

    expect(dashboardNotifications(notes).map((n) => n.id)).toEqual(
      Array.from({ length: 20 }, (_, index) => `n-${24 - index}`),
    );
  });

  it("keeps newer generated notifications ahead of older important ones", () => {
    const notes = [
      notification({
        id: "generated-new",
        title: "Daily Quest generated",
        createdAt: "2026-06-23T00:10:00.000Z",
      }),
      notification({
        id: "complete",
        title: "Daily Quest complete",
        createdAt: "2026-06-23T00:09:00.000Z",
      }),
      notification({
        id: "main",
        title: "🏰 Main Quest Cleared",
        createdAt: "2026-06-23T00:08:00.000Z",
      }),
      notification({
        id: "level",
        type: "level_up",
        title: "Level 2 reached",
        createdAt: "2026-06-23T00:07:00.000Z",
      }),
      notification({
        id: "achievement",
        type: "achievement",
        title: "Achievement unlocked: First Quest",
        createdAt: "2026-06-23T00:06:00.000Z",
      }),
      notification({
        id: "penalty",
        type: "penalty",
        title: "PENALTY ZONE ACTIVE",
        createdAt: "2026-06-23T00:05:00.000Z",
      }),
    ];

    expect(dashboardNotifications(notes).map((n) => n.id)).toEqual([
      "generated-new",
      "complete",
      "main",
      "level",
      "achievement",
      "penalty",
    ]);
  });
});

describe("compact Main Quest helpers", () => {
  it("extracts a compact objective and unit from old AI-style descriptions", () => {
    const q = quest({
      questType: "hard",
      description: [
        "Prepare for the final exam through structured review and practice problems that reveal weak topics before the exam date.",
        "Unit: study sessions",
        "",
        "Suggested steps:",
        "- Review core topics",
        "- Complete practice problems",
        "- Take mock exam",
        "- Rework mistakes",
      ].join("\n"),
    });

    expect(mainQuestObjective(q)).toBe(
      "Prepare for the final exam through structured review and practice problems that reveal weak topics before the exam date.",
    );
    expect(mainQuestProgressUnit(q)).toBe("study sessions");
  });

  it("truncates overly long objective text for dashboard cards", () => {
    const q = quest({
      description:
        "Prepare for the final exam through structured review, practice problems, mock exams, weak-topic correction, mistake review, repeated timed drills, and final summary notes before the deadline.",
    });

    expect(mainQuestObjective(q)).toHaveLength(160);
    expect(mainQuestObjective(q)?.endsWith("…")).toBe(true);
  });
});

describe("xpProgressPercent", () => {
  it("clamps and guards divide-by-zero", () => {
    expect(xpProgressPercent(50, 100)).toBe(50);
    expect(xpProgressPercent(200, 100)).toBe(100);
    expect(xpProgressPercent(10, 0)).toBe(0);
  });
});

describe("ratioPercent", () => {
  it("returns a clamped percentage", () => {
    expect(ratioPercent(4, 30)).toBeCloseTo(13.333, 2);
    expect(ratioPercent(5, 0)).toBe(0);
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-06-23T12:00:00.000Z").getTime();
  it("formats recent instants compactly", () => {
    expect(relativeTime("2026-06-23T11:59:30.000Z", now)).toBe("30s ago");
    expect(relativeTime("2026-06-23T11:30:00.000Z", now)).toBe("30m ago");
    expect(relativeTime("2026-06-23T09:00:00.000Z", now)).toBe("3h ago");
    expect(relativeTime("2026-06-20T12:00:00.000Z", now)).toBe("3d ago");
  });
  it("handles invalid input", () => {
    expect(relativeTime("not-a-date", now)).toBe("unknown");
  });
});

describe("weekdayLabel", () => {
  it("labels a local date with its weekday", () => {
    expect(weekdayLabel("2026-06-23")).toBe("Tue");
  });
});
