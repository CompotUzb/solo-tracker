import { describe, expect, it } from 'vitest';
import { loadConfig, publicConfig } from './config.js';

const baseEnv = {
  DISCORD_TOKEN: 'fake-token',
  DISCORD_CLIENT_ID: 'client-id',
  TRACKED_GUILD_ID: 'guild-id',
  TRACKED_CHANNEL_IDS: 'channel-1, channel-2',
  DATABASE_PATH: ':memory:',
};

describe('loadConfig', () => {
  it('parses false-like boolean environment strings as false', () => {
    const config = loadConfig({
      ...baseEnv,
      STORE_MESSAGE_CONTENT: 'false',
      SKIP_DISCORD_LOGIN: 'false',
    });

    expect(config.storeMessageContent).toBe(false);
    expect(config.contentMaxChars).toBe(0);
    expect(config.skipDiscordLogin).toBe(false);
  });

  it('parses true-like boolean environment strings as true', () => {
    const config = loadConfig({
      ...baseEnv,
      STORE_MESSAGE_CONTENT: 'true',
      CONTENT_MAX_CHARS: '500',
      SKIP_DISCORD_LOGIN: '1',
    });

    expect(config.storeMessageContent).toBe(true);
    expect(config.contentMaxChars).toBe(500);
    expect(config.skipDiscordLogin).toBe(true);
  });

  it('trims tracked channel IDs', () => {
    const config = loadConfig(baseEnv);

    expect(config.trackedChannelIds).toEqual(['channel-1', 'channel-2']);
  });

  it('reads the bot token from the provided env only', () => {
    const config = loadConfig({ ...baseEnv, DISCORD_TOKEN: 'env-only-token' });

    expect(config.discordToken).toBe('env-only-token');
  });

  it('omits secrets from the public config surface', () => {
    const config = loadConfig({ ...baseEnv, DISCORD_TOKEN: 'super-secret-token' });
    const safe = publicConfig(config);
    const serialized = JSON.stringify(safe);

    expect(serialized).not.toContain('super-secret-token');
    expect(serialized).not.toContain(baseEnv.DISCORD_CLIENT_ID);
    expect(safe).not.toHaveProperty('discordToken');
    expect(safe).not.toHaveProperty('discordClientId');
  });
});
