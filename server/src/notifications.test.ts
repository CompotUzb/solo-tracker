import { describe, expect, it, vi } from "vitest";
import { applyMigrations, openDatabase, type Db } from "./db.js";
import {
  countNotifications,
  createNotifier,
  listNotifications,
  recordNotification,
} from "./notifications.js";

function freshDb(): Db {
  const db = openDatabase(":memory:");
  applyMigrations(db);
  return db;
}

const base = {
  userId: "local-user",
  type: "level_up" as const,
  title: "Level 2 reached",
};

describe("notifications storage", () => {
  it("stores a notification and lists it back", () => {
    const db = freshDb();
    try {
      recordNotification(db, { ...base, body: "Nice work" }, "skipped");
      const list = listNotifications(db, "local-user");
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        type: "level_up",
        title: "Level 2 reached",
        body: "Nice work",
        discordStatus: "skipped",
      });
    } finally {
      db.close();
    }
  });

  it("counts the full notification history without limiting dashboard rows", () => {
    const db = freshDb();
    try {
      recordNotification(db, { ...base, title: "Level 2 reached" }, "skipped");
      recordNotification(db, { ...base, title: "Level 3 reached" }, "skipped");

      expect(listNotifications(db, "local-user", 1)).toHaveLength(1);
      expect(countNotifications(db, "local-user")).toBe(2);
    } finally {
      db.close();
    }
  });
});

describe("notifier", () => {
  it("stores as dashboard-only (skipped) when no sender is configured", () => {
    const db = freshDb();
    try {
      const notifier = createNotifier({ db });
      expect(notifier.deliveryEnabled).toBe(false);
      const record = notifier.notify(base);
      expect(record.discordStatus).toBe("skipped");
    } finally {
      db.close();
    }
  });

  it("delivers to Discord in the background and marks the row sent", async () => {
    const db = freshDb();
    try {
      const send = vi.fn().mockResolvedValue("discord-msg-1");
      const onStored = vi.fn();
      const notifier = createNotifier({ db, send, onStored });
      expect(notifier.deliveryEnabled).toBe(true);

      const record = notifier.notify(base);
      expect(record.discordStatus).toBe("pending"); // synchronous result before delivery
      expect(onStored).toHaveBeenCalledOnce();

      await vi.waitFor(() => {
        const updated = listNotifications(db, "local-user")[0];
        expect(updated.discordStatus).toBe("sent");
        expect(updated.discordMessageId).toBe("discord-msg-1");
      });
      expect(send).toHaveBeenCalledOnce();
    } finally {
      db.close();
    }
  });

  it("marks the row failed when delivery throws", async () => {
    const db = freshDb();
    try {
      const send = vi.fn().mockRejectedValue(new Error("discord down"));
      const onError = vi.fn();
      const notifier = createNotifier({ db, send, onError });
      notifier.notify(base);

      await vi.waitFor(() => {
        expect(listNotifications(db, "local-user")[0].discordStatus).toBe(
          "failed",
        );
      });
      expect(onError).toHaveBeenCalledOnce();
    } finally {
      db.close();
    }
  });
});
