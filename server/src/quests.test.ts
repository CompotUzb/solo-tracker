import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { applyMigrations, openDatabase, type Db } from "./db.js";
import {
  QUEST_XP_REWARDS,
  addQuest,
  archiveQuest,
  completeQuest,
  listMainQuests,
  listQuests,
  updateQuestProgress,
  xpRewardForType,
} from "./quests.js";
import { awardXp, getRankSnapshot } from "./xp.js";

let db: Db;
let counter: number;

// Deterministic id/clock so assertions don't depend on randomUUID/Date.now.
function clock(prefix = "id") {
  return {
    now: () => "2026-06-23T10:00:00.000Z",
    genId: () => `${prefix}-${counter++}`,
  };
}

beforeEach(() => {
  counter = 0;
  db = openDatabase(":memory:");
  applyMigrations(db);
});
afterEach(() => db.close());

const USER = "local-user";

describe("quest XP reward formula", () => {
  it("maps each difficulty tier to its fixed reward", () => {
    expect(xpRewardForType("easy")).toBe(10);
    expect(xpRewardForType("normal")).toBe(25);
    expect(xpRewardForType("hard")).toBe(300);
    expect(xpRewardForType("boss")).toBe(750);
    expect(xpRewardForType("raid")).toBe(1500);
  });

  it("exposes the canonical reward table from the parent spec", () => {
    expect(QUEST_XP_REWARDS).toEqual({
      easy: 10,
      normal: 25,
      hard: 300,
      boss: 750,
      raid: 1500,
    });
  });

  it("rejects unknown quest types", () => {
    expect(() => xpRewardForType("legendary")).toThrow(/unknown quest type/);
  });
});

describe("/quest add", () => {
  it("creates an active quest with the reward derived from its type", () => {
    const quest = addQuest(
      db,
      { userId: USER, title: "Ship the engine", questType: "hard" },
      clock(),
    );
    expect(quest).toMatchObject({
      userId: USER,
      title: "Ship the engine",
      questType: "hard",
      status: "active",
      xpReward: 300,
      targetCount: 1,
      progressCount: 0,
      completedAt: null,
    });
    expect(listQuests(db, USER, "active")).toHaveLength(1);
  });

  it("requires a non-empty title and a valid type", () => {
    expect(() =>
      addQuest(db, { userId: USER, title: "  ", questType: "easy" }),
    ).toThrow(/title is required/);
    expect(() =>
      addQuest(db, {
        userId: USER,
        title: "x",
        // @ts-expect-error invalid type on purpose
        questType: "mega",
      }),
    ).toThrow(/unknown quest type/);
  });

  it("rejects a non-positive target count", () => {
    expect(() =>
      addQuest(db, {
        userId: USER,
        title: "x",
        questType: "easy",
        targetCount: 0,
      }),
    ).toThrow(/positive integer/);
  });
});

describe("main quest MVP", () => {
  it("lists only active and recently completed hard/boss/raid quests", () => {
    addQuest(db, { userId: USER, title: "Daily", questType: "normal" }, clock());
    const main = addQuest(
      db,
      { userId: USER, title: "Major arc", questType: "boss" },
      clock(),
    );
    const done = addQuest(
      db,
      { userId: USER, title: "Cleared arc", questType: "hard" },
      clock(),
    );
    completeQuest(db, { questId: done.id, userId: USER }, clock());
    const archived = addQuest(
      db,
      { userId: USER, title: "Old arc", questType: "raid" },
      clock(),
    );
    archiveQuest(db, { questId: archived.id, userId: USER }, clock());

    expect(listMainQuests(db, USER).map((q) => q.id)).toEqual([
      main.id,
      done.id,
    ]);
  });

  it("updates main quest progress without completing it automatically", () => {
    const quest = addQuest(
      db,
      { userId: USER, title: "Seven day streak", questType: "boss", targetCount: 7 },
      clock(),
    );

    const updated = updateQuestProgress(
      db,
      { questId: quest.id, userId: USER, progressCount: 2 },
      clock(),
    );

    expect(updated.progressCount).toBe(2);
    expect(updated.status).toBe("active");
    expect(getQuestStatus(db, quest.id)).toBe("active");
  });

  it("archives a main quest without awarding XP", () => {
    const quest = addQuest(
      db,
      { userId: USER, title: "Paused raid", questType: "raid" },
      clock(),
    );

    const archived = archiveQuest(
      db,
      { questId: quest.id, userId: USER },
      clock(),
    );

    expect(archived.status).toBe("archived");
    expect(getRankSnapshot(db, USER).totalXp).toBe(0);
  });
});

describe("/quest complete", () => {
  it("awards XP, marks the quest done, and updates player stats", () => {
    const quest = addQuest(
      db,
      { userId: USER, title: "Defeat the boss", questType: "boss" },
      clock(),
    );
    const result = completeQuest(
      db,
      { questId: quest.id, userId: USER },
      clock(),
    );

    expect(result.alreadyCompleted).toBe(false);
    expect(result.award.xpAwarded).toBe(750);
    expect(result.quest.status).toBe("completed");
    expect(result.quest.completedAt).toBe("2026-06-23T10:00:00.000Z");
    expect(result.quest.progressCount).toBe(result.quest.targetCount);

    // 750 total XP -> level 4 (curve: L4 starts at 600, L5 at 1000).
    const stats = getRankSnapshot(db, USER);
    expect(stats.totalXp).toBe(750);
    expect(stats.level).toBe(4);
    expect(result.award.leveledUp).toBe(true);
    expect(result.award.levelsGained).toBe(3);
  });

  it("persists an auditable XP ledger row per completion", () => {
    const quest = addQuest(
      db,
      { userId: USER, title: "Daily grind", questType: "normal" },
      clock(),
    );
    completeQuest(db, { questId: quest.id, userId: USER }, clock());
    const ledger = db
      .prepare(
        "select user_id,source,source_id,reason,xp_delta from xp_awards where user_id=?",
      )
      .all(USER);
    expect(ledger).toEqual([
      {
        user_id: USER,
        source: "quest",
        source_id: quest.id,
        reason: "quest_completed",
        xp_delta: 25,
      },
    ]);
  });

  it("is idempotent: re-completing awards no extra XP", () => {
    const quest = addQuest(
      db,
      { userId: USER, title: "Once", questType: "raid" },
      clock(),
    );
    const first = completeQuest(
      db,
      { questId: quest.id, userId: USER },
      clock(),
    );
    const second = completeQuest(
      db,
      { questId: quest.id, userId: USER },
      clock(),
    );

    expect(first.award.xpAwarded).toBe(1500);
    expect(second.alreadyCompleted).toBe(true);
    expect(second.award.xpAwarded).toBe(0);
    expect(getRankSnapshot(db, USER).totalXp).toBe(1500);
    expect(db.prepare("select count(*) as n from xp_awards").get()).toEqual({
      n: 1,
    });
  });

  it("accumulates XP across quests and advances level", () => {
    // raid(1500) -> total 1500 -> level 6 (>=1500), rank E (levels 1–17).
    const raid = addQuest(
      db,
      { userId: USER, title: "Raid", questType: "raid" },
      clock(),
    );
    const result = completeQuest(
      db,
      { questId: raid.id, userId: USER },
      clock(),
    );
    expect(result.award.current.level).toBe(6);
    expect(result.award.current.rankCode).toBe("e");
    expect(result.award.rankChanged).toBe(false);
    expect(result.award.levelsGained).toBe(5);

    // + boss(750) -> total 2250 -> level 7.
    const boss = addQuest(
      db,
      { userId: USER, title: "Boss", questType: "boss" },
      clock(),
    );
    const after = completeQuest(
      db,
      { questId: boss.id, userId: USER },
      clock(),
    );
    expect(after.award.current.totalXp).toBe(2250);
    expect(after.award.current.level).toBe(7);
    expect(after.award.leveledUp).toBe(true);
  });

  it("rejects completing a missing quest or another user's quest", () => {
    const quest = addQuest(
      db,
      { userId: USER, title: "Mine", questType: "easy" },
      clock(),
    );
    expect(() => completeQuest(db, { questId: "nope", userId: USER })).toThrow(
      /quest not found/,
    );
    expect(() =>
      completeQuest(db, { questId: quest.id, userId: "intruder" }),
    ).toThrow(/does not belong/);
    // The failed attempts must not have mutated state.
    expect(getQuestStatus(db, quest.id)).toBe("active");
  });
});

describe("XP engine level curve", () => {
  it("maps cumulative XP to the shared level boundaries", () => {
    const cases: [number, number][] = [
      [0, 1],
      [99, 1],
      [100, 2],
      [300, 3],
      [600, 4],
      [1000, 5],
    ];
    for (const [xp, level] of cases) {
      counter = 0;
      const fresh = openDatabase(":memory:");
      applyMigrations(fresh);
      const r = awardXp(
        fresh,
        { userId: USER, amount: xp, reason: "seed", source: "test" },
        clock(),
      );
      expect(r.current.level, `xp=${xp}`).toBe(level);
      fresh.close();
    }
  });

  it("floors total XP at zero on a deduction and never records a level-up for it", () => {
    awardXp(
      db,
      { userId: USER, amount: 50, reason: "grant", source: "test" },
      clock(),
    );
    const r = awardXp(
      db,
      { userId: USER, amount: -200, reason: "penalty", source: "test" },
      clock(),
    );
    expect(r.xpAwarded).toBe(-50);
    expect(r.current.totalXp).toBe(0);
    expect(r.leveledUp).toBe(false);
    expect(getRankSnapshot(db, USER).totalXp).toBe(0);
  });

  it("rejects non-integer amounts", () => {
    expect(() =>
      awardXp(db, { userId: USER, amount: 1.5, reason: "x", source: "test" }),
    ).toThrow(/integer/);
  });
});

function getQuestStatus(database: Db, id: string): string {
  return (
    database.prepare("select status from quests where id=?").get(id) as {
      status: string;
    }
  ).status;
}
