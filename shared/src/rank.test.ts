import { describe, expect, it } from "vitest";
import {
  computeRankState,
  computeStatLevel,
  rankForLevel,
  xpRequiredForLevel,
} from "./index.js";
describe("stat level rules", () => {
  it("levels each attribute on a gentle cumulative curve", () => {
    expect(computeStatLevel(0).level).toBe(1);
    expect(computeStatLevel(4).level).toBe(1);
    expect(computeStatLevel(5).level).toBe(2);
    expect(computeStatLevel(14).level).toBe(2);
    expect(computeStatLevel(15).level).toBe(3);
    expect(computeStatLevel(30).level).toBe(4);
  });
  it("reports progress toward the next attribute level", () => {
    const s = computeStatLevel(8);
    expect(s.level).toBe(2);
    expect(s.pointsIntoLevel).toBe(3);
    expect(s.pointsForNextLevel).toBe(10);
  });
  it("floors negative or non-finite values at level 1", () => {
    expect(computeStatLevel(-3).level).toBe(1);
    expect(computeStatLevel(Number.NaN).level).toBe(1);
  });
});
describe("rank rules", () => {
  it("maps total XP to level boundaries", () => {
    expect(computeRankState(0).level).toBe(1);
    expect(computeRankState(99).level).toBe(1);
    expect(computeRankState(100).level).toBe(2);
    expect(computeRankState(300).level).toBe(3);
    expect(computeRankState(600).level).toBe(4);
  });
  it("computes progress to next level", () => {
    const s = computeRankState(340);
    expect(s.level).toBe(3);
    expect(s.rankCode).toBe("e");
    expect(s.xpIntoLevel).toBe(40);
    expect(s.xpForNextLevel).toBe(300);
  });
  it("uses closed form XP requirement", () => {
    expect(xpRequiredForLevel(1)).toBe(0);
    expect(xpRequiredForLevel(4)).toBe(600);
  });
  it("maps levels to Hunter ranks E through Monarch", () => {
    expect(rankForLevel(1)).toMatchObject({
      rankCode: "e",
      rankName: "E-Rank",
    });
    expect(rankForLevel(17).rankCode).toBe("e");
    expect(rankForLevel(18).rankCode).toBe("d");
    expect(rankForLevel(26).rankCode).toBe("c");
    expect(rankForLevel(40).rankCode).toBe("b");
    expect(rankForLevel(51).rankCode).toBe("a");
    expect(rankForLevel(76).rankCode).toBe("s");
    expect(rankForLevel(96)).toMatchObject({
      rankCode: "national",
      rankName: "National-Level",
    });
    expect(rankForLevel(120)).toMatchObject({
      rankCode: "monarch",
      rankName: "Monarch",
    });
  });
});
