import { createAiProviderFromEnv, type AiProviderStatus, type IncomingMessage, type ToolResult } from "@ryanos/ai";
import {
  createCoreToolRegistry,
  InMemoryRyanStore,
  type Area,
  type DailyPlan,
  type Item,
  type Project,
  type RecurrenceEvent,
  type RecurrencePolicy,
  type RecurrenceState
} from "@ryanos/core";
import {
  createDb,
  loadSecretVaultFromEnv,
  PostgresMessageStore,
  PostgresRyanStore,
  PostgresSecretStore,
  type RyanDb,
  type StoredMessage
} from "@ryanos/db";
import { nowIso } from "@ryanos/shared";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import { sendTelegramMessage } from "./telegram-client.js";
import { resolveTelegramBotToken } from "./telegram-credentials.js";
import { getTelegramSenderId, normalizeTelegramUpdate } from "./telegram.js";

const toolInvokeSchema = z.object({
  input: z.unknown()
});

const listMessagesQuerySchema = z.object({
  provider: z.enum(["telegram", "whatsapp", "web", "system"]).default("web"),
  chatId: z.string().default("dashboard"),
  userId: z.string().default("local-owner"),
  limit: z.coerce.number().int().min(1).max(100).default(30)
});

const itemStatusSchema = z.enum(["open", "active", "waiting", "done", "cancelled"]);

const listItemsQuerySchema = z.object({
  userId: z.string().default("local-owner"),
  status: z.string().optional(),
  includeDoneToday: z
    .preprocess((value) => value === "true" || value === "1" || value === true, z.boolean())
    .default(false),
  timezone: z.string().default("America/Chicago"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30)
});

const taxonomyQuerySchema = z.object({
  userId: z.string().default("local-owner")
});

const dailyPlanPrompt = "What 1-3 outcomes would make today count?";

const dailyPlanQuerySchema = z.object({
  userId: z.string().default("local-owner"),
  timezone: z.string().default("America/Chicago"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
});

const dailyPlanBodySchema = z.object({
  userId: z.string().default("local-owner"),
  timezone: z.string().default("America/Chicago"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  response: z.string().optional(),
  successCriteria: z.array(z.string()).default([]),
  selectedItemIds: z.array(z.string()).default([])
});

const itemActionParamsSchema = z.object({
  itemId: z.string().min(1)
});

const completeItemBodySchema = z.object({
  userId: z.string().default("local-owner"),
  completed: z.boolean(),
  completedAt: z.string().optional(),
  timezone: z.string().default("America/Chicago")
});

const recurrenceDayParamsSchema = itemActionParamsSchema.extend({
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

const recurrenceDayBodySchema = z.object({
  userId: z.string().default("local-owner"),
  completed: z.boolean(),
  timezone: z.string().default("America/Chicago")
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

const defaultCorsOrigins = ["http://localhost:3100", "http://127.0.0.1:3100"];

function csvValues(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function corsOriginsFromEnv(): Set<string> {
  const configured = csvValues(process.env.RYANOS_CORS_ORIGINS);
  return new Set(configured.length > 0 ? configured : defaultCorsOrigins);
}

function parseItemStatuses(value: string | undefined) {
  const statuses = csvValues(value);
  if (statuses.length === 0) return undefined;
  return statuses.map((status) => itemStatusSchema.parse(status));
}

function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

function parseDateKey(dateKey: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) throw new Error(`Invalid date key: ${dateKey}`);
  return {
    year: Number(match[1]!),
    month: Number(match[2]!),
    day: Number(match[3]!)
  };
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const { year, month, day } = parseDateKey(dateKey);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${padDatePart(date.getUTCMonth() + 1)}-${padDatePart(date.getUTCDate())}`;
}

function localDateParts(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second")
  };
}

function localDateKey(date: Date, timeZone: string): string {
  const parts = localDateParts(date, timeZone);
  return `${parts.year}-${padDatePart(parts.month)}-${padDatePart(parts.day)}`;
}

function localDateTimeToUtcIso(
  dateKey: string,
  timeZone: string,
  hour = 12,
  minute = 0,
  second = 0
): string {
  const { year, month, day } = parseDateKey(dateKey);
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const parts = localDateParts(guess, timeZone);
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const intendedAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  return new Date(guess.getTime() - (localAsUtc - intendedAsUtc)).toISOString();
}

function localDayBounds(dateKey: string, timeZone: string): { start: string; end: string } {
  return {
    start: localDateTimeToUtcIso(dateKey, timeZone, 0),
    end: localDateTimeToUtcIso(addDaysToDateKey(dateKey, 1), timeZone, 0)
  };
}

function weekStartDateKey(dateKey: string): string {
  const { year, month, day } = parseDateKey(dateKey);
  const date = new Date(Date.UTC(year, month - 1, day));
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  return addDaysToDateKey(dateKey, -mondayOffset);
}

function completionTarget(policy: RecurrencePolicy): number | undefined {
  if (policy.type === "target_frequency") return policy.targetCount;
  if (policy.type === "completion_based" || policy.type === "minimum_interval") return 1;
  return undefined;
}

function recurrenceProgress(
  policy: RecurrencePolicy,
  state: RecurrenceState | undefined,
  events: RecurrenceEvent[],
  timeZone: string,
  referenceDateKey: string
) {
  const startDate = weekStartDateKey(referenceDateKey);
  const dateKeys = Array.from({ length: 7 }, (_, index) => addDaysToDateKey(startDate, index));
  const dateKeySet = new Set(dateKeys);
  const latestByDay = new Map<string, RecurrenceEvent>();
  const orderedEvents = [...events].sort((a, b) => {
    const occurred = a.occurredAt.localeCompare(b.occurredAt);
    if (occurred !== 0) return occurred;
    return a.createdAt.localeCompare(b.createdAt);
  });

  for (const event of orderedEvents) {
    const eventDateKey = localDateKey(new Date(event.occurredAt), timeZone);
    if (dateKeySet.has(eventDateKey)) latestByDay.set(eventDateKey, event);
  }

  const days = dateKeys.map((dateKey) => {
    const event = latestByDay.get(dateKey);
    return {
      date: dateKey,
      weekday: new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        weekday: "short"
      }).format(new Date(`${dateKey}T12:00:00.000Z`)),
      status: event?.eventType ?? "none",
      eventId: event?.id,
      occurredAt: event?.occurredAt
    };
  });

  const completedCount = days.filter((day) => day.status === "completed").length;
  return {
    policy: {
      id: policy.id,
      type: policy.type,
      intervalDays: policy.intervalDays,
      minimumIntervalDays: policy.minimumIntervalDays,
      targetCount: policy.targetCount,
      targetWindowDays: policy.targetWindowDays,
      preferredDays: policy.preferredDays ?? []
    },
    state,
    week: {
      startDate,
      endDate: addDaysToDateKey(startDate, 6),
      days,
      completedCount,
      targetCount: completionTarget(policy),
      targetWindowDays: policy.targetWindowDays ?? 7
    }
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function metadataString(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function areaForDashboard(area: Area) {
  return {
    id: area.id,
    name: area.name,
    description: area.description,
    icon: metadataString(area.metadata, "icon") ?? "folder",
    color: metadataString(area.metadata, "color") ?? "stone"
  };
}

function projectForDashboard(project: Project) {
  return {
    id: project.id,
    name: project.name,
    areaId: project.areaId,
    description: project.description,
    icon: metadataString(project.metadata, "icon") ?? "folder-kanban",
    color: metadataString(project.metadata, "color") ?? "stone"
  };
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

type SetupStatus = {
  id: string;
  name: string;
  configured: boolean;
  ready: boolean;
  setupRequired: boolean;
  setupActions: Array<{
    id: string;
    title: string;
    blocking: boolean;
    instructions: string[];
    command?: string;
    docs?: string[];
  }>;
  warnings: string[];
};

type AssistantDelivery = {
  provider: "telegram";
  status: "sent" | "skipped" | "failed";
  source?: string;
  providerMessageId?: string;
  reason?: string;
  error?: string;
  warnings?: string[];
};

async function telegramSetupStatus(db: RyanDb | undefined): Promise<SetupStatus> {
  const hasEnvBotToken = Boolean((process.env.TELEGRAM_BOT_TOKEN ?? "").trim());
  const hasAllowlist = Boolean((process.env.TELEGRAM_ALLOWED_USER_IDS ?? "").trim());
  const setupActions: SetupStatus["setupActions"] = [];
  const warnings: string[] = [];
  const loadedVault = await loadSecretVaultFromEnv();
  let hasDbBotToken = false;
  let dbBotTokenDecryptable = false;

  if (!db) {
    if (!hasEnvBotToken) {
      setupActions.push({
        id: "telegram-database",
        title: "Enable database-backed Telegram setup",
        blocking: true,
        instructions: [
          "Run RyanOS with Postgres enabled before importing Telegram credentials.",
          "The Docker stack already provides this; direct host runs need `DATABASE_URL`."
        ],
        command: "docker compose up --build"
      });
    }
  } else {
    const secretStore = new PostgresSecretStore(db, loadedVault.vault);
    try {
      const secretStatus = await secretStore.getProviderSecretStatus({
        userId: "local-owner",
        provider: "telegram",
        externalAccountId: "bot",
        kind: "bot_token"
      });
      hasDbBotToken = secretStatus.exists;
      dbBotTokenDecryptable = secretStatus.decryptable === true || (secretStatus.exists && !loadedVault.vault);
      if (secretStatus.exists && secretStatus.decryptable === false) {
        setupActions.push({
          id: "telegram-secret-decrypt",
          title: "Restore the correct RyanOS master key",
          blocking: true,
          instructions: [
            "Telegram has an encrypted token in the database, but RyanOS could not decrypt it.",
            "Restore the master key that was used when the token was imported, or rotate the token and import it again."
          ]
        });
        if (secretStatus.error) warnings.push(secretStatus.error);
      }
    } catch (err) {
      warnings.push(
        `Could not inspect encrypted Telegram credentials: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  if (!hasDbBotToken && !hasEnvBotToken && !loadedVault.status.ready) {
    setupActions.push(...loadedVault.status.setupActions);
    warnings.push(...loadedVault.status.warnings);
  }

  if (!hasDbBotToken && !hasEnvBotToken) {
    setupActions.push({
      id: "telegram-bot-token",
      title: "Import Telegram bot token into encrypted DB",
      blocking: true,
      instructions: [
        "Create a Telegram bot with BotFather.",
        "Put the token in `secrets/telegram-bot-token` on this machine, then import it with the command below.",
        "The token file is gitignored; remove it after import if you do not want a plaintext local copy."
      ],
      command: "docker compose exec api pnpm telegram:store-token -- --file /app/secrets/telegram-bot-token",
      docs: ["https://core.telegram.org/bots/features#botfather"]
    });
  }

  if (hasEnvBotToken && !hasDbBotToken) {
    setupActions.push({
      id: "telegram-env-token-migration",
      title: "Migrate Telegram token out of environment",
      blocking: false,
      instructions: [
        "`TELEGRAM_BOT_TOKEN` is configured as a fallback, but RyanOS should store long-lived integration secrets encrypted in Postgres.",
        "Import the token into `secret_records`, then remove `TELEGRAM_BOT_TOKEN` from your local environment."
      ],
      command: "docker compose exec api pnpm telegram:store-token"
    });
  }

  if (hasDbBotToken && !hasEnvBotToken && !loadedVault.status.ready) {
    setupActions.push(...loadedVault.status.setupActions);
    warnings.push(...loadedVault.status.warnings);
  }

  if (!hasAllowlist) {
    warnings.push(
      "`TELEGRAM_ALLOWED_USER_IDS` is empty; local webhook testing accepts all Telegram sender IDs."
    );
  }

  const dbReady = hasDbBotToken && loadedVault.status.ready && dbBotTokenDecryptable;
  const envReady = hasEnvBotToken;

  return {
    id: "telegram",
    name: "Telegram",
    configured: hasDbBotToken || hasEnvBotToken,
    ready: dbReady || envReady,
    setupRequired: setupActions.length > 0,
    setupActions,
    warnings
  };
}

function aiSetupStatus(status: AiProviderStatus): SetupStatus {
  return {
    id: "ai",
    name: status.mode === "none" ? "AI provider" : `AI provider (${status.name})`,
    configured: status.mode !== "none",
    ready: status.ready,
    setupRequired: status.setupRequired,
    setupActions: status.setupActions,
    warnings: status.warnings
  };
}

export function buildApp() {
  const app = Fastify({
    logger: true
  });
  const corsOrigins = corsOriginsFromEnv();
  const database = process.env.DATABASE_URL ? createDb() : undefined;
  const store = database
    ? new PostgresRyanStore(database.db)
    : new InMemoryRyanStore();
  const messageStore = database ? new PostgresMessageStore(database.db) : undefined;
  const tools = createCoreToolRegistry(store);
  const ai = createAiProviderFromEnv();

  if (database) {
    app.addHook("onClose", async () => {
      await database.pool.end();
    });
  }

  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (typeof origin === "string" && corsOrigins.has(origin)) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Vary", "Origin");
      reply.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      reply.header(
        "Access-Control-Allow-Headers",
        typeof request.headers["access-control-request-headers"] === "string"
          ? request.headers["access-control-request-headers"]
          : "content-type, authorization"
      );
    }
    if (request.method === "OPTIONS") {
      reply.code(204).send();
    }
  });

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

  app.get("/v1/ai/status", async () => ai.getStatus());

  app.get("/v1/setup/status", async () => {
    const aiStatus = await ai.getStatus();
    return {
      ai: aiSetupStatus(aiStatus),
      integrations: [await telegramSetupStatus(database?.db)]
    };
  });

  app.get("/v1/messages", async (request) => {
    const query = listMessagesQuerySchema.parse(request.query);
    return {
      messages: messageStore ? await messageStore.listMessages(query) : []
    };
  });

  type DashboardScope = {
    area: ReturnType<typeof areaForDashboard> | undefined;
    project: ReturnType<typeof projectForDashboard> | undefined;
  };

  type DashboardItem = Item & {
    scope: DashboardScope;
    completion: {
      completedToday: boolean;
      completedAt?: string;
    };
    recurrence?: ReturnType<typeof recurrenceProgress>;
  };

  async function itemForDashboard(item: Item, timeZone: string, referenceDateKey: string): Promise<DashboardItem> {
    const [policy, itemArea, itemProject] = await Promise.all([
      store.findRecurrencePolicyForItem(item.id),
      item.areaId === undefined ? Promise.resolve(undefined) : store.getArea(item.areaId),
      item.projectId === undefined ? Promise.resolve(undefined) : store.getProject(item.projectId)
    ]);
    const projectArea =
      itemArea === undefined && itemProject?.areaId !== undefined
        ? await store.getArea(itemProject.areaId)
        : undefined;
    const area = itemArea ?? projectArea;
    const scope: DashboardScope = {
      area: area === undefined ? undefined : areaForDashboard(area),
      project: itemProject === undefined ? undefined : projectForDashboard(itemProject)
    };
    const dayBounds = localDayBounds(referenceDateKey, timeZone);
    const completion: DashboardItem["completion"] = {
      completedToday:
        item.status === "done" &&
        item.completedAt !== undefined &&
        item.completedAt >= dayBounds.start &&
        item.completedAt < dayBounds.end
    };
    if (item.completedAt !== undefined) completion.completedAt = item.completedAt;
    const dashboardItem: DashboardItem = {
      ...item,
      scope,
      completion
    };
    if (!policy) return dashboardItem;

    const [events, state] = await Promise.all([
      store.listRecurrenceEvents(policy.id),
      store.getRecurrenceState(policy.id)
    ]);
    return {
      ...dashboardItem,
      recurrence: recurrenceProgress(policy, state, events, timeZone, referenceDateKey)
    };
  }

  function itemEffort(item: DashboardItem): "easy" | "medium" | "big" {
    if (item.estimateMinutes !== undefined && item.estimateMinutes <= 20) return "easy";
    if (item.estimateMinutes !== undefined && item.estimateMinutes >= 90) return "big";
    if (item.priority === "urgent" || item.priority === "high") return "big";
    if (item.kind === "opportunity_action") return "big";
    if (item.recurrence !== undefined || item.kind === "habit" || item.kind === "reminder") return "easy";
    return "medium";
  }

  function itemNeedsAttentionToday(item: DashboardItem, timeZone: string, dateKey: string): boolean {
    if (item.status === "done") return item.completion.completedToday;
    if (item.dueAt !== undefined && localDateKey(new Date(item.dueAt), timeZone) <= dateKey) return true;
    if (item.recurrence === undefined) return false;
    const today = item.recurrence.week.days.find((day) => day.date === dateKey);
    if (today?.status === "completed") return false;
    const target = item.recurrence.week.targetCount;
    return target !== undefined && item.recurrence.week.completedCount < target;
  }

  function priorityRank(priority: Item["priority"]): number {
    switch (priority) {
      case "urgent":
        return 4;
      case "high":
        return 3;
      case "normal":
        return 2;
      case "low":
        return 1;
    }
  }

  function planScore(item: DashboardItem, timeZone: string, dateKey: string): number {
    let score = priorityRank(item.priority) * 10;
    if (itemNeedsAttentionToday(item, timeZone, dateKey)) score += 35;
    if (item.kind === "opportunity_action") score += 18;
    if (item.status === "waiting") score -= 10;
    if (item.recurrence !== undefined && item.recurrence.week.completedCount === 0) score += 8;
    if (item.dueAt !== undefined) {
      const dueKey = localDateKey(new Date(item.dueAt), timeZone);
      if (dueKey < dateKey) score += 20;
      if (dueKey === dateKey) score += 30;
    }
    return score;
  }

  function suggestedItemIds(items: DashboardItem[], timeZone: string, dateKey: string): string[] {
    const openItems = items.filter((item) => item.status !== "done");
    const ranked = [...openItems].sort((a, b) => planScore(b, timeZone, dateKey) - planScore(a, timeZone, dateKey));
    const selected: DashboardItem[] = [];
    for (const effort of ["easy", "medium", "big"] as const) {
      const match = ranked.find(
        (item) => itemEffort(item) === effort && !selected.some((selectedItem) => selectedItem.id === item.id)
      );
      if (match) selected.push(match);
    }
    for (const item of ranked) {
      if (selected.length >= 3) break;
      if (!selected.some((selectedItem) => selectedItem.id === item.id)) selected.push(item);
    }
    return selected.slice(0, 3).map((item) => item.id);
  }

  function planForDashboard(plan: DailyPlan | undefined, fallbackSuggestedIds: string[]) {
    if (!plan) {
      return {
        response: "",
        successCriteria: [],
        selectedItemIds: fallbackSuggestedIds,
        suggestedItemIds: fallbackSuggestedIds,
        suggestionSource: "heuristic",
        status: "active"
      };
    }
    return {
      id: plan.id,
      response: plan.response ?? "",
      successCriteria: plan.successCriteria,
      selectedItemIds: plan.selectedItemIds.length > 0 ? plan.selectedItemIds : fallbackSuggestedIds,
      suggestedItemIds: plan.suggestedItemIds.length > 0 ? plan.suggestedItemIds : fallbackSuggestedIds,
      suggestionSource: plan.suggestionSource,
      status: plan.status,
      updatedAt: plan.updatedAt
    };
  }

  async function dashboardItemsForDay(userId: string, timeZone: string, dateKey: string): Promise<DashboardItem[]> {
    const dayBounds = localDayBounds(dateKey, timeZone);
    const items = await store.listItems({
      userId,
      statuses: ["open", "active", "waiting"],
      completedAfter: dayBounds.start,
      completedBefore: dayBounds.end,
      limit: 100
    });
    return Promise.all(items.map((item) => itemForDashboard(item, timeZone, dateKey)));
  }

  async function ensureDailyPlanPromptMessage(userId: string, dateKey: string) {
    if (!messageStore) return;
    await messageStore.saveOutgoingMessage({
      provider: "web",
      chatId: "dashboard",
      userId,
      text: dailyPlanPrompt,
      providerMessageId: `daily-plan-prompt:${dateKey}`,
      metadata: {
        kind: "daily_plan_prompt",
        dateKey
      }
    });
  }

  async function dailyPlanPayload(input: { userId: string; timezone: string; dateKey: string }) {
    const [items, plan] = await Promise.all([
      dashboardItemsForDay(input.userId, input.timezone, input.dateKey),
      store.getDailyPlan(input.userId, input.dateKey)
    ]);
    const fallbackSuggestedIds = suggestedItemIds(items, input.timezone, input.dateKey);
    const dashboardPlan = planForDashboard(plan, fallbackSuggestedIds);
    const selectedIdSet = new Set(dashboardPlan.selectedItemIds);
    const suggestedIdSet = new Set(dashboardPlan.suggestedItemIds);
    const dueItems = items.filter((item) => itemNeedsAttentionToday(item, input.timezone, input.dateKey));
    return {
      date: input.dateKey,
      timezone: input.timezone,
      prompt: dailyPlanPrompt,
      plan: dashboardPlan,
      suggestedItems: items.filter((item) => suggestedIdSet.has(item.id)),
      selectedItems: items.filter((item) => selectedIdSet.has(item.id)),
      dueItems,
      items
    };
  }

  app.get("/v1/taxonomy", async (request) => {
    const query = taxonomyQuerySchema.parse(request.query);
    const [areas, projects] = await Promise.all([
      store.listAreas(query.userId),
      store.listProjects({ userId: query.userId, limit: 200 })
    ]);
    return {
      areas: areas.map(areaForDashboard),
      projects: projects.map(projectForDashboard)
    };
  });

  app.get("/v1/daily-plan", async (request) => {
    const query = dailyPlanQuerySchema.parse(request.query);
    const dateKey = query.date ?? localDateKey(new Date(), query.timezone);
    await ensureDailyPlanPromptMessage(query.userId, dateKey);
    return dailyPlanPayload({
      userId: query.userId,
      timezone: query.timezone,
      dateKey
    });
  });

  app.post("/v1/daily-plan", async (request) => {
    const body = dailyPlanBodySchema.parse(request.body);
    const dateKey = body.date ?? localDateKey(new Date(), body.timezone);
    const existing = await store.getDailyPlan(body.userId, dateKey);
    const selectedItemIds =
      body.selectedItemIds.length > 0
        ? body.selectedItemIds
        : existing?.selectedItemIds ?? existing?.suggestedItemIds ?? [];
    const suggestedItemIds =
      body.selectedItemIds.length > 0
        ? selectedItemIds
        : existing?.suggestedItemIds && existing.suggestedItemIds.length > 0
          ? existing.suggestedItemIds
          : selectedItemIds;
    const planInput: Parameters<typeof store.upsertDailyPlan>[0] = {
      userId: body.userId,
      dateKey,
      timezone: body.timezone,
      prompt: dailyPlanPrompt,
      successCriteria: body.successCriteria
        .map((criterion) => criterion.trim())
        .filter((criterion) => criterion.length > 0),
      selectedItemIds,
      suggestedItemIds,
      suggestionSource: "user",
      status: "active",
      metadata: {}
    };
    if (body.response !== undefined) planInput.response = body.response;
    await store.upsertDailyPlan(planInput);
    return dailyPlanPayload({
      userId: body.userId,
      timezone: body.timezone,
      dateKey
    });
  });

  app.post("/v1/daily-plan/suggest", async (request) => {
    const body = dailyPlanBodySchema.partial({ response: true, successCriteria: true, selectedItemIds: true }).parse(request.body);
    const dateKey = body.date ?? localDateKey(new Date(), body.timezone);
    const items = await dashboardItemsForDay(body.userId, body.timezone, dateKey);
    const recentPlans = await store.listDailyPlans({
      userId: body.userId,
      beforeDateKey: dateKey,
      limit: 5
    });
    const status = await ai.getStatus();
    if (!status.ready) {
      return {
        ...(await dailyPlanPayload({ userId: body.userId, timezone: body.timezone, dateKey })),
        suggestionAttempt: {
          source: "heuristic",
          warnings: status.warnings,
          setupRequired: status.setupRequired,
          setupActions: status.setupActions
        }
      };
    }

    const dailyPlanTools = tools.list().filter((tool) => tool.name === "daily_plan.upsert");
    const suggestionMessage: IncomingMessage = {
      id: `daily-plan-suggestion:${dateKey}`,
      provider: "system",
      chatId: "daily-plan",
      userId: body.userId,
      text: [
        "Create today's RyanOS daily focus suggestion.",
        `Date: ${dateKey}`,
        `Question: ${dailyPlanPrompt}`,
        "Select one to three item IDs. Prefer a realistic mix of one easy win, one medium item, and one important larger item when available.",
        "Use daily_plan.upsert exactly once. Put exact item IDs in selectedItemRefs and suggestedItemRefs.",
        "Do not answer the daily focus question for the user; leave response and successCriteria unset.",
        "Do not invent tasks.",
        "",
        "Recent daily focus responses:",
        JSON.stringify(
          recentPlans.map((plan) => ({
            dateKey: plan.dateKey,
            response: plan.response,
            successCriteria: plan.successCriteria,
            selectedItemIds: plan.selectedItemIds
          })),
          null,
          2
        ),
        "",
        "Available items:",
        JSON.stringify(
          items.map((item) => ({
            id: item.id,
            title: item.title,
            kind: item.kind,
            status: item.status,
            priority: item.priority,
            dueAt: item.dueAt,
            effort: itemEffort(item),
            needsAttentionToday: itemNeedsAttentionToday(item, body.timezone, dateKey),
            scope: item.scope
          })),
          null,
          2
        )
      ].join("\n"),
      timestamp: nowIso(),
      attachments: [],
      metadata: {
        kind: "daily_plan_suggestion",
        dateKey
      }
    };
    const interpreted = await ai.interpret(suggestionMessage, dailyPlanTools);

    const toolResults: Array<{ name: string; result: ToolResult }> = [];
    for (const toolCall of interpreted.toolCalls.filter((toolCall) => toolCall.name === "daily_plan.upsert").slice(0, 1)) {
      const suggestedInput: Record<string, unknown> = {
        ...(asRecord(toolCall.input) ?? {}),
        userId: body.userId,
        dateKey,
        timezone: body.timezone,
        prompt: dailyPlanPrompt,
        suggestionSource: "ai"
      };
      delete suggestedInput.response;
      delete suggestedInput.successCriteria;
      const result = await tools.execute(
        toolCall.name,
        enrichToolInput(suggestedInput, suggestionMessage, toolCall.name)
      );
      toolResults.push({ name: toolCall.name, result });
    }

    return {
      ...(await dailyPlanPayload({ userId: body.userId, timezone: body.timezone, dateKey })),
      suggestionAttempt: {
        source: "ai",
        interpreted,
        toolResults
      }
    };
  });

  app.get("/v1/items", async (request) => {
    const query = listItemsQuerySchema.parse(request.query);
    const referenceDateKey = query.date ?? localDateKey(new Date(), query.timezone);
    const dayBounds = localDayBounds(referenceDateKey, query.timezone);
    const filters: Parameters<typeof store.listItems>[0] = {
      userId: query.userId,
      limit: query.limit
    };
    const statuses = parseItemStatuses(query.status);
    if (statuses !== undefined) filters.statuses = statuses;
    if (query.includeDoneToday) {
      filters.completedAfter = dayBounds.start;
      filters.completedBefore = dayBounds.end;
    }
    const items = await store.listItems(filters);
    return {
      date: referenceDateKey,
      timezone: query.timezone,
      items: await Promise.all(
        items.map((item) => itemForDashboard(item, query.timezone, referenceDateKey))
      )
    };
  });

  app.post("/v1/items/:itemId/complete", async (request, reply) => {
    const params = itemActionParamsSchema.parse(request.params);
    const body = completeItemBodySchema.parse(request.body);
    const result = await tools.execute(body.completed ? "item.complete" : "item.uncomplete", {
      userId: body.userId,
      itemRef: params.itemId,
      completedAt: body.completed ? body.completedAt ?? nowIso() : undefined
    });
    if (result.status === "failed" || result.status === "rejected") {
      reply.code(400);
      return { result };
    }
    const item = await store.getItem(params.itemId);
    return {
      result,
      item: item ? await itemForDashboard(item, body.timezone, localDateKey(new Date(), body.timezone)) : undefined
    };
  });

  app.post("/v1/items/:itemId/recurrence-days/:dateKey", async (request, reply) => {
    const params = recurrenceDayParamsSchema.parse(request.params);
    const body = recurrenceDayBodySchema.parse(request.body);
    const item = await store.getItem(params.itemId);
    if (!item) {
      reply.code(404);
      return {
        result: {
          status: "failed",
          messageForUser: `Item not found: ${params.itemId}`
        }
      };
    }
    const result = await tools.execute("recurrence.recordEvent", {
      userId: body.userId,
      recurrenceRef: params.itemId,
      eventType: body.completed ? "completed" : "uncompleted",
      occurredAt: localDateTimeToUtcIso(params.dateKey, body.timezone, 12)
    });
    if (result.status === "failed" || result.status === "rejected") {
      reply.code(400);
    }
    return {
      result,
      item: await itemForDashboard(item, body.timezone, params.dateKey)
    };
  });

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
  ): Promise<{ text: string; storedMessage?: StoredMessage; delivery?: AssistantDelivery } | undefined> {
    if (!text || text.trim().length === 0) return undefined;
    if (!messageStore) {
      const delivery = await deliverAssistantResponse(message, text, false);
      return delivery ? { text, delivery } : { text };
    }
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
    const delivery = await deliverAssistantResponse(message, text, storedMessage.duplicate);
    return delivery ? { text, storedMessage, delivery } : { text, storedMessage };
  }

  async function deliverAssistantResponse(
    message: IncomingMessage,
    text: string,
    duplicate: boolean
  ): Promise<AssistantDelivery | undefined> {
    if (message.provider !== "telegram") return undefined;
    if (duplicate) {
      return {
        provider: "telegram",
        status: "skipped",
        reason: "duplicate_response"
      };
    }

    const tokenResolutionInput: { db?: RyanDb } = {};
    if (database) tokenResolutionInput.db = database.db;
    const tokenResolution = await resolveTelegramBotToken(tokenResolutionInput);
    if (!tokenResolution.token) {
      return {
        provider: "telegram",
        status: "skipped",
        reason: "telegram_token_missing",
        warnings: tokenResolution.warnings
      };
    }

    try {
      const externalMessageId =
        typeof message.metadata.externalMessageId === "string"
          ? message.metadata.externalMessageId
          : undefined;
      const result = await sendTelegramMessage({
        token: tokenResolution.token,
        chatId: message.chatId,
        text,
        ...(externalMessageId ? { replyToMessageId: externalMessageId } : {})
      });
      return {
        provider: "telegram",
        status: "sent",
        ...(tokenResolution.source ? { source: tokenResolution.source } : {}),
        ...(result.providerMessageId ? { providerMessageId: result.providerMessageId } : {}),
        ...(tokenResolution.warnings.length > 0 ? { warnings: tokenResolution.warnings } : {})
      };
    } catch (err) {
      return {
        provider: "telegram",
        status: "failed",
        ...(tokenResolution.source ? { source: tokenResolution.source } : {}),
        error: err instanceof Error ? err.message : String(err),
        ...(tokenResolution.warnings.length > 0 ? { warnings: tokenResolution.warnings } : {})
      };
    }
  }

  app.get("/v1/dev/snapshot", async () => ({
    store: store.snapshot ? await store.snapshot() : { storeType: "unknown" },
    tools: tools.list()
  }));

  return app;
}
