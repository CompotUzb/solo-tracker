# Solo System Tracker — How to use it for real

This guide takes you from an empty server to a **live setup**: a real Discord bot that
watches your activity, turns it into RPG stats / XP / levels, and posts system
notifications — all shown on a local dashboard.

If you only want a local smoke test without Discord, keep `SKIP_DISCORD_LOGIN=true` and skip
straight to [Run it](#4-run-it). Everything else below is for the real, connected setup.

---

## The mental model

You are the **Hunter**. Your real-life effort is logged as Discord messages in a few
tracked channels, and the System turns that into progression:

- **Hunter Stats** — 8 attributes (Strength, Intelligence, Discipline, Technical Skill,
  Health, Communication, Wealth/Career, Survival). Each has its **own level** that climbs
  as you log activity in the matching channel.
- **XP & Rank** — a separate global level/rank, earned mainly by completing **quests**.
- **System Notifications** — level ups, achievements, penalties, and daily/weekly
  summaries. Stored locally and (optionally) posted to one Discord channel.

Nothing happens automatically from "being online" — it reacts to **messages you post** in
the tracked channels and to **quests you complete**.

---

## 1. Create the Discord bot

1. Go to the **[Discord Developer Portal](https://discord.com/developers/applications)** →
   **New Application**. Name it (e.g. "Solo System").
2. Open the **Bot** tab → **Add Bot**.
3. Under **Privileged Gateway Intents**, enable **MESSAGE CONTENT INTENT**.
   (The bot needs this to read message text and measure message length, even though
   message content is *not stored* by default.)
4. Click **Reset Token** → copy the token. This is your `DISCORD_TOKEN` — keep it secret.
5. On the **General Information** tab, copy the **Application ID** → that's
   `DISCORD_CLIENT_ID`.

### Invite the bot to your server

On the **OAuth2 → URL Generator** tab:

- Scopes: **`bot`**
- Bot Permissions: **View Channels**, **Read Message History**, **Send Messages**

Open the generated URL, pick your server, and authorize. The bot should appear (offline
until you start the app).

---

## 2. Get your IDs

In Discord: **User Settings → Advanced → Developer Mode = ON**. Now right-click anything →
**Copy ID**.

You need:

| What | Variable | How |
|------|----------|-----|
| Your server | `TRACKED_GUILD_ID` | Right-click the server icon → Copy Server ID |
| Tracked channels | the `*_CHANNEL_ID` vars below | Right-click each channel → Copy Channel ID |

### Recommended channels

Create (or reuse) these text channels and grab each ID:

| Channel | Purpose | Variable | Feeds which stats |
|---------|---------|----------|-------------------|
| `#daily-quests` | log daily tasks | `DAILY_QUESTS_CHANNEL_ID` | Discipline (+ Health/Intelligence/Technical by keyword) |
| `#mind-training` | study / reading / thinking | `MIND_TRAINING_CHANNEL_ID` | Intelligence (+ Communication/Survival/Discipline) |
| `#body-training` | workouts / physical | `BODY_TRAINING_CHANNEL_ID` | Strength (+ Health/Discipline/Survival) |
| `#work-skill` | coding / work / career | `WORK_SKILL_CHANNEL_ID` | Technical Skill (+ Wealth/Communication/Intelligence) |
| `#commands` | type bot commands here | `COMMANDS_CHANNEL_ID` | (not tracked for stats) |
| `#system-output` | bot posts notifications here | `SYSTEM_OUTPUT_CHANNEL_ID` | (output only) |

Make sure the bot can **see** the four tracked channels and **send** to `#system-output`.

---

## 3. Configure `.env`

```bash
cp .env.example .env
```

Fill it in with your real values:

```ini
DISCORD_TOKEN=your_real_bot_token
DISCORD_CLIENT_ID=your_application_id
TRACKED_GUILD_ID=your_server_id

# You can leave this as a single placeholder — the named channels below are
# merged into the tracked set automatically.
TRACKED_CHANNEL_IDS=placeholder

COMMANDS_CHANNEL_ID=your_commands_channel_id
DAILY_QUESTS_CHANNEL_ID=your_daily_quests_channel_id
MIND_TRAINING_CHANNEL_ID=your_mind_training_channel_id
BODY_TRAINING_CHANNEL_ID=your_body_training_channel_id
WORK_SKILL_CHANNEL_ID=your_work_skill_channel_id
SYSTEM_OUTPUT_CHANNEL_ID=your_system_output_channel_id

DATABASE_PATH=./data/solo-system.sqlite
API_HOST=127.0.0.1
API_PORT=3333
STORE_MESSAGE_CONTENT=false
CONTENT_MAX_CHARS=0
TIMEZONE=Asia/Tashkent

# THIS is the switch that connects the bot:
SKIP_DISCORD_LOGIN=false
```

Key points:

- **`SKIP_DISCORD_LOGIN=false`** is what actually connects the bot. Leave it `true` to run
  dashboard-only with no Discord.
- **`SYSTEM_OUTPUT_CHANNEL_ID`** — if set, notifications are posted to that channel. If left
  blank, the app still runs fine and notifications are dashboard-only (you'll see
  `Discord notifications skipped: SYSTEM_OUTPUT_CHANNEL_ID not configured.` in the logs).
- **`STORE_MESSAGE_CONTENT=false`** keeps your message *text* out of the database (only
  length, timestamps, IDs are stored). Set it to `true` (and `CONTENT_MAX_CHARS` > 0) only
  if you want keyword-based **secondary** stat gains — see [How stats grow](#how-stats-grow).
- Set `TIMEZONE` to your IANA zone (e.g. `Asia/Tashkent`, `Europe/London`) so "today" and
  streaks line up with your day.

`.env` is gitignored — your token never gets committed.

---

## 4. Run it

### Option A — Docker (recommended for a real, always-on setup)

```bash
pnpm install
pnpm build
docker compose up --build -d
```

Fastify serves both the API and the dashboard. The SQLite database lives in `./data` on
your host (persists across restarts).

Open the dashboard: **http://127.0.0.1:3333**

Check it's healthy and connected:

```bash
curl http://127.0.0.1:3333/api/health
# {"ok":true,"db":"ok","discord":"connected"}   <- "connected" means the bot logged in
docker compose logs -f solo-system-tracker
```

> `"discord":"skipped"` means `SKIP_DISCORD_LOGIN=true`. `"connected"` means the bot is live.

### Option B — Local dev (hot reload)

```bash
corepack enable
pnpm install
cp .env.example .env   # then edit as above
pnpm migrate
pnpm dev
```

This runs the API + the Vite dashboard with live reload.

---

## 5. Daily usage

Once the bot shows **connected** and is in your server:

### Log activity → grow stats
Just post messages in the tracked channels:

- A message in **#body-training** ("ran 5k") → **+1 Strength**.
- A message in **#work-skill** ("shipped the auth feature") → **+1 Technical Skill**.
- Use **threads** under a tracked channel to keep the main channel clean — activity in a
  thread counts toward its parent channel's category, and the dashboard shows the thread
  title.

Watch the **Hunter Stats** card on the dashboard tick up in real time.

### Quests → earn XP, level up, unlock achievements
Quests drive your global XP/rank. Create and complete them via the API:

```bash
# Create a quest (easy | normal | hard | boss | raid)
curl -X POST http://127.0.0.1:3333/api/quests \
  -H 'Content-Type: application/json' \
  -d '{"title":"Finish the report","questType":"hard"}'

# Complete it (use the id returned above)
curl -X POST http://127.0.0.1:3333/api/quests/<QUEST_ID>/complete -d '{}'
```

Completing a quest awards XP (easy 10 → raid 400), builds **Discipline**, and can trigger a
**level-up** and **achievement** notification. Active quests appear on the **Daily Quests**
and **Main Quests** cards.

### Discord commands (in `#commands` only)
Type these in your `COMMANDS_CHANNEL_ID` channel:

- `!summary today` or `/summary today` → publishes a **daily summary** notification.
- `!summary week`, `/summary week`, or `/report weekly` → publishes a **weekly summary**.

The summary is posted to `#system-output` (if configured) and stored for the dashboard.

### Penalties (manual)
Log a penalty/warning (e.g. you broke a commitment):

```bash
curl -X POST http://127.0.0.1:3333/api/penalties \
  -H 'Content-Type: application/json' \
  -d '{"reason":"Skipped training","severity":"warning"}'
```

### Where notifications show up
Every notification is saved locally and listed on the **System Notifications** card. If
`SYSTEM_OUTPUT_CHANNEL_ID` is set, the same message is posted to that Discord channel.

---

## How stats grow

| Action | Effect |
|--------|--------|
| Meaningful message in a tracked channel (≥2 chars) | **+1** to that channel's primary stat |
| Same, with `STORE_MESSAGE_CONTENT=true` and a matching keyword | **+1** to a relevant secondary stat |
| Complete a quest | **+2** Discipline (hard +3, boss +4, raid +5) |

Guardrails so stats grow **slower than XP**:

- Max **5** message-driven gains per channel-category per day.
- Stats are floored at 0.

**Per-stat levels:** each attribute levels on a gentle curve — Lv 2 at 5 points, Lv 3 at
15, Lv 4 at 30 (each next level costs `5 × current level` more). The bar under each stat
shows progress to its next level.

**Global XP/rank** is separate and comes mostly from quests. Your level maps to a Hunter
rank: **E** (1–17) → **D** (18–25) → **C** (26–39) → **B** (40–50) → **A** (51–75) →
**S** (76–95) → **National-Level** (96–119) → **Monarch** (120+).

---

## Privacy

- The API binds to `127.0.0.1` by default (Docker uses `0.0.0.0` inside the container only).
- Only your `TRACKED_GUILD_ID` and the configured channels are persisted.
- DMs, unlisted channels, presence, voice, typing, reactions, and member lists are ignored.
- With `STORE_MESSAGE_CONTENT=false` (default), message **text is never written** — only
  IDs, timestamps, attachment counts, and `contentLength`.
- The bot token is read only from `.env` and never logged.
- Everything is local SQLite (`./data`), gitignored.

---

## Backup & reset

- **Backup:** copy the `data/` folder (it holds `solo-system.sqlite`).
- **Reset all progress:** stop the app, delete the files in `data/`, restart — migrations
  recreate an empty database on boot.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `/api/health` shows `"discord":"skipped"` | Set `SKIP_DISCORD_LOGIN=false` and restart. |
| Bot stays offline / "connected" never appears | Wrong `DISCORD_TOKEN`, or bot not invited to the server. Re-check the OAuth invite. |
| Stats don't move when I post | Posting in an untracked channel; or the channel ID in `.env` is wrong; or the bot can't see the channel. Confirm `MESSAGE CONTENT INTENT` is enabled. |
| No secondary stats from keywords | Expected — keyword detection needs `STORE_MESSAGE_CONTENT=true` and `CONTENT_MAX_CHARS` > 0. |
| Notifications don't reach Discord | `SYSTEM_OUTPUT_CHANNEL_ID` blank, or the bot lacks **Send Messages** in that channel. They're still saved locally. |
| Dashboard looks stale after an update | Hard-refresh the browser (Ctrl+Shift+R). |
| `pnpm test` fails with a `NODE_MODULE_VERSION` error | `better-sqlite3` is built for Node 22 (the Docker runtime). Run tests with Node 22, not a newer local Node. |

---

## Command reference

```bash
pnpm dev            # API + dashboard, hot reload
pnpm build          # build all packages
pnpm start          # run the built server
pnpm migrate        # apply DB migrations / seed
pnpm test           # run tests (use Node 22)
pnpm lint           # type-check
pnpm app doctor     # print config + readiness as JSON
pnpm app export-json # export boundaries/daily stats/rank snapshots

docker compose up --build -d          # run as a service
docker compose logs -f solo-system-tracker
curl http://127.0.0.1:3333/api/health
```

API endpoints: `/api/health`, `/api/config/boundaries`, `/api/stats/summary`,
`/api/stats/player`, `/api/quests`, `/api/quests/:id/complete`, `/api/achievements`,
`/api/timeline`, `/api/notifications`, `/api/penalties`, `/api/summaries/today`,
`/api/summaries/week`, `/api/reports/weekly`, `/api/events/stream`.
