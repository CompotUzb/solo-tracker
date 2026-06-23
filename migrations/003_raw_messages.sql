create table if not exists raw_messages (
  message_id text primary key,
  guild_id text not null,
  channel_id text not null,
  parent_channel_id text null,
  author_id text not null,
  content text not null,
  message_timestamp text not null,
  received_at text not null,
  metadata_json text null
);
create index if not exists idx_raw_messages_channel_time on raw_messages(channel_id,message_timestamp);
create index if not exists idx_raw_messages_author_time on raw_messages(author_id,message_timestamp);
