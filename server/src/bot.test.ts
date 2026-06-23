import { describe, expect, it, vi } from 'vitest';
import type { Message } from 'discord.js';
import { parseSummaryCommand, toMessageLike, createDiscordClient } from './bot.js';
import { loadConfig } from './config.js';
import { isMessageInTrackedBoundary, type BoundaryConfig } from './boundary.js';

const boundary: BoundaryConfig = { trackedGuildId: 'guild-1', trackedChannelIds: ['channel-1', 'forum-parent'] };

// Build a structurally-minimal stand-in for a discord.js Message. We only touch the fields
// toMessageLike reads, so the unsafe cast keeps the test focused on the normalization contract.
function fakeMessage(overrides: {
  id?: string;
  content?: string;
  guildId?: string | null;
  channelId: string;
  channel: object;
  webhookId?: string | null;
  system?: boolean | null;
  author?: { id?: string | null; bot?: boolean | null; system?: boolean | null } | null;
}): Message {
  return {
    id: overrides.id ?? 'msg-1',
    content: overrides.content ?? '',
    createdAt: new Date('2026-06-23T10:00:00.000Z'),
    guildId: overrides.guildId ?? null,
    webhookId: overrides.webhookId ?? null,
    system: overrides.system ?? false,
    author: overrides.author ?? { id: 'user-1', bot: false, system: false },
    attachments: { size: 0 },
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

describe('summary command routing', () => {
  it('parses supported summary command aliases', () => {
    expect(parseSummaryCommand('/summary today')).toBe('today');
    expect(parseSummaryCommand('!summary week')).toBe('week');
    expect(parseSummaryCommand('/report weekly')).toBe('week');
    expect(parseSummaryCommand('/summary tomorrow')).toBeNull();
  });

  it('dispatches summary commands only from the configured commands channel', () => {
    const config = loadConfig({
      DISCORD_TOKEN: 'fake',
      DISCORD_CLIENT_ID: 'client',
      TRACKED_GUILD_ID: 'guild-1',
      TRACKED_CHANNEL_IDS: 'channel-1',
      COMMANDS_CHANNEL_ID: 'commands',
      DATABASE_PATH: ':memory:',
      SKIP_DISCORD_LOGIN: 'true',
    });
    const onSummaryCommand = vi.fn();
    const client = createDiscordClient(config, boundary, { storeRawMessage: vi.fn(), onSummaryCommand });

    const emitMessage = (client as unknown as { emit: (event: string, message: unknown) => boolean }).emit.bind(client);
    emitMessage('messageCreate', fakeMessage({ guildId: 'guild-1', channelId: 'commands', channel: { id: 'commands' }, content: '/summary today' }));
    emitMessage('messageCreate', fakeMessage({ guildId: 'guild-1', channelId: 'random', channel: { id: 'random' }, content: '/summary week' }));

    expect(onSummaryCommand).toHaveBeenCalledOnce();
    expect(onSummaryCommand).toHaveBeenCalledWith('today', expect.anything());
    client.destroy();
  });
});
