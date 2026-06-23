import { describe, expect, it } from "vitest";
import { isMessageInTrackedBoundary } from "./boundary.js";
const config = {
  trackedGuildId: "guild-1",
  trackedChannelIds: ["channel-1", "forum-parent"],
};
const base = {
  guildId: "guild-1",
  channelId: "channel-1",
  author: { id: "user-1", bot: false, system: false },
};
describe("Discord boundary filter", () => {
  it("ignores wrong guild", () => {
    expect(
      isMessageInTrackedBoundary({ ...base, guildId: "guild-2" }, config),
    ).toBe(false);
  });
  it("ignores untracked channel", () => {
    expect(
      isMessageInTrackedBoundary({ ...base, channelId: "random" }, config),
    ).toBe(false);
  });
  it("accepts configured parent thread", () => {
    expect(
      isMessageInTrackedBoundary(
        { ...base, channelId: "thread-1", parentChannelId: "forum-parent" },
        config,
      ),
    ).toBe(true);
  });
  it("ignores bot and webhook authors", () => {
    expect(
      isMessageInTrackedBoundary(
        { ...base, author: { id: "bot-1", bot: true } },
        config,
      ),
    ).toBe(false);
    expect(
      isMessageInTrackedBoundary({ ...base, webhookId: "webhook-1" }, config),
    ).toBe(false);
  });
});
