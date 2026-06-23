-- Real-world Daily Quest engine. The daily quest is a fixed checklist of physical/mental
-- metrics scaled by a chosen tier (E/C/S). Completing every metric in a day awards XP,
-- stat points, and loot boxes, and advances a streak. Missing a day (evaluated at local
-- midnight) breaks the streak and triggers a penalty state until a recovery "flush" is logged.

-- Per-user chosen baseline tier.
create table if not exists daily_quest_settings (
  user_id text primary key,
  tier text not null default 'e',
  updated_at text not null
);

-- One row per user per local calendar day, with the tier snapshot and lifecycle status.
create table if not exists daily_quest_days (
  user_id text not null,
  local_date text not null,
  tier text not null,
  status text not null default 'active', -- active, completed, failed
  completed_at text null,
  evaluated integer not null default 0,
  created_at text not null,
  updated_at text not null,
  primary key (user_id, local_date)
);

-- Per-metric target snapshot + progress for a given day.
create table if not exists daily_quest_metrics (
  user_id text not null,
  local_date text not null,
  metric_key text not null,
  target real not null,
  progress real not null default 0,
  created_at text not null,
  updated_at text not null,
  primary key (user_id, local_date, metric_key)
);

-- Streak / penalty / unallocated stat-point state for the daily engine.
create table if not exists daily_quest_state (
  user_id text primary key,
  current_streak integer not null default 0,
  longest_streak integer not null default 0,
  stat_points integer not null default 0,
  penalty_active integer not null default 0,
  penalty_reason text null,
  penalty_since text null,
  last_evaluated_date text null,
  updated_at text not null
);

-- Loot boxes earned on completion and at streak milestones.
create table if not exists loot_boxes (
  id text primary key,
  user_id text not null,
  rarity text not null, -- common, rare, legendary
  reward text not null,
  source text not null, -- daily, streak_7, streak_30
  status text not null default 'unopened', -- unopened, claimed
  created_at text not null,
  claimed_at text null
);
create index if not exists idx_loot_boxes_user on loot_boxes(user_id, created_at);
