# Solo System Tracker

Local-first Discord activity tracker for one trusted server. It tracks only explicitly configured channels, stores privacy-safe events in local SQLite, computes deterministic XP/rank stats, and shows them in a local React dashboard.

> **Setting it up with a real Discord bot?** See **[INSTRUCTIONS.md](INSTRUCTIONS.md)** for the full step-by-step (create the bot, get IDs, configure channels, connect, and daily usage).

## Stack

- Node.js 22 + TypeScript
- discord.js v14
- Fastify API + Server-Sent Events
- SQLite via better-sqlite3
- Vite + React dashboard
- pnpm workspaces: `server/`, `web/`, `shared/`

## Quick start

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm migrate
pnpm dev
```

The dashboard runs on the local Vite port. The API runs on the configured local API port.

By default `.env.example` has `SKIP_DISCORD_LOGIN=true`, so the API and dashboard can run without connecting to Discord. To connect the bot, fill real Discord values and set `SKIP_DISCORD_LOGIN=false`.

## Environment

Required: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `TRACKED_GUILD_ID`, `TRACKED_CHANNEL_IDS`, `DATABASE_PATH`. Configure `DAILY_QUESTS_CHANNEL_ID` for automatic Daily Quest threads. Optional scheduling values: `DAILY_QUEST_CREATE_TIME` (default `06:00`) and `DAILY_EVALUATION_TIME` (default `00:00`).

## Automatic Daily Quest

At the configured local creation time, the bot reads the Hunter's current rank, selects the highest permitted Daily Quest tier, posts one checklist, and creates a `Day-N` thread. E/D receive Beginner, C/B/A receive Intermediate, and S/National-Level/Monarch receive The Sung Jin-Woo tier. Only messages in that stored active thread are parsed for progress. Creation and metric ingestion are idempotent.

`DAILY_QUEST_TIER_OVERRIDE` is development/test-only and cannot select a tier above the Hunter rank. Production ignores it.

Development commands in `COMMANDS_CHANNEL_ID`:

```text
/daily
/daily create
/daily evaluate
/daily thread
```

With `STORE_MESSAGE_CONTENT=false`, message text is processed in memory and only extracted metric values are retained.

Reset local progression/demo data while preserving configuration and schema:

```bash
pnpm reset:local-data --confirm
```

The command refuses to run without `--confirm` and is disabled when `NODE_ENV=production`.

## Commands

```bash
pnpm dev
pnpm dev:server
pnpm dev:web
pnpm migrate
pnpm test
pnpm lint
pnpm build
pnpm start
pnpm app doctor
pnpm app export-json
```

## Docker

The app can run as one Docker service: Fastify serves both the API and the built React dashboard on port `3333`. SQLite is persisted on the host in `./data`.

```bash
cp .env.example .env
# edit .env with real Discord values when you are ready to connect the bot
# keep SKIP_DISCORD_LOGIN=true for a local dashboard/API smoke run

pnpm install
pnpm build
docker compose up --build
```

Open:

```txt
http://127.0.0.1:3333
```

Useful checks:

```bash
docker compose ps
docker compose logs -f solo-system-tracker
curl http://127.0.0.1:3333/api/health
```

Compose overrides these runtime values so the container is reachable and the database is stored in the mounted volume:

```txt
API_HOST=0.0.0.0
API_PORT=3333
DATABASE_PATH=/app/data/solo-system.sqlite
```

Do not bake `.env` into the image; `.dockerignore` excludes local env files and `docker-compose.yml` injects them at runtime.

## Privacy boundaries

- The API binds to the configured local host by default.
- Only `TRACKED_GUILD_ID` and `TRACKED_CHANNEL_IDS` are persisted.
- DMs, unlisted channels, presence, voice, typing, reactions, and member lists are ignored.
- Message content is not stored by default. With `STORE_MESSAGE_CONTENT=false`, raw Discord rows keep only IDs, timestamps, attachment counts, and `contentLength`; the stored `content` field is empty.
- If `STORE_MESSAGE_CONTENT=true`, message content is truncated to `CONTENT_MAX_CHARS` before it is written to local SQLite.
- Raw tracked Discord message metadata is stored in the local `raw_messages` table so the MVP can audit ingestion and drive activity/XP. This database is local-only and ignored by git.
- Bot tokens are loaded only from environment variables and are never logged.

## Layout

```text
server/      Fastify API, Discord bot skeleton, SQLite migrations, CLI commands
web/         Vite React dashboard
shared/      shared types and deterministic XP/rank constants
migrations/  SQL schema files applied by server migration runner
data/        local SQLite files (gitignored)
```

API endpoints: `/api/health`, `/api/config/boundaries`, `/api/stats/summary`, `/api/timeline`, `/api/notifications`, `/api/penalties`, `/api/summaries/today`, `/api/summaries/week`, `/api/events/stream`.

System output notifications are always stored locally in SQLite and are delivered to Discord only when `SYSTEM_OUTPUT_CHANNEL_ID` is configured and Discord login is enabled. Quest completion can emit level-up and achievement notifications; `/api/penalties` emits penalty warnings; `/api/summaries/today` and `/api/summaries/week` publish on-demand summary notifications. In Discord, `!summary today`, `/summary today`, `!summary week`, `/summary week`, and `/report weekly` are accepted only in `COMMANDS_CHANNEL_ID` and publish through the configured system output route.
