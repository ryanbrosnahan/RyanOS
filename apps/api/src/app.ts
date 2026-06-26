import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
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
  type ItemChecklistItem,
  type ItemProgressNote,
  type ProviderAccount,
  type Project,
  type RecurrenceEvent,
  type RecurrencePolicy,
  type RecurrenceState,
  type RyanStore,
  type ShoppingCatalogItem,
  type ShoppingListItem,
  type VocabularyEncounter,
  type VocabularyEntry
} from "@ryanos/core";
import {
  createDb,
  loadSecretVaultFromEnv,
  PostgresMessageStore,
  PostgresRyanStore,
  PostgresSecretStore,
  getRyanOsUserById,
  resolveAuthenticatedUserId,
  resolveUserIdByEmail,
  type RyanDb,
  type UserRole,
  type StoredMessage
} from "@ryanos/db";
import { nowIso, type JsonObject, type UUID } from "@ryanos/shared";
import { fromNodeHeaders } from "better-auth/node";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import { authModeFromEnv, createRyanOsAuth, type RyanOsAuthMode } from "./auth.js";
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
import {
  acceptOpportunityProposal,
  ingestOpportunityReport,
  opportunityProposalView,
  parseOpportunityReportIngestBody,
  rejectOpportunityProposal
} from "./opportunity-proposals.js";
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

const dailyPlanSuggestionPrompt = "Starred daily focus suggestion";

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

const itemDetailsQuerySchema = z.object({
  userId: z.string().default("local-owner"),
  timezone: z.string().default("America/Chicago"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
});

const progressNoteBodySchema = z.object({
  userId: z.string().default("local-owner"),
  timezone: z.string().default("America/Chicago"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  body: z.string().trim().min(1).max(4000),
  occurredAt: z.string().optional()
});

const progressNotePatchBodySchema = progressNoteBodySchema.partial({
  body: true,
  occurredAt: true
}).extend({
  userId: z.string().default("local-owner"),
  timezone: z.string().default("America/Chicago"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
});

const checklistItemBodySchema = z.object({
  userId: z.string().default("local-owner"),
  timezone: z.string().default("America/Chicago"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  title: z.string().trim().min(1).max(500)
});

const checklistItemPatchBodySchema = z.object({
  userId: z.string().default("local-owner"),
  timezone: z.string().default("America/Chicago"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  title: z.string().trim().min(1).max(500).optional(),
  checked: z.boolean().optional(),
  sortOrder: z.number().int().optional()
});

const checklistReorderBodySchema = z.object({
  userId: z.string().default("local-owner"),
  timezone: z.string().default("America/Chicago"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  checklistItemIds: z.array(z.string().min(1)).min(1)
});

const mobileToggleChecklistItemBodySchema = z.object({
  userId: z.string().default("local-owner"),
  checked: z.boolean().optional(),
  timezone: z.string().default("America/Chicago"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toggle: z.boolean().default(true)
});

const shoppingCategorySchema = z.enum([
  "grocery",
  "personal care",
  "household good",
  "health",
  "miscellaneous"
]);

const vocabularyCategories = [
  "general",
  "medical",
  "language",
  "technical",
  "slang",
  "proper_noun",
  "other"
] as const;

const vocabularyCategorySchema = z.enum(vocabularyCategories);

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

const vocabularyEntriesQuerySchema = z.object({
  userId: z.string().default("local-owner"),
  query: z.string().optional(),
  category: z.string().optional(),
  languageCode: z.string().optional(),
  tag: z.string().optional(),
  status: z.enum(["active", "archived"]).default("active"),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

const vocabularyCreateEntryBodySchema = z.object({
  userId: z.string().default("local-owner"),
  term: z.string().min(1),
  languageCode: z.string().optional(),
  category: vocabularyCategorySchema.optional(),
  definition: z.string().optional(),
  partOfSpeech: z.string().optional(),
  pronunciation: z.string().optional(),
  translation: z.string().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).default([]),
  sourceType: z.string().optional(),
  sourceTitle: z.string().optional(),
  sourceUrl: z.string().optional(),
  context: z.string().optional(),
  occurredAt: z.string().optional(),
  draftWithAi: z.boolean().default(true)
});

const vocabularyEntryParamsSchema = z.object({
  entryId: z.string().min(1)
});

const vocabularyPatchEntryBodySchema = z.object({
  userId: z.string().default("local-owner"),
  term: z.string().min(1).optional(),
  languageCode: z.string().optional(),
  category: vocabularyCategorySchema.optional(),
  definition: z.string().nullable().optional(),
  partOfSpeech: z.string().nullable().optional(),
  pronunciation: z.string().nullable().optional(),
  translation: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  status: z.enum(["active", "archived"]).optional(),
  deleted: z.boolean().optional()
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

const integrationIdSchema = z.enum(["ai", "telegram", "gmail", "codex_rfp"]);

const integrationParamsSchema = z.object({
  id: integrationIdSchema
});

const integrationSettingsBodySchema = z.object({
  userId: z.string().default("local-owner"),
  enabled: z.boolean()
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
  syncAccounts: z.boolean().default(true),
  includeNewAccounts: z.boolean().optional()
});

const gmailAuthBodySchema = z.object({
  userId: z.string().default("local-owner"),
  email: z.string().trim().email()
});

const gmailAuthCompleteBodySchema = gmailAuthBodySchema.extend({
  redirectUrl: z.string().trim().url()
});

const telegramTokenBodySchema = z.object({
  token: z.string().trim().min(1)
});

const telegramLinkCodeBodySchema = z.object({
  userId: z.string().default("local-owner")
});

const activeEmailScans = new Map<string, { startedAt: string }>();

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

const opportunityProposalsQuerySchema = z.object({
  userId: z.string().default("local-owner"),
  status: z.enum(["proposed", "accepted", "rejected"]).default("proposed"),
  projectSlug: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25)
});

const opportunityProposalParamsSchema = z.object({
  id: z.string().min(1)
});

const opportunityProposalActionBodySchema = z.object({
  userId: z.string().default("local-owner")
});

const itemActionParamsSchema = z.object({
  itemId: z.string().min(1)
});

const progressNoteParamsSchema = itemActionParamsSchema.extend({
  noteId: z.string().min(1)
});

const checklistItemParamsSchema = itemActionParamsSchema.extend({
  checklistItemId: z.string().min(1)
});

const completeItemBodySchema = z.object({
  userId: z.string().default("local-owner"),
  completed: z.boolean(),
  completedAt: z.string().optional(),
  timezone: z.string().default("America/Chicago")
});

const starItemBodySchema = z.object({
  userId: z.string().default("local-owner"),
  starred: z.boolean(),
  starredAt: z.string().optional(),
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

type VocabularyCategory = (typeof vocabularyCategories)[number];

function normalizeVocabularyTerm(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKC")
    .replace(/\s+/g, " ");
}

function normalizeLanguageCode(value: string | undefined): string {
  const normalized = (value ?? "en").trim().toLowerCase().replace("_", "-");
  return normalized.length > 0 ? normalized : "en";
}

function cleanVocabularyTags(tags: string[] | undefined): string[] {
  return [...new Set((tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
}

function inferVocabularyCategory(input: {
  term: string;
  languageCode?: string | undefined;
  category?: VocabularyCategory | undefined;
  context?: string | undefined;
  tags?: string[] | undefined;
}): VocabularyCategory {
  if (input.category !== undefined) return input.category;
  const languageCode = normalizeLanguageCode(input.languageCode);
  if (languageCode !== "en") return "language";
  const text = normalizeVocabularyTerm(`${input.term} ${input.context ?? ""} ${(input.tags ?? []).join(" ")}`);
  if (/\b(spanish|french|german|italian|foreign|translation|translate|language)\b/.test(text)) return "language";
  if (/\b(medical|medicine|clinical|doctor|diagnosis|symptom|disease|agonist|receptor|drug|dose|anatomy)\b/.test(text)) return "medical";
  if (/\b(api|code|database|protocol|algorithm|technical|software|hardware|server)\b/.test(text)) return "technical";
  if (/\b(slang|idiom|colloquial)\b/.test(text)) return "slang";
  if (/^[A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+)+$/u.test(input.term.trim())) return "proper_noun";
  return "general";
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

function envKeyValueMap(value: string | undefined): Map<string, string> {
  const trimmed = value?.trim();
  if (!trimmed) return new Map();
  if (trimmed.startsWith("{")) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch (err) {
      throw new Error(
        `Invalid JSON map configuration: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    const entries: Array<[string, string]> = Object.entries(parsed)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
      .map(([key, mapValue]) => [key.trim(), mapValue.trim()]);
    return new Map(entries.filter(([key]) => key.length > 0));
  }
  return new Map(
    trimmed
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const separator = entry.indexOf(":");
        return separator === -1
          ? undefined
          : [entry.slice(0, separator).trim(), entry.slice(separator + 1).trim()] as const;
      })
      .filter((entry): entry is readonly [string, string] => Boolean(entry?.[0] && entry[1]))
  );
}

function telegramUserEmailMap(): Map<string, string> {
  return envKeyValueMap(process.env.TELEGRAM_USER_EMAIL_MAP);
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
  const configuredAllowedIds = (process.env.TELEGRAM_ALLOWED_USER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const mappedIds = [...telegramUserEmailMap().keys()];
  const allowedIds = new Set([...configuredAllowedIds, ...mappedIds]);
  const senderId = getTelegramSenderId(message);
  if (allowedIds.size === 0) {
    return senderId === undefined
      ? { allowed: true, configured: false }
      : { allowed: true, configured: false, senderId };
  }
  if (senderId !== undefined && allowedIds.has(senderId)) {
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
      title: "Store Telegram bot token",
      blocking: true,
      instructions: [
        "Create a Telegram bot with BotFather.",
        "Paste the token into the Telegram settings section in RyanOS Admin while signed in as a superadmin.",
        "RyanOS stores the token encrypted in Postgres and never echoes it back."
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

type IntegrationId = z.infer<typeof integrationIdSchema>;

const integrationNames: Record<IntegrationId, string> = {
  ai: "AI provider",
  telegram: "Telegram",
  gmail: "Gmail",
  codex_rfp: "Codex RFP automations"
};

const codexRfpProvider = "codex_rfp_ingest";
const codexRfpTokenPrefix = "ryanos_rfp";
const codexRfpEndpointPath = "/api/v1/automation/rfp-reports/ingest";

function codexRfpMetadata(account: ProviderAccount | undefined): Record<string, unknown> {
  return asRecord(account?.metadata) ?? {};
}

function createCodexRfpToken(): {
  token: string;
  tokenId: string;
  secret: string;
  secretHash: string;
  tokenPreview: string;
} {
  const tokenId = randomBytes(8).toString("hex");
  const secret = randomBytes(24).toString("base64url");
  const token = `${codexRfpTokenPrefix}_${tokenId}_${secret}`;
  return {
    token,
    tokenId,
    secret,
    secretHash: hashCodexRfpSecret(tokenId, secret),
    tokenPreview: `${codexRfpTokenPrefix}_${tokenId}_...${secret.slice(-4)}`
  };
}

function parseCodexRfpToken(raw: string | undefined): { tokenId: string; secret: string } | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  const match = value.match(/^ryanos_rfp_([a-f0-9]{16})_(.+)$/);
  if (!match) return undefined;
  return {
    tokenId: match[1]!,
    secret: match[2]!
  };
}

function hashCodexRfpSecret(tokenId: string, secret: string): string {
  return createHash("sha256").update(`${tokenId}:${secret}`).digest("base64url");
}

function secureStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function codexRfpTokenFromRequest(request: FastifyRequest): string | undefined {
  const authorization = request.headers.authorization;
  if (typeof authorization === "string") {
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1]?.trim();
  }
  const header = request.headers["x-ryanos-ingest-token"];
  return Array.isArray(header) ? header[0] : header;
}

function validateTelegramBotToken(token: string): string {
  const trimmed = token.trim();
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(trimmed)) {
    throw new Error("Telegram bot token does not match the expected bot-token shape.");
  }
  return trimmed;
}

function telegramLinkCodeFromText(text: string): string | undefined {
  const trimmed = text.trim();
  const withoutStart = trimmed.toLowerCase().startsWith("/start")
    ? trimmed.slice("/start".length).trim()
    : trimmed;
  const match = withoutStart.match(/\b[A-Z0-9]{6}\b/i);
  return match?.[0]?.toUpperCase();
}

function telegramLinkCodeExpired(metadata: JsonObject): boolean {
  const expiresAt = typeof metadata.expiresAt === "string" ? metadata.expiresAt : undefined;
  return !expiresAt || new Date(expiresAt).getTime() <= Date.now();
}

function newTelegramLinkCode(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
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
      title: "Authorize Gmail accounts",
      blocking: true,
      instructions: [
        "Use the Gmail settings section in RyanOS Admin to start browser-assisted auth for each account.",
        "The CLI command remains available as a fallback if remote auth is not available in the current runtime."
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

type RyanOsRequestAuth = {
  authUserId: string;
  userId: string;
  email: string;
  role: UserRole;
  displayName?: string;
};

type RyanOsRequest = FastifyRequest & {
  ryanAuth?: RyanOsRequestAuth;
};

type AuthSessionPayload = {
  user?: {
    id?: string;
    email?: string;
    name?: string | null;
  };
};

export function buildApp(options: {
  ai?: AiProvider;
  store?: RyanStore;
  emailClient?: GmailClientLike;
  authMode?: RyanOsAuthMode;
  devLocalRole?: UserRole;
} = {}) {
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
  const authMode = options.authMode ?? authModeFromEnv();
  const devLocalRole = options.devLocalRole ?? "superadmin";
  const auth = database ? createRyanOsAuth(database.pool) : undefined;

  function currentUserId(request: RyanOsRequest): string {
    return authMode === "dev-local" ? "local-owner" : request.ryanAuth?.userId ?? "local-owner";
  }

  function currentRole(request: RyanOsRequest): UserRole {
    return authMode === "dev-local" ? devLocalRole : request.ryanAuth?.role ?? "user";
  }

  function requireSuperadmin(request: RyanOsRequest, reply: FastifyReply): boolean {
    if (currentRole(request) === "superadmin") return true;
    reply.code(403);
    void reply.send({ error: "Superadmin access is required." });
    return false;
  }

  async function integrationEnabled(userId: string, integrationId: IntegrationId): Promise<boolean> {
    const setting = await store.getUserIntegrationSetting(userId as UUID, integrationId);
    return setting?.enabled ?? true;
  }

  function setupForRole(entry: SetupStatus, role: UserRole): SetupStatus {
    if (role === "superadmin" || entry.setupActions.length === 0) return entry;
    return {
      ...entry,
      setupActions: [
        {
          id: `${entry.id}-superadmin-required`,
          title: "Deployment setup required",
          blocking: true,
          instructions: [
            "A RyanOS superadmin needs to finish this deployment-level setup before this integration can be used."
          ]
        }
      ]
    };
  }

  async function codexRfpAccountForUser(userId: UUID): Promise<ProviderAccount | undefined> {
    const accounts = await store.listProviderAccounts({
      userId,
      provider: codexRfpProvider,
      limit: 20
    });
    return accounts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  }

  async function codexRfpProposalCounts(userId: UUID) {
    const [proposed, accepted, rejected] = await Promise.all([
      store.listOpportunityProposals({ userId, status: "proposed", limit: 200 }),
      store.listOpportunityProposals({ userId, status: "accepted", limit: 200 }),
      store.listOpportunityProposals({ userId, status: "rejected", limit: 200 })
    ]);
    return {
      proposed: proposed.length,
      accepted: accepted.length,
      rejected: rejected.length,
      total: proposed.length + accepted.length + rejected.length
    };
  }

  async function codexRfpSetupStatus(userId: UUID): Promise<SetupStatus> {
    const account = await codexRfpAccountForUser(userId);
    const enabled = await integrationEnabled(userId, "codex_rfp");
    const metadata = codexRfpMetadata(account);
    const hasTokenHash = typeof metadata.secretHash === "string" && metadata.secretHash.length > 0;
    const configured = Boolean(account && hasTokenHash);
    const ready = configured && account?.status === "active" && enabled;
    const setupActions: SetupStatus["setupActions"] = [];
    const warnings: string[] = [];

    if (!configured) {
      setupActions.push({
        id: "codex-rfp-token",
        title: "Create Codex RFP ingest token",
        blocking: true,
        instructions: [
          "Open RyanOS Admin and generate a Codex RFP token.",
          "Add the generated endpoint and token to each local Codex RFP automation."
        ]
      });
    }
    if (configured && account?.status !== "active") {
      setupActions.push({
        id: "codex-rfp-token-disabled",
        title: "Enable or rotate Codex RFP token",
        blocking: true,
        instructions: [
          "The stored Codex RFP ingest token is disabled.",
          "Enable the integration or rotate the token from RyanOS Admin."
        ]
      });
    }
    if (configured && !enabled) {
      warnings.push("Codex RFP automation ingest is disabled for this user.");
    }

    return {
      id: "codex_rfp",
      name: integrationNames.codex_rfp,
      configured,
      ready,
      setupRequired: setupActions.length > 0,
      setupActions,
      warnings
    };
  }

  async function codexRfpStatusPayload(userId: UUID) {
    const [account, setting, counts] = await Promise.all([
      codexRfpAccountForUser(userId),
      store.getUserIntegrationSetting(userId, "codex_rfp"),
      codexRfpProposalCounts(userId)
    ]);
    const setup = await codexRfpSetupStatus(userId);
    const metadata = codexRfpMetadata(account);
    return {
      setup,
      endpointPath: codexRfpEndpointPath,
      enabled: setting?.enabled ?? true,
      counts,
      account: account
        ? {
            id: account.id,
            status: account.status,
            displayName: account.displayName,
            tokenId: account.externalAccountId,
            tokenPreview: metadata.tokenPreview,
            createdAt: account.createdAt,
            updatedAt: account.updatedAt,
            lastIngestAt: metadata.lastIngestAt,
            lastReportRunAt: metadata.lastReportRunAt,
            lastAutomationIds: Array.isArray(metadata.lastAutomationIds)
              ? metadata.lastAutomationIds.filter((value): value is string => typeof value === "string")
              : [],
            lastProjectSlugs: Array.isArray(metadata.lastProjectSlugs)
              ? metadata.lastProjectSlugs.filter((value): value is string => typeof value === "string")
              : [],
            lastResult: asRecord(metadata.lastResult) ?? undefined
          }
        : undefined
    };
  }

  async function rotateCodexRfpToken(userId: UUID): Promise<{ token: string; status: "created" | "rotated" }> {
    const existing = await codexRfpAccountForUser(userId);
    const next = createCodexRfpToken();
    const metadata = asJsonObject({
      ...codexRfpMetadata(existing),
      credentialStorage: "hashed-db",
      tokenKind: "rfp_report_ingest",
      secretHash: next.secretHash,
      tokenPreview: next.tokenPreview,
      rotatedAt: nowIso()
    });
    if (!existing) {
      await store.upsertProviderAccount({
        userId,
        provider: codexRfpProvider,
        externalAccountId: next.tokenId,
        displayName: "Codex RFP ingest token",
        status: "active",
        scopes: ["rfp_report:ingest"],
        metadata
      });
      await store.upsertUserIntegrationSetting({
        userId,
        integrationId: "codex_rfp",
        enabled: true
      });
      return {
        token: next.token,
        status: "created"
      };
    }

    await store.updateProviderAccount(existing.id, {
      externalAccountId: next.tokenId,
      displayName: existing.displayName ?? "Codex RFP ingest token",
      status: "active",
      scopes: existing.scopes.length > 0 ? existing.scopes : ["rfp_report:ingest"],
      metadata
    });
    await store.upsertUserIntegrationSetting({
      userId,
      integrationId: "codex_rfp",
      enabled: true
    });
    return {
      token: next.token,
      status: "rotated"
    };
  }

  async function authenticateCodexRfpIngestToken(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<ProviderAccount | undefined> {
    const parsed = parseCodexRfpToken(codexRfpTokenFromRequest(request));
    if (!parsed) {
      reply.code(401);
      void reply.send({ error: "Missing or invalid Codex RFP ingest token." });
      return undefined;
    }
    const account = await store.findProviderAccountByExternalId(codexRfpProvider, parsed.tokenId);
    const metadata = codexRfpMetadata(account);
    const expectedHash = typeof metadata.secretHash === "string" ? metadata.secretHash : undefined;
    const actualHash = hashCodexRfpSecret(parsed.tokenId, parsed.secret);
    if (!account || !expectedHash || !secureStringEqual(expectedHash, actualHash)) {
      reply.code(401);
      void reply.send({ error: "Missing or invalid Codex RFP ingest token." });
      return undefined;
    }
    if (account.status !== "active") {
      reply.code(403);
      void reply.send({ error: "Codex RFP ingest token is disabled." });
      return undefined;
    }
    if (!(await integrationEnabled(account.userId, "codex_rfp"))) {
      reply.code(403);
      void reply.send({ error: "Codex RFP automation ingest is disabled for this user." });
      return undefined;
    }
    return account;
  }

  async function gmailAuthClient(reply: FastifyReply): Promise<
    Pick<GogGmailClient, "startRemoteAuth" | "completeRemoteAuth"> | undefined
  > {
    if ("startRemoteAuth" in emailClient && "completeRemoteAuth" in emailClient) {
      return emailClient as Pick<GogGmailClient, "startRemoteAuth" | "completeRemoteAuth">;
    }
    reply.code(503);
    await reply.send({ error: "Gmail browser-assisted auth is not available in this runtime." });
    return undefined;
  }

  async function runAiSmoke(input: { userId: string; text: string }) {
    if (!(await integrationEnabled(input.userId, "ai"))) {
      return {
        ok: false,
        status: {
          name: integrationNames.ai,
          mode: "disabled",
          ready: false,
          setupRequired: false,
          setupActions: [],
          warnings: ["AI integration is disabled for this user."]
        },
        interpreted: {
          text: "AI integration is disabled for this user.",
          toolCalls: []
        },
        latencyMs: 0
      };
    }
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
      reply.header("Access-Control-Allow-Credentials", "true");
      reply.header("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
      reply.header(
        "Access-Control-Allow-Headers",
        typeof request.headers["access-control-request-headers"] === "string"
          ? request.headers["access-control-request-headers"]
          : "content-type, authorization, x-ryanos-invite-code, x-ryanos-ingest-token"
      );
    }
    if (request.method === "OPTIONS") {
      return reply.code(204).send();
    }
  });

  function requestPath(request: FastifyRequest): string {
    return request.url.split("?")[0] ?? request.url;
  }

  function isPublicPath(path: string): boolean {
    return (
      path === "/" ||
      path === "/health" ||
      path === "/v1/ai/status" ||
      path === "/v1/tools" ||
      path.startsWith("/auth/") ||
      path === "/v1/webhooks/telegram" ||
      path === "/v1/inbound/telegram" ||
      path === "/v1/automation/rfp-reports/ingest"
    );
  }

  function asMutableRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    return value as Record<string, unknown>;
  }

  function forceRequestUserId(request: FastifyRequest, userId: string): void {
    const query = asMutableRecord(request.query);
    if (query) query.userId = userId;

    const body = asMutableRecord(request.body);
    if (!body) return;
    body.userId = userId;

    const input = asMutableRecord(body.input);
    if (input) input.userId = userId;

    const toolCall = asMutableRecord(body.toolCall);
    const toolInput = asMutableRecord(toolCall?.input);
    if (toolInput) toolInput.userId = userId;
  }

  async function authenticatedSessionForRequest(request: FastifyRequest): Promise<AuthSessionPayload | undefined> {
    if (!auth) return undefined;
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers)
    });
    return (session ?? undefined) as AuthSessionPayload | undefined;
  }

  function requestOrigin(request: FastifyRequest): string {
    const forwardedProto = request.headers["x-forwarded-proto"];
    const proto =
      typeof forwardedProto === "string" && forwardedProto.length > 0
        ? forwardedProto.split(",")[0]?.trim() || "http"
        : "http";
    return `${proto}://${request.headers.host ?? "localhost"}`;
  }

  async function sendAuthResponse(response: Response, reply: FastifyReply) {
    reply.status(response.status);

    const headers = response.headers as Headers & { getSetCookie?: () => string[] };
    const setCookies = headers.getSetCookie?.() ?? [];
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() !== "set-cookie") {
        reply.header(key, value);
      }
    });
    if (setCookies.length > 0) {
      reply.header("set-cookie", setCookies);
    } else {
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) reply.header("set-cookie", setCookie);
    }

    return reply.send(response.body ? await response.text() : null);
  }

  app.route({
    method: ["GET", "POST"],
    url: "/auth/*",
    async handler(request, reply) {
      if (!auth) {
        reply.code(503);
        return { error: "Authentication requires DATABASE_URL." };
      }
      try {
        const url = new URL(request.url, requestOrigin(request));
        const headers = fromNodeHeaders(request.headers);
        const init: RequestInit = {
          method: request.method,
          headers
        };
        if (request.method !== "GET" && request.method !== "HEAD" && request.body !== undefined) {
          init.body = typeof request.body === "string" ? request.body : JSON.stringify(request.body);
        }
        const response = await auth.handler(new Request(url.toString(), init));
        return sendAuthResponse(response, reply);
      } catch (error) {
        request.log.error({ error }, "Authentication request failed");
        reply.code(500);
        return { error: "Internal authentication error" };
      }
    }
  });

  app.addHook("preHandler", async (request: RyanOsRequest, reply) => {
    const path = requestPath(request);
    if (isPublicPath(path) || authMode === "dev-local") return;
    if (!database || !auth) {
      reply.code(503);
      return reply.send({ error: "Authentication is required but not configured." });
    }

    const session = await authenticatedSessionForRequest(request);
    const authUserId = session?.user?.id;
    const email = session?.user?.email;
    if (!authUserId || !email) {
      reply.code(401);
      return reply.send({ error: "Unauthorized" });
    }

    const identity = {
      authUserId,
      email,
      ...(session.user?.name !== undefined ? { displayName: session.user.name } : {})
    };
    const userId = await resolveAuthenticatedUserId(database.db, identity);
    const user = await getRyanOsUserById(database.db, userId);
    request.ryanAuth = {
      authUserId,
      userId,
      email,
      role: user?.role ?? "user",
      ...(session.user?.name ? { displayName: session.user.name } : {})
    };
    forceRequestUserId(request, userId);
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

  app.get("/v1/me", async (request: RyanOsRequest, reply) => {
    if (authMode === "dev-local") {
      return {
        authMode,
        user: {
          id: "local-owner",
          email: "local-owner@ryanos.local",
          displayName: "Local Owner",
          role: devLocalRole
        }
      };
    }
    if (!request.ryanAuth) {
      reply.code(401);
      return { error: "Unauthorized" };
    }
    return {
      authMode,
      user: {
        id: request.ryanAuth.userId,
        email: request.ryanAuth.email,
        displayName: request.ryanAuth.displayName ?? request.ryanAuth.email,
        role: request.ryanAuth.role
      }
    };
  });

  app.post("/v1/ai/smoke", async (request, reply) => {
    const body = aiSmokeBodySchema.parse(request.body ?? {});
    const result = await runAiSmoke(body);
    if (!result.ok) reply.code(503);
    return result;
  });

  app.get("/v1/setup/status", async (request: RyanOsRequest, reply) => {
    if (!requireSuperadmin(request, reply)) return;
    const aiStatus = await ai.getStatus();
    const userId = currentUserId(request) as UUID;
    return {
      ai: aiSetupStatus(aiStatus),
      integrations: [
        await telegramSetupStatus(database?.db),
        await gmailSetupStatus(emailClient),
        await codexRfpSetupStatus(userId)
      ]
    };
  });

  app.get("/v1/integrations", async (request: RyanOsRequest) => {
    const userId = currentUserId(request);
    const role = currentRole(request);
    const [
      aiStatus,
      telegramSetup,
      gmailSetup,
      codexRfpSetup,
      codexRfpStatus,
      settings,
      gmailAccounts,
      gmailCounts,
      telegramAccounts,
      providerAccountSummaries,
      integrationSettingSummaries
    ] = await Promise.all([
      ai.getStatus(),
      telegramSetupStatus(database?.db),
      gmailSetupStatus(emailClient),
      codexRfpSetupStatus(userId as UUID),
      codexRfpStatusPayload(userId as UUID),
      store.listUserIntegrationSettings(userId as UUID),
      store.listProviderAccounts({
        userId: userId as UUID,
        provider: "gmail",
        limit: 200
      }),
      gmailProposalCounts(store, userId as UUID),
      store.listProviderAccounts({
        userId: userId as UUID,
        provider: "telegram",
        limit: 20
      }),
      role === "superadmin" ? store.listProviderAccountSummaries() : Promise.resolve([]),
      role === "superadmin" ? store.listUserIntegrationSettingSummaries() : Promise.resolve([])
    ]);
    const settingsById = new Map(settings.map((setting) => [setting.integrationId, setting]));

    function integrationView(id: IntegrationId, setup: SetupStatus, extra: Record<string, unknown> = {}) {
      const setting = settingsById.get(id);
      const enabled = setting?.enabled ?? true;
      const visibleSetup = setupForRole(setup, role);
      return {
        id,
        name: setup.name || integrationNames[id],
        configured: setup.configured,
        ready: setup.ready,
        setupRequired: setup.setupRequired,
        enabled,
        effectiveReady: enabled && setup.ready,
        setupActions: visibleSetup.setupActions,
        warnings: visibleSetup.warnings,
        settings: {
          enabled,
          metadata: setting?.metadata ?? {}
        },
        ...extra
      };
    }

    return {
      user: {
        id: userId,
        role
      },
      ...(role === "superadmin"
        ? {
            deployment: {
              providerAccounts: providerAccountSummaries,
              integrationSettings: integrationSettingSummaries
            }
          }
        : {}),
      integrations: [
        integrationView("ai", aiSetupStatus(aiStatus)),
        integrationView("telegram", telegramSetup, {
          linkedAccounts: telegramAccounts.map((account) => ({
            id: account.id,
            displayName: account.displayName,
            status: account.status,
            linkedAt:
              typeof account.metadata.linkedAt === "string"
                ? account.metadata.linkedAt
                : account.createdAt
          })),
          canManageDeployment: role === "superadmin"
        }),
        integrationView("gmail", gmailSetup, {
          config: emailScanConfig(),
          counts: gmailCounts,
          accounts: await Promise.all(gmailAccounts.map((account) => gmailAccountView(store, account))),
          canManageDeployment: role === "superadmin"
        }),
        integrationView("codex_rfp", codexRfpSetup, {
          endpointPath: codexRfpStatus.endpointPath,
          counts: codexRfpStatus.counts,
          account: codexRfpStatus.account
        })
      ]
    };
  });

  app.patch("/v1/integrations/:id/settings", async (request) => {
    const params = integrationParamsSchema.parse(request.params);
    const body = integrationSettingsBodySchema.parse(request.body ?? {});
    const setting = await store.upsertUserIntegrationSetting({
      userId: body.userId as UUID,
      integrationId: params.id,
      enabled: body.enabled
    });
    return {
      setting
    };
  });

  app.get("/v1/integrations/codex-rfp", async (request: RyanOsRequest) => {
    return codexRfpStatusPayload(currentUserId(request) as UUID);
  });

  app.post("/v1/integrations/codex-rfp/token", async (request: RyanOsRequest) => {
    const userId = currentUserId(request) as UUID;
    const result = await rotateCodexRfpToken(userId);
    return {
      status: result.status,
      token: result.token,
      ...(await codexRfpStatusPayload(userId))
    };
  });

  app.post("/v1/automation/rfp-reports/ingest", async (request, reply) => {
    const account = await authenticateCodexRfpIngestToken(request, reply);
    if (!account) return;
    try {
      const body = parseOpportunityReportIngestBody(request.body ?? {});
      const result = await ingestOpportunityReport({
        store,
        userId: account.userId,
        report: body.report
      });
      const metadata = codexRfpMetadata(account);
      const automationIds = [
        body.report.automationId,
        ...(Array.isArray(metadata.lastAutomationIds)
          ? metadata.lastAutomationIds.filter((value): value is string => typeof value === "string")
          : [])
      ].filter((value, index, all) => all.indexOf(value) === index).slice(0, 10);
      const projectSlugs = [
        body.report.projectSlug,
        ...(Array.isArray(metadata.lastProjectSlugs)
          ? metadata.lastProjectSlugs.filter((value): value is string => typeof value === "string")
          : [])
      ].filter((value, index, all) => all.indexOf(value) === index).slice(0, 10);
      await store.updateProviderAccount(account.id, {
        metadata: asJsonObject({
          ...metadata,
          lastIngestAt: nowIso(),
          lastReportRunAt: body.report.runAt,
          lastAutomationIds: automationIds,
          lastProjectSlugs: projectSlugs,
          lastResult: result
        })
      });
      return {
        result
      };
    } catch (err) {
      reply.code(400);
      return {
        error: err instanceof Error ? err.message : String(err)
      };
    }
  });

  app.post("/v1/admin/integrations/telegram/bot-token", async (request: RyanOsRequest, reply) => {
    if (!requireSuperadmin(request, reply)) return;
    const body = telegramTokenBodySchema.parse(request.body ?? {});
    let token: string;
    try {
      token = validateTelegramBotToken(body.token);
    } catch (err) {
      reply.code(400);
      return { error: err instanceof Error ? err.message : String(err) };
    }
    if (!database) {
      reply.code(503);
      return { error: "Telegram token storage requires DATABASE_URL." };
    }
    const loadedVault = await loadSecretVaultFromEnv();
    if (!loadedVault.vault) {
      reply.code(503);
      return {
        error: "RyanOS master key is not ready.",
        warnings: loadedVault.status.warnings,
        setupActions: loadedVault.status.setupActions
      };
    }
    const result = await new PostgresSecretStore(database.db, loadedVault.vault).storeProviderSecret({
      userId: "local-owner",
      provider: "telegram",
      externalAccountId: "bot",
      accountDisplayName: "Telegram Bot",
      kind: "bot_token",
      plaintext: token,
      metadata: {
        importedBy: request.ryanAuth?.email ?? "dev-local",
        importedFrom: "admin-web",
        importedAt: nowIso()
      }
    });
    return {
      status: "stored",
      provider: "telegram",
      kind: "bot_token",
      providerAccountId: result.providerAccountId,
      secretRecordId: result.secretRecordId,
      keyVersion: result.keyVersion
    };
  });

  app.post("/v1/integrations/telegram/link-code", async (request, reply) => {
    const body = telegramLinkCodeBodySchema.parse(request.body ?? {});
    let code = "";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = newTelegramLinkCode();
      const existing = await store.findProviderAccountByExternalId("telegram_link_code", candidate);
      if (!existing) {
        code = candidate;
        break;
      }
    }
    if (!code) {
      reply.code(503);
      return { error: "Could not generate a unique Telegram link code." };
    }
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await store.upsertProviderAccount({
      userId: body.userId,
      provider: "telegram_link_code",
      externalAccountId: code,
      displayName: "Telegram link code",
      status: "pending",
      metadata: {
        createdAt: nowIso(),
        expiresAt
      }
    });
    return {
      code,
      expiresAt,
      instructions: [
        `Send /start ${code} to the RyanOS Telegram bot from the Telegram account you want to link.`,
        "This code expires in 10 minutes."
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
    const query = emailScanBodySchema.pick({
      userId: true,
      includeNewAccounts: true
    }).parse(request.body ?? {});
    try {
      await syncGmailAccounts({
        store,
        client: emailClient,
        userId: query.userId,
        includeNewAccounts: authMode === "dev-local" || query.includeNewAccounts === true
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

  app.post("/v1/integrations/gmail/auth/start", async (request, reply) => {
    const body = gmailAuthBodySchema.parse(request.body ?? {});
    const client = await gmailAuthClient(reply);
    if (!client) return;
    try {
      const existing = await store.findProviderAccountByExternalId("gmail", body.email);
      if (existing && existing.userId !== body.userId) {
        reply.code(409);
        return { error: "That Gmail account is already linked to another RyanOS user." };
      }
      const result = await client.startRemoteAuth({ email: body.email });
      return {
        authUrl: result.authUrl,
        instructions: [
          "Open the Google authorization URL.",
          "Approve Gmail read-only access.",
          "Copy the final redirect URL from the browser and paste it back into RyanOS."
        ]
      };
    } catch (err) {
      reply.code(503);
      return {
        error: err instanceof Error ? err.message : String(err)
      };
    }
  });

  app.post("/v1/integrations/gmail/auth/complete", async (request, reply) => {
    const body = gmailAuthCompleteBodySchema.parse(request.body ?? {});
    const client = await gmailAuthClient(reply);
    if (!client) return;
    try {
      await client.completeRemoteAuth({
        email: body.email,
        redirectUrl: body.redirectUrl
      });
      await syncGmailAccounts({
        store,
        client: emailClient,
        userId: body.userId,
        accountEmail: body.email,
        includeNewAccounts: true
      });
      const account = await store.findProviderAccountByExternalId("gmail", body.email);
      if (!account || account.userId !== body.userId) {
        reply.code(404);
        return { error: "Gmail auth completed, but RyanOS could not find the synced account." };
      }
      return {
        account: await gmailAccountView(store, account)
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
    if (!(await integrationEnabled(body.userId, "gmail"))) {
      reply.code(409);
      return {
        error: "Gmail integration is disabled for this user."
      };
    }
    if (!(await integrationEnabled(body.userId, "ai"))) {
      reply.code(409);
      return {
        error: "AI integration is disabled for this user."
      };
    }
    const lockKey = body.userId;
    const activeScan = activeEmailScans.get(lockKey);
    const config = emailScanConfig();
    if (activeScan) {
      return {
        result: {
          query: body.query ?? config.query,
          maxPerAccount: body.maxPerAccount ?? config.maxPerAccount,
          accountsScanned: 0,
          accountsSkipped: 0,
          messagesSeen: 0,
          messagesFetched: 0,
          messagesSkippedByFilter: 0,
          filterReasons: {},
          proposalsCreatedOrUpdated: 0,
          errors: [],
          alreadyRunning: true,
          startedAt: activeScan.startedAt
        }
      };
    }
    const status = await ai.getStatus();
    if (!status.ready) {
      reply.code(503);
      return {
        error: "AI provider is not ready.",
        status
      };
    }
    activeEmailScans.set(lockKey, {
      startedAt: nowIso()
    });
    const scanInput: Parameters<typeof scanGmailInbox>[0] = {
      ai,
      store,
        client: emailClient,
        userId: body.userId,
        query: body.query ?? config.query,
        maxPerAccount: body.maxPerAccount ?? config.maxPerAccount,
        syncAccounts: body.syncAccounts,
        includeNewAccounts: authMode === "dev-local" || body.includeNewAccounts === true
      };
    if (body.accountId !== undefined) scanInput.accountId = body.accountId;
    try {
      const result = await scanGmailInbox(scanInput);
      return {
        result
      };
    } finally {
      activeEmailScans.delete(lockKey);
    }
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

  app.post("/v1/opportunity-proposals/ingest", async (request, reply) => {
    try {
      const body = parseOpportunityReportIngestBody(request.body ?? {});
      const result = await ingestOpportunityReport({
        store,
        userId: body.userId,
        report: body.report
      });
      return {
        result
      };
    } catch (err) {
      reply.code(400);
      return {
        error: err instanceof Error ? err.message : String(err)
      };
    }
  });

  app.get("/v1/opportunity-proposals", async (request) => {
    const query = opportunityProposalsQuerySchema.parse(request.query);
    const filters: Parameters<typeof store.listOpportunityProposals>[0] = {
      userId: query.userId,
      status: query.status,
      limit: query.limit
    };
    if (query.projectSlug !== undefined) filters.projectSlug = query.projectSlug;
    const proposals = await store.listOpportunityProposals(filters);
    return {
      proposals: await Promise.all(proposals.map((proposal) => opportunityProposalView(store, proposal)))
    };
  });

  app.post("/v1/opportunity-proposals/:id/accept", async (request, reply) => {
    const params = opportunityProposalParamsSchema.parse(request.params);
    const body = opportunityProposalActionBodySchema.parse(request.body ?? {});
    try {
      const result = await acceptOpportunityProposal({
        store,
        userId: body.userId,
        proposalId: params.id
      });
      return {
        proposal: await opportunityProposalView(store, result.proposal),
        opportunity: result.opportunity,
        item: result.item
      };
    } catch (err) {
      reply.code(400);
      return {
        error: err instanceof Error ? err.message : String(err)
      };
    }
  });

  app.post("/v1/opportunity-proposals/:id/reject", async (request, reply) => {
    const params = opportunityProposalParamsSchema.parse(request.params);
    const body = opportunityProposalActionBodySchema.parse(request.body ?? {});
    try {
      const proposal = await rejectOpportunityProposal({
        store,
        userId: body.userId,
        proposalId: params.id
      });
      return {
        proposal: await opportunityProposalView(store, proposal)
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

  type DashboardProgressNote = {
    id: string;
    body: string;
    occurredAt: string;
    createdAt: string;
    updatedAt: string;
  };

  type DashboardChecklistItem = {
    id: string;
    title: string;
    checked: boolean;
    checkedAt?: string;
    sortOrder: number;
    createdAt: string;
    updatedAt: string;
  };

  type DashboardItemBase = Item & {
    scope: DashboardScope;
    starred: boolean;
    progress: {
      count: number;
      latest?: DashboardProgressNote;
    };
    checklist: {
      total: number;
      completed: number;
    };
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

  function progressNoteForDashboard(note: ItemProgressNote): DashboardProgressNote {
    return {
      id: note.id,
      body: note.body,
      occurredAt: note.occurredAt,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt
    };
  }

  function checklistItemForDashboard(item: ItemChecklistItem): DashboardChecklistItem {
    const checklistItem: DashboardChecklistItem = {
      id: item.id,
      title: item.title,
      checked: item.checkedAt !== undefined,
      sortOrder: item.sortOrder,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    };
    if (item.checkedAt !== undefined) checklistItem.checkedAt = item.checkedAt;
    return checklistItem;
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
    if (a.starred && !b.starred) return -1;
    if (!a.starred && b.starred) return 1;
    if (a.starred && b.starred && a.starredAt !== b.starredAt) {
      return (b.starredAt ?? "").localeCompare(a.starredAt ?? "");
    }
    if (a.priorityScore !== b.priorityScore) return b.priorityScore - a.priorityScore;
    const aDue = a.dueAt ?? a.recurrence?.state?.nextDueAt ?? "9999-12-31T23:59:59.999Z";
    const bDue = b.dueAt ?? b.recurrence?.state?.nextDueAt ?? "9999-12-31T23:59:59.999Z";
    if (aDue !== bDue) return aDue.localeCompare(bDue);
    return b.createdAt.localeCompare(a.createdAt);
  }

  async function itemForDashboard(item: Item, timeZone: string, referenceDateKey: string): Promise<DashboardItem> {
    const [policy, itemArea, itemProject, progressNotes, checklistItems] = await Promise.all([
      store.findRecurrencePolicyForItem(item.id),
      item.areaId === undefined ? Promise.resolve(undefined) : store.getArea(item.areaId),
      item.projectId === undefined ? Promise.resolve(undefined) : store.getProject(item.projectId),
      store.listItemProgressNotes({ userId: item.userId, itemId: item.id, limit: 200 }),
      store.listItemChecklistItems({ userId: item.userId, itemId: item.id, limit: 200 })
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
      starred: item.starredAt !== undefined,
      scope,
      progress: {
        count: progressNotes.length,
        ...(progressNotes[0] === undefined ? {} : { latest: progressNoteForDashboard(progressNotes[0]) })
      },
      checklist: {
        total: checklistItems.length,
        completed: checklistItems.filter((checklistItem) => checklistItem.checkedAt !== undefined).length
      },
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

  async function itemForUser(userId: string, itemId: string): Promise<Item | undefined> {
    const match = (await store.searchItems(userId, itemId, 1))[0];
    return match?.record.id === itemId ? match.record : undefined;
  }

  async function itemDetailsPayload(input: {
    userId: string;
    item: Item;
    timezone: string;
    dateKey: string;
  }) {
    const [dashboardItem, progressNotes, checklistItems] = await Promise.all([
      itemForDashboard(input.item, input.timezone, input.dateKey),
      store.listItemProgressNotes({ userId: input.userId, itemId: input.item.id, limit: 200 }),
      store.listItemChecklistItems({ userId: input.userId, itemId: input.item.id, limit: 200 })
    ]);
    return {
      item: dashboardItem,
      progressNotes: progressNotes.map(progressNoteForDashboard),
      checklistItems: checklistItems.map(checklistItemForDashboard)
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

  function itemVisibleByDefault(item: DashboardItem): boolean {
    return item.starred || item.hiddenUntil === undefined;
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
    if (item.starred) return true;
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
    if (a.starred && !b.starred) return -1;
    if (!a.starred && b.starred) return 1;
    if (a.starred && b.starred && a.starredAt !== b.starredAt) {
      return (b.starredAt ?? "").localeCompare(a.starredAt ?? "");
    }
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

  type MobileWidgetProgress = {
    count: number;
    latest: DashboardProgressNote[];
  };

  type MobileWidgetChecklist = {
    total: number;
    completed: number;
    moreCount: number;
    items: DashboardChecklistItem[];
  };

  type MobileWidgetItem = {
    id: string;
    title: string;
    kind: Item["kind"];
    status: Item["status"];
    checked: boolean;
    starred: boolean;
    priority: Item["priority"];
    priorityScore: number;
    prioritySignals: string[];
    action: MobileWidgetItemAction;
    starredAt?: string;
    dueAt?: string;
    secondaryText?: string;
    progress: MobileWidgetProgress;
    checklist: MobileWidgetChecklist;
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

  async function mobileWidgetItemForDashboard(
    item: DashboardItem,
    timeZone: string,
    dateKey: string
  ): Promise<MobileWidgetItem> {
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
    const [progressNotes, checklistItems] = await Promise.all([
      store.listItemProgressNotes({ userId: item.userId, itemId: item.id, limit: 2 }),
      store.listItemChecklistItems({ userId: item.userId, itemId: item.id, limit: 200 })
    ]);
    const visibleChecklistItems = checklistItems.slice(0, 6);
    const widgetItem: MobileWidgetItem = {
      id: item.id,
      title: item.title,
      kind: item.kind,
      status: item.status,
      checked: hasRecurrence ? mobileRecurrenceCompleted(item, dateKey) : item.status === "done",
      starred: item.starred,
      priority: item.priority,
      priorityScore: item.priorityScore,
      prioritySignals: item.prioritySignals,
      action,
      progress: {
        count: item.progress.count,
        latest: progressNotes.map(progressNoteForDashboard)
      },
      checklist: {
        total: item.checklist.total,
        completed: item.checklist.completed,
        moreCount: Math.max(0, checklistItems.length - visibleChecklistItems.length),
        items: visibleChecklistItems.map(checklistItemForDashboard)
      }
    };
    if (item.starredAt !== undefined) widgetItem.starredAt = item.starredAt;
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
      items: await Promise.all(
        items
          .slice(0, input.limit)
          .map((item) => mobileWidgetItemForDashboard(item, input.timezone, input.dateKey))
      )
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

  async function getDefaultShoppingItemForUser(
    itemId: string,
    userId: string,
    reply: FastifyReply
  ): Promise<ShoppingListItem | undefined> {
    const [existing, list] = await Promise.all([
      store.getShoppingItem(itemId),
      store.getDefaultShoppingList(userId)
    ]);
    if (!existing || existing.listId !== list.id) {
      reply.code(404);
      return undefined;
    }
    return existing;
  }

  async function checkShoppingItemPayload(
    itemId: string,
    body: z.infer<typeof shoppingCheckItemBodySchema>,
    reply: FastifyReply
  ) {
    const existing = await getDefaultShoppingItemForUser(itemId, body.userId, reply);
    if (!existing) {
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

  type VocabularyEntryView = {
    id: string;
    term: string;
    normalizedTerm: string;
    languageCode: string;
    category: string;
    definition?: string;
    partOfSpeech?: string;
    pronunciation?: string;
    translation?: string;
    notes?: string;
    tags: string[];
    definitionSource: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  };

  type VocabularyEncounterView = {
    id: string;
    entryId: string;
    sourceType?: string;
    sourceTitle?: string;
    sourceUrl?: string;
    context?: string;
    occurredAt: string;
    createdAt: string;
  };

  function vocabularyEntryView(entry: VocabularyEntry): VocabularyEntryView {
    const view: VocabularyEntryView = {
      id: entry.id,
      term: entry.term,
      normalizedTerm: entry.normalizedTerm,
      languageCode: entry.languageCode,
      category: entry.category,
      tags: entry.tags,
      definitionSource: entry.definitionSource,
      status: entry.status,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt
    };
    if (entry.definition !== undefined) view.definition = entry.definition;
    if (entry.partOfSpeech !== undefined) view.partOfSpeech = entry.partOfSpeech;
    if (entry.pronunciation !== undefined) view.pronunciation = entry.pronunciation;
    if (entry.translation !== undefined) view.translation = entry.translation;
    if (entry.notes !== undefined) view.notes = entry.notes;
    return view;
  }

  function vocabularyEncounterView(encounter: VocabularyEncounter): VocabularyEncounterView {
    const view: VocabularyEncounterView = {
      id: encounter.id,
      entryId: encounter.entryId,
      occurredAt: encounter.occurredAt,
      createdAt: encounter.createdAt
    };
    if (encounter.sourceType !== undefined) view.sourceType = encounter.sourceType;
    if (encounter.sourceTitle !== undefined) view.sourceTitle = encounter.sourceTitle;
    if (encounter.sourceUrl !== undefined) view.sourceUrl = encounter.sourceUrl;
    if (encounter.context !== undefined) view.context = encounter.context;
    return view;
  }

  async function vocabularyListPayload(input: z.infer<typeof vocabularyEntriesQuerySchema>) {
    const filters: Parameters<typeof store.listVocabularyEntries>[0] = {
      userId: input.userId,
      status: input.status,
      limit: input.limit
    };
    if (input.query !== undefined && input.query.trim().length > 0) filters.query = input.query.trim();
    if (input.category !== undefined && input.category.trim().length > 0) filters.category = input.category.trim();
    if (input.languageCode !== undefined && input.languageCode.trim().length > 0) {
      filters.languageCode = normalizeLanguageCode(input.languageCode);
    }
    if (input.tag !== undefined && input.tag.trim().length > 0) filters.tag = input.tag.trim();

    const entries = await store.listVocabularyEntries(filters);
    const entryIds = new Set(entries.map((entry) => entry.id));
    const encounters = (await store.listVocabularyEncounters({
      userId: input.userId,
      limit: Math.min(Math.max(entries.length * 3, 50), 300)
    })).filter((encounter) => entryIds.has(encounter.entryId));
    const encountersByEntryId: Record<string, VocabularyEncounterView[]> = {};
    for (const encounter of encounters) {
      const bucket = encountersByEntryId[encounter.entryId] ?? [];
      if (bucket.length < 3) bucket.push(vocabularyEncounterView(encounter));
      encountersByEntryId[encounter.entryId] = bucket;
    }
    return {
      categories: vocabularyCategories,
      entries: entries.map(vocabularyEntryView),
      encountersByEntryId
    };
  }

  async function upsertVocabularyEntryPayload(
    body: z.infer<typeof vocabularyCreateEntryBodySchema>,
    sourceDefault: string
  ) {
    const term = body.term.trim();
    const languageCode = normalizeLanguageCode(body.languageCode);
    const normalizedTerm = normalizeVocabularyTerm(term);
    const tags = cleanVocabularyTags(body.tags);
    const category = inferVocabularyCategory({
      term,
      languageCode,
      category: body.category,
      context: body.context,
      tags
    });
    const existing = await store.findVocabularyEntry(body.userId, languageCode, normalizedTerm);
    let entry: VocabularyEntry;
    let merged = false;
    if (existing) {
      const patch: Parameters<typeof store.updateVocabularyEntry>[1] = {
        term,
        category,
        tags: cleanVocabularyTags([...existing.tags, ...tags]),
        status: "active",
        metadata: asJsonObject({
          ...existing.metadata,
          lastQuickAddAt: nowIso()
        })
      };
      if ((existing.definition ?? "").trim().length === 0 && body.definition !== undefined) {
        patch.definition = body.definition;
        patch.definitionSource = "ai_draft";
      }
      if ((existing.partOfSpeech ?? "").trim().length === 0 && body.partOfSpeech !== undefined) {
        patch.partOfSpeech = body.partOfSpeech;
      }
      if ((existing.pronunciation ?? "").trim().length === 0 && body.pronunciation !== undefined) {
        patch.pronunciation = body.pronunciation;
      }
      if ((existing.translation ?? "").trim().length === 0 && body.translation !== undefined) {
        patch.translation = body.translation;
      }
      if (body.notes !== undefined && body.notes.trim().length > 0) {
        patch.notes = [existing.notes, body.notes].filter(Boolean).join("\n");
      }
      entry = await store.updateVocabularyEntry(existing.id, patch);
      merged = true;
    } else {
      const createData: Parameters<typeof store.createVocabularyEntry>[0] = {
        userId: body.userId,
        term,
        normalizedTerm,
        languageCode,
        category,
        tags,
        definitionSource: body.definition ? "ai_draft" : "manual",
        metadata: asJsonObject({
          firstQuickAddAt: nowIso()
        })
      };
      if (body.definition !== undefined) createData.definition = body.definition;
      if (body.partOfSpeech !== undefined) createData.partOfSpeech = body.partOfSpeech;
      if (body.pronunciation !== undefined) createData.pronunciation = body.pronunciation;
      if (body.translation !== undefined) createData.translation = body.translation;
      if (body.notes !== undefined) createData.notes = body.notes;
      entry = await store.createVocabularyEntry(createData);
    }

    const encounterData: Parameters<typeof store.addVocabularyEncounter>[0] = {
      userId: body.userId,
      entryId: entry.id,
      sourceType: body.sourceType ?? sourceDefault,
      metadata: {}
    };
    if (body.sourceTitle !== undefined) encounterData.sourceTitle = body.sourceTitle;
    if (body.sourceUrl !== undefined) encounterData.sourceUrl = body.sourceUrl;
    if (body.context !== undefined) encounterData.context = body.context;
    if (body.occurredAt !== undefined) encounterData.occurredAt = body.occurredAt;
    const encounter = await store.addVocabularyEncounter(encounterData);
    return {
      entry: vocabularyEntryView(entry),
      encounter: vocabularyEncounterView(encounter),
      merged,
      ...(await vocabularyListPayload({
        userId: body.userId,
        status: "active",
        limit: 50
      }))
    };
  }

  async function tryVocabularyAiDraft(
    body: z.infer<typeof vocabularyCreateEntryBodySchema>,
    sourceDefault: string
  ) {
    if (!body.draftWithAi || body.definition !== undefined) return undefined;
    if (!(await integrationEnabled(body.userId, "ai"))) return undefined;
    const status = await ai.getStatus();
    if (!status.ready || ai.name === "none") return undefined;
    const vocabularyTool = tools.list().find((tool) => tool.name === "vocabulary.addEntries");
    if (!vocabularyTool) return undefined;
    const message: IncomingMessage = {
      id: `vocabulary:${crypto.randomUUID()}`,
      provider: "system",
      chatId: "vocabulary-draft",
      userId: body.userId,
      text: [
        `Save this vocabulary entry and draft a concise editable definition.`,
        `Term: ${body.term.trim()}`,
        `Language: ${normalizeLanguageCode(body.languageCode)}`,
        body.category ? `Category: ${body.category}` : undefined,
        body.context ? `Context: ${body.context}` : undefined,
        body.sourceTitle ? `Source title: ${body.sourceTitle}` : undefined
      ].filter(Boolean).join("\n"),
      timestamp: nowIso(),
      attachments: [],
      metadata: {
        kind: "vocabulary_draft",
        source: sourceDefault
      }
    };
    try {
      const interpreted = await ai.interpret(message, [vocabularyTool]);
      const toolCall = interpreted.toolCalls.find((call) => call.name === "vocabulary.addEntries");
      if (!toolCall) return undefined;
      const result = await tools.execute(
        toolCall.name,
        enrichToolInput(
          {
            ...(asRecord(toolCall.input) ?? {}),
            userId: body.userId,
            source: sourceDefault
          },
          message,
          toolCall.name,
          0
        )
      );
      if (result.status !== "applied") return undefined;
      const entry = await store.findVocabularyEntry(
        body.userId,
        normalizeLanguageCode(body.languageCode),
        normalizeVocabularyTerm(body.term)
      );
      return {
        result,
        entry: entry ? vocabularyEntryView(entry) : undefined,
        ...(await vocabularyListPayload({
          userId: body.userId,
          status: "active",
          limit: 50
        }))
      };
    } catch {
      return undefined;
    }
  }

  async function createVocabularyEntryPayload(
    body: z.infer<typeof vocabularyCreateEntryBodySchema>,
    sourceDefault: string
  ) {
    const aiDraft = await tryVocabularyAiDraft(body, sourceDefault);
    if (aiDraft !== undefined) return aiDraft;
    return upsertVocabularyEntryPayload(body, sourceDefault);
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
    const starredItems = items.filter((item) => item.starred);
    const dueItems = items.filter((item) => itemNeedsAttentionToday(item, input.timezone, input.dateKey));
    return {
      date: input.dateKey,
      timezone: input.timezone,
      plan: dashboardPlan,
      starredItems,
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
    const existing = await getDefaultShoppingItemForUser(params.itemId, body.userId, reply);
    if (!existing) {
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

  app.get("/v1/vocabulary/entries", async (request) => {
    const query = vocabularyEntriesQuerySchema.parse(request.query);
    return vocabularyListPayload(query);
  });

  app.post("/v1/vocabulary/entries", async (request) => {
    const body = vocabularyCreateEntryBodySchema.parse(request.body);
    return createVocabularyEntryPayload(body, "web");
  });

  app.patch("/v1/vocabulary/entries/:entryId", async (request, reply) => {
    const params = vocabularyEntryParamsSchema.parse(request.params);
    const body = vocabularyPatchEntryBodySchema.parse(request.body);
    const existing = await store.getVocabularyEntry(params.entryId);
    if (!existing || existing.deletedAt !== undefined) {
      reply.code(404);
      return { error: "Vocabulary entry not found" };
    }
    const patch: Parameters<typeof store.updateVocabularyEntry>[1] = {
      definitionSource: "edited"
    };
    if (body.term !== undefined) {
      patch.term = body.term.trim();
      patch.normalizedTerm = normalizeVocabularyTerm(body.term);
    }
    if (body.languageCode !== undefined) patch.languageCode = normalizeLanguageCode(body.languageCode);
    if (body.category !== undefined) patch.category = body.category;
    if (body.definition !== undefined) patch.definition = body.definition ?? "";
    if (body.partOfSpeech !== undefined) patch.partOfSpeech = body.partOfSpeech ?? "";
    if (body.pronunciation !== undefined) patch.pronunciation = body.pronunciation ?? "";
    if (body.translation !== undefined) patch.translation = body.translation ?? "";
    if (body.notes !== undefined) patch.notes = body.notes ?? "";
    if (body.tags !== undefined) patch.tags = cleanVocabularyTags(body.tags);
    if (body.status !== undefined) patch.status = body.status;
    if (body.deleted === true) patch.deletedAt = nowIso();
    const updated = await store.updateVocabularyEntry(params.entryId, patch);
    return {
      entry: vocabularyEntryView(updated),
      ...(await vocabularyListPayload({
        userId: body.userId,
        status: body.status ?? "active",
        limit: 50
      }))
    };
  });

  app.get("/v1/mobile/vocabulary/entries", async (request) => {
    const query = vocabularyEntriesQuerySchema.parse(request.query);
    return vocabularyListPayload(query);
  });

  app.post("/v1/mobile/vocabulary/entries", async (request) => {
    const body = vocabularyCreateEntryBodySchema.parse(request.body);
    return createVocabularyEntryPayload(body, "android");
  });

  app.get("/v1/daily-plan", async (request) => {
    const query = dailyPlanQuerySchema.parse(request.query);
    const dateKey = query.date ?? localDateKey(new Date(), query.timezone);
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
      prompt: existing?.prompt ?? dailyPlanSuggestionPrompt,
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
    if (!(await integrationEnabled(body.userId, "ai"))) {
      return {
        ...(await dailyPlanPayload({ userId: body.userId, timezone: body.timezone, dateKey })),
        suggestionAttempt: {
          source: "heuristic",
          warnings: ["AI integration is disabled for this user."],
          setupRequired: false,
          setupActions: []
        }
      };
    }
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
        "Create today's RyanOS starred-focus candidate suggestion.",
        `Date: ${dateKey}`,
        "Suggest a short list of item IDs that could be starred for focus. Starred items are the active focus; suggestions are only candidates.",
        "Prefer a realistic mix of one easy win, one medium item, and one important larger item when available.",
        "Use daily_plan.upsert exactly once. Put exact item IDs in selectedItemRefs and suggestedItemRefs.",
        "Leave response and successCriteria unset.",
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
            starred: item.starred,
            starredAt: item.starredAt,
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
        prompt: dailyPlanSuggestionPrompt,
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
          : await mobileWidgetItemForDashboard(dashboardItem, body.timezone, dateKey),
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
          : await mobileWidgetItemForDashboard(updatedDashboardItem, body.timezone, dateKey)
    };
  });

  app.post("/v1/mobile/items/:itemId/checklist-items/:checklistItemId/toggle", async (request, reply) => {
    const params = checklistItemParamsSchema.parse(request.params);
    const body = mobileToggleChecklistItemBodySchema.parse(request.body);
    const dateKey = body.date ?? localDateKey(new Date(), body.timezone);
    const item = await itemForUser(body.userId, params.itemId);
    const checklistItem = item
      ? (await store.listItemChecklistItems({ userId: body.userId, itemId: item.id, limit: 200 }))
          .find((candidate) => candidate.id === params.checklistItemId)
      : undefined;
    if (!item || !checklistItem) {
      reply.code(404);
      return {
        result: {
          status: "failed",
          messageForUser: `Checklist item not found: ${params.checklistItemId}`
        }
      };
    }
    const checked = body.toggle ? checklistItem.checkedAt === undefined : body.checked ?? true;
    const result = await tools.execute("item.checklist.check", {
      userId: body.userId,
      checklistItemId: params.checklistItemId,
      checked
    });
    if (result.status === "failed" || result.status === "rejected" || result.status === "needs_clarification") {
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
          : await mobileWidgetItemForDashboard(updatedDashboardItem, body.timezone, dateKey)
    };
  });

  app.get("/v1/items/:itemId/details", async (request, reply) => {
    const params = itemActionParamsSchema.parse(request.params);
    const query = itemDetailsQuerySchema.parse(request.query);
    const dateKey = query.date ?? localDateKey(new Date(), query.timezone);
    const item = await itemForUser(query.userId, params.itemId);
    if (!item) {
      reply.code(404);
      return { error: `Item not found: ${params.itemId}` };
    }
    return itemDetailsPayload({
      userId: query.userId,
      item,
      timezone: query.timezone,
      dateKey
    });
  });

  app.post("/v1/items/:itemId/progress-notes", async (request, reply) => {
    const params = itemActionParamsSchema.parse(request.params);
    const body = progressNoteBodySchema.parse(request.body);
    const dateKey = body.date ?? localDateKey(new Date(), body.timezone);
    const item = await itemForUser(body.userId, params.itemId);
    if (!item) {
      reply.code(404);
      return { error: `Item not found: ${params.itemId}` };
    }
    const result = await tools.execute("item.progress.add", {
      userId: body.userId,
      itemRef: params.itemId,
      body: body.body,
      occurredAt: body.occurredAt
    });
    if (result.status === "failed" || result.status === "rejected" || result.status === "needs_clarification") {
      reply.code(400);
    }
    const updated = await store.getItem(params.itemId);
    return {
      result,
      ...(await itemDetailsPayload({
        userId: body.userId,
        item: updated ?? item,
        timezone: body.timezone,
        dateKey
      }))
    };
  });

  app.patch("/v1/items/:itemId/progress-notes/:noteId", async (request, reply) => {
    const params = progressNoteParamsSchema.parse(request.params);
    const body = progressNotePatchBodySchema.parse(request.body);
    const dateKey = body.date ?? localDateKey(new Date(), body.timezone);
    const item = await itemForUser(body.userId, params.itemId);
    const note = await store.getItemProgressNote(params.noteId);
    if (!item || !note || note.itemId !== params.itemId) {
      reply.code(404);
      return { error: `Progress note not found: ${params.noteId}` };
    }
    if (body.body === undefined && body.occurredAt === undefined) {
      reply.code(400);
      return { error: "Progress note update requires body or occurredAt." };
    }
    const result = await tools.execute("item.progress.update", {
      userId: body.userId,
      noteId: params.noteId,
      body: body.body,
      occurredAt: body.occurredAt
    });
    if (result.status === "failed" || result.status === "rejected" || result.status === "needs_clarification") {
      reply.code(400);
    }
    return {
      result,
      ...(await itemDetailsPayload({
        userId: body.userId,
        item,
        timezone: body.timezone,
        dateKey
      }))
    };
  });

  app.delete("/v1/items/:itemId/progress-notes/:noteId", async (request, reply) => {
    const params = progressNoteParamsSchema.parse(request.params);
    const body = itemDetailsQuerySchema.parse(request.body ?? {});
    const dateKey = body.date ?? localDateKey(new Date(), body.timezone);
    const item = await itemForUser(body.userId, params.itemId);
    const note = await store.getItemProgressNote(params.noteId);
    if (!item || !note || note.itemId !== params.itemId) {
      reply.code(404);
      return { error: `Progress note not found: ${params.noteId}` };
    }
    const result = await tools.execute("item.progress.delete", {
      userId: body.userId,
      noteId: params.noteId
    });
    if (result.status === "failed" || result.status === "rejected" || result.status === "needs_clarification") {
      reply.code(400);
    }
    return {
      result,
      ...(await itemDetailsPayload({
        userId: body.userId,
        item,
        timezone: body.timezone,
        dateKey
      }))
    };
  });

  app.post("/v1/items/:itemId/checklist-items", async (request, reply) => {
    const params = itemActionParamsSchema.parse(request.params);
    const body = checklistItemBodySchema.parse(request.body);
    const dateKey = body.date ?? localDateKey(new Date(), body.timezone);
    const item = await itemForUser(body.userId, params.itemId);
    if (!item) {
      reply.code(404);
      return { error: `Item not found: ${params.itemId}` };
    }
    const result = await tools.execute("item.checklist.add", {
      userId: body.userId,
      itemRef: params.itemId,
      title: body.title
    });
    if (result.status === "failed" || result.status === "rejected" || result.status === "needs_clarification") {
      reply.code(400);
    }
    return {
      result,
      ...(await itemDetailsPayload({
        userId: body.userId,
        item,
        timezone: body.timezone,
        dateKey
      }))
    };
  });

  app.patch("/v1/items/:itemId/checklist-items/:checklistItemId", async (request, reply) => {
    const params = checklistItemParamsSchema.parse(request.params);
    const body = checklistItemPatchBodySchema.parse(request.body);
    const dateKey = body.date ?? localDateKey(new Date(), body.timezone);
    const item = await itemForUser(body.userId, params.itemId);
    const checklistItem = item
      ? (await store.listItemChecklistItems({ userId: body.userId, itemId: item.id, limit: 200 }))
          .find((candidate) => candidate.id === params.checklistItemId)
      : undefined;
    if (!item || !checklistItem) {
      reply.code(404);
      return { error: `Checklist item not found: ${params.checklistItemId}` };
    }
    const results: unknown[] = [];
    if (body.title !== undefined || body.sortOrder !== undefined) {
      results.push(
        await tools.execute("item.checklist.update", {
          userId: body.userId,
          checklistItemId: params.checklistItemId,
          title: body.title,
          sortOrder: body.sortOrder
        })
      );
    }
    if (body.checked !== undefined) {
      results.push(
        await tools.execute("item.checklist.check", {
          userId: body.userId,
          checklistItemId: params.checklistItemId,
          checked: body.checked
        })
      );
    }
    if (results.length === 0) {
      reply.code(400);
      return { error: "Checklist update requires title, sortOrder, or checked." };
    }
    const failed = results.find(
      (result) =>
        typeof result === "object" &&
        result !== null &&
        "status" in result &&
        ["failed", "rejected", "needs_clarification"].includes(String((result as { status?: unknown }).status))
    );
    if (failed !== undefined) reply.code(400);
    return {
      result: results[results.length - 1],
      results,
      ...(await itemDetailsPayload({
        userId: body.userId,
        item,
        timezone: body.timezone,
        dateKey
      }))
    };
  });

  app.delete("/v1/items/:itemId/checklist-items/:checklistItemId", async (request, reply) => {
    const params = checklistItemParamsSchema.parse(request.params);
    const body = itemDetailsQuerySchema.parse(request.body ?? {});
    const dateKey = body.date ?? localDateKey(new Date(), body.timezone);
    const item = await itemForUser(body.userId, params.itemId);
    const checklistItem = item
      ? (await store.listItemChecklistItems({ userId: body.userId, itemId: item.id, limit: 200 }))
          .find((candidate) => candidate.id === params.checklistItemId)
      : undefined;
    if (!item || !checklistItem) {
      reply.code(404);
      return { error: `Checklist item not found: ${params.checklistItemId}` };
    }
    const result = await tools.execute("item.checklist.delete", {
      userId: body.userId,
      checklistItemId: params.checklistItemId
    });
    if (result.status === "failed" || result.status === "rejected" || result.status === "needs_clarification") {
      reply.code(400);
    }
    return {
      result,
      ...(await itemDetailsPayload({
        userId: body.userId,
        item,
        timezone: body.timezone,
        dateKey
      }))
    };
  });

  app.post("/v1/items/:itemId/checklist-items/reorder", async (request, reply) => {
    const params = itemActionParamsSchema.parse(request.params);
    const body = checklistReorderBodySchema.parse(request.body);
    const dateKey = body.date ?? localDateKey(new Date(), body.timezone);
    const item = await itemForUser(body.userId, params.itemId);
    if (!item) {
      reply.code(404);
      return { error: `Item not found: ${params.itemId}` };
    }
    const result = await tools.execute("item.checklist.reorder", {
      userId: body.userId,
      itemRef: params.itemId,
      checklistItemIds: body.checklistItemIds
    });
    if (result.status === "failed" || result.status === "rejected" || result.status === "needs_clarification") {
      reply.code(400);
    }
    return {
      result,
      ...(await itemDetailsPayload({
        userId: body.userId,
        item,
        timezone: body.timezone,
        dateKey
      }))
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

  app.post("/v1/items/:itemId/star", async (request, reply) => {
    const params = itemActionParamsSchema.parse(request.params);
    const body = starItemBodySchema.parse(request.body);
    const result = await tools.execute("item.star", {
      userId: body.userId,
      itemRef: params.itemId,
      starred: body.starred,
      starredAt: body.starredAt
    });
    if (result.status === "failed" || result.status === "rejected" || result.status === "needs_clarification") {
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
    const updated = await store.getItem(params.itemId);
    return {
      result,
      item: updated ? await itemForDashboard(updated, body.timezone, referenceDateKey) : undefined
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
    if (!(await integrationEnabled(message.userId, "ai"))) {
      const response = await persistAssistantResponse(
        message,
        "AI integration is disabled for this user.",
        {
          mode: "integration-disabled",
          integrationId: "ai"
        }
      );
      return {
        mode: "integration-disabled",
        provider: ai.name,
        message,
        ...(storedMessage ? { storedMessage } : {}),
        ...(response ? { response } : {}),
        warnings: [...warnings, "AI integration is disabled for this user."]
      };
    }
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

    const senderId = getTelegramSenderId(normalized.message);
    const linkCode = telegramLinkCodeFromText(normalized.message.text);
    if (senderId && linkCode) {
      const pending = await store.findProviderAccountByExternalId("telegram_link_code", linkCode);
      if (!pending || telegramLinkCodeExpired(pending.metadata)) {
        reply.code(404);
        return {
          status: "rejected",
          reason: "telegram_link_code_invalid_or_expired",
          senderId
        };
      }
      const existingSender = await store.findProviderAccountByExternalId("telegram", senderId);
      if (existingSender && existingSender.userId !== pending.userId) {
        reply.code(409);
        return {
          status: "rejected",
          reason: "telegram_sender_already_linked",
          senderId
        };
      }
      const linked = await store.upsertProviderAccount({
        userId: pending.userId,
        provider: "telegram",
        externalAccountId: senderId,
        displayName: normalized.message.displayName ?? `Telegram ${senderId}`,
        status: "active",
        metadata: {
          linkedAt: nowIso(),
          linkedByCode: linkCode,
          chatId: normalized.message.chatId,
          telegram: asJsonObject(normalized.message.metadata.telegram)
        }
      });
      await store.updateProviderAccount(pending.id, {
        status: "used",
        metadata: {
          ...pending.metadata,
          usedAt: nowIso(),
          senderId,
          linkedProviderAccountId: linked.id
        }
      });
      const linkedMessage = { ...normalized.message, userId: pending.userId };
      const delivery = await deliverAssistantResponse(
        linkedMessage,
        "Telegram is linked to your RyanOS account.",
        false
      );
      return {
        status: "linked",
        providerAccountId: linked.id,
        ...(delivery ? { delivery } : {})
      };
    }

    if (authMode !== "dev-local") {
      if (!database) {
        reply.code(503);
        return {
          status: "rejected",
          reason: "database_required_for_telegram_user_mapping"
        };
      }
      if (!senderId) {
        reply.code(403);
        return {
          status: "rejected",
          reason: "telegram_sender_not_mapped",
          senderId
        };
      }
      const linkedAccount = await store.findProviderAccountByExternalId("telegram", senderId);
      const email = telegramUserEmailMap().get(senderId);
      const userId = linkedAccount
        ? linkedAccount.userId
        : email
          ? await resolveUserIdByEmail(database.db, {
              email,
              ...(normalized.message.displayName ? { displayName: normalized.message.displayName } : {})
            })
          : undefined;
      if (!userId) {
        reply.code(403);
        return {
          status: "rejected",
          reason: "telegram_sender_not_mapped",
          senderId
        };
      }
      if (!(await integrationEnabled(userId, "telegram"))) {
        reply.code(403);
        return {
          status: "rejected",
          reason: "telegram_integration_disabled",
          senderId
        };
      }
      return processIncomingMessage({ ...normalized.message, userId });
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
