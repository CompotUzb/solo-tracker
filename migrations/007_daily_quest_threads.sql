-- Discord-backed Daily Quest workflow. Existing daily_quest_days rows are retained;
-- nullable Discord fields allow old local-only rows to coexist during migration.
create table if not exists daily_quest_metric_events (
  id text primary key,
  daily_quest_day_id text not null,
  discord_message_id text not null,
  metric_key text not null,
  amount real not null,
  raw_match text null,
  created_at text not null,
  unique(discord_message_id, metric_key)
);
create index if not exists idx_daily_metric_events_day on daily_quest_metric_events(daily_quest_day_id, created_at);
