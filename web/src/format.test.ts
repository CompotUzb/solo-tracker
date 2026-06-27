import { describe, expect, it } from "vitest";
import {
  ratioPercent,
  relativeTime,
  splitQuests,
  weekdayLabel,
  xpProgressPercent,
} from "./format.js";
import type { Quest } from "./types.js";

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
