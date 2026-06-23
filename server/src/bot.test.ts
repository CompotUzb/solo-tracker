import { describe, expect, it } from 'vitest';
import type { Message } from 'discord.js';
import { toMessageLike } from './bot.js';
import { isMessageInTrackedBoundary, type BoundaryConfig } from './boundary.js';

const boundary: BoundaryConfig = { trackedGuildId: 'guild-1', trackedChannelIds: ['channel-1', 'forum-parent'] };

// Build a structurally-minimal stand-in for a discord.js Message. We only touch the fields
// toMessageLike reads, so the unsafe cast keeps the test focused on the normalization contract.
function fakeMessage(overrides: {
  guildId?: string | null;
  channelId: string;
  channel: object;
  webhookId?: string | null;
  system?: boolean | null;
  author?: { id?: string | null; bot?: boolean | null; system?: boolean | null } | null;
}): Message {
  return {
    guildId: overrides.guildId ?? null,
    webhookId: overrides.webhookId ?? null,
    system: overrides.system ?? false,
    author: overrides.author ?? { id: 'user-1', bot: false, system: false },
    ...overrides,
  } as unknown as Message;
}

describe('bot message normalization', () => {
  it('tracks a human message in a configured guild channel', () => {
    const message = fakeMessage({ guildId: 'guild-1', channelId: 'channel-1', channel: { id: 'channel-1' } });
    expect(isMessageInTrackedBoundary(toMessageLike(message), boundary)).toBe(true);
  });

  it('resolves the parent of a thread for the whitelist check', () => {
    const message = fakeMessage({
      guildId: 'guild-1',
      channelId: 'thread-9',
      channel: { id: 'thread-9', parentId: 'forum-parent' },
    });
    expect(isMessageInTrackedBoundary(toMessageLike(message), boundary)).toBe(true);
  });

  it('ignores direct messages (no guild, DM channel has no parentId)', () => {
    const dm = fakeMessage({ guildId: null, channelId: 'dm-channel', channel: { id: 'dm-channel' } });
    const like = toMessageLike(dm);
    expect(like.guildId).toBeNull();
    expect(like.parentChannelId).toBeNull();
    expect(isMessageInTrackedBoundary(like, boundary)).toBe(false);
  });

  it('ignores configured-guild messages in an unconfigured channel', () => {
    const message = fakeMessage({ guildId: 'guild-1', channelId: 'random', channel: { id: 'random' } });
    expect(isMessageInTrackedBoundary(toMessageLike(message), boundary)).toBe(false);
  });
});
