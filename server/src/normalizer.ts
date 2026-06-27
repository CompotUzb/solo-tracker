import type { AppConfig } from "./config.js";
export interface NormalizedDiscordEvent {
  id: string;
  eventType: "message_created" | "message_updated" | "message_deleted";
  guildId: string;
  channelId: string;
  parentChannelId: string | null;
  messageId: string;
  authorId: string | null;
  occurredAt: string;
  receivedAt: string;
  contentLength: number;
  contentSnippet: string | null;
  attachmentCount: number;
}
export function normalizeMessageCreate(
  input: {
    guildId: string;
    channelId: string;
    parentChannelId?: string | null;
    messageId: string;
    authorId: string;
    createdAt: Date;
    content?: string | null;
    attachmentCount?: number;
  },
  config: Pick<AppConfig, "storeMessageContent" | "contentMaxChars">,
): NormalizedDiscordEvent {
  const content = input.content ?? "";
  const occurredAt = input.createdAt.toISOString();
  return {
    id: `message_created:${input.messageId}:${occurredAt}`,
    eventType: "message_created",
    guildId: input.guildId,
    channelId: input.channelId,
    parentChannelId: input.parentChannelId ?? null,
    messageId: input.messageId,
    authorId: input.authorId,
    occurredAt,
    receivedAt: new Date().toISOString(),
    contentLength: content.length,
    contentSnippet: config.storeMessageContent
      ? content.slice(0, config.contentMaxChars)
      : null,
    attachmentCount: input.attachmentCount ?? 0,
  };
}
