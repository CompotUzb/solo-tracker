export interface AuthorLike {
  id?: string | null;
  bot?: boolean | null;
  system?: boolean | null;
}
export interface MessageLike {
  guildId?: string | null;
  channelId: string;
  parentChannelId?: string | null;
  webhookId?: string | null;
  system?: boolean | null;
  author?: AuthorLike | null;
}
export interface BoundaryConfig {
  trackedGuildId: string;
  trackedChannelIds: string[];
}
export function isMessageInTrackedBoundary(m: MessageLike, c: BoundaryConfig) {
  if (m.guildId !== c.trackedGuildId) return false;
  if (m.webhookId || m.system) return false;
  if (!m.author?.id || m.author.bot || m.author.system) return false;
  const allowed = new Set(c.trackedChannelIds);
  return (
    allowed.has(m.channelId) ||
    Boolean(m.parentChannelId && allowed.has(m.parentChannelId))
  );
}
