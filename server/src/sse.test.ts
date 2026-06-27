import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { createApi } from "./api.js";
import { openDatabase, type Db } from "./db.js";

let db: Db | undefined;
afterEach(() => db?.close());

function makeApi() {
  const config = loadConfig({
    DISCORD_TOKEN: "fake",
    DISCORD_CLIENT_ID: "client",
    TRACKED_GUILD_ID: "guild",
    TRACKED_CHANNEL_IDS: "chan-1",
    DATABASE_PATH: ":memory:",
    SKIP_DISCORD_LOGIN: "true",
  });
  db = openDatabase(":memory:");
  return createApi({ config, discordStatus: () => "skipped", db });
}

async function readUntil(
  stream: ReadableStream<Uint8Array>,
  needle: string,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes(needle)) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  await reader.cancel();
  return text;
}

describe("SSE live update stream", () => {
  it("opens as an event-stream with reconnect hints and receives manual broadcasts", async () => {
    const api = makeApi();
    await api.app.listen({ host: "127.0.0.1", port: 0 });
    const address = api.app.server.address();
    if (!address || typeof address === "string")
      throw new Error("missing test server address");

    const res = await fetch(
      `http://127.0.0.1:${address.port}/api/events/stream`,
    );
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    api.broadcast("stats.updated", { reason: "test" });
    const text = await readUntil(res.body!, "event: stats.updated");
    expect(text).toContain("retry: 2000");
    expect(text).toContain("event: connected");
    expect(text).toContain('data: {"reason":"test"}');
    await api.close();
  });

  it("broadcasts quest creation, completion, and XP events to connected dashboards", async () => {
    const api = makeApi();
    await api.app.listen({ host: "127.0.0.1", port: 0 });
    const address = api.app.server.address();
    if (!address || typeof address === "string")
      throw new Error("missing test server address");

    const res = await fetch(
      `http://127.0.0.1:${address.port}/api/events/stream`,
    );
    await api.app.inject({
      method: "POST",
      url: "/api/quests",
      payload: { title: "Live quest", questType: "easy" },
    });
    const addText = await readUntil(res.body!, "event: quest.updated");
    expect(addText).toContain('"action":"created"');

    const quest = (
      await api.app.inject({ method: "GET", url: "/api/quests" })
    ).json().quests[0];
    const res2 = await fetch(
      `http://127.0.0.1:${address.port}/api/events/stream`,
    );
    await api.app.inject({
      method: "POST",
      url: `/api/quests/${quest.id}/complete`,
      payload: {},
    });
    const completeText = await readUntil(res2.body!, "event: xp");
    expect(completeText).toContain("event: quest.updated");
    expect(completeText).toContain('"action":"completed"');
    expect(completeText).toContain("event: xp");
    expect(completeText).toContain('"xpAwarded":10');
    await api.close();
  });
});
