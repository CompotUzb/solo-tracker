import { randomUUID } from "node:crypto";
import type { Db } from "./db.js";

// System notifications. Every notification is stored locally (so the dashboard can show
// history) and, when a system-output channel is configured, delivered to Discord. When no
// channel is configured the app stays healthy in dashboard-only mode.

export const NOTIFICATION_TYPES = [
  "level_up",
  "achievement",
  "penalty",
  "daily_summary",
  "weekly_summary",
  "system",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type NotificationDiscordStatus =
  "skipped" | "pending" | "sent" | "failed";

export interface NotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface NotificationRecord {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string | null;
  metadata: Record<string, unknown> | null;
  discordStatus: NotificationDiscordStatus;
  discordMessageId: string | null;
  createdAt: string;
}

interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  metadata_json: string | null;
  discord_status: string;
  discord_message_id: string | null;
  created_at: string;
}

function mapNotification(row: NotificationRow): NotificationRecord {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type as NotificationType,
    title: row.title,
    body: row.body,
    metadata: row.metadata_json
      ? (JSON.parse(row.metadata_json) as Record<string, unknown>)
      : null,
    discordStatus: row.discord_status as NotificationDiscordStatus,
    discordMessageId: row.discord_message_id,
    createdAt: row.created_at,
  };
}

/** Persist a notification. Used directly in tests and by the notifier. */
export function recordNotification(
  db: Db,
  input: NotificationInput,
  discordStatus: NotificationDiscordStatus,
  clock: { now?: () => string; genId?: () => string } = {},
): NotificationRecord {
  const now = clock.now?.() ?? new Date().toISOString();
  const id = (clock.genId ?? randomUUID)();
  db.prepare(
    `insert into notifications (id,user_id,type,title,body,metadata_json,discord_status,discord_message_id,created_at)
     values (?,?,?,?,?,?,?,null,?)`,
  ).run(
    id,
    input.userId,
    input.type,
    input.title,
    input.body ?? null,
    input.metadata == null ? null : JSON.stringify(input.metadata),
    discordStatus,
    now,
  );
  return mapNotification(
    db
      .prepare("select * from notifications where id=?")
      .get(id) as NotificationRow,
  );
}

export function listNotifications(
  db: Db,
  userId: string,
  limit = 20,
): NotificationRecord[] {
  const rows = db
    .prepare(
      "select * from notifications where user_id=? order by created_at desc limit ?",
    )
    .all(userId, Math.min(Math.max(limit, 1), 200)) as NotificationRow[];
  return rows.map(mapNotification);
}

export function countNotifications(db: Db, userId: string): number {
  const row = db
    .prepare("select count(*) as count from notifications where user_id=?")
    .get(userId) as { count: number };
  return row.count;
}

function updateDelivery(
  db: Db,
  id: string,
  status: NotificationDiscordStatus,
  discordMessageId: string | null,
): void {
  db.prepare(
    "update notifications set discord_status=?, discord_message_id=? where id=?",
  ).run(status, discordMessageId, id);
}

/** Render a notification into the single-line Discord message posted to #system-output. */
export function formatNotificationMessage(input: NotificationInput): string {
  const icons: Record<NotificationType, string> = {
    level_up: "⬆️",
    achievement: "🏆",
    penalty: "⚠️",
    daily_summary: "📅",
    weekly_summary: "📜",
    system: "🔔",
  };
  const heading = `${icons[input.type]} **${input.title}**`;
  return input.body ? `${heading}\n${input.body}` : heading;
}

export type NotificationSender = (
  message: string,
  input: NotificationInput,
) => Promise<string | null>;

export interface Notifier {
  notify(input: NotificationInput): NotificationRecord;
  deliveryEnabled: boolean;
}

export interface NotifierOptions {
  db: Db;
  /** When provided, notifications are delivered to Discord in the background. */
  send?: NotificationSender | null;
  /** Invoked with each stored notification (e.g. to broadcast over SSE). */
  onStored?: (record: NotificationRecord) => void;
  /** Background-delivery error reporter. */
  onError?: (error: unknown, record: NotificationRecord) => void;
}

/**
 * Build a notifier. `notify` stores synchronously and returns immediately; Discord
 * delivery (if enabled) runs in the background and updates the row's status, so API
 * requests are never blocked on Discord latency.
 */
export function createNotifier(options: NotifierOptions): Notifier {
  const { db, send } = options;
  const deliveryEnabled = Boolean(send);

  return {
    deliveryEnabled,
    notify(input) {
      const record = recordNotification(
        db,
        input,
        deliveryEnabled ? "pending" : "skipped",
      );
      options.onStored?.(record);
      if (send) {
        void Promise.resolve()
          .then(() => send(formatNotificationMessage(input), input))
          .then((messageId) =>
            updateDelivery(db, record.id, "sent", messageId ?? null),
          )
          .catch((error) => {
            updateDelivery(db, record.id, "failed", null);
            options.onError?.(error, record);
          });
      }
      return record;
    },
  };
}
