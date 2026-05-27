import type { IncomingMessage } from "@ryanos/ai";
import { nowIso } from "@ryanos/shared";
import { z } from "zod";

const telegramIdSchema = z.union([z.string(), z.number()]);

const telegramUserSchema = z
  .object({
    id: telegramIdSchema,
    is_bot: z.boolean().optional(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    username: z.string().optional()
  })
  .passthrough();

const telegramChatSchema = z
  .object({
    id: telegramIdSchema,
    type: z.string().optional(),
    title: z.string().optional(),
    username: z.string().optional(),
    first_name: z.string().optional(),
    last_name: z.string().optional()
  })
  .passthrough();

const telegramMessageSchema = z
  .object({
    message_id: telegramIdSchema,
    date: z.number().optional(),
    chat: telegramChatSchema,
    from: telegramUserSchema.optional(),
    text: z.string().optional(),
    caption: z.string().optional(),
    reply_to_message: z
      .object({
        message_id: telegramIdSchema
      })
      .passthrough()
      .optional()
  })
  .passthrough();

export const telegramUpdateSchema = z
  .object({
    update_id: z.number(),
    message: telegramMessageSchema.optional(),
    edited_message: telegramMessageSchema.optional(),
    channel_post: telegramMessageSchema.optional()
  })
  .passthrough();

export type TelegramNormalizeResult =
  | {
      status: "message";
      updateId: number;
      updateType: "message" | "edited_message" | "channel_post";
      message: IncomingMessage;
    }
  | {
      status: "ignored";
      updateId?: number;
      reason: string;
      issues?: string[];
    };

function displayNameFor(
  person:
    | {
        first_name?: string | undefined;
        last_name?: string | undefined;
        username?: string | undefined;
      }
    | undefined
): string | undefined {
  if (!person) return undefined;
  const name = [person.first_name, person.last_name].filter(Boolean).join(" ").trim();
  if (name.length > 0) return name;
  return person.username;
}

function timestampFromTelegramDate(value: number | undefined): string {
  if (value === undefined) return nowIso();
  const timestamp = new Date(value * 1000);
  if (Number.isNaN(timestamp.getTime())) return nowIso();
  return timestamp.toISOString();
}

export function getTelegramSenderId(message: IncomingMessage): string | undefined {
  const telegram = message.metadata.telegram;
  if (!telegram || typeof telegram !== "object" || Array.isArray(telegram)) return undefined;
  const fromId = (telegram as Record<string, unknown>).fromId;
  return typeof fromId === "string" ? fromId : undefined;
}

export function normalizeTelegramUpdate(update: unknown): TelegramNormalizeResult {
  const parsed = telegramUpdateSchema.safeParse(update);
  if (!parsed.success) {
    return {
      status: "ignored",
      reason: "invalid_update",
      issues: parsed.error.issues.map((issue) => issue.message)
    };
  }

  const updateType = parsed.data.message
    ? "message"
    : parsed.data.edited_message
      ? "edited_message"
      : parsed.data.channel_post
        ? "channel_post"
        : undefined;
  if (!updateType) {
    return {
      status: "ignored",
      updateId: parsed.data.update_id,
      reason: "unsupported_update_type"
    };
  }

  const source =
    updateType === "message"
      ? parsed.data.message
      : updateType === "edited_message"
        ? parsed.data.edited_message
        : parsed.data.channel_post;
  if (!source) {
    return {
      status: "ignored",
      updateId: parsed.data.update_id,
      reason: "unsupported_update_type"
    };
  }
  const text = source.text ?? source.caption;
  if (!text || text.trim().length === 0) {
    return {
      status: "ignored",
      updateId: parsed.data.update_id,
      reason: "non_text_message"
    };
  }

  const message: IncomingMessage = {
    id: String(source.message_id),
    provider: "telegram",
    chatId: String(source.chat.id),
    userId: "local-owner",
    text,
    timestamp: timestampFromTelegramDate(source.date),
    attachments: [],
    metadata: {
      telegram: {
        updateId: parsed.data.update_id,
        updateType,
        messageId: String(source.message_id),
        chatId: String(source.chat.id),
        chatType: source.chat.type,
        chatTitle: source.chat.title,
        fromId: source.from ? String(source.from.id) : undefined,
        fromIsBot: source.from?.is_bot,
        contentKind: source.text ? "text" : "caption"
      }
    }
  };
  const username = source.from?.username ?? source.chat.username;
  if (username !== undefined) message.username = username;
  const displayName = displayNameFor(source.from) ?? displayNameFor(source.chat);
  if (displayName !== undefined) message.displayName = displayName;
  const replyToMessageId = source.reply_to_message?.message_id;
  if (replyToMessageId !== undefined) message.replyToMessageId = String(replyToMessageId);

  return {
    status: "message",
    updateId: parsed.data.update_id,
    updateType,
    message
  };
}
