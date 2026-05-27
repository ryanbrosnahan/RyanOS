import { NoopAiProvider, type IncomingMessage, type ToolResult } from "@ryanos/ai";
import { createCoreToolRegistry, InMemoryRyanStore } from "@ryanos/core";
import { createDb, PostgresMessageStore, PostgresRyanStore, type StoredMessage } from "@ryanos/db";
import { nowIso } from "@ryanos/shared";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import { getTelegramSenderId, normalizeTelegramUpdate } from "./telegram.js";

const toolInvokeSchema = z.object({
  input: z.unknown()
});

const messageSchema = z.object({
  id: z.string().default(() => crypto.randomUUID()),
  provider: z.enum(["telegram", "whatsapp", "web", "system"]).default("web"),
  chatId: z.string().default("dev-chat"),
  userId: z.string().default("local-owner"),
  text: z.string(),
  timestamp: z.string().default(() => nowIso()),
  metadata: z.record(z.string(), z.unknown()).default({}),
  toolCall: z
    .object({
      name: z.string(),
      input: z.unknown()
    })
    .optional()
});

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function enrichToolInput(input: unknown, message: IncomingMessage, toolName: string): unknown {
  const record = asRecord(input);
  if (!record) return input;
  const enriched: Record<string, unknown> = {
    ...record,
    sourceMessageId: message.id,
    sourceProvider: message.provider,
    sourceChatId: message.chatId,
    sourceUserId: message.userId
  };
  if (typeof enriched.userId !== "string") {
    enriched.userId = message.userId;
  }
  if (typeof enriched.idempotencyKey !== "string") {
    enriched.idempotencyKey = `${message.provider}:${message.chatId}:${message.id}:${toolName}`;
  }
  return enriched;
}

function toolResultResponseText(result: ToolResult): string | undefined {
  return result.messageForUser ?? result.clarificationPrompt ?? result.confirmationPrompt;
}

function aiTurnResponseText(
  interpretedText: string | undefined,
  toolResults: Array<{ name: string; result: ToolResult }>
): string | undefined {
  const toolMessages = toolResults
    .map((toolResult) => toolResultResponseText(toolResult.result))
    .filter((value): value is string => value !== undefined && value.trim().length > 0);
  if (toolMessages.length > 0) return toolMessages.join("\n");
  return interpretedText;
}

function telegramAuthorization(message: IncomingMessage): {
  allowed: boolean;
  configured: boolean;
  senderId?: string;
} {
  const allowedIds = (process.env.TELEGRAM_ALLOWED_USER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const senderId = getTelegramSenderId(message);
  if (allowedIds.length === 0) {
    return senderId === undefined
      ? { allowed: true, configured: false }
      : { allowed: true, configured: false, senderId };
  }
  if (senderId !== undefined && allowedIds.includes(senderId)) {
    return { allowed: true, configured: true, senderId };
  }
  return senderId === undefined
    ? { allowed: false, configured: true }
    : { allowed: false, configured: true, senderId };
}

export function buildApp() {
  const app = Fastify({
    logger: true
  });
  const database = process.env.DATABASE_URL ? createDb() : undefined;
  const store = database
    ? new PostgresRyanStore(database.db)
    : new InMemoryRyanStore();
  const messageStore = database ? new PostgresMessageStore(database.db) : undefined;
  const tools = createCoreToolRegistry(store);
  const ai = new NoopAiProvider();

  if (database) {
    app.addHook("onClose", async () => {
      await database.pool.end();
    });
  }

  app.get("/", async () => ({
    service: "RyanOS API",
    status: "ok",
    docs: ["ARCHITECTURE.md", "MESSAGE_PIPELINE.md", "TOOL_CONTRACTS.md"]
  }));

  app.get("/health", async () => ({
    status: "ok",
    service: "api",
    time: nowIso()
  }));

  app.get("/v1/tools", async () => ({
    tools: tools.list()
  }));

  app.post("/v1/tools/:name/invoke", async (request, reply) => {
    const params = z.object({ name: z.string() }).parse(request.params);
    const body = toolInvokeSchema.parse(request.body);
    const result = await tools.execute(params.name, body.input);
    if (result.status === "failed" || result.status === "rejected") {
      reply.code(400);
    }
    return result;
  });

  async function persistIncomingMessage(message: IncomingMessage): Promise<{
    message: IncomingMessage;
    storedMessage?: StoredMessage;
  }> {
    if (!messageStore) return { message };
    const storedMessage = await messageStore.saveIncomingMessage(message);
    return {
      storedMessage,
      message: {
        ...message,
        id: storedMessage.id,
        metadata: {
          ...message.metadata,
          externalMessageId: message.id,
          storedMessageId: storedMessage.id,
          persistedDuplicate: storedMessage.duplicate
        }
      }
    };
  }

  async function processPersistedMessage(
    message: IncomingMessage,
    storedMessage: StoredMessage | undefined,
    warnings: string[] = []
  ) {
    const interpreted = await ai.interpret(message, tools.list());
    const toolResults: Array<{ name: string; result: ToolResult }> = [];
    for (const toolCall of interpreted.toolCalls) {
      const result = await tools.execute(
        toolCall.name,
        enrichToolInput(toolCall.input, message, toolCall.name)
      );
      toolResults.push({ name: toolCall.name, result });
    }
    const response = await persistAssistantResponse(
      message,
      aiTurnResponseText(interpreted.text, toolResults),
      {
        mode: "ai-provider",
        aiProvider: ai.name,
        toolCallCount: toolResults.length
      }
    );
    return {
      mode: "ai-provider",
      provider: ai.name,
      message,
      ...(storedMessage ? { storedMessage } : {}),
      interpreted,
      toolResults,
      ...(response ? { response } : {}),
      ...(warnings.length > 0 ? { warnings } : {})
    };
  }

  async function processIncomingMessage(
    message: IncomingMessage,
    warnings: string[] = []
  ) {
    const persisted = await persistIncomingMessage(message);
    return processPersistedMessage(persisted.message, persisted.storedMessage, warnings);
  }

  app.post("/v1/messages", async (request, reply) => {
    const body = messageSchema.parse(request.body);
    const rawMessage: IncomingMessage = {
      id: body.id,
      provider: body.provider,
      chatId: body.chatId,
      userId: body.userId,
      text: body.text,
      timestamp: body.timestamp,
      attachments: [],
      metadata: body.metadata
    };
    const persisted = await persistIncomingMessage(rawMessage);
    const message = persisted.message;

    if (body.toolCall) {
      const result = await tools.execute(
        body.toolCall.name,
        enrichToolInput(body.toolCall.input, message, body.toolCall.name)
      );
      const response = await persistAssistantResponse(
        message,
        toolResultResponseText(result),
        {
          mode: "typed-tool-call",
          toolName: body.toolCall.name,
          resultStatus: result.status
        }
      );
      if (result.status === "failed" || result.status === "rejected") {
        reply.code(400);
      }
      return {
        mode: "typed-tool-call",
        message,
        ...(persisted.storedMessage ? { storedMessage: persisted.storedMessage } : {}),
        ...(response ? { response } : {}),
        result
      };
    }

    return processPersistedMessage(message, persisted.storedMessage);
  });

  async function handleTelegramWebhook(request: FastifyRequest, reply: FastifyReply) {
    const normalized = normalizeTelegramUpdate(request.body);
    if (normalized.status === "ignored") {
      if (normalized.reason === "invalid_update") reply.code(400);
      return normalized;
    }

    const authorization = telegramAuthorization(normalized.message);
    if (!authorization.allowed) {
      reply.code(403);
      return {
        status: "rejected",
        reason: "sender_not_allowed",
        senderId: authorization.senderId
      };
    }

    const warnings = authorization.configured
      ? []
      : ["TELEGRAM_ALLOWED_USER_IDS is not configured; accepting Telegram messages in local dev mode."];
    return processIncomingMessage(normalized.message, warnings);
  }

  app.post("/v1/webhooks/telegram", handleTelegramWebhook);
  app.post("/v1/inbound/telegram", handleTelegramWebhook);

  async function persistAssistantResponse(
    message: IncomingMessage,
    text: string | undefined,
    metadata: Record<string, unknown>
  ): Promise<{ text: string; storedMessage?: StoredMessage } | undefined> {
    if (!text || text.trim().length === 0) return undefined;
    if (!messageStore) return { text };
    const storedMessage = await messageStore.saveOutgoingMessage({
      provider: message.provider,
      chatId: message.chatId,
      userId: message.userId,
      text,
      providerMessageId: `response:${message.id}`,
      replyToMessageId: message.id,
      metadata: {
        ...metadata,
        sourceMessageId: message.id
      }
    });
    return { text, storedMessage };
  }

  app.get("/v1/dev/snapshot", async () => ({
    store: store.snapshot ? await store.snapshot() : { storeType: "unknown" },
    tools: tools.list()
  }));

  return app;
}
