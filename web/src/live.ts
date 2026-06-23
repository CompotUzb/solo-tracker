export interface DashboardEventHandlers {
  onLiveChange: (live: boolean) => void;
  onRefresh: () => void;
}

const REFRESH_EVENTS = [
  'xp',
  'quest.created',
  'quest.completed',
  'quest.updated',
  'stats.updated',
  'stats.player.updated',
  'daily.updated',
  'notification',
  'discord.message',
] as const;

export function subscribeToDashboardEvents({ onLiveChange, onRefresh }: DashboardEventHandlers): () => void {
  const stream = new EventSource('/api/events/stream');

  stream.addEventListener('connected', () => onLiveChange(true));
  for (const event of REFRESH_EVENTS) stream.addEventListener(event, onRefresh);
  stream.onerror = () => onLiveChange(false);

  return () => stream.close();
}
