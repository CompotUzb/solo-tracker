# Solo System Tracker MVP Acceptance Runbook

This runbook starts and verifies the local-first Solo System Tracker MVP. Complete the skip Discord flow first. Real Discord tracking is a separate, optional acceptance step.

Run all commands from the repository root.

## 1. Prerequisites

Install:

- Git.
- Node.js 22 or newer.
- Corepack, included with Node.js.
- Docker Engine with Docker Compose v2.
- `curl`.

Confirm the tools:

```bash
node --version
corepack --version
docker --version
docker compose version
curl --version
```

The Docker image copies host-built files and installed dependencies, so both Node/pnpm and Docker are required for the current Docker workflow.

## 2. Environment setup

Clone the repository, enter it, enable the pinned pnpm version, install dependencies, and build the application:

```bash
git clone <REPOSITORY_URL> solo-system-tracker
cd solo-system-tracker
corepack enable
pnpm install --frozen-lockfile
pnpm build
```

Replace `<REPOSITORY_URL>` with the repository's actual Git URL.

## 3. Copy and configure `.env`

Create the local environment file:

```bash
cp .env.example .env
```

Do not commit `.env` or paste real Discord credentials into source files, logs, issues, or this runbook.

The copied defaults are ready for skip Discord mode:

```dotenv
DISCORD_TOKEN=replace_with_discord_bot_token
DISCORD_CLIENT_ID=replace_with_discord_client_id
TRACKED_GUILD_ID=replace_with_discord_guild_id
TRACKED_CHANNEL_IDS=replace_with_channel_id_1,replace_with_channel_id_2
DATABASE_PATH=./data/solo-system.sqlite
API_HOST=127.0.0.1
API_PORT=3333
STORE_MESSAGE_CONTENT=false
CONTENT_MAX_CHARS=0
TIMEZONE=Asia/Tashkent
SKIP_DISCORD_LOGIN=true
```

Change `TIMEZONE` to the local IANA timezone if needed, for example `America/New_York`. Leave the fake Discord placeholders in place while `SKIP_DISCORD_LOGIN=true`; configuration requires non-empty values, but skip mode does not use them.

Privacy default: keep `STORE_MESSAGE_CONTENT=false`. With this setting, no Discord message content is stored. Raw tracked events contain metadata only, such as IDs, timestamps, content length, and attachment count.

## 4. Run locally with Docker

The current Docker setup runs one service. Fastify serves both the dashboard and API at `http://127.0.0.1:3333`. Docker Compose persists SQLite on the host at `./data` by mounting it at `/app/data` in the container.

Build the host artifacts, build the image, and start the service:

```bash
pnpm build
docker compose up --build -d
docker compose ps
```

Follow startup logs if needed:

```bash
docker compose logs -f solo-system-tracker
```

Press `Ctrl+C` to stop following logs; the container continues running.

## 5. Skip Discord mode

For local API, dashboard, quest, XP, SSE, and persistence acceptance without a Discord token, confirm:

```dotenv
SKIP_DISCORD_LOGIN=true
```

Then start or recreate the container:

```bash
docker compose up --build -d
```

Verify that Discord is explicitly skipped:

```bash
curl --fail --silent --show-error http://127.0.0.1:3333/api/health
```

Expected shape:

```json
{"ok":true,"db":"ok","discord":"skipped"}
```

## 6. Verify API health

Run:

```bash
curl --fail --silent --show-error http://127.0.0.1:3333/api/health
```

Acceptance result:

- `"ok"` is `true`.
- `"db"` is `"ok"`.
- `"discord"` is `"skipped"` in skip mode or `"connected"` in real Discord mode.

The Compose health status can take up to the configured health-check interval to update:

```bash
docker compose ps
```

## 7. Open the dashboard

Open this URL in a browser:

```text
http://127.0.0.1:3333
```

Confirm that the dashboard loads and displays API, DB, and Discord status. In skip mode, Discord should display `skipped`.

## 8. Test quest creation and completion

These commands use the default MVP user, `local-user`. First record the current total XP:

```bash
BEFORE_JSON="$(curl --fail --silent --show-error http://127.0.0.1:3333/api/stats/summary)"
BEFORE_XP="$(node -p 'JSON.parse(process.argv[1]).rank.totalXp' "$BEFORE_JSON")"
printf 'XP before: %s\n' "$BEFORE_XP"
```

Create a `hard` quest, which is worth 60 XP:

```bash
QUEST_JSON="$(curl --fail --silent --show-error \
  --request POST \
  --header 'Content-Type: application/json' \
  --data '{"title":"MVP acceptance quest","description":"Verify quest completion and persistence","questType":"hard","targetCount":1}' \
  http://127.0.0.1:3333/api/quests)"
printf '%s\n' "$QUEST_JSON"
```

Extract its ID:

```bash
QUEST_ID="$(node -p 'JSON.parse(process.argv[1]).quest.id' "$QUEST_JSON")"
printf 'Quest ID: %s\n' "$QUEST_ID"
```

Confirm that the response contains `"status":"active"`, `"questType":"hard"`, and `"xpReward":60`.

Complete the quest:

```bash
COMPLETE_JSON="$(curl --fail --silent --show-error \
  --request POST \
  --header 'Content-Type: application/json' \
  --data '{}' \
  "http://127.0.0.1:3333/api/quests/$QUEST_ID/complete")"
printf '%s\n' "$COMPLETE_JSON"
```

Confirm that the response contains `"status":"completed"`, `"xpAwarded":60`, and `"alreadyCompleted":false`.

Optional idempotency check:

```bash
curl --fail --silent --show-error \
  --request POST \
  --header 'Content-Type: application/json' \
  --data '{}' \
  "http://127.0.0.1:3333/api/quests/$QUEST_ID/complete"
```

The second completion must report `"xpAwarded":0` and `"alreadyCompleted":true`.

## 9. Verify XP changes

Fetch the new total and verify that it increased by exactly 60:

```bash
AFTER_JSON="$(curl --fail --silent --show-error http://127.0.0.1:3333/api/stats/summary)"
AFTER_XP="$(node -p 'JSON.parse(process.argv[1]).rank.totalXp' "$AFTER_JSON")"
printf 'XP after: %s\n' "$AFTER_XP"
test "$AFTER_XP" -eq "$((BEFORE_XP + 60))"
```

No output from `test` means the XP check passed. To print an explicit result:

```bash
if test "$AFTER_XP" -eq "$((BEFORE_XP + 60))"; then
  echo "PASS: XP increased by 60"
else
  echo "FAIL: expected $((BEFORE_XP + 60)), got $AFTER_XP"
  exit 1
fi
```

## 10. Verify SSE and live updates

Open terminal 1 and keep the SSE connection running:

```bash
curl --no-buffer http://127.0.0.1:3333/api/events/stream
```

It should immediately show a `connected` event.

In terminal 2, create another quest:

```bash
LIVE_QUEST_JSON="$(curl --fail --silent --show-error \
  --request POST \
  --header 'Content-Type: application/json' \
  --data '{"title":"SSE acceptance quest","questType":"easy"}' \
  http://127.0.0.1:3333/api/quests)"
LIVE_QUEST_ID="$(node -p 'JSON.parse(process.argv[1]).quest.id' "$LIVE_QUEST_JSON")"
printf '%s\n' "$LIVE_QUEST_JSON"
```

Terminal 1 must show `quest.created` and `quest.updated` events.

Complete the live quest from terminal 2:

```bash
curl --fail --silent --show-error \
  --request POST \
  --header 'Content-Type: application/json' \
  --data '{}' \
  "http://127.0.0.1:3333/api/quests/$LIVE_QUEST_ID/complete"
```

Terminal 1 must show completion-related events including `quest.updated`, `xp`, `quest.completed`, and `stats.updated`. The open dashboard should update without a manual browser refresh.

Press `Ctrl+C` in terminal 1 after verification.

## 11. Verify database persistence after restart

Keep the `QUEST_ID` and `AFTER_XP` shell variables from the earlier steps, then restart the container:

```bash
docker compose restart solo-system-tracker
```

Wait for the API:

```bash
until curl --fail --silent --output /dev/null http://127.0.0.1:3333/api/health; do
  sleep 1
done
```

Verify that the completed quest is still present:

```bash
PERSISTED_QUESTS="$(curl --fail --silent --show-error 'http://127.0.0.1:3333/api/quests?status=completed')"
printf '%s\n' "$PERSISTED_QUESTS"
node -e '
const body = JSON.parse(process.argv[1]);
const id = process.argv[2];
if (!body.quests.some((quest) => quest.id === id && quest.status === "completed")) {
  throw new Error(`completed quest ${id} was not persisted`);
}
console.log("PASS: completed quest persisted");
' "$PERSISTED_QUESTS" "$QUEST_ID"
```

Verify that total XP survived the restart:

```bash
PERSISTED_XP="$(node -p 'JSON.parse(process.argv[1]).rank.totalXp' \
  "$(curl --fail --silent --show-error http://127.0.0.1:3333/api/stats/summary)")"
printf 'XP after restart: %s\n' "$PERSISTED_XP"
test "$PERSISTED_XP" -ge "$AFTER_XP"
```

The comparison is `-ge` because the SSE verification quest may have added another 10 XP. Persistence is provided by the host file `./data/solo-system.sqlite`.

## 12. Real Discord mode

Complete this section only after skip mode passes.

### Discord application setup

1. Create or select a Discord application in the Discord Developer Portal.
2. Create its bot user and copy the bot token.
3. Under the bot's privileged gateway intents, enable **Message Content Intent**. The current client requests `Guilds`, `GuildMessages`, and `MessageContent`.
4. Invite the bot to the target server with permission to view the tracked channels and read their messages/history.
5. In Discord, enable Developer Mode and copy:
   - the application/client ID;
   - the target server/guild ID;
   - each channel ID to track.

Configure `.env` with real values locally:

```dotenv
DISCORD_TOKEN=<REAL_BOT_TOKEN>
DISCORD_CLIENT_ID=<REAL_APPLICATION_ID>
TRACKED_GUILD_ID=<REAL_GUILD_ID>
TRACKED_CHANNEL_IDS=<CHANNEL_ID_1>,<CHANNEL_ID_2>
SKIP_DISCORD_LOGIN=false
STORE_MESSAGE_CONTENT=false
CONTENT_MAX_CHARS=0
```

Do not include angle brackets in the real values. Keep `STORE_MESSAGE_CONTENT=false` unless content storage is an explicit, reviewed requirement.

Recreate the service:

```bash
pnpm build
docker compose up --build -d
docker compose logs -f solo-system-tracker
```

Look for a successful connection message, then stop following logs with `Ctrl+C`.

Verify health:

```bash
curl --fail --silent --show-error http://127.0.0.1:3333/api/health
```

Expected Discord state:

```json
{"ok":true,"db":"ok","discord":"connected"}
```

Send a normal, non-bot message in one configured channel. Confirm that:

- The container log reports a tracked message.
- The dashboard receives a live update.
- Messages in unlisted servers, unlisted channels, DMs, and bot/system/webhook messages are ignored.
- With `STORE_MESSAGE_CONTENT=false`, only raw metadata is stored; message text is not stored.

To return to skip mode, set `SKIP_DISCORD_LOGIN=true` in `.env` and run:

```bash
docker compose up -d --force-recreate
```

## 13. Troubleshooting

### Docker build cannot find `node_modules` or `dist`

The current Dockerfile expects dependencies and compiled output on the host:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build
docker compose up --build -d
```

### Port 3333 is already in use

Find the conflicting process or container:

```bash
docker ps --format 'table {{.Names}}\t{{.Ports}}'
ss -ltnp | grep ':3333'
```

Stop the conflicting service before starting Solo System Tracker.

### Health request fails

Inspect status and logs:

```bash
docker compose ps
docker compose logs --tail=200 solo-system-tracker
```

Recreate the service after correcting `.env`:

```bash
docker compose up --build -d --force-recreate
```

### Health shows Discord `disconnected`

Confirm that `SKIP_DISCORD_LOGIN=false` is intentional. Then check the token, guild/channel IDs, bot membership, channel permissions, and Message Content Intent. Do not print the token while diagnosing.

### Health shows Discord `skipped` after enabling real mode

Confirm the effective setting without printing other environment values:

```bash
docker compose config | grep SKIP_DISCORD_LOGIN
```

Set `SKIP_DISCORD_LOGIN=false` in `.env`, then recreate:

```bash
docker compose up -d --force-recreate
```

### Dashboard loads but has stale data

Check the SSE endpoint:

```bash
curl --no-buffer http://127.0.0.1:3333/api/events/stream
```

Then create or complete a quest in another terminal. If no events arrive, inspect container logs and browser developer-console errors.

### SQLite data does not persist

Confirm the host mount and database file:

```bash
docker compose config
ls -la ./data
```

Compose must mount `./data:/app/data`, and the database should exist at `./data/solo-system.sqlite`. Do not delete `./data` when testing persistence.

### Reset local acceptance data

This permanently deletes local tracker data. Stop the service and remove only the local database files:

```bash
docker compose down
rm -f ./data/solo-system.sqlite ./data/solo-system.sqlite-shm ./data/solo-system.sqlite-wal
docker compose up -d
```

## 14. Final MVP acceptance checklist

- [ ] Prerequisite tool versions run successfully.
- [ ] `pnpm install --frozen-lockfile` and `pnpm build` succeed.
- [ ] `.env` exists locally and contains no committed real secrets.
- [ ] Skip Discord mode starts with `SKIP_DISCORD_LOGIN=true`.
- [ ] `http://127.0.0.1:3333/api/health` reports API/DB healthy and Discord `skipped`.
- [ ] The dashboard opens at `http://127.0.0.1:3333`.
- [ ] A hard quest can be created and reports a 60 XP reward.
- [ ] The quest can be completed and awards exactly 60 XP once.
- [ ] Re-completing the quest awards 0 XP.
- [ ] The stats summary reflects the XP increase.
- [ ] The SSE stream emits quest, XP, and stats events.
- [ ] The dashboard updates live without a manual refresh.
- [ ] Completed quests and XP remain after a container restart.
- [ ] SQLite is persisted in `./data`.
- [ ] `STORE_MESSAGE_CONTENT=false` is retained, so message content is not stored and raw events contain metadata only.
- [ ] If real Discord mode is in scope, health reports Discord `connected` and only configured guild/channel activity is tracked.
- [ ] No real Discord token or other secret appears in tracked files or command output.
