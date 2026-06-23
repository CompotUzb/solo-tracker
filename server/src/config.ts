import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

function findRepoRoot(start = process.cwd()): string {
  let current = path.resolve(start);

  while (true) {
    if (fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) return current;

    const parent = path.dirname(current);
    if (parent === current) return path.resolve(start);
    current = parent;
  }
}

function loadDotEnv(): string {
  const repoRoot = findRepoRoot();
  const candidates = [
    path.join(process.cwd(), '.env'),
    path.join(repoRoot, '.env'),
    path.join(repoRoot, '.env.local'),
  ];

  const envFile = candidates.find((candidate) => fs.existsSync(candidate));
  if (envFile) dotenv.config({ path: envFile });

  return envFile ? path.dirname(envFile) : repoRoot;
}

const envBaseDir = loadDotEnv();

const envBoolean = z.preprocess((value) => {
  if (typeof value !== 'string') return value;

  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off', ''].includes(normalized)) return false;

  return value;
}, z.boolean());

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DATABASE_PATH: z.string().default('./data/solo-system.sqlite'),
  TRACKED_GUILD_ID: z.string().min(1),
  TRACKED_CHANNEL_IDS: z.string().min(1),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().positive().default(3333),
  STORE_MESSAGE_CONTENT: envBoolean.default(false),
  CONTENT_MAX_CHARS: z.coerce.number().int().min(0).default(0),
  TIMEZONE: z.string().default(Intl.DateTimeFormat().resolvedOptions().timeZone),
  SKIP_DISCORD_LOGIN: envBoolean.default(false),
});

export type AppConfig = ReturnType<typeof loadConfig>;

function resolveDatabasePath(databasePath: string): string {
  if (databasePath === ':memory:' || path.isAbsolute(databasePath)) return databasePath;
  return path.resolve(envBaseDir, databasePath);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.parse(env);
  const trackedChannelIds = parsed.TRACKED_CHANNEL_IDS.split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  if (!trackedChannelIds.length) {
    throw new Error('TRACKED_CHANNEL_IDS must include at least one channel ID');
  }

  return {
    discordToken: parsed.DISCORD_TOKEN,
    discordClientId: parsed.DISCORD_CLIENT_ID,
    databasePath: resolveDatabasePath(parsed.DATABASE_PATH),
    trackedGuildId: parsed.TRACKED_GUILD_ID,
    trackedChannelIds,
    apiHost: parsed.API_HOST,
    apiPort: parsed.API_PORT,
    storeMessageContent: parsed.STORE_MESSAGE_CONTENT,
    contentMaxChars: parsed.STORE_MESSAGE_CONTENT ? Math.max(parsed.CONTENT_MAX_CHARS, 1) : 0,
    timezone: parsed.TIMEZONE,
    skipDiscordLogin: parsed.SKIP_DISCORD_LOGIN,
  };
}

export function publicConfig(config: AppConfig) {
  return {
    guildId: config.trackedGuildId,
    trackedChannelIds: config.trackedChannelIds,
    storeMessageContent: config.storeMessageContent,
    apiHost: config.apiHost,
    apiPort: config.apiPort,
    databasePath: config.databasePath,
    timezone: config.timezone,
  };
}
