import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { createApi } from "./api.js";
import { openDatabase, type Db } from "./db.js";
let db: Db | undefined;
afterEach(() => db?.close());
describe("API", () => {
  it("returns health and privacy-safe boundaries", async () => {
    const config = loadConfig({
      DISCORD_TOKEN: "fake",
      DISCORD_CLIENT_ID: "client",
      TRACKED_GUILD_ID: "guild",
      TRACKED_CHANNEL_IDS: "chan-1,chan-2",
      DATABASE_PATH: ":memory:",
      SKIP_DISCORD_LOGIN: "true",
    });
    db = openDatabase(":memory:");
    const api = createApi({ config, discordStatus: () => "skipped", db });
    const health = await api.app.inject({ method: "GET", url: "/api/health" });
    expect(health.json()).toMatchObject({
      ok: true,
      db: "ok",
      discord: "skipped",
    });
    const boundaries = await api.app.inject({
      method: "GET",
      url: "/api/config/boundaries",
    });
    expect(boundaries.json()).toMatchObject({
      guildId: "guild",
      trackedChannelIds: ["chan-1", "chan-2"],
      storeMessageContent: false,
    });
    await api.close();
  });
});
