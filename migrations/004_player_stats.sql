-- Player (Hunter) stats: the eight RPG attributes that grow from tracked activity and
-- quests. player_stats is the materialized current value per attribute; stat_awards is
-- the append-only audit ledger of every grant, mirroring the xp_awards design. Stats are
-- intended to grow slower than XP, so awards here are small (+1 typical).
create table if not exists player_stats (
  user_id text not null,
  stat_key text not null,
  value integer not null default 0,
  updated_at text not null,
  primary key (user_id, stat_key)
);

create table if not exists stat_awards (
  id text primary key,
  user_id text not null,
  stat_key text not null,
  delta integer not null,
  reason text not null,
  source text not null,
  source_id text null,
  occurred_at text not null,
  created_at text not null
);
create index if not exists idx_stat_awards_user_time on stat_awards(user_id, occurred_at);
create index if not exists idx_stat_awards_source on stat_awards(source, source_id);
