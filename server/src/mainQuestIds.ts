import type { Db } from "./db.js";
import type { Quest } from "./quests.js";

interface MainQuestIdRow {
  id: string;
}

function mainQuestIdRows(db: Db, userId: string): MainQuestIdRow[] {
  return db
    .prepare(
      `select id from quests
       where user_id=?
         and quest_type in ('hard','boss','raid')
       order by created_at asc, rowid asc`,
    )
    .all(userId) as MainQuestIdRow[];
}

export interface QuestWithDisplayId extends Quest {
  displayId: string;
}

export function mainQuestDisplayId(
  db: Db,
  userId: string,
  questId: string,
): string {
  const index = mainQuestIdRows(db, userId).findIndex((row) => row.id === questId);
  return index === -1 ? questId : `MQ-${index + 1}`;
}

export function withMainQuestDisplayIds(
  db: Db,
  userId: string,
  quests: Quest[],
): QuestWithDisplayId[] {
  const displayIds = new Map(
    mainQuestIdRows(db, userId).map((row, index) => [row.id, `MQ-${index + 1}`]),
  );
  return quests.map((quest) => ({
    ...quest,
    displayId: displayIds.get(quest.id) ?? quest.id,
  }));
}

export function resolveMainQuestId(
  db: Db,
  userId: string,
  input: string,
): string {
  const trimmed = input.trim();
  const match = trimmed.match(/^(?:MQ-)?(\d+)$/i);
  if (!match) return trimmed;
  const index = Number(match[1]) - 1;
  const row = mainQuestIdRows(db, userId)[index];
  return row?.id ?? trimmed;
}
