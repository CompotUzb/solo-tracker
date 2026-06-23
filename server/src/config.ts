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

// Optional named-channel ids load from env only; an empty/placeholder value disables
// that channel. A value left as the .env.example placeholder is treated as unset so a
// freshly copied env file does not accidentally track a fake channel.
const optionalChannelId = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('replace_with_')) return undefined;
  return trimmed;
}, z.string().min(1).optional());

const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DATABASE_PATH: z.string().default('./data/solo-system.sqlite'),
  TRACKED_GUILD_ID: z.string().min(1),
  TRACKED_CHANNEL_IDS: z.string().min(1),
  COMMANDS_CHANNEL_ID: optionalChannelId,
  DAILY_QUESTS_CHANNEL_ID: optionalChannelId,
  MIND_TRAINING_CHANNEL_ID: optionalChannelId,
  BODY_TRAINING_CHANNEL_ID: optionalChannelId,
  WORK_SKILL_CHANNEL_ID: optionalChannelId,
  SYSTEM_OUTPUT_CHANNEL_ID: optionalChannelId,
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().positive().default(3333),
  STORE_MESSAGE_CONTENT: envBoolean.default(false),
  CONTENT_MAX_CHARS: z.coerce.number().int().min(0).default(0),
  TIMEZONE: z.string().default(Intl.DateTimeFormat().resolvedOptions().timeZone),
  DAILY_QUEST_CREATE_TIME: localTime.default('06:00'),
  DAILY_EVALUATION_TIME: localTime.default('00:00'),
  DAILY_QUEST_TIER_OVERRIDE: z.coerce.number().int().min(1).max(3).optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SKIP_DISCORD_LOGIN: envBoolean.default(false),
});

/** Channel categories that map Discord activity to player stats. */
export type ChannelCategory = 'daily-quests' | 'mind-training' | 'body-training' | 'work-skill';

export type AppConfig = ReturnType<typeof loadConfig>;

function resolveDatabasePath(databasePath: string): string {
  if (databasePath === ':memory:' || path.isAbsolute(databasePath)) return databasePath;
  return path.resolve(envBaseDir, databasePath);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.parse(env);

  // Map the named input channels to their stat category. The command channel and the
  // system-output channel are intentionally excluded — they are not tracked for stats.
  const channelCategories: Record<string, ChannelCategory> = {};
  const addCategory = (id: string | undefined, category: ChannelCategory) => {
    if (id) channelCategories[id] = category;
  };
  addCategory(parsed.DAILY_QUESTS_CHANNEL_ID, 'daily-quests');
  addCategory(parsed.MIND_TRAINING_CHANNEL_ID, 'mind-training');
  addCategory(parsed.BODY_TRAINING_CHANNEL_ID, 'body-training');
  addCategory(parsed.WORK_SKILL_CHANNEL_ID, 'work-skill');

  // The tracked whitelist is the legacy list plus every configured stat channel,
  // de-duplicated while preserving order.
  const trackedChannelIds = [
    ...parsed.TRACKED_CHANNEL_IDS.split(',').map((id) => id.trim()),
    ...Object.keys(channelCategories),
  ].filter(Boolean);
  const uniqueTrackedChannelIds = [...new Set(trackedChannelIds)];

  if (!uniqueTrackedChannelIds.length) {
    throw new Error('TRACKED_CHANNEL_IDS must include at least one channel ID');
  }

  return {
    discordToken: parsed.DISCORD_TOKEN,
    discordClientId: parsed.DISCORD_CLIENT_ID,
    databasePath: resolveDatabasePath(parsed.DATABASE_PATH),
    trackedGuildId: parsed.TRACKED_GUILD_ID,
    trackedChannelIds: uniqueTrackedChannelIds,
    channelCategories,
    commandsChannelId: parsed.COMMANDS_CHANNEL_ID ?? null,
    dailyQuestsChannelId: parsed.DAILY_QUESTS_CHANNEL_ID ?? null,
    systemOutputChannelId: parsed.SYSTEM_OUTPUT_CHANNEL_ID ?? null,
    apiHost: parsed.API_HOST,
    apiPort: parsed.API_PORT,
    storeMessageContent: parsed.STORE_MESSAGE_CONTENT,
    contentMaxChars: parsed.STORE_MESSAGE_CONTENT ? Math.max(parsed.CONTENT_MAX_CHARS, 1) : 0,
    timezone: parsed.TIMEZONE,
    dailyQuestCreateTime: parsed.DAILY_QUEST_CREATE_TIME,
    dailyEvaluationTime: parsed.DAILY_EVALUATION_TIME,
    dailyQuestTierOverride: parsed.NODE_ENV === 'production' ? null : parsed.DAILY_QUEST_TIER_OVERRIDE ?? null,
    skipDiscordLogin: parsed.SKIP_DISCORD_LOGIN,
  };
}

export function publicConfig(config: AppConfig) {
  return {
    guildId: config.trackedGuildId,
    trackedChannelIds: config.trackedChannelIds,
    channelCategories: config.channelCategories,
    systemOutputConfigured: config.systemOutputChannelId != null,
    dailyQuestsConfigured: config.dailyQuestsChannelId != null,
    storeMessageContent: config.storeMessageContent,
    apiHost: config.apiHost,
    apiPort: config.apiPort,
    databasePath: config.databasePath,
    timezone: config.timezone,
    dailyQuestCreateTime: config.dailyQuestCreateTime,
    dailyEvaluationTime: config.dailyEvaluationTime,
  };
}
