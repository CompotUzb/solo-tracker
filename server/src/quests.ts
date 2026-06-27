import { randomUUID } from "node:crypto";
import type { Db } from "./db.js";
import {
  awardXp,
  getRankSnapshot,
  type AwardXpResult,
  type RankSnapshot,
  type XpClock,
} from "./xp.js";

// Quest difficulty tiers and their fixed XP rewards (parent XP spec).
export const QUEST_XP_REWARDS = {
  easy: 10,
  normal: 25,
  hard: 60,
  boss: 150,
  raid: 400,
} as const;

export type QuestType = keyof typeof QUEST_XP_REWARDS;
export const QUEST_TYPES = Object.keys(QUEST_XP_REWARDS) as QuestType[];

export type QuestStatus = "active" | "completed" | "abandoned";

export interface Quest {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  questType: QuestType;
  status: QuestStatus;
  targetCount: number;
  progressCount: number;
  xpReward: number;
  startsAt: string | null;
  dueAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AddQuestInput {
  userId: string;
  title: string;
  questType: QuestType;
  description?: string | null;
  targetCount?: number;
  startsAt?: string | null;
  dueAt?: string | null;
}

export interface CompleteQuestResult {
  quest: Quest;
  award: AwardXpResult;
  alreadyCompleted: boolean;
}

interface QuestRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  quest_type: string;
  status: string;
  target_count: number;
  progress_count: number;
  xp_reward: number;
  starts_at: string | null;
  due_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

function isQuestType(value: string): value is QuestType {
  return Object.prototype.hasOwnProperty.call(QUEST_XP_REWARDS, value);
}

/** XP awarded for completing a quest of the given difficulty tier. */
export function xpRewardForType(questType: string): number {
  if (!isQuestType(questType)) {
    throw new Error(
      `unknown quest type: ${questType}. Expected one of ${QUEST_TYPES.join(", ")}`,
    );
  }
  return QUEST_XP_REWARDS[questType];
}

function mapQuest(row: QuestRow): Quest {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    description: row.description,
    questType: isQuestType(row.quest_type) ? row.quest_type : "normal",
    status: row.status as QuestStatus,
    targetCount: row.target_count,
    progressCount: row.progress_count,
    xpReward: row.xp_reward,
    startsAt: row.starts_at,
    dueAt: row.due_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getQuest(db: Db, questId: string): Quest | undefined {
  const row = db.prepare("select * from quests where id=?").get(questId) as
    QuestRow | undefined;
  return row ? mapQuest(row) : undefined;
}

export function listQuests(
  db: Db,
  userId: string,
  status?: QuestStatus,
): Quest[] {
  const rows = (
    status
      ? db
          .prepare(
            "select * from quests where user_id=? and status=? order by created_at desc",
          )
          .all(userId, status)
      : db
          .prepare(
            "select * from quests where user_id=? order by created_at desc",
          )
          .all(userId)
  ) as QuestRow[];
  return rows.map(mapQuest);
}

/** `/quest add` — create an active quest, deriving its XP reward from the difficulty tier. */
export function addQuest(
  db: Db,
  input: AddQuestInput,
  clock: XpClock = {},
): Quest {
  const title = input.title?.trim();
  if (!title) throw new Error("quest title is required");
  const xpReward = xpRewardForType(input.questType);
  const targetCount = input.targetCount ?? 1;
  if (!Number.isInteger(targetCount) || targetCount < 1)
    throw new Error("targetCount must be a positive integer");

  const now = clock.now?.() ?? new Date().toISOString();
  const id = (clock.genId ?? randomUUID)();

  db.prepare(
    `insert into quests
      (id,user_id,title,description,quest_type,status,target_count,progress_count,xp_reward,starts_at,due_at,completed_at,created_at,updated_at)
     values (?,?,?,?,?,'active',?,0,?,?,?,null,?,?)`,
  ).run(
    id,
    input.userId,
    title,
    input.description ?? null,
    input.questType,
    targetCount,
    xpReward,
    input.startsAt ?? null,
    input.dueAt ?? null,
    now,
    now,
  );

  return getQuest(db, id)!;
}

/**
 * `/quest complete` — mark a quest completed and award its XP through the engine.
 * Idempotent: completing an already-completed quest awards no further XP.
 */
export function completeQuest(
  db: Db,
  params: { questId: string; userId: string },
  clock: XpClock = {},
): CompleteQuestResult {
  const now = clock.now?.() ?? new Date().toISOString();

  const run = db.transaction((): CompleteQuestResult => {
    const row = db
      .prepare("select * from quests where id=?")
      .get(params.questId) as QuestRow | undefined;
    if (!row) throw new Error(`quest not found: ${params.questId}`);
    if (row.user_id !== params.userId)
      throw new Error("quest does not belong to this user");

    if (row.status === "completed") {
      const snapshot = getRankSnapshot(db, params.userId);
      return {
        quest: mapQuest(row),
        award: noOpAward(params.userId, snapshot),
        alreadyCompleted: true,
      };
    }

    db.prepare(
      `update quests set status='completed',progress_count=target_count,completed_at=?,updated_at=? where id=?`,
    ).run(now, now, params.questId);

    const awardClock: XpClock = clock.genId
      ? { now: () => now, genId: clock.genId }
      : { now: () => now };
    const award = awardXp(
      db,
      {
        userId: params.userId,
        amount: row.xp_reward,
        reason: "quest_completed",
        source: "quest",
        sourceId: params.questId,
      },
      awardClock,
    );

    return {
      quest: getQuest(db, params.questId)!,
      award,
      alreadyCompleted: false,
    };
  });

  return run();
}

function noOpAward(userId: string, snapshot: RankSnapshot): AwardXpResult {
  return {
    userId,
    xpAwarded: 0,
    previous: snapshot,
    current: snapshot,
    leveledUp: false,
    levelsGained: 0,
    rankChanged: false,
  };
}
