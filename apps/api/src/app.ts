import {
  createAiProviderFromEnv,
  type AiProvider,
  type AiProviderStatus,
  type IncomingMessage,
  type ToolResult
} from "@ryanos/ai";
import {
  createCoreToolRegistry,
  InMemoryRyanStore,
  type Area,
  type DailyPlan,
  type Item,
  type ProviderAccount,
  type Project,
  type RecurrenceEvent,
  type RecurrencePolicy,
  type RecurrenceState,
  type RyanStore,
  type ShoppingCatalogItem,
  type ShoppingListItem
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
import { nowIso, type JsonObject } from "@ryanos/shared";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import {
  acceptEmailProposal,
  DEFAULT_EMAIL_SCAN_QUERY,
  emailTriageSettings,
  gmailProposalCounts,
  parseScanMax,
  proposalView,
  rejectEmailProposal,
  scanGmailInbox,
  syncGmailAccounts,
  type GmailClientLike
} from "./email-triage.js";
import { GogGmailClient } from "./gog-gmail.js";
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
  includeHidden: z
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

const dailyPlanPromptBodySchema = z.object({
  userId: z.string().default("local-owner"),
  timezone: z.string().default("America/Chicago"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sendTelegram: z.boolean().default(false),
  telegramChatId: z.string().optional()
});

const mobileWidgetItemsQuerySchema = z.object({
  userId: z.string().default("local-owner"),
  timezone: z.string().default("America/Chicago"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
  recurrenceLeadDays: z.coerce.number().int().min(0).max(30).default(1)
});

const mobileCreateItemBodySchema = z.object({
  userId: z.string().default("local-owner"),
  timezone: z.string().default("America/Chicago"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  title: z.string().min(1),
  kind: z.enum(["task", "reminder", "decision", "note", "waiting", "habit", "opportunity_action", "other"]).default("task"),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  dueAt: z.string().optional(),
  body: z.string().optional()
});

const mobileToggleItemBodySchema = z.object({
  userId: z.string().default("local-owner"),
  completed: z.boolean(),
  timezone: z.string().default("America/Chicago"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toggle: z.boolean().default(false),
  allowEarly: z.boolean().default(false)
});

const shoppingCategorySchema = z.enum([
  "grocery",
  "personal care",
  "household good",
  "health",
  "miscellaneous"
]);

const shoppingListQuerySchema = z.object({
  userId: z.string().default("local-owner"),
  lingerHours: z.coerce.number().int().min(1).max(168).default(24),
  suggestions: z.coerce.number().int().min(0).max(50).default(12)
});

const shoppingCreateItemBodySchema = z.object({
  userId: z.string().default("local-owner"),
  name: z.string().min(1),
  category: shoppingCategorySchema.optional(),
  quantity: z.string().optional(),
  note: z.string().optional(),
  source: z.string().default("manual")
});

const shoppingItemParamsSchema = z.object({
  itemId: z.string().min(1)
});

const shoppingPatchItemBodySchema = z.object({
  userId: z.string().default("local-owner"),
  name: z.string().min(1).optional(),
  category: shoppingCategorySchema.optional(),
  quantity: z.string().nullable().optional(),
  note: z.string().nullable().optional()
});

const shoppingCheckItemBodySchema = z.object({
  userId: z.string().default("local-owner"),
  checked: z.boolean()
});

const shoppingSuggestionsQuerySchema = z.object({
  userId: z.string().default("local-owner"),
  limit: z.coerce.number().int().min(1).max(50).default(12)
});

const aiSmokeBodySchema = z.object({
  userId: z.string().default("local-owner"),
  text: z
    .string()
    .default("Setup check only: reply that the Codex bridge is working. Do not create tasks or use tools.")
});

const emailAccountsQuerySchema = z.object({
  userId: z.string().default("local-owner")
});

const emailAccountParamsSchema = z.object({
  id: z.string().min(1)
});

const emailAccountSettingsBodySchema = z.object({
  userId: z.string().default("local-owner"),
  enabled: z.boolean()
});

const emailScanBodySchema = z.object({
  userId: z.string().default("local-owner"),
  accountId: z.string().optional(),
  query: z.string().optional(),
  maxPerAccount: z.number().int().min(1).max(100).optional(),
  syncAccounts: z.boolean().default(true)
});

const emailProposalsQuerySchema = z.object({
  userId: z.string().default("local-owner"),
  status: z.enum(["proposed", "accepted", "rejected"]).default("proposed"),
  limit: z.coerce.number().int().min(1).max(100).default(25)
});

const emailProposalParamsSchema = z.object({
  id: z.string().min(1)
});

const emailProposalActionBodySchema = z.object({
  userId: z.string().default("local-owner")
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
  timezone: z.string().default("America/Chicago"),
  allowEarly: z.boolean().default(false),
  referenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
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

const shoppingCategories = [
  "grocery",
  "personal care",
  "household good",
  "health",
  "miscellaneous"
] as const;

type ShoppingCategory = (typeof shoppingCategories)[number];

function normalizeShoppingName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, " ");
}

function inferShoppingCategory(name: string): ShoppingCategory {
  const normalized = normalizeShoppingName(name);
  if (/\b(vitamins?|medicine|medications?|supplements?|advil|tylenol|ibuprofen|bandages?)\b/.test(normalized)) {
    return "health";
  }
  if (/\b(detergent|dish soap|trash bags?|paper towels?|toilet paper|cleaner|sponges?|batter(y|ies)|laundry|car soap|car wash)\b/.test(normalized) || /\bsoap\b.*\bcar\b/.test(normalized)) {
    return "household good";
  }
  if (/\b(toothpaste|toothbrush|floss|deodorant|shampoo|conditioner|razor|mouthwash|soap)\b/.test(normalized)) {
    return "personal care";
  }
  if (/\b(gift|adapter|cable|notebook|misc)\b/.test(normalized)) {
    return "miscellaneous";
  }
  return "grocery";
}

function shoppingLingerAfter(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
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

function daysBetweenDateKeys(startDateKey: string, endDateKey: string): number {
  const start = parseDateKey(startDateKey);
  const end = parseDateKey(endDateKey);
  const startMs = Date.UTC(start.year, start.month - 1, start.day);
  const endMs = Date.UTC(end.year, end.month - 1, end.day);
  return Math.round((endMs - startMs) / (24 * 60 * 60 * 1000));
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
  const startDate = addDaysToDateKey(referenceDateKey, -6);
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
      cron: policy.cron,
      targetCount: policy.targetCount,
      targetWindowDays: policy.targetWindowDays,
      preferredDays: policy.preferredDays ?? []
    },
    state,
    week: {
      startDate,
      endDate: referenceDateKey,
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

function asJsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value ?? {})) as JsonObject;
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

function enrichToolInput(
  input: unknown,
  message: IncomingMessage,
  toolName: string,
  callIndex = 0
): unknown {
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
    enriched.idempotencyKey = `${message.provider}:${message.chatId}:${message.id}:${toolName}:${callIndex}`;
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

function emailScanConfig() {
  return {
    query: process.env.EMAIL_SCAN_QUERY?.trim() || DEFAULT_EMAIL_SCAN_QUERY,
    maxPerAccount: parseScanMax(process.env.EMAIL_SCAN_MAX_PER_ACCOUNT),
    cadenceMinutes: Math.min(
      Math.max(Number(process.env.EMAIL_SCAN_INTERVAL_MINUTES ?? "60") || 60, 5),
      1440
    ),
    enabled: process.env.EMAIL_TRIAGE_ENABLED !== "false"
  };
}

async function gmailSetupStatus(emailClient: GmailClientLike): Promise<SetupStatus> {
  const setupActions: SetupStatus["setupActions"] = [];
  const warnings: string[] = [];
  const gogHome = process.env.GOG_HOME?.trim() || "/app/.gogcli";
  const keyringBackend = process.env.GOG_KEYRING_BACKEND?.trim() || "file";
  const hasKeyringPassword = Boolean((process.env.GOG_KEYRING_PASSWORD ?? "").trim());
  const doctor = await emailClient.doctor();
  let accountCount = 0;

  if (!doctor.installed) {
    setupActions.push({
      id: "gmail-gog-install",
      title: "Install gog in the RyanOS API image",
      blocking: true,
      instructions: [
        "The production Docker image should include gog pinned to GOGCLI_VERSION.",
        "Rebuild and redeploy RyanOS on Lenovo after pulling the latest code."
      ],
      command: "scripts/deploy-lenovo.sh",
      docs: ["https://gogcli.sh/install.html"]
    });
  } else {
    try {
      accountCount = (await emailClient.listAccounts()).length;
    } catch (err) {
      warnings.push(
        `Could not list gog accounts: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  if (keyringBackend === "file" && !hasKeyringPassword) {
    setupActions.push({
      id: "gmail-keyring-password",
      title: "Set gog file keyring password",
      blocking: true,
      instructions: [
        "Set GOG_KEYRING_PASSWORD in /opt/ryanos/.env on Lenovo.",
        "Restart the API and worker containers after changing the environment."
      ],
      command: "ssh lenovo 'cd /opt/ryanos && ${EDITOR:-nano} .env && docker compose -f docker-compose.server.yml up -d api worker'"
    });
  }

  if (doctor.installed && (!doctor.ok || accountCount === 0)) {
    setupActions.push({
      id: "gmail-oauth-credentials",
      title: "Install Google OAuth client credentials",
      blocking: true,
      instructions: [
        "Place a desktop OAuth client JSON at /opt/ryanos/secrets/google-oauth-client.json on Lenovo.",
        "Register the credentials inside the API container before adding Gmail accounts."
      ],
      command: "ssh lenovo 'cd /opt/ryanos && docker compose -f docker-compose.server.yml exec api gog auth credentials /app/secrets/google-oauth-client.json'",
      docs: ["https://gogcli.sh/quickstart.html"]
    });
    setupActions.push({
      id: "gmail-auth-account",
      title: "Authorize each Gmail account with gog",
      blocking: true,
      instructions: [
        "Run the manual gog auth command from the API container for each Gmail account.",
        "Then run the sync command from RyanOS Admin or the API route."
      ],
      command: "ssh lenovo 'cd /opt/ryanos && docker compose -f docker-compose.server.yml exec api gog auth add account@gmail.com --services gmail --manual'",
      docs: ["https://gogcli.sh/quickstart.html"]
    });
  }

  if (doctor.installed && !doctor.ok) {
    setupActions.push({
      id: "gmail-auth-doctor",
      title: "Run gog auth doctor",
      blocking: false,
      instructions: [
        "Run gog auth doctor from the same API container environment RyanOS uses."
      ],
      command: "ssh lenovo 'cd /opt/ryanos && docker compose -f docker-compose.server.yml exec api gog auth doctor --check'"
    });
  }

  if (doctor.error) warnings.push(doctor.error);
  if (doctor.stderr) warnings.push(doctor.stderr);

  const ready = doctor.installed && doctor.ok && (keyringBackend !== "file" || hasKeyringPassword) && accountCount > 0;
  return {
    id: "gmail",
    name: "Gmail via gog",
    configured: doctor.installed && accountCount > 0,
    ready,
    setupRequired: setupActions.length > 0,
    setupActions,
    warnings
  };
}

async function gmailAccountView(store: RyanStore, account: ProviderAccount) {
  const [proposed, accepted, rejected] = await Promise.all([
    store.listEmailActionProposals({
      userId: account.userId,
      providerAccountId: account.id,
      status: "proposed",
      limit: 200
    }),
    store.listEmailActionProposals({
      userId: account.userId,
      providerAccountId: account.id,
      status: "accepted",
      limit: 200
    }),
    store.listEmailActionProposals({
      userId: account.userId,
      providerAccountId: account.id,
      status: "rejected",
      limit: 200
    })
  ]);
  return {
    id: account.id,
    provider: account.provider,
    externalAccountId: account.externalAccountId,
    displayName: account.displayName,
    email: account.email,
    status: account.status,
    scopes: account.scopes,
    settings: emailTriageSettings(account),
    proposalCounts: {
      proposed: proposed.length,
      accepted: accepted.length,
      rejected: rejected.length
    },
    createdAt: account.createdAt,
    updatedAt: account.updatedAt
  };
}

export function buildApp(options: { ai?: AiProvider; store?: RyanStore; emailClient?: GmailClientLike } = {}) {
  const app = Fastify({
    logger: true
  });
  const corsOrigins = corsOriginsFromEnv();
  const database = process.env.DATABASE_URL ? createDb() : undefined;
  const store = options.store ?? (database
    ? new PostgresRyanStore(database.db)
    : new InMemoryRyanStore());
  const messageStore = database ? new PostgresMessageStore(database.db) : undefined;
  const tools = createCoreToolRegistry(store);
  const ai = options.ai ?? createAiProviderFromEnv();
  const emailClient = options.emailClient ?? new GogGmailClient();

  async function runAiSmoke(input: { userId: string; text: string }) {
    const status = await ai.getStatus();
    const startedAt = Date.now();
    if (!status.ready || ai.name === "none") {
      const firstAction = status.setupActions[0];
      const firstInstruction = firstAction?.instructions[0];
      return {
        ok: false,
        status,
        interpreted: {
          text: firstAction
            ? `${firstAction.title}${firstInstruction ? `: ${firstInstruction}` : "."}`
            : "AI interpretation is not configured.",
          toolCalls: []
        },
        latencyMs: 0
      };
    }

    const message: IncomingMessage = {
      id: `ai-smoke:${crypto.randomUUID()}`,
      provider: "system",
      chatId: "ai-smoke",
      userId: input.userId,
      text: input.text,
      timestamp: nowIso(),
      attachments: [],
      metadata: {
        kind: "ai_smoke"
      }
    };
    const interpreted = await ai.interpret(message, []);
    return {
      ok:
        !interpreted.setupRequired &&
        interpreted.toolCalls.length === 0 &&
        interpreted.text !== undefined &&
        interpreted.text.trim().length > 0,
      status,
      interpreted,
      latencyMs: Date.now() - startedAt
    };
  }

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
      reply.header("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
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

  app.post("/v1/ai/smoke", async (request, reply) => {
    const body = aiSmokeBodySchema.parse(request.body ?? {});
    const result = await runAiSmoke(body);
    if (!result.ok) reply.code(503);
    return result;
  });

  app.get("/v1/setup/status", async () => {
    const aiStatus = await ai.getStatus();
    return {
      ai: aiSetupStatus(aiStatus),
      integrations: [
        await telegramSetupStatus(database?.db),
        await gmailSetupStatus(emailClient)
      ]
    };
  });

  app.get("/v1/email/accounts", async (request) => {
    const query = emailAccountsQuerySchema.parse(request.query);
    const [setup, accounts, counts] = await Promise.all([
      gmailSetupStatus(emailClient),
      store.listProviderAccounts({
        userId: query.userId,
        provider: "gmail",
        limit: 200
      }),
      gmailProposalCounts(store, query.userId)
    ]);
    return {
      setup,
      config: emailScanConfig(),
      counts,
      accounts: await Promise.all(accounts.map((account) => gmailAccountView(store, account)))
    };
  });

  app.post("/v1/email/accounts/sync", async (request, reply) => {
    const query = emailAccountsQuerySchema.parse(request.body ?? {});
    try {
      await syncGmailAccounts({
        store,
        client: emailClient,
        userId: query.userId
      });
      const accounts = await store.listProviderAccounts({
        userId: query.userId,
        provider: "gmail",
        limit: 200
      });
      return {
        accounts: await Promise.all(accounts.map((account) => gmailAccountView(store, account)))
      };
    } catch (err) {
      reply.code(503);
      return {
        error: err instanceof Error ? err.message : String(err)
      };
    }
  });

  app.patch("/v1/email/accounts/:id/settings", async (request, reply) => {
    const params = emailAccountParamsSchema.parse(request.params);
    const body = emailAccountSettingsBodySchema.parse(request.body);
    const account = await store.getProviderAccount(params.id);
    if (!account || account.userId !== body.userId || account.provider !== "gmail") {
      reply.code(404);
      return { error: `Gmail account not found: ${params.id}` };
    }
    const updated = await store.updateProviderAccount(account.id, {
      status: body.enabled ? "active" : "disabled",
      metadata: asJsonObject({
        ...account.metadata,
        emailTriage: {
          ...(asRecord(account.metadata.emailTriage) ?? {}),
          enabled: body.enabled
        }
      })
    });
    return {
      account: await gmailAccountView(store, updated)
    };
  });

  app.post("/v1/email/scan", async (request, reply) => {
    const body = emailScanBodySchema.parse(request.body ?? {});
    const status = await ai.getStatus();
    if (!status.ready) {
      reply.code(503);
      return {
        error: "AI provider is not ready.",
        status
      };
    }
    const scanInput: Parameters<typeof scanGmailInbox>[0] = {
      ai,
      store,
      client: emailClient,
      userId: body.userId,
      query: body.query ?? emailScanConfig().query,
      maxPerAccount: body.maxPerAccount ?? emailScanConfig().maxPerAccount,
      syncAccounts: body.syncAccounts
    };
    if (body.accountId !== undefined) scanInput.accountId = body.accountId;
    const result = await scanGmailInbox(scanInput);
    return {
      result
    };
  });

  app.get("/v1/email/proposals", async (request) => {
    const query = emailProposalsQuerySchema.parse(request.query);
    const proposals = await store.listEmailActionProposals({
      userId: query.userId,
      status: query.status,
      limit: query.limit
    });
    return {
      proposals: await Promise.all(proposals.map((proposal) => proposalView(store, proposal)))
    };
  });

  app.post("/v1/email/proposals/:id/accept", async (request, reply) => {
    const params = emailProposalParamsSchema.parse(request.params);
    const body = emailProposalActionBodySchema.parse(request.body ?? {});
    try {
      const result = await acceptEmailProposal({
        store,
        userId: body.userId,
        proposalId: params.id
      });
      return {
        proposal: await proposalView(store, result.proposal),
        item: result.item
      };
    } catch (err) {
      reply.code(400);
      return {
        error: err instanceof Error ? err.message : String(err)
      };
    }
  });

  app.post("/v1/email/proposals/:id/reject", async (request, reply) => {
    const params = emailProposalParamsSchema.parse(request.params);
    const body = emailProposalActionBodySchema.parse(request.body ?? {});
    try {
      const proposal = await rejectEmailProposal({
        store,
        userId: body.userId,
        proposalId: params.id
      });
      return {
        proposal: await proposalView(store, proposal)
      };
    } catch (err) {
      reply.code(400);
      return {
        error: err instanceof Error ? err.message : String(err)
      };
    }
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

  type DashboardItemBase = Item & {
    scope: DashboardScope;
    completion: {
      completedToday: boolean;
      completedAt?: string;
    };
    recurrence?: ReturnType<typeof recurrenceProgress>;
  };

  type DashboardItem = DashboardItemBase & {
    priorityScore: number;
    prioritySignals: string[];
    hiddenUntil?: string;
  };

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

  function cadenceDueDateKey(item: DashboardItemBase, timeZone: string): string | undefined {
    const policyType = item.recurrence?.policy.type;
    if (policyType !== "completion_based" && policyType !== "minimum_interval") return undefined;
    const nextDueAt = item.recurrence?.state?.nextDueAt;
    return nextDueAt === undefined ? undefined : localDateKey(new Date(nextDueAt), timeZone);
  }

  function scoreDashboardItem(
    item: DashboardItemBase,
    timeZone: string,
    referenceDateKey: string
  ): Pick<DashboardItem, "priorityScore" | "prioritySignals" | "hiddenUntil"> {
    const signals: string[] = [];

    if (item.status === "done") {
      return {
        priorityScore: item.completion.completedToday ? 1 : 0,
        prioritySignals: item.completion.completedToday ? ["completed today"] : ["done"]
      };
    }

    let score = priorityRank(item.priority) * 10;
    signals.push(`${item.priority} priority`);

    if (item.status === "waiting") {
      score -= 12;
      signals.push("waiting");
    }

    if (item.kind === "opportunity_action") {
      score += 18;
      signals.push("opportunity");
    }

    if (item.dueAt !== undefined) {
      const dueKey = localDateKey(new Date(item.dueAt), timeZone);
      const daysUntilDue = daysBetweenDateKeys(referenceDateKey, dueKey);
      if (daysUntilDue < 0) {
        score += 60 + Math.min(40, Math.abs(daysUntilDue) * 6);
        signals.push(`${Math.abs(daysUntilDue)}d overdue`);
      } else if (daysUntilDue === 0) {
        score += 50;
        signals.push("due today");
      } else if (daysUntilDue === 1) {
        score += 16;
        signals.push("due tomorrow");
      } else if (daysUntilDue <= 7) {
        score += Math.max(2, 10 - daysUntilDue);
        signals.push(`due in ${daysUntilDue}d`);
      } else if (daysUntilDue <= 14) {
        score += Math.max(1, 8 - Math.ceil(daysUntilDue / 2));
        signals.push(`due in ${daysUntilDue}d`);
      }
    }

    const cadenceDueKey = cadenceDueDateKey(item, timeZone);
    if (cadenceDueKey !== undefined) {
      const attentionDateKey = addDaysToDateKey(cadenceDueKey, -1);
      if (referenceDateKey < attentionDateKey) {
        return {
          priorityScore: Math.max(0, Math.min(score, 5)),
          prioritySignals: [...signals, `hidden until ${attentionDateKey}`, `next due ${cadenceDueKey}`],
          hiddenUntil: attentionDateKey
        };
      }

      const daysUntilDue = daysBetweenDateKeys(referenceDateKey, cadenceDueKey);
      if (daysUntilDue === 1) {
        score = Math.min(score, 12);
        signals.push("recurs tomorrow");
      } else if (daysUntilDue === 0) {
        score += 32;
        signals.push("recurs today");
      } else if (daysUntilDue < 0) {
        score += 48 + Math.min(40, Math.abs(daysUntilDue) * 6);
        signals.push(`${Math.abs(daysUntilDue)}d stale`);
      }
    }

    if (item.recurrence?.policy.type === "target_frequency") {
      const target = item.recurrence.week.targetCount ?? item.recurrence.policy.targetCount ?? 0;
      const completed = item.recurrence.week.completedCount;
      const remaining = Math.max(0, target - completed);
      const lastCompletedAt = item.recurrence.state?.lastCompletedAt;
      const daysSinceLastCompleted =
        lastCompletedAt === undefined
          ? item.recurrence.week.targetWindowDays + 1
          : Math.max(0, daysBetweenDateKeys(localDateKey(new Date(lastCompletedAt), timeZone), referenceDateKey));
      const completedToday = item.recurrence.week.days.some(
        (day) => day.date === referenceDateKey && day.status === "completed"
      );

      if (remaining <= 0) {
        score -= 18;
        signals.push("target met");
      } else {
        score += remaining * 7;
        score += Math.min(32, daysSinceLastCompleted * 4);
        signals.push(`${remaining} left`);
        signals.push(`${daysSinceLastCompleted}d since last`);

        if (remaining > 0) score += 24;
        if (remaining >= Math.max(2, target)) {
          score += 21;
          signals.push("behind target");
        }

        if (completedToday) {
          score -= 14;
          signals.push("done today");
        }
      }
    } else if (item.recurrence !== undefined && cadenceDueKey === undefined) {
      score += Math.min(12, item.recurrence.state?.stalenessScore ?? 0);
    }

    return {
      priorityScore: Math.max(0, Math.round(score)),
      prioritySignals: signals
    };
  }

  function withDashboardPriority(item: DashboardItemBase, timeZone: string, referenceDateKey: string): DashboardItem {
    return {
      ...item,
      ...scoreDashboardItem(item, timeZone, referenceDateKey)
    };
  }

  function compareDashboardItems(a: DashboardItem, b: DashboardItem): number {
    if (a.status === "done" && b.status !== "done") return 1;
    if (a.status !== "done" && b.status === "done") return -1;
    if (a.priorityScore !== b.priorityScore) return b.priorityScore - a.priorityScore;
    const aDue = a.dueAt ?? a.recurrence?.state?.nextDueAt ?? "9999-12-31T23:59:59.999Z";
    const bDue = b.dueAt ?? b.recurrence?.state?.nextDueAt ?? "9999-12-31T23:59:59.999Z";
    if (aDue !== bDue) return aDue.localeCompare(bDue);
    return b.createdAt.localeCompare(a.createdAt);
  }

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
    const dashboardItem: DashboardItemBase = {
      ...item,
      scope,
      completion
    };
    if (!policy) return withDashboardPriority(dashboardItem, timeZone, referenceDateKey);

    const [events, state] = await Promise.all([
      store.listRecurrenceEvents(policy.id),
      store.getRecurrenceState(policy.id)
    ]);
    return withDashboardPriority({
      ...dashboardItem,
      recurrence: recurrenceProgress(policy, state, events, timeZone, referenceDateKey)
    }, timeZone, referenceDateKey);
  }

  function itemEffort(item: DashboardItem): "easy" | "medium" | "big" {
    if (item.estimateMinutes !== undefined && item.estimateMinutes <= 20) return "easy";
    if (item.estimateMinutes !== undefined && item.estimateMinutes >= 90) return "big";
    if (item.priority === "urgent" || item.priority === "high") return "big";
    if (item.kind === "opportunity_action") return "big";
    if (item.recurrence !== undefined || item.kind === "habit" || item.kind === "reminder") return "easy";
    return "medium";
  }

  function itemVisibleByDefault(item: DashboardItem): boolean {
    return item.hiddenUntil === undefined;
  }

  function itemNeedsAttentionToday(item: DashboardItem, timeZone: string, dateKey: string): boolean {
    if (item.status === "done") return item.completion.completedToday;
    if (item.dueAt !== undefined && localDateKey(new Date(item.dueAt), timeZone) <= dateKey) return true;
    if (item.recurrence === undefined) return false;
    const cadenceDueKey = cadenceDueDateKey(item, timeZone);
    if (cadenceDueKey !== undefined) return cadenceDueKey <= dateKey;
    const today = item.recurrence.week.days.find((day) => day.date === dateKey);
    if (today?.status === "completed") return false;
    const target = item.recurrence.week.targetCount;
    return target !== undefined && item.recurrence.week.completedCount < target;
  }

  function planScore(item: DashboardItem, timeZone: string, dateKey: string): number {
    let score = item.priorityScore;
    if (itemNeedsAttentionToday(item, timeZone, dateKey)) score += 35;
    if (item.kind === "opportunity_action") score += 18;
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
    const dashboardItems = await Promise.all(items.map((item) => itemForDashboard(item, timeZone, dateKey)));
    return dashboardItems.filter(itemVisibleByDefault).sort(compareDashboardItems);
  }

  function dashboardItemCheckedForMobile(item: DashboardItem, dateKey: string): boolean {
    return item.recurrence?.week.days.some((day) => day.date === dateKey && day.status === "completed") ??
      (item.status === "done");
  }

  function mobileWidgetItemVisible(
    item: DashboardItem,
    timeZone: string,
    dateKey: string,
    recurrenceLeadDays: number
  ): boolean {
    if (item.recurrence === undefined) return true;
    if (dashboardItemCheckedForMobile(item, dateKey)) return true;
    const cadenceDueKey = cadenceDueDateKey(item, timeZone);
    if (cadenceDueKey === undefined) return true;
    return dateKey >= addDaysToDateKey(cadenceDueKey, -recurrenceLeadDays);
  }

  function compareMobileWidgetItems(a: DashboardItem, b: DashboardItem, dateKey: string): number {
    const aChecked = dashboardItemCheckedForMobile(a, dateKey);
    const bChecked = dashboardItemCheckedForMobile(b, dateKey);
    if (aChecked && !bChecked) return 1;
    if (!aChecked && bChecked) return -1;
    return compareDashboardItems(a, b);
  }

  async function mobileWidgetItemsForDay(
    userId: string,
    timeZone: string,
    dateKey: string,
    recurrenceLeadDays: number
  ): Promise<DashboardItem[]> {
    const dayBounds = localDayBounds(dateKey, timeZone);
    const items = await store.listItems({
      userId,
      statuses: ["open", "active", "waiting"],
      completedAfter: dayBounds.start,
      completedBefore: dayBounds.end,
      limit: 100
    });
    const dashboardItems = await Promise.all(items.map((item) => itemForDashboard(item, timeZone, dateKey)));
    return dashboardItems
      .filter((item) => mobileWidgetItemVisible(item, timeZone, dateKey, recurrenceLeadDays))
      .sort((a, b) => compareMobileWidgetItems(a, b, dateKey));
  }

  type MobileWidgetItemAction =
    | {
        type: "item_complete";
        itemId: string;
      }
    | {
        type: "recurrence_day";
        itemId: string;
        date: string;
        allowEarly: boolean;
      };

  type MobileWidgetRecurrenceDay = {
    date: string;
    weekday: string;
    status: string;
    allowEarly: boolean;
    isToday: boolean;
    isIntended: boolean;
  };

  type MobileWidgetRecurrence = {
    summary: string;
    days: MobileWidgetRecurrenceDay[];
    intendedDate?: string;
    nextDueAt?: string;
    lastDoneLabel?: string;
  };

  type MobileWidgetItem = {
    id: string;
    title: string;
    kind: Item["kind"];
    status: Item["status"];
    checked: boolean;
    priority: Item["priority"];
    priorityScore: number;
    prioritySignals: string[];
    action: MobileWidgetItemAction;
    dueAt?: string;
    secondaryText?: string;
    recurrence?: MobileWidgetRecurrence;
    scope?: {
      area?: ReturnType<typeof areaForDashboard>;
      project?: ReturnType<typeof projectForDashboard>;
    };
  };

  function ordinalDay(day: number): string {
    if (day % 100 >= 11 && day % 100 <= 13) return `${day}th`;
    switch (day % 10) {
      case 1:
        return `${day}st`;
      case 2:
        return `${day}nd`;
      case 3:
        return `${day}rd`;
      default:
        return `${day}th`;
    }
  }

  function monthlyCronDay(cron: string | undefined): number | undefined {
    const parts = cron?.trim().split(/\s+/);
    if (parts?.length !== 5) return undefined;
    const [, , dayOfMonth, month, dayOfWeek] = parts;
    if (month !== "*" || (dayOfWeek !== "*" && dayOfWeek !== "?")) return undefined;
    if (!/^\d{1,2}$/.test(dayOfMonth ?? "")) return undefined;
    const day = Number(dayOfMonth);
    return day >= 1 && day <= 31 ? day : undefined;
  }

  function mobileRecurrenceSummary(recurrence: NonNullable<DashboardItem["recurrence"]>): string {
    const target = recurrence.week.targetCount;
    if (target !== undefined) return `${recurrence.week.completedCount}/${target}`;
    if (recurrence.policy.type === "fixed_schedule") {
      const monthlyDay = monthlyCronDay(recurrence.policy.cron);
      if (monthlyDay !== undefined) return `Monthly ${ordinalDay(monthlyDay)}`;
    }
    if (recurrence.policy.type === "minimum_interval" && recurrence.policy.minimumIntervalDays !== undefined) {
      return `Min ${recurrence.policy.minimumIntervalDays}d`;
    }
    if (recurrence.policy.type === "completion_based" && recurrence.policy.intervalDays !== undefined) {
      return `${recurrence.policy.intervalDays}d`;
    }
    return `${recurrence.week.completedCount}`;
  }

  function mobileDueAt(item: DashboardItem): string | undefined {
    return item.dueAt ?? item.recurrence?.state?.nextDueAt;
  }

  function mobileRecurrenceCompleted(item: DashboardItem, dateKey: string): boolean {
    return dashboardItemCheckedForMobile(item, dateKey);
  }

  function mobileRecurrenceEarly(item: DashboardItem, dateKey: string, timeZone: string): boolean {
    const nextEligibleAt = item.recurrence?.state?.nextEligibleAt;
    if (item.recurrence?.policy.minimumIntervalDays === undefined || nextEligibleAt === undefined) return false;
    return dateKey < localDateKey(new Date(nextEligibleAt), timeZone);
  }

  function mobileSecondaryText(item: DashboardItem, timeZone: string): string | undefined {
    const labels = [item.scope.area?.name, item.scope.project?.name].filter(
      (label): label is string => label !== undefined
    );
    const dueAt = mobileDueAt(item);
    if (dueAt !== undefined) {
      labels.unshift(localDateKey(new Date(dueAt), timeZone));
    }
    return labels.length === 0 ? undefined : labels.slice(0, 2).join(" / ");
  }

  function mobileRecurrenceLastDoneLabel(item: DashboardItem, timeZone: string, dateKey: string): string | undefined {
    const lastCompletedAt = item.recurrence?.state?.lastCompletedAt;
    if (lastCompletedAt === undefined) return "not done yet";
    const lastDateKey = localDateKey(new Date(lastCompletedAt), timeZone);
    const daysAgo = Math.max(0, daysBetweenDateKeys(lastDateKey, dateKey));
    return daysAgo === 0 ? "done today" : `last ${daysAgo}d ago`;
  }

  function mobileRecurrenceForDashboard(
    item: DashboardItem,
    timeZone: string,
    dateKey: string
  ): MobileWidgetRecurrence | undefined {
    const recurrence = item.recurrence;
    if (recurrence === undefined) return undefined;
    const intendedDate =
      recurrence.state?.nextDueAt === undefined ? undefined : localDateKey(new Date(recurrence.state.nextDueAt), timeZone);
    const widgetRecurrence: MobileWidgetRecurrence = {
      summary: mobileRecurrenceSummary(recurrence),
      days: recurrence.week.days.map((day) => ({
        date: day.date,
        weekday: day.weekday,
        status: day.status,
        allowEarly: mobileRecurrenceEarly(item, day.date, timeZone),
        isToday: day.date === dateKey,
        isIntended: intendedDate === day.date
      }))
    };
    if (intendedDate !== undefined) widgetRecurrence.intendedDate = intendedDate;
    if (recurrence.state?.nextDueAt !== undefined) widgetRecurrence.nextDueAt = recurrence.state.nextDueAt;
    const lastDoneLabel = mobileRecurrenceLastDoneLabel(item, timeZone, dateKey);
    if (lastDoneLabel !== undefined) widgetRecurrence.lastDoneLabel = lastDoneLabel;
    return widgetRecurrence;
  }

  function mobileWidgetItemForDashboard(item: DashboardItem, timeZone: string, dateKey: string): MobileWidgetItem {
    const hasRecurrence = item.recurrence !== undefined;
    const action: MobileWidgetItemAction = hasRecurrence
      ? {
          type: "recurrence_day",
          itemId: item.id,
          date: dateKey,
          allowEarly: mobileRecurrenceEarly(item, dateKey, timeZone)
        }
      : {
          type: "item_complete",
          itemId: item.id
        };
    const widgetItem: MobileWidgetItem = {
      id: item.id,
      title: item.title,
      kind: item.kind,
      status: item.status,
      checked: hasRecurrence ? mobileRecurrenceCompleted(item, dateKey) : item.status === "done",
      priority: item.priority,
      priorityScore: item.priorityScore,
      prioritySignals: item.prioritySignals,
      action
    };
    const dueAt = mobileDueAt(item);
    if (dueAt !== undefined) widgetItem.dueAt = dueAt;
    const secondaryText = mobileSecondaryText(item, timeZone);
    if (secondaryText !== undefined) widgetItem.secondaryText = secondaryText;
    const recurrence = mobileRecurrenceForDashboard(item, timeZone, dateKey);
    if (recurrence !== undefined) widgetItem.recurrence = recurrence;
    if (item.scope.area !== undefined || item.scope.project !== undefined) {
      widgetItem.scope = {};
      if (item.scope.area !== undefined) widgetItem.scope.area = item.scope.area;
      if (item.scope.project !== undefined) widgetItem.scope.project = item.scope.project;
    }
    return widgetItem;
  }

  async function mobileWidgetPayload(input: {
    userId: string;
    timezone: string;
    dateKey: string;
    limit: number;
    recurrenceLeadDays: number;
  }) {
    const items = await mobileWidgetItemsForDay(
      input.userId,
      input.timezone,
      input.dateKey,
      input.recurrenceLeadDays
    );
    return {
      date: input.dateKey,
      timezone: input.timezone,
      generatedAt: nowIso(),
      items: items
        .slice(0, input.limit)
        .map((item) => mobileWidgetItemForDashboard(item, input.timezone, input.dateKey))
    };
  }

  type ShoppingItemView = {
    id: string;
    name: string;
    normalizedName: string;
    category: string;
    quantity?: string;
    note?: string;
    checked: boolean;
    checkedAt?: string;
    source: string;
    sortOrder: number;
    catalogItemId?: string;
    createdAt: string;
    updatedAt: string;
  };

  type ShoppingSuggestionView = {
    id: string;
    name: string;
    normalizedName: string;
    category: string;
    lastPurchasedAt?: string;
    purchaseCount: number;
  };

  function shoppingItemView(item: ShoppingListItem): ShoppingItemView {
    const view: ShoppingItemView = {
      id: item.id,
      name: item.name,
      normalizedName: item.normalizedName,
      category: item.category,
      checked: item.checkedAt !== undefined,
      source: item.source,
      sortOrder: item.sortOrder,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    };
    if (item.quantity !== undefined) view.quantity = item.quantity;
    if (item.note !== undefined) view.note = item.note;
    if (item.checkedAt !== undefined) view.checkedAt = item.checkedAt;
    if (item.catalogItemId !== undefined) view.catalogItemId = item.catalogItemId;
    return view;
  }

  function shoppingSuggestionView(item: ShoppingCatalogItem): ShoppingSuggestionView {
    const view: ShoppingSuggestionView = {
      id: item.id,
      name: item.name,
      normalizedName: item.normalizedName,
      category: item.defaultCategory,
      purchaseCount: item.purchaseCount
    };
    if (item.lastPurchasedAt !== undefined) view.lastPurchasedAt = item.lastPurchasedAt;
    return view;
  }

  async function shoppingSuggestions(input: {
    userId: string;
    activeNormalizedNames: Set<string>;
    limit: number;
  }): Promise<ShoppingSuggestionView[]> {
    const catalogItems = await store.listShoppingCatalogItems({
      userId: input.userId,
      limit: Math.max(input.limit * 3, input.limit)
    });
    return catalogItems
      .filter((item) => !input.activeNormalizedNames.has(item.normalizedName))
      .slice(0, input.limit)
      .map(shoppingSuggestionView);
  }

  async function shoppingListPayload(input: {
    userId: string;
    lingerHours: number;
    suggestions: number;
  }) {
    const list = await store.getDefaultShoppingList(input.userId);
    const items = await store.listShoppingItems({
      userId: input.userId,
      listId: list.id,
      checkedAfter: shoppingLingerAfter(input.lingerHours),
      limit: 200
    });
    const activeNormalizedNames = new Set(items.map((item) => item.normalizedName));
    return {
      list: {
        id: list.id,
        name: list.name
      },
      categories: shoppingCategories,
      lingerHours: input.lingerHours,
      items: items.map(shoppingItemView),
      suggestions: await shoppingSuggestions({
        userId: input.userId,
        activeNormalizedNames,
        limit: input.suggestions
      })
    };
  }

  async function findShoppingCatalogItem(userId: string, normalizedName: string): Promise<ShoppingCatalogItem | undefined> {
    const catalogItems = await store.listShoppingCatalogItems({ userId, limit: 100 });
    return catalogItems.find((item) => item.normalizedName === normalizedName);
  }

  async function rememberShoppingPurchase(item: ShoppingListItem, checkedAt: string): Promise<void> {
    const existing = await findShoppingCatalogItem(item.userId, item.normalizedName);
    await store.upsertShoppingCatalogItem({
      userId: item.userId,
      name: item.name,
      normalizedName: item.normalizedName,
      defaultCategory: item.category,
      lastPurchasedAt: checkedAt,
      purchaseCount: (existing?.purchaseCount ?? 0) + 1,
      metadata: existing?.metadata ?? {}
    });
  }

  async function createShoppingItemPayload(body: z.infer<typeof shoppingCreateItemBodySchema>) {
    const list = await store.getDefaultShoppingList(body.userId);
    const normalizedName = normalizeShoppingName(body.name);
    const existingItems = await store.listShoppingItems({
      userId: body.userId,
      listId: list.id,
      checkedAfter: shoppingLingerAfter(24),
      limit: 200
    });
    const existing = existingItems.find((item) => item.normalizedName === normalizedName);
    const catalogItem = await findShoppingCatalogItem(body.userId, normalizedName);
    const category = body.category ?? catalogItem?.defaultCategory ?? inferShoppingCategory(body.name);
    if (existing) {
      const updated = await store.updateShoppingItem(existing.id, {
        name: body.name.trim(),
        normalizedName,
        category,
        checkedAt: null,
        ...(body.quantity !== undefined ? { quantity: body.quantity } : {}),
        ...(body.note !== undefined ? { note: body.note } : {})
      });
      return {
        item: shoppingItemView(updated),
        ...(await shoppingListPayload({ userId: body.userId, lingerHours: 24, suggestions: 12 }))
      };
    }

    const createData: Parameters<typeof store.createShoppingItem>[0] = {
      userId: body.userId,
      listId: list.id,
      name: body.name.trim(),
      normalizedName,
      category,
      source: body.source
    };
    if (catalogItem !== undefined) createData.catalogItemId = catalogItem.id;
    if (body.quantity !== undefined) createData.quantity = body.quantity;
    if (body.note !== undefined) createData.note = body.note;
    const created = await store.createShoppingItem(createData);
    return {
      item: shoppingItemView(created),
      ...(await shoppingListPayload({ userId: body.userId, lingerHours: 24, suggestions: 12 }))
    };
  }

  async function checkShoppingItemPayload(
    itemId: string,
    body: z.infer<typeof shoppingCheckItemBodySchema>,
    reply: FastifyReply
  ) {
    const existing = await store.getShoppingItem(itemId);
    if (!existing || existing.userId !== body.userId) {
      reply.code(404);
      return { error: "Shopping item not found" };
    }
    const checkedAt = body.checked ? nowIso() : null;
    const updated = await store.updateShoppingItem(itemId, { checkedAt });
    if (body.checked && checkedAt !== null) {
      await rememberShoppingPurchase(updated, checkedAt);
    }
    return {
      item: shoppingItemView(updated),
      ...(await shoppingListPayload({ userId: body.userId, lingerHours: 24, suggestions: 12 }))
    };
  }

  async function ensureDailyPlanPromptMessage(input: {
    userId: string;
    dateKey: string;
    provider?: "web" | "telegram";
    chatId?: string;
  }): Promise<StoredMessage | undefined> {
    if (!messageStore) return undefined;
    const provider = input.provider ?? "web";
    const chatId = input.chatId ?? "dashboard";
    return messageStore.saveOutgoingMessage({
      provider,
      chatId,
      userId: input.userId,
      text: dailyPlanPrompt,
      providerMessageId:
        provider === "web" && chatId === "dashboard"
          ? `daily-plan-prompt:${input.dateKey}`
          : `daily-plan-prompt:${provider}:${chatId}:${input.dateKey}`,
      metadata: {
        kind: "daily_plan_prompt",
        dateKey: input.dateKey
      }
    });
  }

  async function sendDailyPlanPromptToTelegram(input: {
    userId: string;
    dateKey: string;
    telegramChatId?: string | undefined;
  }): Promise<AssistantDelivery> {
    const chatId = input.telegramChatId ?? csvValues(process.env.TELEGRAM_ALLOWED_USER_IDS)[0];
    if (!chatId) {
      return {
        provider: "telegram",
        status: "skipped",
        reason: "telegram_chat_id_missing"
      };
    }
    const storedMessage = await ensureDailyPlanPromptMessage({
      userId: input.userId,
      dateKey: input.dateKey,
      provider: "telegram",
      chatId
    });
    if (!storedMessage) {
      return {
        provider: "telegram",
        status: "skipped",
        reason: "message_store_missing"
      };
    }
    if (storedMessage.duplicate) {
      return {
        provider: "telegram",
        status: "skipped",
        reason: "duplicate_prompt"
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
      const result = await sendTelegramMessage({
        token: tokenResolution.token,
        chatId,
        text: dailyPlanPrompt
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

  app.get("/v1/shopping/list", async (request) => {
    const query = shoppingListQuerySchema.parse(request.query);
    return shoppingListPayload({
      userId: query.userId,
      lingerHours: query.lingerHours,
      suggestions: query.suggestions
    });
  });

  app.post("/v1/shopping/items", async (request) => {
    const body = shoppingCreateItemBodySchema.parse(request.body);
    return createShoppingItemPayload(body);
  });

  app.patch("/v1/shopping/items/:itemId", async (request, reply) => {
    const params = shoppingItemParamsSchema.parse(request.params);
    const body = shoppingPatchItemBodySchema.parse(request.body);
    const existing = await store.getShoppingItem(params.itemId);
    if (!existing || existing.userId !== body.userId) {
      reply.code(404);
      return { error: "Shopping item not found" };
    }
    const patch: Parameters<typeof store.updateShoppingItem>[1] = {};
    if (body.name !== undefined) {
      patch.name = body.name.trim();
      patch.normalizedName = normalizeShoppingName(body.name);
    }
    if (body.category !== undefined) patch.category = body.category;
    if (body.quantity !== undefined) patch.quantity = body.quantity;
    if (body.note !== undefined) patch.note = body.note;
    const updated = await store.updateShoppingItem(params.itemId, patch);
    return {
      item: shoppingItemView(updated),
      ...(await shoppingListPayload({ userId: body.userId, lingerHours: 24, suggestions: 12 }))
    };
  });

  app.post("/v1/shopping/items/:itemId/check", async (request, reply) => {
    const params = shoppingItemParamsSchema.parse(request.params);
    const body = shoppingCheckItemBodySchema.parse(request.body);
    return checkShoppingItemPayload(params.itemId, body, reply);
  });

  app.get("/v1/shopping/suggestions", async (request) => {
    const query = shoppingSuggestionsQuerySchema.parse(request.query);
    const list = await store.getDefaultShoppingList(query.userId);
    const activeItems = await store.listShoppingItems({
      userId: query.userId,
      listId: list.id,
      limit: 200
    });
    return {
      suggestions: await shoppingSuggestions({
        userId: query.userId,
        activeNormalizedNames: new Set(activeItems.map((item) => item.normalizedName)),
        limit: query.limit
      })
    };
  });

  app.get("/v1/mobile/shopping/list", async (request) => {
    const query = shoppingListQuerySchema.parse(request.query);
    return shoppingListPayload({
      userId: query.userId,
      lingerHours: query.lingerHours,
      suggestions: query.suggestions
    });
  });

  app.post("/v1/mobile/shopping/items", async (request) => {
    const body = shoppingCreateItemBodySchema.parse(request.body);
    return createShoppingItemPayload(body);
  });

  app.post("/v1/mobile/shopping/items/:itemId/check", async (request, reply) => {
    const params = shoppingItemParamsSchema.parse(request.params);
    const body = shoppingCheckItemBodySchema.parse(request.body);
    return checkShoppingItemPayload(params.itemId, body, reply);
  });

  app.get("/v1/daily-plan", async (request) => {
    const query = dailyPlanQuerySchema.parse(request.query);
    const dateKey = query.date ?? localDateKey(new Date(), query.timezone);
    await ensureDailyPlanPromptMessage({ userId: query.userId, dateKey });
    return dailyPlanPayload({
      userId: query.userId,
      timezone: query.timezone,
      dateKey
    });
  });

  app.post("/v1/daily-plan/prompt", async (request) => {
    const body = dailyPlanPromptBodySchema.parse(request.body ?? {});
    const dateKey = body.date ?? localDateKey(new Date(), body.timezone);
    const webMessage = await ensureDailyPlanPromptMessage({
      userId: body.userId,
      dateKey
    });
    const telegram = body.sendTelegram
      ? await sendDailyPlanPromptToTelegram({
          userId: body.userId,
          dateKey,
          telegramChatId: body.telegramChatId
        })
      : undefined;
    return {
      date: dateKey,
      timezone: body.timezone,
      prompt: dailyPlanPrompt,
      web: webMessage
        ? {
            status: webMessage.duplicate ? "duplicate" : "stored",
            messageId: webMessage.id
          }
        : {
            status: "skipped",
            reason: "message_store_missing"
          },
      ...(telegram ? { telegram } : {})
    };
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
            priorityScore: item.priorityScore,
            prioritySignals: item.prioritySignals,
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
        enrichToolInput(suggestedInput, suggestionMessage, toolCall.name, 0)
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

  app.get("/v1/mobile/widget-items", async (request) => {
    const query = mobileWidgetItemsQuerySchema.parse(request.query);
    const dateKey = query.date ?? localDateKey(new Date(), query.timezone);
    return mobileWidgetPayload({
      userId: query.userId,
      timezone: query.timezone,
      dateKey,
      limit: query.limit,
      recurrenceLeadDays: query.recurrenceLeadDays
    });
  });

  app.post("/v1/mobile/items", async (request, reply) => {
    const body = mobileCreateItemBodySchema.parse(request.body);
    const dateKey = body.date ?? localDateKey(new Date(), body.timezone);
    const input: Record<string, unknown> = {
      userId: body.userId,
      title: body.title,
      kind: body.kind,
      priority: body.priority
    };
    if (body.dueAt !== undefined) input.dueAt = body.dueAt;
    if (body.body !== undefined) input.body = body.body;
    const result = await tools.execute("item.create", input);
    if (result.status === "failed" || result.status === "rejected" || result.status === "needs_clarification") {
      reply.code(400);
      return { result };
    }
    const created = (result.data as { item?: Item } | undefined)?.item;
    const dashboardItem = created === undefined ? undefined : await itemForDashboard(created, body.timezone, dateKey);
    return {
      result,
      item:
        dashboardItem === undefined
          ? undefined
          : mobileWidgetItemForDashboard(dashboardItem, body.timezone, dateKey),
      widget: await mobileWidgetPayload({
        userId: body.userId,
        timezone: body.timezone,
        dateKey,
        limit: 100,
        recurrenceLeadDays: 1
      })
    };
  });

  app.post("/v1/mobile/items/:itemId/toggle", async (request, reply) => {
    const params = itemActionParamsSchema.parse(request.params);
    const body = mobileToggleItemBodySchema.parse(request.body);
    const dateKey = body.date ?? localDateKey(new Date(), body.timezone);
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

    const dashboardItem = await itemForDashboard(item, body.timezone, dateKey);
    const completed = body.toggle ? !dashboardItemCheckedForMobile(dashboardItem, dateKey) : body.completed;
    const result =
      dashboardItem.recurrence === undefined
        ? await tools.execute(completed ? "item.complete" : "item.uncomplete", {
            userId: body.userId,
            itemRef: params.itemId,
            completedAt: completed ? localDateTimeToUtcIso(dateKey, body.timezone, 12) : undefined
          })
        : await tools.execute("recurrence.recordEvent", {
            userId: body.userId,
            recurrenceRef: params.itemId,
            eventType: completed ? "completed" : "uncompleted",
            occurredAt: localDateTimeToUtcIso(dateKey, body.timezone, 12),
            overrideMinimumInterval: body.allowEarly
          });
    if (result.status === "needs_confirmation") {
      reply.code(409);
    } else if (result.status === "failed" || result.status === "rejected" || result.status === "needs_clarification") {
      reply.code(400);
    }
    const updated = await store.getItem(params.itemId);
    const updatedDashboardItem =
      updated === undefined ? undefined : await itemForDashboard(updated, body.timezone, dateKey);
    return {
      result,
      item:
        updatedDashboardItem === undefined
          ? undefined
          : mobileWidgetItemForDashboard(updatedDashboardItem, body.timezone, dateKey)
    };
  });

  app.get("/v1/items", async (request) => {
    const query = listItemsQuerySchema.parse(request.query);
    const referenceDateKey = query.date ?? localDateKey(new Date(), query.timezone);
    const dayBounds = localDayBounds(referenceDateKey, query.timezone);
    const filters: Parameters<typeof store.listItems>[0] = {
      userId: query.userId,
      limit: 100
    };
    const statuses = parseItemStatuses(query.status);
    if (statuses !== undefined) filters.statuses = statuses;
    if (query.includeDoneToday) {
      filters.completedAfter = dayBounds.start;
      filters.completedBefore = dayBounds.end;
    }
    const items = await store.listItems(filters);
    const dashboardItems = await Promise.all(
      items.map((item) => itemForDashboard(item, query.timezone, referenceDateKey))
    );
    const visibleItems = (query.includeHidden ? dashboardItems : dashboardItems.filter(itemVisibleByDefault))
      .sort(compareDashboardItems)
      .slice(0, query.limit);
    return {
      date: referenceDateKey,
      timezone: query.timezone,
      items: visibleItems
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
      occurredAt: localDateTimeToUtcIso(params.dateKey, body.timezone, 12),
      overrideMinimumInterval: body.allowEarly
    });
    if (result.status === "needs_confirmation") {
      reply.code(409);
    } else if (result.status === "failed" || result.status === "rejected") {
      reply.code(400);
    }
    const referenceDateKey = body.referenceDate ?? params.dateKey;
    return {
      result,
      item: await itemForDashboard(item, body.timezone, referenceDateKey)
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
    for (const [index, toolCall] of interpreted.toolCalls.entries()) {
      const result = await tools.execute(
        toolCall.name,
        enrichToolInput(toolCall.input, message, toolCall.name, index)
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
        enrichToolInput(body.toolCall.input, message, body.toolCall.name, 0)
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
