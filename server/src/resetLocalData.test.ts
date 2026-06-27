import { beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, openDatabase, seedDatabase, type Db } from "./db.js";
import { resetLocalData } from "./resetLocalData.js";

let db: Db;

beforeEach(() => {
  db = openDatabase(":memory:");
  applyMigrations(db);
  seedDatabase(
    db,
    { trackedGuildId: "guild-1", trackedChannelIds: ["daily-channel"] },
    "test",
  );
});

describe("resetLocalData", () => {
  it("clears progression data while preserving config rows and schema", () => {
    db.prepare(
      `insert into quests
        (id,user_id,title,quest_type,status,target_count,progress_count,xp_reward,created_at,updated_at)
       values ('quest-1','local-user','Defeat the gate boss','boss','active',1,0,150,'now','now')`,
    ).run();
    db.prepare(
      `insert into notifications
        (id,user_id,type,title,discord_status,created_at)
       values ('notice-1','local-user','system','Demo','skipped','now')`,
    ).run();

    resetLocalData(db);

    expect(db.prepare("select count(*) as n from quests").get()).toEqual({
      n: 0,
    });
    expect(db.prepare("select count(*) as n from notifications").get()).toEqual(
      { n: 0 },
    );
    expect(db.prepare("select count(*) as n from users").get()).toEqual({
      n: 1,
    });
    expect(
      db.prepare("select count(*) as n from tracked_channels").get(),
    ).toEqual({ n: 1 });
    expect(
      db
        .prepare(
          "select count(*) as n from sqlite_master where type='table' and name='daily_quest_days'",
        )
        .get(),
    ).toEqual({ n: 1 });
  });
});
