-- System notifications. Every notification (level up, achievement, penalty, summaries,
-- general updates) is stored locally so the dashboard can show history regardless of
-- whether Discord delivery is configured. discord_status records the delivery outcome:
--   skipped  - no system-output channel configured (dashboard-only mode)
--   pending  - queued for delivery
--   sent     - delivered to Discord (discord_message_id set)
--   failed   - delivery attempted but errored
create table if not exists notifications (
  id text primary key,
  user_id text not null,
  type text not null,
  title text not null,
  body text null,
  metadata_json text null,
  discord_status text not null default 'skipped',
  discord_message_id text null,
  created_at text not null
);
create index if not exists idx_notifications_user_time on notifications(user_id, created_at);
