import { describe, expect, it } from "vitest";
import { applyMigrations, openDatabase, storeRawMessage } from "./db.js";

describe("raw Discord message persistence", () => {
  it("stores message id, channel id, author id, content, and timestamp", () => {
    const db = openDatabase(":memory:");
    try {
      applyMigrations(db);

      const inserted = storeRawMessage(db, {
        messageId: "msg-1",
        guildId: "guild-1",
        channelId: "channel-1",
        parentChannelId: null,
        authorId: "user-1",
        content: "worked 45m on Discord tracker",
        messageTimestamp: "2026-06-23T06:00:00.000Z",
        receivedAt: "2026-06-23T06:00:01.000Z",
        metadata: { attachmentCount: 0 },
      });

      expect(inserted).toBe(true);
      const row = db
        .prepare("select * from raw_messages where message_id=?")
        .get("msg-1") as Record<string, unknown>;
      expect(row).toMatchObject({
        message_id: "msg-1",
        guild_id: "guild-1",
        channel_id: "channel-1",
        author_id: "user-1",
        content: "worked 45m on Discord tracker",
        message_timestamp: "2026-06-23T06:00:00.000Z",
      });
      expect(JSON.parse(row.metadata_json as string)).toEqual({
        attachmentCount: 0,
      });
    } finally {
      db.close();
    }
  });

  it("stores thread id and title for messages in a thread", () => {
    const db = openDatabase(":memory:");
    try {
      applyMigrations(db);
      storeRawMessage(db, {
        messageId: "msg-thread",
        guildId: "guild-1",
        channelId: "thread-9",
        parentChannelId: "mind-training",
        threadId: "thread-9",
        threadTitle: "Deep work log",
        authorId: "user-1",
        content: "",
        messageTimestamp: "2026-06-23T06:00:00.000Z",
      });
      const row = db
        .prepare(
          "select thread_id, thread_title, parent_channel_id from raw_messages where message_id=?",
        )
        .get("msg-thread");
      expect(row).toEqual({
        thread_id: "thread-9",
        thread_title: "Deep work log",
        parent_channel_id: "mind-training",
      });
    } finally {
      db.close();
    }
  });

  it("does not duplicate rows for duplicate message ids", () => {
    const db = openDatabase(":memory:");
    try {
      applyMigrations(db);
      const message = {
        messageId: "msg-dup",
        guildId: "guild-1",
        channelId: "channel-1",
        parentChannelId: null,
        authorId: "user-1",
        content: "first version",
        messageTimestamp: "2026-06-23T06:00:00.000Z",
        receivedAt: "2026-06-23T06:00:01.000Z",
        metadata: null,
      };

      expect(storeRawMessage(db, message)).toBe(true);
      expect(
        storeRawMessage(db, { ...message, content: "duplicate version" }),
      ).toBe(false);

      const rows = db
        .prepare("select content from raw_messages where message_id=?")
        .all("msg-dup");
      expect(rows).toEqual([{ content: "first version" }]);
    } finally {
      db.close();
    }
  });
});
