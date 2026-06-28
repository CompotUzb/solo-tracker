import { describe, expect, it } from "vitest";
import { applyMigrations, openDatabase, type Db } from "./db.js";
import {
  applyStatGains,
  awardMessageStats,
  getPlayerStats,
  messageStatGains,
  questStatGains,
  MAX_MESSAGE_STAT_GAINS_PER_CATEGORY_PER_DAY,
  PLAYER_STAT_KEYS,
} from "./stats.js";

const USER = "local-user";

function freshDb(): Db {
  const db = openDatabase(":memory:");
  applyMigrations(db);
  return db;
}

function counter() {
  let n = 0;
  return () => `id-${n++}`;
}

describe("message stat gains", () => {
  it("grants the channel primary stat for a meaningful log", () => {
    expect(messageStatGains("body-training", 20)).toEqual([
      { statKey: "strength", delta: 1 },
    ]);
    expect(messageStatGains("work-skill", 20)).toEqual([
      { statKey: "technical", delta: 1 },
    ]);
  });

  it("ignores too-short logs", () => {
    expect(messageStatGains("daily-quests", 1)).toEqual([]);
  });

  it("adds a secondary stat only when content keywords match", () => {
    const withContent = messageStatGains(
      "work-skill",
      40,
      "shipped client invoice and wrote the report",
    );
    expect(withContent).toContainEqual({ statKey: "technical", delta: 1 });
    expect(withContent).toContainEqual({ statKey: "wealth", delta: 1 });
    expect(withContent).toContainEqual({ statKey: "communication", delta: 1 });

    // No content (privacy mode) -> primary only.
    expect(messageStatGains("work-skill", 40)).toEqual([
      { statKey: "technical", delta: 1 },
    ]);
  });
});

describe("quest stat gains", () => {
  it("uses deterministic main quest rewards for hard/boss/raid arcs", () => {
    expect(questStatGains("normal")).toEqual([
      { statKey: "discipline", delta: 2 },
    ]);
    expect(questStatGains("hard")).toEqual([
      { statKey: "discipline", delta: 3 },
      { statKey: "technical", delta: 3 },
    ]);
    expect(questStatGains("boss")).toEqual([
      { statKey: "discipline", delta: 5 },
      { statKey: "technical", delta: 7 },
    ]);
    expect(questStatGains("raid")).toEqual([
      { statKey: "discipline", delta: 10 },
      { statKey: "technical", delta: 15 },
      { statKey: "survival", delta: 5 },
    ]);
  });
});

describe("applyStatGains", () => {
  it("materializes values and writes an audit ledger row", () => {
    const db = freshDb();
    try {
      const clock = { now: () => "2026-06-23T10:00:00.000Z", genId: counter() };
      const result = applyStatGains(
        db,
        {
          userId: USER,
          gains: [{ statKey: "strength", delta: 1 }],
          reason: "message:body-training",
          source: "discord",
        },
        clock,
      );
      expect(result.changed).toEqual([{ statKey: "strength", from: 0, to: 1 }]);

      const stats = getPlayerStats(db, USER);
      expect(stats.stats).toHaveLength(PLAYER_STAT_KEYS.length);
      expect(stats.stats.find((s) => s.key === "strength")?.value).toBe(1);

      const ledger = db
        .prepare("select count(*) as n from stat_awards where user_id=?")
        .get(USER) as { n: number };
      expect(ledger.n).toBe(1);
    } finally {
      db.close();
    }
  });

  it("floors stat values at zero", () => {
    const db = freshDb();
    try {
      applyStatGains(db, {
        userId: USER,
        gains: [{ statKey: "health", delta: -5 }],
        reason: "penalty",
        source: "manual",
      });
      expect(
        getPlayerStats(db, USER).stats.find((s) => s.key === "health")?.value,
      ).toBe(0);
    } finally {
      db.close();
    }
  });
});

describe("awardMessageStats daily cap", () => {
  it("stops awarding once the per-category daily cap is reached", () => {
    const db = freshDb();
    try {
      const clock = { now: () => "2026-06-23T10:00:00.000Z", genId: counter() };
      let awarded = 0;
      for (
        let i = 0;
        i < MAX_MESSAGE_STAT_GAINS_PER_CATEGORY_PER_DAY + 3;
        i++
      ) {
        const result = awardMessageStats(
          db,
          {
            userId: USER,
            category: "mind-training",
            contentLength: 30,
            localDate: "2026-06-23",
            sourceId: `m-${i}`,
          },
          clock,
        );
        if (result) awarded++;
      }
      expect(awarded).toBe(MAX_MESSAGE_STAT_GAINS_PER_CATEGORY_PER_DAY);
      expect(
        getPlayerStats(db, USER).stats.find((s) => s.key === "intelligence")
          ?.value,
      ).toBe(MAX_MESSAGE_STAT_GAINS_PER_CATEGORY_PER_DAY);
    } finally {
      db.close();
    }
  });
});
