import { and, eq } from "drizzle-orm";
import type { JsonObject, UUID } from "@ryanos/shared";
import { isUuid, resolveUserId, type RyanDb } from "./identity.js";
import * as schema from "./schema.js";

export type PersistIncomingMessageInput = {
  id: string;
  provider: "telegram" | "whatsapp" | "web" | "system";
  accountId?: string;
  chatId: string;
  userId: string;
  text: string;
  username?: string;
  displayName?: string;
  replyToMessageId?: string;
  timestamp: string;
  attachments: Array<{
    id: string;
    mimeType?: string;
    url?: string;
    metadata?: Record<string, unknown>;
  }>;
  metadata: Record<string, unknown>;
};

export type StoredMessage = {
  id: UUID;
  sessionId: UUID;
  userId: UUID;
  provider: string;
  providerMessageId?: string;
  text: string;
  occurredAt: string;
  duplicate: boolean;
};

function asJsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value ?? {})) as JsonObject;
}

function messageFromRow(
  row: typeof schema.messages.$inferSelect,
  duplicate: boolean
): StoredMessage {
  const message: StoredMessage = {
    id: row.id,
    sessionId: row.sessionId,
    userId: row.userId,
    provider: row.provider,
    text: row.text,
    occurredAt: row.occurredAt.toISOString(),
    duplicate
  };
  if (row.providerMessageId !== null) message.providerMessageId = row.providerMessageId;
  return message;
}

export class PostgresMessageStore {
  constructor(private readonly db: RyanDb) {}

  async saveIncomingMessage(input: PersistIncomingMessageInput): Promise<StoredMessage> {
    const userId = await resolveUserId(this.db, input.userId);
    const occurredAt = new Date(input.timestamp);
    const sessionInput: {
      userId: UUID;
      provider: string;
      chatId: string;
      occurredAt: Date;
      accountId?: string;
    } = {
      userId,
      provider: input.provider,
      chatId: input.chatId,
      occurredAt
    };
    if (input.accountId !== undefined) sessionInput.accountId = input.accountId;
    const session = await this.upsertSession(sessionInput);

    const metadata = asJsonObject({
      ...input.metadata,
      accountId: input.accountId,
      username: input.username,
      externalMessageId: input.id,
      attachments: input.attachments
    });

    const values: typeof schema.messages.$inferInsert = {
      sessionId: session.id,
      userId,
      provider: input.provider,
      providerMessageId: input.id,
      direction: "inbound",
      text: input.text,
      occurredAt,
      metadata
    };
    if (input.displayName !== undefined) values.senderDisplayName = input.displayName;
    if (isUuid(input.replyToMessageId)) values.replyToMessageId = input.replyToMessageId;
    if (isUuid(input.id)) values.id = input.id;

    const [created] = await this.db
      .insert(schema.messages)
      .values(values)
      .onConflictDoNothing({
        target: [
          schema.messages.provider,
          schema.messages.sessionId,
          schema.messages.providerMessageId
        ]
      })
      .returning();

    if (created) return messageFromRow(created, false);

    const existing = await this.db.query.messages.findFirst({
      where: and(
        eq(schema.messages.provider, input.provider),
        eq(schema.messages.sessionId, session.id),
        eq(schema.messages.providerMessageId, input.id)
      )
    });
    if (!existing) throw new Error("Message insert conflicted but existing row was not found");
    return messageFromRow(existing, true);
  }

  private async upsertSession(input: {
    userId: UUID;
    provider: string;
    chatId: string;
    occurredAt: Date;
    accountId?: string;
  }): Promise<typeof schema.sessions.$inferSelect> {
    const [session] = await this.db
      .insert(schema.sessions)
      .values({
        userId: input.userId,
        provider: input.provider,
        providerChatId: input.chatId,
        lastMessageAt: input.occurredAt,
        metadata: asJsonObject({ accountId: input.accountId })
      })
      .onConflictDoUpdate({
        target: [schema.sessions.provider, schema.sessions.providerChatId],
        set: {
          lastMessageAt: input.occurredAt,
          updatedAt: new Date()
        }
      })
      .returning();

    if (!session) throw new Error("Failed to upsert message session");
    return session;
  }
}
