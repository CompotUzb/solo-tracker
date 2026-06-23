-- Auditable XP award ledger for non-Discord XP sources (quests, achievements, manual grants).
-- Kept separate from xp_ledger because xp_ledger rows must reference a discord-sourced
-- activity_event; quest XP has no such source. rank_snapshots remains the materialized
-- player-stats view (total_xp/level/rank) updated by the XP engine on each award.
create table if not exists xp_awards (
  id text primary key,
  user_id text not null,
  source text not null,
  source_id text null,
  reason text not null,
  xp_delta integer not null,
  occurred_at text not null,
  created_at text not null
);
create index if not exists idx_xp_awards_user_time on xp_awards(user_id, occurred_at);
create index if not exists idx_xp_awards_source on xp_awards(source, source_id);
