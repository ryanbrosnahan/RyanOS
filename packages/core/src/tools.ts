import { ToolRegistry, toolEnvelopeSchema } from "@ryanos/ai";
import { addDaysIso, nowIso } from "@ryanos/shared";
import { z } from "zod";
import { calculateRecurrenceState, isBeforeMinimumInterval } from "./recurrence.js";
import type { ItemCreateData, ItemPatch, RyanStore, VocabularyEntryPatch } from "./store.js";
import type { JsonObject, UUID } from "@ryanos/shared";
import type {
  Area,
  Item,
  ItemChecklistItem,
  ItemProgressNote,
  Project,
  ShoppingCatalogItem,
  ShoppingListItem,
  VocabularyEntry
} from "./types.js";

const userIdSchema = z.string().min(1).default("local-owner");
const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const shoppingCategories = [
  "grocery",
  "personal care",
  "household good",
  "health",
  "miscellaneous"
] as const;
const shoppingCategorySchema = z.enum(shoppingCategories);
type ShoppingCategory = (typeof shoppingCategories)[number];
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
type VocabularyCategory = (typeof vocabularyCategories)[number];
const recurrenceTypeSchema = z.preprocess(
  (value) => (value === "interval" ? "completion_based" : value),
  z.enum(["completion_based", "fixed_schedule", "minimum_interval", "target_frequency", "opportunistic"])
);

function asJsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value ?? {})) as JsonObject;
}

function defaultDueAtForOneOff(kind: ItemCreateData["kind"], now: string): string | undefined {
  if (kind === "habit" || kind === "note") return undefined;
  return addDaysIso(now, 14);
}

function isDefaultDueMetadata(metadata: JsonObject): boolean {
  return metadata.defaultDueAt === true;
}

function cleanLabel(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeShoppingName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, " ");
}

function inferShoppingCategory(name: string): ShoppingCategory {
  const normalized = normalizeShoppingName(name);
  if (/\b(vitamins?|medicine|medications?|supplements?|advil|tylenol|ibuprofen|bandages?|wart acid)\b/.test(normalized)) {
    return "health";
  }
  if (/\b(detergent|dish soap|trash bags?|paper towels?|toilet paper|cleaner|sponges?|batter(y|ies)|laundry|car soap|car wash)\b/.test(normalized) || /\bsoap\b.*\bcar\b/.test(normalized)) {
    return "household good";
  }
  if (/\b(toothpaste|toothbrush|floss|deodorant|shampoo|conditioner|razor|mouthwash|soap)\b/.test(normalized)) {
    return "personal care";
  }
  if (/\b(gift|adapter|cable|notebooks?|envelopes?|misc)\b/.test(normalized)) {
    return "miscellaneous";
  }
  return "grocery";
}

function shoppingLingerAfter(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function shoppingListReference(value: string | undefined): boolean {
  if (value === undefined) return false;
  return new Set(["shopping", "shopping list", "grocery", "grocery list", "groceries"]).has(cleanLabel(value));
}

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

function vocabularyReference(value: string | undefined): boolean {
  if (value === undefined) return false;
  return new Set([
    "vocabulary",
    "vocab",
    "dictionary",
    "word list",
    "words",
    "words to learn",
    "terms"
  ]).has(cleanLabel(value));
}

function vocabularyRequestText(value: string | undefined): boolean {
  if (value === undefined) return false;
  const text = cleanLabel(value);
  return (
    /\b(add|save|store|put|record)\b.*\b(vocabulary|vocab|dictionary|word list)\b/.test(text) ||
    /\b(define|look up|lookup)\b.*\b(word|term|vocabulary|vocab|dictionary)\b/.test(text) ||
    /\b(save|add|store|record) (this )?(word|term)\b/.test(text)
  );
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

function cleanVocabularyTags(tags: string[] | undefined): string[] {
  return [...new Set((tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
}

function mergeVocabularyTags(a: string[], b: string[]): string[] {
  return cleanVocabularyTags([...a, ...b]);
}

async function upsertVocabularyEntry(
  store: RyanStore,
  input: {
    userId: string;
    term: string;
    languageCode?: string | undefined;
    category?: VocabularyCategory | undefined;
    definition?: string | undefined;
    partOfSpeech?: string | undefined;
    pronunciation?: string | undefined;
    translation?: string | undefined;
    notes?: string | undefined;
    tags?: string[] | undefined;
    definitionSource?: string | undefined;
    sourceType?: string | undefined;
    sourceTitle?: string | undefined;
    sourceUrl?: string | undefined;
    context?: string | undefined;
    occurredAt?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
  }
): Promise<{ entry: VocabularyEntry; encounterId?: string | undefined; merged: boolean }> {
  const term = input.term.trim();
  const languageCode = normalizeLanguageCode(input.languageCode);
  const normalizedTerm = normalizeVocabularyTerm(term);
  const tags = cleanVocabularyTags(input.tags);
  const category = inferVocabularyCategory({
    term,
    languageCode,
    category: input.category,
    context: input.context,
    tags
  });
  const existing = await store.findVocabularyEntry(input.userId, languageCode, normalizedTerm);
  let entry: VocabularyEntry;
  let merged = false;
  if (existing !== undefined) {
    const patch: VocabularyEntryPatch = {
      term,
      category,
      tags: mergeVocabularyTags(existing.tags, tags),
      status: "active",
      metadata: asJsonObject({
        ...existing.metadata,
        ...input.metadata,
        lastQuickAddAt: nowIso()
      })
    };
    if ((existing.definition ?? "").trim().length === 0 && input.definition !== undefined) {
      patch.definition = input.definition;
      patch.definitionSource = input.definitionSource ?? "ai_draft";
    }
    if ((existing.partOfSpeech ?? "").trim().length === 0 && input.partOfSpeech !== undefined) {
      patch.partOfSpeech = input.partOfSpeech;
    }
    if ((existing.pronunciation ?? "").trim().length === 0 && input.pronunciation !== undefined) {
      patch.pronunciation = input.pronunciation;
    }
    if ((existing.translation ?? "").trim().length === 0 && input.translation !== undefined) {
      patch.translation = input.translation;
    }
    if (input.notes !== undefined && input.notes.trim().length > 0) {
      patch.notes = [existing.notes, input.notes].filter(Boolean).join("\n");
    }
    entry = await store.updateVocabularyEntry(existing.id, patch);
    merged = true;
  } else {
    const createData: Parameters<RyanStore["createVocabularyEntry"]>[0] = {
      userId: input.userId,
      term,
      normalizedTerm,
      languageCode,
      category,
      tags,
      definitionSource: input.definitionSource ?? (input.definition ? "ai_draft" : "manual"),
      status: "active",
      metadata: asJsonObject({
        ...input.metadata,
        firstQuickAddAt: nowIso()
      })
    };
    if (input.definition !== undefined) createData.definition = input.definition;
    if (input.partOfSpeech !== undefined) createData.partOfSpeech = input.partOfSpeech;
    if (input.pronunciation !== undefined) createData.pronunciation = input.pronunciation;
    if (input.translation !== undefined) createData.translation = input.translation;
    if (input.notes !== undefined) createData.notes = input.notes;
    entry = await store.createVocabularyEntry(createData);
  }

  const hasEncounter =
    input.sourceType !== undefined ||
    input.sourceTitle !== undefined ||
    input.sourceUrl !== undefined ||
    input.context !== undefined ||
    input.occurredAt !== undefined;
  if (!hasEncounter) return { entry, merged };
  const encounterData: Parameters<RyanStore["addVocabularyEncounter"]>[0] = {
    userId: input.userId,
    entryId: entry.id,
    metadata: {}
  };
  if (input.sourceType !== undefined) encounterData.sourceType = input.sourceType;
  if (input.sourceTitle !== undefined) encounterData.sourceTitle = input.sourceTitle;
  if (input.sourceUrl !== undefined) encounterData.sourceUrl = input.sourceUrl;
  if (input.context !== undefined) encounterData.context = input.context;
  if (input.occurredAt !== undefined) encounterData.occurredAt = input.occurredAt;
  const encounter = await store.addVocabularyEncounter(encounterData);
  return { entry, encounterId: encounter.id, merged };
}

const areaVisualDefaults: Record<string, { icon: string; color: string }> = {
  health: { icon: "heart-pulse", color: "cyan" },
  fitness: { icon: "heart-pulse", color: "cyan" },
  work: { icon: "briefcase-business", color: "sky" },
  career: { icon: "briefcase-business", color: "sky" },
  family: { icon: "users", color: "violet" },
  relationships: { icon: "users", color: "violet" },
  social: { icon: "users", color: "violet" },
  home: { icon: "home", color: "amber" },
  finance: { icon: "landmark", color: "indigo" },
  investments: { icon: "landmark", color: "indigo" },
  learning: { icon: "book-open", color: "violet" },
  hobbies: { icon: "sparkles", color: "fuchsia" },
  travel: { icon: "plane", color: "cyan" },
  pets: { icon: "paw-print", color: "sky" },
  errands: { icon: "clipboard-list", color: "stone" },
  admin: { icon: "clipboard-list", color: "stone" },
  "side projects": { icon: "code-2", color: "blue" }
};

function defaultAreaVisual(name: string): { icon: string; color: string } {
  const normalized = cleanLabel(name);
  return areaVisualDefaults[normalized] ?? { icon: "folder", color: "stone" };
}

function visualMetadata(
  name: string,
  input: { icon?: string | undefined; color?: string | undefined; metadata?: Record<string, unknown> | undefined },
  defaults: { icon: string; color: string }
): JsonObject {
  return asJsonObject({
    ...input.metadata,
    icon: input.icon ?? (typeof input.metadata?.icon === "string" ? input.metadata.icon : defaults.icon),
    color: input.color ?? (typeof input.metadata?.color === "string" ? input.metadata.color : defaults.color),
    label: name
  });
}

async function resolveArea(
  store: RyanStore,
  input: {
    userId: string;
    areaRef?: string | undefined;
    createMissing?: boolean | undefined;
    icon?: string | undefined;
    color?: string | undefined;
  }
): Promise<Area | undefined> {
  if (input.areaRef === undefined || input.areaRef.trim().length === 0) return undefined;
  const matches = await store.searchAreas(input.userId, input.areaRef, 3);
  const best = matches[0];
  if (best && best.confidence >= 0.75) return best.record;
  if (input.createMissing === false) return undefined;
  const defaults = defaultAreaVisual(input.areaRef);
  return store.upsertArea({
    userId: input.userId,
    name: input.areaRef,
    metadata: visualMetadata(input.areaRef, input, defaults)
  });
}

async function resolveProject(
  store: RyanStore,
  input: {
    userId: string;
    projectRef?: string | undefined;
    area?: Area | undefined;
    createMissing?: boolean | undefined;
    icon?: string | undefined;
    color?: string | undefined;
  }
): Promise<Project | undefined> {
  if (input.projectRef === undefined || input.projectRef.trim().length === 0) return undefined;
  const matches = await store.searchProjects(input.userId, input.projectRef, 5);
  const best = matches.find(
    (match) => input.area === undefined || match.record.areaId === undefined || match.record.areaId === input.area.id
  );
  if (best && best.confidence >= 0.75) return best.record;
  if (input.createMissing === false) return undefined;
  const metadata = visualMetadata(input.projectRef, input, {
    icon: input.icon ?? "folder-kanban",
    color: input.color ?? "stone"
  });
  const createData: Parameters<RyanStore["upsertProject"]>[0] = {
    userId: input.userId,
    name: input.projectRef,
    metadata
  };
  if (input.area !== undefined) createData.areaId = input.area.id;
  return store.upsertProject(createData);
}

async function resolveItemIds(
  store: RyanStore,
  userId: string,
  refs: string[] | undefined
): Promise<UUID[]> {
  const ids: UUID[] = [];
  const seen = new Set<string>();
  for (const ref of refs ?? []) {
    const trimmed = ref.trim();
    if (!trimmed) continue;
    const matches = await store.searchItems(userId, trimmed, 3);
    const best = matches[0];
    if (!best || best.confidence < 0.75 || seen.has(best.record.id)) continue;
    seen.add(best.record.id);
    ids.push(best.record.id);
  }
  return ids;
}

async function resolveItem(
  store: RyanStore,
  userId: string,
  itemRef: string
): Promise<{ item: Item; matchedBy: string } | undefined> {
  const matches = await store.searchItems(userId, itemRef, 3);
  const best = matches[0];
  if (!best || best.confidence < 0.75) return undefined;
  return { item: best.record, matchedBy: best.reason };
}

async function itemProgressNoteForUser(
  store: RyanStore,
  userId: string,
  noteId: string
): Promise<ItemProgressNote | undefined> {
  const note = await store.getItemProgressNote(noteId);
  if (!note || note.deletedAt !== undefined) return undefined;
  const visibleNotes = await store.listItemProgressNotes({
    userId,
    itemId: note.itemId,
    limit: 200
  });
  return visibleNotes.find((candidate) => candidate.id === noteId);
}

async function itemChecklistItemForUser(
  store: RyanStore,
  userId: string,
  checklistItemId: string
): Promise<ItemChecklistItem | undefined> {
  const checklistItem = await store.getItemChecklistItem(checklistItemId);
  if (!checklistItem || checklistItem.deletedAt !== undefined) return undefined;
  const visibleChecklistItems = await store.listItemChecklistItems({
    userId,
    itemId: checklistItem.itemId,
    limit: 200
  });
  return visibleChecklistItems.find((candidate) => candidate.id === checklistItemId);
}

async function findShoppingCatalogItem(
  store: RyanStore,
  userId: string,
  normalizedName: string
): Promise<ShoppingCatalogItem | undefined> {
  const catalogItems = await store.listShoppingCatalogItems({ userId, limit: 100 });
  return catalogItems.find((item) => item.normalizedName === normalizedName);
}

async function upsertShoppingListItem(
  store: RyanStore,
  input: {
    userId: string;
    listId: string;
    name: string;
    category?: ShoppingCategory | undefined;
    quantity?: string | undefined;
    note?: string | undefined;
    source: string;
  }
): Promise<ShoppingListItem> {
  const normalizedName = normalizeShoppingName(input.name);
  const activeItems = await store.listShoppingItems({
    userId: input.userId,
    listId: input.listId,
    checkedAfter: shoppingLingerAfter(24),
    limit: 200
  });
  const existing = activeItems.find((item) => item.normalizedName === normalizedName);
  const catalogItem = await findShoppingCatalogItem(store, input.userId, normalizedName);
  const category = input.category ?? catalogItem?.defaultCategory ?? inferShoppingCategory(input.name);
  if (existing !== undefined) {
    return store.updateShoppingItem(existing.id, {
      name: input.name,
      normalizedName,
      category,
      checkedAt: null,
      source: input.source,
      ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
      ...(input.note !== undefined ? { note: input.note } : {})
    });
  }

  const createData: Parameters<RyanStore["createShoppingItem"]>[0] = {
    userId: input.userId,
    listId: input.listId,
    name: input.name,
    normalizedName,
    category,
    source: input.source
  };
  if (catalogItem !== undefined) createData.catalogItemId = catalogItem.id;
  if (input.quantity !== undefined) createData.quantity = input.quantity;
  if (input.note !== undefined) createData.note = input.note;
  return store.createShoppingItem(createData);
}

type RecurrencePolicyToolInput = {
  type: z.infer<typeof recurrenceTypeSchema>;
  intervalDays?: number | undefined;
  minimumIntervalDays?: number | undefined;
  cron?: string | undefined;
  targetCount?: number | undefined;
  targetWindowDays?: number | undefined;
  preferredDays?: string[] | undefined;
};

function validateRecurrencePolicyInput(policy: RecurrencePolicyToolInput): string | undefined {
  if (policy.type === "completion_based" && policy.intervalDays === undefined) {
    return "completion_based recurrence requires intervalDays.";
  }
  if (policy.type === "minimum_interval" && policy.minimumIntervalDays === undefined) {
    return "minimum_interval recurrence requires minimumIntervalDays.";
  }
  if (
    policy.type === "target_frequency" &&
    (policy.targetCount === undefined || policy.targetWindowDays === undefined)
  ) {
    return "target_frequency recurrence requires targetCount and targetWindowDays.";
  }
  if (
    policy.type === "fixed_schedule" &&
    policy.cron === undefined &&
    (policy.preferredDays === undefined || policy.preferredDays.length === 0)
  ) {
    return "fixed_schedule recurrence requires cron or preferredDays.";
  }
  return undefined;
}

async function audit(
  store: RyanStore,
  input: { userId: string; action: string; toolName: string; request: unknown; result: unknown; sourceMessageId?: string | undefined }
) {
  const log: Parameters<RyanStore["addAuditLog"]>[0] = {
    userId: input.userId,
    actorType: "ai",
    action: input.action,
    toolName: input.toolName,
    request: asJsonObject(input.request),
    result: asJsonObject(input.result),
    status: "success",
    metadata: {}
  };
  if (input.sourceMessageId !== undefined) {
    log.sourceMessageId = input.sourceMessageId;
  }
  return store.addAuditLog(log);
}

export function createCoreToolRegistry(store: RyanStore): ToolRegistry {
  const registry = new ToolRegistry();

  registry.register({
    name: "area.upsert",
    description: "Create or update a broad life/work area such as Health, Work, Family, Finance, Home, or Hobbies.",
    metadata: {
      sideEffect: "state_write",
      confirmation: "not_required",
      retrySafety: "safe_with_idempotency_key",
      descriptionForModel:
        "Use to define or refine top-level taxonomy buckets. Areas are broad domains of life, not one-off tasks."
    },
    inputSchema: toolEnvelopeSchema.extend({
      userId: userIdSchema,
      name: z.string().min(1),
      description: z.string().optional(),
      icon: z.string().optional(),
      color: z.string().optional(),
      sortOrder: z.number().int().optional(),
      metadata: z.record(z.string(), z.unknown()).optional()
    }),
    handler: async (input) => {
      const defaults = defaultAreaVisual(input.name);
      const areaInput: Parameters<RyanStore["upsertArea"]>[0] = {
        userId: input.userId,
        name: input.name,
        metadata: visualMetadata(input.name, input, defaults)
      };
      if (input.description !== undefined) areaInput.description = input.description;
      if (input.sortOrder !== undefined) areaInput.sortOrder = input.sortOrder;
      const area = await store.upsertArea(areaInput);
      const auditLog = await audit(store, {
        userId: input.userId,
        action: "area.upsert",
        toolName: "area.upsert",
        sourceMessageId: input.sourceMessageId,
        request: input,
        result: { areaId: area.id }
      });
      return {
        status: "applied",
        data: { area },
        auditId: auditLog.id,
        messageForUser: `Saved area "${area.name}".`
      };
    }
  });

  registry.register({
    name: "project.upsert",
    description: "Create or update a specific project, silo, company, property, investment, or initiative under an optional area.",
    metadata: {
      sideEffect: "state_write",
      confirmation: "not_required",
      retrySafety: "safe_with_idempotency_key",
      descriptionForModel:
        "Use when the user names a specific silo like a company, property, client pipeline, wedding, investment, or software product. If an area is implied, include `areaRef`."
    },
    inputSchema: toolEnvelopeSchema.extend({
      userId: userIdSchema,
      name: z.string().min(1),
      areaRef: z.string().optional(),
      description: z.string().optional(),
      priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
      dueAt: z.string().optional(),
      reviewAfter: z.string().optional(),
      icon: z.string().optional(),
      color: z.string().optional(),
      metadata: z.record(z.string(), z.unknown()).optional()
    }),
    handler: async (input) => {
      const area = await resolveArea(store, {
        userId: input.userId,
        areaRef: input.areaRef,
        createMissing: true
      });
      const projectInput: Parameters<RyanStore["upsertProject"]>[0] = {
        userId: input.userId,
        name: input.name,
        priority: input.priority,
        metadata: visualMetadata(input.name, input, {
          icon: input.icon ?? "folder-kanban",
          color: input.color ?? "stone"
        })
      };
      if (area !== undefined) projectInput.areaId = area.id;
      if (input.description !== undefined) projectInput.description = input.description;
      if (input.dueAt !== undefined) projectInput.dueAt = input.dueAt;
      if (input.reviewAfter !== undefined) projectInput.reviewAfter = input.reviewAfter;
      const project = await store.upsertProject(projectInput);
      const auditLog = await audit(store, {
        userId: input.userId,
        action: "project.upsert",
        toolName: "project.upsert",
        sourceMessageId: input.sourceMessageId,
        request: input,
        result: { projectId: project.id, areaId: project.areaId }
      });
      return {
        status: "applied",
        data: { area, project },
        auditId: auditLog.id,
        messageForUser: area
          ? `Saved project "${project.name}" under ${area.name}.`
          : `Saved project "${project.name}".`
      };
    }
  });

  registry.register({
    name: "item.search",
    description: "Find candidate items for an ambiguous user reference.",
    metadata: {
      sideEffect: "read",
      confirmation: "not_required",
      retrySafety: "idempotent",
      descriptionForModel: "Use before mutating an item when the user's reference may be ambiguous."
    },
    inputSchema: toolEnvelopeSchema.extend({
      userId: userIdSchema,
      query: z.string().min(1),
      includeDone: z.boolean().default(false),
      limit: z.number().int().positive().max(20).default(5)
    }),
    handler: async (input) => {
      const matches = (await store.searchItems(input.userId, input.query, input.limit)).filter(
        (match) => input.includeDone || !["done", "cancelled"].includes(match.record.status)
      );
      const data = {
        matches: matches.map((match) => ({
          id: match.record.id,
          kind: match.record.kind,
          title: match.record.title,
          status: match.record.status,
          priority: match.record.priority,
          dueAt: match.record.dueAt,
          confidence: match.confidence,
          reason: match.reason
        }))
      };
      const auditLog = await audit(store, {
        userId: input.userId,
        action: "item.search",
        toolName: "item.search",
        sourceMessageId: input.sourceMessageId,
        request: input,
        result: { matchCount: data.matches.length }
      });
      return {
        status: "applied",
        data,
        auditId: auditLog.id,
        messageForUser:
          data.matches.length === 0
            ? `I did not find an item matching "${input.query}".`
            : `Found ${data.matches.length} candidate item${data.matches.length === 1 ? "" : "s"}.`
      };
    }
  });

  registry.register({
    name: "daily_plan.upsert",
    description: "Create or update daily focus suggestion history and candidate priority items.",
    metadata: {
      sideEffect: "state_write",
      confirmation: "not_required",
      retrySafety: "safe_with_idempotency_key",
      descriptionForModel:
        "Use to store suggested item candidates for starring. Active focus is controlled by item.star; do not generate a daily check-in prompt."
    },
    inputSchema: toolEnvelopeSchema.extend({
      userId: userIdSchema,
      dateKey: dateKeySchema,
      timezone: z.string().default("America/Chicago"),
      prompt: z.string().min(1),
      response: z.string().optional(),
      successCriteria: z.array(z.string()).default([]),
      selectedItemRefs: z.array(z.string()).default([]),
      suggestedItemRefs: z.array(z.string()).default([]),
      suggestionSource: z.enum(["ai", "heuristic", "user"]).default("ai"),
      metadata: z.record(z.string(), z.unknown()).optional()
    }),
    handler: async (input) => {
      const [selectedItemIds, suggestedItemIds] = await Promise.all([
        resolveItemIds(store, input.userId, input.selectedItemRefs),
        resolveItemIds(store, input.userId, input.suggestedItemRefs)
      ]);
      const planInput: Parameters<RyanStore["upsertDailyPlan"]>[0] = {
        userId: input.userId,
        dateKey: input.dateKey,
        timezone: input.timezone,
        prompt: input.prompt,
        successCriteria: input.successCriteria
          .map((criterion) => criterion.trim())
          .filter((criterion) => criterion.length > 0),
        selectedItemIds,
        suggestedItemIds: suggestedItemIds.length > 0 ? suggestedItemIds : selectedItemIds,
        suggestionSource: input.suggestionSource,
        status: "active",
        metadata: asJsonObject(input.metadata)
      };
      if (input.response !== undefined) planInput.response = input.response;
      const plan = await store.upsertDailyPlan(planInput);
      const auditLog = await audit(store, {
        userId: input.userId,
        action: "daily_plan.upsert",
        toolName: "daily_plan.upsert",
        sourceMessageId: input.sourceMessageId,
        request: input,
        result: {
          planId: plan.id,
          selectedItemIds: plan.selectedItemIds,
          suggestedItemIds: plan.suggestedItemIds
        }
      });
      return {
        status: "applied",
        data: { plan },
        auditId: auditLog.id,
        messageForUser: "Saved today's focus plan."
      };
    }
  });

  registry.register({
    name: "item.create",
    description: "Create a task, reminder, decision, note, waiting item, habit, or other item.",
    metadata: {
      sideEffect: "state_write",
      confirmation: "not_required",
      retrySafety: "safe_with_idempotency_key",
      descriptionForModel: "Creates a RyanOS item only; does not contact external systems. Use `kind` for item type, for example `{ \"title\": \"Go to the gym\", \"kind\": \"habit\", \"areaRef\": \"Health\" }`. Use `areaRef` for the broad domain and `projectRef` for a specific silo."
    },
    inputSchema: toolEnvelopeSchema.extend({
      userId: userIdSchema,
      title: z.string().min(1),
      kind: z.enum(["task", "reminder", "decision", "note", "waiting", "habit", "opportunity_action", "other"]).default("task"),
      priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
      areaRef: z.string().optional(),
      projectRef: z.string().optional(),
      dueAt: z.string().optional(),
      startAt: z.string().optional(),
      estimateMinutes: z.number().int().positive().optional(),
      body: z.string().optional()
    }),
    handler: async (input) => {
      if (shoppingListReference(input.areaRef) || shoppingListReference(input.projectRef)) {
        return {
          status: "rejected",
          messageForUser: "That sounds like a shopping-list request. Use shopping.addItems so it goes on the shopping list, not the task list."
        };
      }
      if (
        vocabularyReference(input.areaRef) ||
        vocabularyReference(input.projectRef) ||
        vocabularyRequestText(input.title) ||
        vocabularyRequestText(input.body)
      ) {
        return {
          status: "rejected",
          messageForUser: "That sounds like a vocabulary request. Use vocabulary.addEntries so it goes in the dictionary, not the task list."
        };
      }

      const area = await resolveArea(store, {
        userId: input.userId,
        areaRef: input.areaRef,
        createMissing: true
      });
      const project = await resolveProject(store, {
        userId: input.userId,
        projectRef: input.projectRef,
        area,
        createMissing: true
      });
      const createData: ItemCreateData = {
        userId: input.userId,
        kind: input.kind,
        title: input.title,
        priority: input.priority
      };
      const metadata: Record<string, unknown> = {};
      if (area !== undefined) createData.areaId = area.id;
      if (project !== undefined) {
        createData.projectId = project.id;
        if (area === undefined && project.areaId !== undefined) createData.areaId = project.areaId;
      }
      if (input.dueAt !== undefined) {
        createData.dueAt = input.dueAt;
      } else {
        const defaultDueAt = defaultDueAtForOneOff(input.kind, nowIso());
        if (defaultDueAt !== undefined) {
          createData.dueAt = defaultDueAt;
          metadata.defaultDueAt = true;
          metadata.defaultDueDays = 14;
        }
      }
      if (input.startAt !== undefined) createData.startAt = input.startAt;
      if (input.estimateMinutes !== undefined) createData.estimateMinutes = input.estimateMinutes;
      if (input.body !== undefined) createData.body = input.body;
      if (Object.keys(metadata).length > 0) createData.metadata = asJsonObject(metadata);

      const item = await store.createItem(createData);
      const eventInput: Parameters<RyanStore["addItemEvent"]>[0] = {
        userId: input.userId,
        itemId: item.id,
        eventType: "created",
        occurredAt: nowIso(),
        payload: { title: item.title }
      };
      if (input.sourceMessageId !== undefined) eventInput.sourceMessageId = input.sourceMessageId;
      if (input.idempotencyKey !== undefined) eventInput.idempotencyKey = input.idempotencyKey;
      const event = await store.addItemEvent(eventInput);
      const auditLog = await audit(store, {
        userId: input.userId,
        action: "item.create",
        toolName: "item.create",
        sourceMessageId: input.sourceMessageId,
        request: input,
        result: { itemId: item.id, eventId: event.id, areaId: item.areaId, projectId: item.projectId }
      });
      return {
        status: "applied",
        data: { item },
        eventIds: [event.id],
        auditId: auditLog.id,
        messageForUser: `Created "${item.title}".`
      };
    }
  });

  registry.register({
    name: "shopping.addItems",
    description: "Add one or more things to buy to the shopping list, such as groceries, household goods, personal care, health items, or miscellaneous purchases.",
    metadata: {
      sideEffect: "state_write",
      confirmation: "not_required",
      retrySafety: "safe_with_idempotency_key",
      descriptionForModel:
        "Use this whenever the user says shopping list, grocery list, buy, pick up, need from the store, household supplies, toiletries, medicine, vitamins, or other purchases. Do not use item.create for shopping-list items."
    },
    inputSchema: toolEnvelopeSchema.extend({
      userId: userIdSchema,
      items: z.array(
        z.object({
          name: z.string().trim().min(1),
          category: shoppingCategorySchema.optional(),
          quantity: z.string().trim().min(1).optional(),
          note: z.string().trim().min(1).optional()
        })
      ).min(1).max(50),
      source: z.string().trim().min(1).default("chat")
    }),
    handler: async (input) => {
      const list = await store.getDefaultShoppingList(input.userId);
      const items: ShoppingListItem[] = [];
      for (const itemInput of input.items) {
        items.push(
          await upsertShoppingListItem(store, {
            userId: input.userId,
            listId: list.id,
            name: itemInput.name,
            category: itemInput.category,
            quantity: itemInput.quantity,
            note: itemInput.note,
            source: input.source
          })
        );
      }
      const auditLog = await audit(store, {
        userId: input.userId,
        action: "shopping.addItems",
        toolName: "shopping.addItems",
        sourceMessageId: input.sourceMessageId,
        request: input,
        result: {
          listId: list.id,
          itemIds: items.map((item) => item.id),
          itemNames: items.map((item) => item.name)
        }
      });
      const names = items.map((item) => item.name).join(", ");
      return {
        status: "applied",
        data: { list, items },
        auditId: auditLog.id,
        messageForUser: `Added to shopping list: ${names}.`
      };
    }
  });

  registry.register({
    name: "vocabulary.addEntries",
    description: "Save one or more unfamiliar words, phrases, medical terms, technical terms, slang terms, or foreign-language words to the user's editable vocabulary dictionary.",
    metadata: {
      sideEffect: "state_write",
      confirmation: "not_required",
      retrySafety: "safe_with_idempotency_key",
      descriptionForModel:
        "Use this whenever the user says save/add/define a word or term, add to vocabulary, add to dictionary, or mentions a foreign-language word to learn. Draft a brief editable definition when you can. Do not use item.create for vocabulary or dictionary requests."
    },
    inputSchema: toolEnvelopeSchema.extend({
      userId: userIdSchema,
      entries: z.array(
        z.object({
          term: z.string().trim().min(1),
          languageCode: z.string().trim().min(1).default("en"),
          category: vocabularyCategorySchema.optional(),
          definition: z.string().trim().min(1).optional(),
          partOfSpeech: z.string().trim().min(1).optional(),
          pronunciation: z.string().trim().min(1).optional(),
          translation: z.string().trim().min(1).optional(),
          notes: z.string().trim().min(1).optional(),
          tags: z.array(z.string().trim().min(1)).default([]),
          sourceType: z.string().trim().min(1).optional(),
          sourceTitle: z.string().trim().min(1).optional(),
          sourceUrl: z.string().trim().min(1).optional(),
          context: z.string().trim().min(1).optional(),
          occurredAt: z.string().trim().min(1).optional()
        })
      ).min(1).max(20),
      source: z.string().trim().min(1).default("chat")
    }),
    handler: async (input) => {
      const results: Array<{ entry: VocabularyEntry; encounterId?: string | undefined; merged: boolean }> = [];
      for (const entryInput of input.entries) {
        results.push(
          await upsertVocabularyEntry(store, {
            userId: input.userId,
            term: entryInput.term,
            languageCode: entryInput.languageCode,
            category: entryInput.category,
            definition: entryInput.definition,
            partOfSpeech: entryInput.partOfSpeech,
            pronunciation: entryInput.pronunciation,
            translation: entryInput.translation,
            notes: entryInput.notes,
            tags: entryInput.tags,
            definitionSource: entryInput.definition ? "ai_draft" : "manual",
            sourceType: entryInput.sourceType ?? input.source,
            sourceTitle: entryInput.sourceTitle,
            sourceUrl: entryInput.sourceUrl,
            context: entryInput.context,
            occurredAt: entryInput.occurredAt,
            metadata: {
              source: input.source
            }
          })
        );
      }
      const auditLog = await audit(store, {
        userId: input.userId,
        action: "vocabulary.addEntries",
        toolName: "vocabulary.addEntries",
        sourceMessageId: input.sourceMessageId,
        request: input,
        result: {
          entryIds: results.map((result) => result.entry.id),
          terms: results.map((result) => result.entry.term),
          mergedCount: results.filter((result) => result.merged).length
        }
      });
      const names = results.map((result) => result.entry.term).join(", ");
      return {
        status: "applied",
        data: {
          entries: results.map((result) => result.entry),
          encounterIds: results
            .map((result) => result.encounterId)
            .filter((id): id is string => id !== undefined)
        },
        auditId: auditLog.id,
        messageForUser: `Saved to vocabulary: ${names}.`
      };
    }
  });

  registry.register({
    name: "item.update",
    description: "Update an existing item after resolving an item reference.",
    metadata: {
      sideEffect: "state_write",
      confirmation: "low_confidence",
      retrySafety: "safe_with_idempotency_key",
      descriptionForModel: "Use after resolving the target item. Ask for clarification when the match is uncertain."
    },
    inputSchema: toolEnvelopeSchema.extend({
      userId: userIdSchema,
      itemRef: z.string().min(1),
      patch: z.object({
        kind: z.enum(["task", "reminder", "decision", "note", "waiting", "habit", "opportunity_action", "other"]).optional(),
        title: z.string().min(1).optional(),
        body: z.string().optional(),
        bodyAppend: z.string().optional(),
        status: z.enum(["open", "active", "waiting", "done", "cancelled"]).optional(),
        priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
        dueAt: z.string().optional(),
        startAt: z.string().optional(),
        snoozedUntil: z.string().optional(),
        estimateMinutes: z.number().int().positive().optional()
      })
    }),
    handler: async (input) => {
      const matches = await store.searchItems(input.userId, input.itemRef, 3);
      const best = matches[0];
      if (!best || best.confidence < 0.75) {
        return {
          status: "needs_clarification",
          clarificationPrompt: `Which item should I update for "${input.itemRef}"?`
        };
      }

      const patch: ItemPatch = {};
      if (input.patch.kind !== undefined) patch.kind = input.patch.kind;
      if (input.patch.title !== undefined) patch.title = input.patch.title;
      if (input.patch.status !== undefined) patch.status = input.patch.status;
      if (input.patch.priority !== undefined) patch.priority = input.patch.priority;
      if (input.patch.dueAt !== undefined) patch.dueAt = input.patch.dueAt;
      if (input.patch.startAt !== undefined) patch.startAt = input.patch.startAt;
      if (input.patch.snoozedUntil !== undefined) patch.snoozedUntil = input.patch.snoozedUntil;
      if (input.patch.estimateMinutes !== undefined) {
        patch.estimateMinutes = input.patch.estimateMinutes;
      }
      if (input.patch.body !== undefined) {
        patch.body = input.patch.body;
      } else if (input.patch.bodyAppend !== undefined) {
        const existingBody = best.record.body ? `${best.record.body}\n` : "";
        patch.body = `${existingBody}${input.patch.bodyAppend}`;
      }

      if (Object.keys(patch).length === 0) {
        return {
          status: "rejected",
          messageForUser: "No item updates were provided."
        };
      }

      const item = await store.updateItem(best.record.id, patch);
      const eventInput: Parameters<RyanStore["addItemEvent"]>[0] = {
        userId: input.userId,
        itemId: item.id,
        eventType: "updated",
        occurredAt: nowIso(),
        payload: { patch: asJsonObject(patch), matchedBy: best.reason }
      };
      if (input.sourceMessageId !== undefined) eventInput.sourceMessageId = input.sourceMessageId;
      if (input.idempotencyKey !== undefined) eventInput.idempotencyKey = input.idempotencyKey;
      const event = await store.addItemEvent(eventInput);
      const auditLog = await audit(store, {
        userId: input.userId,
        action: "item.update",
        toolName: "item.update",
        sourceMessageId: input.sourceMessageId,
        request: input,
        result: { itemId: item.id, eventId: event.id }
      });
      return {
        status: "applied",
        data: { item },
        eventIds: [event.id],
        auditId: auditLog.id,
        messageForUser: `Updated "${item.title}".`
      };
    }
  });

  registry.register({
    name: "item.classify",
    description: "Assign, move, or clear an item's broad area and specific project/silo.",
    metadata: {
      sideEffect: "state_write",
      confirmation: "low_confidence",
      retrySafety: "safe_with_idempotency_key",
      descriptionForModel:
        "Use when the user says an item belongs to an area or project, for example `put gym under Health`, `BP Living is Finance / Real Estate`, or `Court Nox is Work / Legal software`."
    },
    inputSchema: toolEnvelopeSchema.extend({
      userId: userIdSchema,
      itemRef: z.string().min(1),
      areaRef: z.string().optional(),
      projectRef: z.string().optional(),
      createMissing: z.boolean().default(true),
      clearArea: z.boolean().default(false),
      clearProject: z.boolean().default(false),
      note: z.string().optional()
    }),
    handler: async (input) => {
      const matches = await store.searchItems(input.userId, input.itemRef, 3);
      const best = matches[0];
      if (!best || best.confidence < 0.75) {
        return {
          status: "needs_clarification",
          clarificationPrompt: `Which item should I classify for "${input.itemRef}"?`
        };
      }

      const area = input.clearArea
        ? undefined
        : await resolveArea(store, {
            userId: input.userId,
            areaRef: input.areaRef,
            createMissing: input.createMissing
          });
      if (input.areaRef !== undefined && !area && input.createMissing === false) {
        return {
          status: "needs_clarification",
          clarificationPrompt: `Which area should I use for "${input.areaRef}"?`
        };
      }

      const project = input.clearProject
        ? undefined
        : await resolveProject(store, {
            userId: input.userId,
            projectRef: input.projectRef,
            area,
            createMissing: input.createMissing
          });
      if (input.projectRef !== undefined && !project && input.createMissing === false) {
        return {
          status: "needs_clarification",
          clarificationPrompt: `Which project should I use for "${input.projectRef}"?`
        };
      }

      const patch: ItemPatch = {};
      if (input.clearArea) patch.areaId = null;
      else if (area !== undefined) patch.areaId = area.id;
      else if (project?.areaId !== undefined) patch.areaId = project.areaId;

      if (input.clearProject) patch.projectId = null;
      else if (project !== undefined) patch.projectId = project.id;

      if (Object.keys(patch).length === 0) {
        return {
          status: "rejected",
          messageForUser: "No classification change was provided."
        };
      }

      const item = await store.updateItem(best.record.id, patch);
      const eventInput: Parameters<RyanStore["addItemEvent"]>[0] = {
        userId: input.userId,
        itemId: item.id,
        eventType: "updated",
        occurredAt: nowIso(),
        payload: {
          classification: {
            areaId: item.areaId ?? null,
            projectId: item.projectId ?? null,
            note: input.note ?? ""
          },
          matchedBy: best.reason
        }
      };
      if (input.sourceMessageId !== undefined) eventInput.sourceMessageId = input.sourceMessageId;
      if (input.idempotencyKey !== undefined) eventInput.idempotencyKey = input.idempotencyKey;
      const event = await store.addItemEvent(eventInput);
      const auditLog = await audit(store, {
        userId: input.userId,
        action: "item.classify",
        toolName: "item.classify",
        sourceMessageId: input.sourceMessageId,
        request: input,
        result: { itemId: item.id, areaId: item.areaId, projectId: item.projectId, eventId: event.id }
      });
      const labels = [area?.name, project?.name].filter((label): label is string => label !== undefined);
      return {
        status: "applied",
        data: { item, area, project },
        eventIds: [event.id],
        auditId: auditLog.id,
        messageForUser:
          labels.length > 0
            ? `Classified "${item.title}" as ${labels.join(" / ")}.`
            : `Cleared classification for "${item.title}".`
      };
    }
  });

  registry.register({
    name: "item.complete",
    description: "Mark an item complete and record a completion event.",
    metadata: {
      sideEffect: "state_write",
      confirmation: "low_confidence",
      retrySafety: "safe_with_idempotency_key",
      descriptionForModel: "Records completion from the user's message and may reset recurrence from the event time."
    },
    inputSchema: toolEnvelopeSchema.extend({
      userId: userIdSchema,
      itemRef: z.string().min(1),
      completedAt: z.string().optional(),
      note: z.string().optional()
    }),
    handler: async (input) => {
      if (input.idempotencyKey) {
        const replayed = await store.findItemEventByIdempotencyKey(input.userId, input.idempotencyKey);
        if (replayed) {
          return {
            status: "replayed",
            data: { event: replayed },
            eventIds: [replayed.id],
            messageForUser: "That completion was already recorded."
          };
        }
      }

      const matches = await store.searchItems(input.userId, input.itemRef, 3);
      const best = matches[0];
      if (!best || best.confidence < 0.75) {
        return {
          status: "needs_clarification",
          clarificationPrompt: `Which item did you mean by "${input.itemRef}"?`
        };
      }

      const completedAt = input.completedAt ?? nowIso();
      const item = await store.updateItem(best.record.id, {
        status: "done",
        starredAt: null,
        completedAt
      });
      const eventInput: Parameters<RyanStore["addItemEvent"]>[0] = {
        userId: input.userId,
        itemId: item.id,
        eventType: "completed",
        occurredAt: completedAt,
        payload: { note: input.note ?? "", matchedBy: best.reason }
      };
      if (input.sourceMessageId !== undefined) eventInput.sourceMessageId = input.sourceMessageId;
      if (input.idempotencyKey !== undefined) eventInput.idempotencyKey = input.idempotencyKey;
      const event = await store.addItemEvent(eventInput);
      const policy = await store.findRecurrencePolicyForItem(item.id);
      if (policy) {
        const recurrenceEventInput: Parameters<RyanStore["addRecurrenceEvent"]>[0] = {
          userId: input.userId,
          itemId: item.id,
          recurrencePolicyId: policy.id,
          eventType: "completed",
          occurredAt: completedAt,
          payload: {}
        };
        if (input.sourceMessageId !== undefined) {
          recurrenceEventInput.sourceMessageId = input.sourceMessageId;
        }
        if (input.idempotencyKey !== undefined) {
          recurrenceEventInput.idempotencyKey = input.idempotencyKey;
        }
        if (input.note !== undefined) recurrenceEventInput.note = input.note;
        const recurrenceEvent = await store.addRecurrenceEvent(recurrenceEventInput);
        const events = await store.listRecurrenceEvents(policy.id);
        const state = calculateRecurrenceState(policy, events);
        await store.updateRecurrenceState(state);
        const auditLog = await audit(store, {
          userId: input.userId,
          action: "item.complete",
          toolName: "item.complete",
          sourceMessageId: input.sourceMessageId,
          request: input,
          result: { itemId: item.id, eventId: event.id, recurrenceEventId: recurrenceEvent.id, nextDueAt: state.nextDueAt }
        });
        return {
          status: "applied",
          data: { item, recurrenceState: state },
          eventIds: [event.id, recurrenceEvent.id],
          auditId: auditLog.id,
          messageForUser: state.nextDueAt
            ? `Marked "${item.title}" complete. Next due: ${state.nextDueAt}.`
            : `Marked "${item.title}" complete.`
        };
      }

      const auditLog = await audit(store, {
        userId: input.userId,
        action: "item.complete",
        toolName: "item.complete",
        sourceMessageId: input.sourceMessageId,
        request: input,
        result: { itemId: item.id, eventId: event.id }
      });
      return {
        status: "applied",
        data: { item },
        eventIds: [event.id],
        auditId: auditLog.id,
        messageForUser: `Marked "${item.title}" complete.`
      };
    }
  });

  registry.register({
    name: "item.star",
    description: "Star or unstar an item so it stays in today's focus until completion or manual removal.",
    metadata: {
      sideEffect: "state_write",
      confirmation: "low_confidence",
      retrySafety: "safe_with_idempotency_key",
      descriptionForModel: "Use when the user wants to pin or remove an item from today's focus."
    },
    inputSchema: toolEnvelopeSchema.extend({
      userId: userIdSchema,
      itemRef: z.string().min(1),
      starred: z.boolean(),
      starredAt: z.string().optional(),
      note: z.string().optional()
    }),
    handler: async (input) => {
      if (input.idempotencyKey) {
        const replayed = await store.findItemEventByIdempotencyKey(input.userId, input.idempotencyKey);
        if (replayed) {
          return {
            status: "replayed",
            data: { event: replayed },
            eventIds: [replayed.id],
            messageForUser: input.starred ? "That item was already starred." : "That item was already unstarred."
          };
        }
      }

      const matches = await store.searchItems(input.userId, input.itemRef, 3);
      const best = matches[0];
      if (!best || best.confidence < 0.75) {
        return {
          status: "needs_clarification",
          clarificationPrompt: `Which item should I ${input.starred ? "star" : "unstar"} for "${input.itemRef}"?`
        };
      }

      const starredAt = input.starred ? input.starredAt ?? nowIso() : null;
      const item = await store.updateItem(best.record.id, {
        starredAt
      });
      const eventInput: Parameters<RyanStore["addItemEvent"]>[0] = {
        userId: input.userId,
        itemId: item.id,
        eventType: input.starred ? "starred" : "unstarred",
        occurredAt: input.starred && starredAt !== null ? starredAt : nowIso(),
        payload: { note: input.note ?? "", matchedBy: best.reason }
      };
      if (input.sourceMessageId !== undefined) eventInput.sourceMessageId = input.sourceMessageId;
      if (input.idempotencyKey !== undefined) eventInput.idempotencyKey = input.idempotencyKey;
      const event = await store.addItemEvent(eventInput);
      const auditLog = await audit(store, {
        userId: input.userId,
        action: "item.star",
        toolName: "item.star",
        sourceMessageId: input.sourceMessageId,
        request: input,
        result: { itemId: item.id, starred: input.starred, eventId: event.id }
      });
      return {
        status: "applied",
        data: { item },
        eventIds: [event.id],
        auditId: auditLog.id,
        messageForUser: input.starred ? `Starred "${item.title}".` : `Unstarred "${item.title}".`
      };
    }
  });

  registry.register({
    name: "item.progress.add",
    description: "Add a timestamped progress note to an item without completing it.",
    metadata: {
      sideEffect: "state_write",
      confirmation: "not_required",
      retrySafety: "safe_with_idempotency_key",
      descriptionForModel: "Use when the user reports progress on a task but does not want to mark it complete."
    },
    inputSchema: toolEnvelopeSchema.extend({
      userId: userIdSchema,
      itemRef: z.string().min(1),
      body: z.string().trim().min(1).max(4000),
      occurredAt: z.string().optional(),
      metadata: z.record(z.string(), z.unknown()).optional()
    }),
    handler: async (input) => {
      if (input.idempotencyKey) {
        const replayed = await store.findItemEventByIdempotencyKey(input.userId, input.idempotencyKey);
        if (replayed) {
          return {
            status: "replayed",
            data: { event: replayed },
            eventIds: [replayed.id],
            messageForUser: "That progress note was already recorded."
          };
        }
      }
      const resolved = await resolveItem(store, input.userId, input.itemRef);
      if (!resolved) {
        return {
          status: "needs_clarification",
          clarificationPrompt: `Which item should I add progress to for "${input.itemRef}"?`
        };
      }
      const noteInput: Parameters<RyanStore["createItemProgressNote"]>[0] = {
        userId: input.userId,
        itemId: resolved.item.id,
        body: input.body,
        metadata: asJsonObject(input.metadata)
      };
      if (input.occurredAt !== undefined) noteInput.occurredAt = input.occurredAt;
      const note = await store.createItemProgressNote(noteInput);
      const eventInput: Parameters<RyanStore["addItemEvent"]>[0] = {
        userId: input.userId,
        itemId: resolved.item.id,
        eventType: "progress_note_added",
        occurredAt: note.occurredAt,
        payload: { progressNoteId: note.id, matchedBy: resolved.matchedBy }
      };
      if (input.sourceMessageId !== undefined) eventInput.sourceMessageId = input.sourceMessageId;
      if (input.idempotencyKey !== undefined) eventInput.idempotencyKey = input.idempotencyKey;
      const event = await store.addItemEvent(eventInput);
      const auditLog = await audit(store, {
        userId: input.userId,
        action: "item.progress.add",
        toolName: "item.progress.add",
        sourceMessageId: input.sourceMessageId,
        request: input,
        result: { itemId: resolved.item.id, progressNoteId: note.id, eventId: event.id }
      });
      return {
        status: "applied",
        data: { note },
        eventIds: [event.id],
        auditId: auditLog.id,
        messageForUser: `Added progress to "${resolved.item.title}".`
      };
    }
  });

  registry.register({
    name: "item.progress.update",
    description: "Edit an existing item progress note.",
    metadata: {
      sideEffect: "state_write",
      confirmation: "not_required",
      retrySafety: "unsafe",
      descriptionForModel: "Use when the user wants to correct or refine a progress note."
    },
    inputSchema: toolEnvelopeSchema.extend({
      userId: userIdSchema,
      noteId: z.string().min(1),
      body: z.string().trim().min(1).max(4000).optional(),
      occurredAt: z.string().optional(),
      metadata: z.record(z.string(), z.unknown()).optional()
    }),
    handler: async (input) => {
      const note = await itemProgressNoteForUser(store, input.userId, input.noteId);
      if (!note) {
        return {
          status: "failed",
          messageForUser: `Progress note not found: ${input.noteId}`
        };
      }
      const patch: Parameters<RyanStore["updateItemProgressNote"]>[1] = {};
      if (input.body !== undefined) patch.body = input.body;
      if (input.occurredAt !== undefined) patch.occurredAt = input.occurredAt;
      if (input.metadata !== undefined) patch.metadata = asJsonObject(input.metadata);
      const updated = await store.updateItemProgressNote(note.id, patch);
      const eventInput: Parameters<RyanStore["addItemEvent"]>[0] = {
        userId: input.userId,
        itemId: note.itemId,
        eventType: "progress_note_updated",
        occurredAt: nowIso(),
        payload: { progressNoteId: note.id }
      };
      if (input.sourceMessageId !== undefined) eventInput.sourceMessageId = input.sourceMessageId;
      if (input.idempotencyKey !== undefined) eventInput.idempotencyKey = input.idempotencyKey;
      const event = await store.addItemEvent(eventInput);
      const auditLog = await audit(store, {
        userId: input.userId,
        action: "item.progress.update",
        toolName: "item.progress.update",
        sourceMessageId: input.sourceMessageId,
        request: input,
        result: { itemId: note.itemId, progressNoteId: note.id, eventId: event.id }
      });
      return {
        status: "applied",
        data: { note: updated },
        eventIds: [event.id],
        auditId: auditLog.id,
        messageForUser: "Updated progress note."
      };
    }
  });

  registry.register({
    name: "item.progress.delete",
    description: "Delete an existing item progress note.",
    metadata: {
      sideEffect: "state_write",
      confirmation: "low_confidence",
      retrySafety: "unsafe",
      descriptionForModel: "Use when the user wants to remove a progress note from a task."
    },
    inputSchema: toolEnvelopeSchema.extend({
      userId: userIdSchema,
      noteId: z.string().min(1)
    }),
    handler: async (input) => {
      const note = await itemProgressNoteForUser(store, input.userId, input.noteId);
      if (!note) {
        return {
          status: "failed",
          messageForUser: `Progress note not found: ${input.noteId}`
        };
      }
      const deleted = await store.updateItemProgressNote(note.id, { deletedAt: nowIso() });
      const eventInput: Parameters<RyanStore["addItemEvent"]>[0] = {
        userId: input.userId,
        itemId: note.itemId,
        eventType: "progress_note_deleted",
        occurredAt: nowIso(),
        payload: { progressNoteId: note.id }
      };
      if (input.sourceMessageId !== undefined) eventInput.sourceMessageId = input.sourceMessageId;
      if (input.idempotencyKey !== undefined) eventInput.idempotencyKey = input.idempotencyKey;
      const event = await store.addItemEvent(eventInput);
      const auditLog = await audit(store, {
        userId: input.userId,
        action: "item.progress.delete",
        toolName: "item.progress.delete",
        sourceMessageId: input.sourceMessageId,
        request: input,
        result: { itemId: note.itemId, progressNoteId: note.id, eventId: event.id }
      });
      return {
        status: "applied",
        data: { note: deleted },
        eventIds: [event.id],
        auditId: auditLog.id,
        messageForUser: "Deleted progress note."
      };
    }
  });

  registry.register({
    name: "item.checklist.add",
    description: "Add one or more ordered checklist items to a task.",
    metadata: {
      sideEffect: "state_write",
      confirmation: "not_required",
      retrySafety: "safe_with_idempotency_key",
      descriptionForModel: "Use when the user wants to break a task into concrete checklist steps."
    },
    inputSchema: toolEnvelopeSchema.extend({
      userId: userIdSchema,
      itemRef: z.string().min(1),
      title: z.string().trim().min(1).max(500).optional(),
      titles: z.array(z.string().trim().min(1).max(500)).default([]),
      sortOrder: z.number().int().optional(),
      metadata: z.record(z.string(), z.unknown()).optional()
    }),
    handler: async (input) => {
      if (input.idempotencyKey) {
        const replayed = await store.findItemEventByIdempotencyKey(input.userId, input.idempotencyKey);
        if (replayed) {
          return {
            status: "replayed",
            data: { event: replayed },
            eventIds: [replayed.id],
            messageForUser: "That checklist update was already recorded."
          };
        }
      }
      const titles = [input.title, ...input.titles]
        .filter((title): title is string => typeof title === "string")
        .map((title) => title.trim())
        .filter(Boolean);
      if (titles.length === 0) {
        return {
          status: "rejected",
          messageForUser: "Checklist items need at least one title."
        };
      }
      const resolved = await resolveItem(store, input.userId, input.itemRef);
      if (!resolved) {
        return {
          status: "needs_clarification",
          clarificationPrompt: `Which item should I add checklist steps to for "${input.itemRef}"?`
        };
      }
      const checklistItems = [];
      for (const [index, title] of titles.entries()) {
        const checklistInput: Parameters<RyanStore["createItemChecklistItem"]>[0] = {
          userId: input.userId,
          itemId: resolved.item.id,
          title,
          metadata: asJsonObject(input.metadata)
        };
        if (input.sortOrder !== undefined) checklistInput.sortOrder = input.sortOrder + index;
        checklistItems.push(await store.createItemChecklistItem(checklistInput));
      }
      const eventInput: Parameters<RyanStore["addItemEvent"]>[0] = {
        userId: input.userId,
        itemId: resolved.item.id,
        eventType: "checklist_item_added",
        occurredAt: nowIso(),
        payload: {
          checklistItemIds: checklistItems.map((item) => item.id),
          matchedBy: resolved.matchedBy
        }
      };
      if (input.sourceMessageId !== undefined) eventInput.sourceMessageId = input.sourceMessageId;
      if (input.idempotencyKey !== undefined) eventInput.idempotencyKey = input.idempotencyKey;
      const event = await store.addItemEvent(eventInput);
      const auditLog = await audit(store, {
        userId: input.userId,
        action: "item.checklist.add",
        toolName: "item.checklist.add",
        sourceMessageId: input.sourceMessageId,
        request: input,
        result: { itemId: resolved.item.id, checklistItemIds: checklistItems.map((item) => item.id), eventId: event.id }
      });
      return {
        status: "applied",
        data: { checklistItems },
        eventIds: [event.id],
        auditId: auditLog.id,
        messageForUser: `Added ${checklistItems.length} checklist ${checklistItems.length === 1 ? "item" : "items"} to "${resolved.item.title}".`
      };
    }
  });

  registry.register({
    name: "item.checklist.update",
    description: "Edit a checklist item's title or order.",
    metadata: {
      sideEffect: "state_write",
      confirmation: "not_required",
      retrySafety: "unsafe",
      descriptionForModel: "Use when the user wants to rename or move a checklist step."
    },
    inputSchema: toolEnvelopeSchema.extend({
      userId: userIdSchema,
      checklistItemId: z.string().min(1),
      title: z.string().trim().min(1).max(500).optional(),
      sortOrder: z.number().int().optional(),
      metadata: z.record(z.string(), z.unknown()).optional()
    }),
    handler: async (input) => {
      const checklistItem = await itemChecklistItemForUser(store, input.userId, input.checklistItemId);
      if (!checklistItem) {
        return {
          status: "failed",
          messageForUser: `Checklist item not found: ${input.checklistItemId}`
        };
      }
      const patch: Parameters<RyanStore["updateItemChecklistItem"]>[1] = {};
      if (input.title !== undefined) patch.title = input.title;
      if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;
      if (input.metadata !== undefined) patch.metadata = asJsonObject(input.metadata);
      const updated = await store.updateItemChecklistItem(checklistItem.id, patch);
      const eventInput: Parameters<RyanStore["addItemEvent"]>[0] = {
        userId: input.userId,
        itemId: checklistItem.itemId,
        eventType: "checklist_item_updated",
        occurredAt: nowIso(),
        payload: { checklistItemId: checklistItem.id }
      };
      if (input.sourceMessageId !== undefined) eventInput.sourceMessageId = input.sourceMessageId;
      if (input.idempotencyKey !== undefined) eventInput.idempotencyKey = input.idempotencyKey;
      const event = await store.addItemEvent(eventInput);
      const auditLog = await audit(store, {
        userId: input.userId,
        action: "item.checklist.update",
        toolName: "item.checklist.update",
        sourceMessageId: input.sourceMessageId,
        request: input,
        result: { itemId: checklistItem.itemId, checklistItemId: checklistItem.id, eventId: event.id }
      });
      return {
        status: "applied",
        data: { checklistItem: updated },
        eventIds: [event.id],
        auditId: auditLog.id,
        messageForUser: "Updated checklist item."
      };
    }
  });

  registry.register({
    name: "item.checklist.check",
    description: "Check or uncheck a checklist item without completing the parent task.",
    metadata: {
      sideEffect: "state_write",
      confirmation: "not_required",
      retrySafety: "idempotent",
      descriptionForModel: "Use when the user finishes or reopens one checklist step inside a task."
    },
    inputSchema: toolEnvelopeSchema.extend({
      userId: userIdSchema,
      checklistItemId: z.string().min(1),
      checked: z.boolean(),
      checkedAt: z.string().optional()
    }),
    handler: async (input) => {
      const checklistItem = await itemChecklistItemForUser(store, input.userId, input.checklistItemId);
      if (!checklistItem) {
        return {
          status: "failed",
          messageForUser: `Checklist item not found: ${input.checklistItemId}`
        };
      }
      const checkedAt = input.checked ? input.checkedAt ?? nowIso() : null;
      const updated = await store.updateItemChecklistItem(checklistItem.id, { checkedAt });
      const eventInput: Parameters<RyanStore["addItemEvent"]>[0] = {
        userId: input.userId,
        itemId: checklistItem.itemId,
        eventType: input.checked ? "checklist_item_checked" : "checklist_item_unchecked",
        occurredAt: input.checked && checkedAt !== null ? checkedAt : nowIso(),
        payload: { checklistItemId: checklistItem.id }
      };
      if (input.sourceMessageId !== undefined) eventInput.sourceMessageId = input.sourceMessageId;
      if (input.idempotencyKey !== undefined) eventInput.idempotencyKey = input.idempotencyKey;
      const event = await store.addItemEvent(eventInput);
      const auditLog = await audit(store, {
        userId: input.userId,
        action: "item.checklist.check",
        toolName: "item.checklist.check",
        sourceMessageId: input.sourceMessageId,
        request: input,
        result: { itemId: checklistItem.itemId, checklistItemId: checklistItem.id, checked: input.checked, eventId: event.id }
      });
      return {
        status: "applied",
        data: { checklistItem: updated },
        eventIds: [event.id],
        auditId: auditLog.id,
        messageForUser: input.checked ? "Checked checklist item." : "Unchecked checklist item."
      };
    }
  });

  registry.register({
    name: "item.checklist.delete",
    description: "Delete a checklist item.",
    metadata: {
      sideEffect: "state_write",
      confirmation: "low_confidence",
      retrySafety: "unsafe",
      descriptionForModel: "Use when the user wants to remove a checklist step from a task."
    },
    inputSchema: toolEnvelopeSchema.extend({
      userId: userIdSchema,
      checklistItemId: z.string().min(1)
    }),
    handler: async (input) => {
      const checklistItem = await itemChecklistItemForUser(store, input.userId, input.checklistItemId);
      if (!checklistItem) {
        return {
          status: "failed",
          messageForUser: `Checklist item not found: ${input.checklistItemId}`
        };
      }
      const deleted = await store.updateItemChecklistItem(checklistItem.id, { deletedAt: nowIso() });
      const eventInput: Parameters<RyanStore["addItemEvent"]>[0] = {
        userId: input.userId,
        itemId: checklistItem.itemId,
        eventType: "checklist_item_deleted",
        occurredAt: nowIso(),
        payload: { checklistItemId: checklistItem.id }
      };
      if (input.sourceMessageId !== undefined) eventInput.sourceMessageId = input.sourceMessageId;
      if (input.idempotencyKey !== undefined) eventInput.idempotencyKey = input.idempotencyKey;
      const event = await store.addItemEvent(eventInput);
      const auditLog = await audit(store, {
        userId: input.userId,
        action: "item.checklist.delete",
        toolName: "item.checklist.delete",
        sourceMessageId: input.sourceMessageId,
        request: input,
        result: { itemId: checklistItem.itemId, checklistItemId: checklistItem.id, eventId: event.id }
      });
      return {
        status: "applied",
        data: { checklistItem: deleted },
        eventIds: [event.id],
        auditId: auditLog.id,
        messageForUser: "Deleted checklist item."
      };
    }
  });

  registry.register({
    name: "item.checklist.reorder",
    description: "Reorder checklist items for a task.",
    metadata: {
      sideEffect: "state_write",
      confirmation: "not_required",
      retrySafety: "idempotent",
      descriptionForModel: "Use when the user wants checklist steps in a specific order."
    },
    inputSchema: toolEnvelopeSchema.extend({
      userId: userIdSchema,
      itemRef: z.string().min(1),
      checklistItemIds: z.array(z.string().min(1)).min(1)
    }),
    handler: async (input) => {
      const resolved = await resolveItem(store, input.userId, input.itemRef);
      if (!resolved) {
        return {
          status: "needs_clarification",
          clarificationPrompt: `Which item should I reorder checklist steps for "${input.itemRef}"?`
        };
      }
      const existing = await store.listItemChecklistItems({
        userId: input.userId,
        itemId: resolved.item.id,
        limit: 200
      });
      const existingIds = new Set(existing.map((item) => item.id));
      const requestedIds = input.checklistItemIds.filter((id) => existingIds.has(id));
      if (requestedIds.length !== input.checklistItemIds.length) {
        return {
          status: "failed",
          messageForUser: "One or more checklist items do not belong to that task."
        };
      }
      const reordered = [];
      for (const [index, checklistItemId] of requestedIds.entries()) {
        reordered.push(await store.updateItemChecklistItem(checklistItemId, { sortOrder: index }));
      }
      const eventInput: Parameters<RyanStore["addItemEvent"]>[0] = {
        userId: input.userId,
        itemId: resolved.item.id,
        eventType: "checklist_item_reordered",
        occurredAt: nowIso(),
        payload: { checklistItemIds: requestedIds }
      };
      if (input.sourceMessageId !== undefined) eventInput.sourceMessageId = input.sourceMessageId;
      if (input.idempotencyKey !== undefined) eventInput.idempotencyKey = input.idempotencyKey;
      const event = await store.addItemEvent(eventInput);
      const auditLog = await audit(store, {
        userId: input.userId,
        action: "item.checklist.reorder",
        toolName: "item.checklist.reorder",
        sourceMessageId: input.sourceMessageId,
        request: input,
        result: { itemId: resolved.item.id, checklistItemIds: requestedIds, eventId: event.id }
      });
      return {
        status: "applied",
        data: { checklistItems: reordered },
        eventIds: [event.id],
        auditId: auditLog.id,
        messageForUser: "Reordered checklist."
      };
    }
  });

  registry.register({
    name: "item.uncomplete",
    description: "Move a completed one-off item back to open and record an undo event.",
    metadata: {
      sideEffect: "state_write",
      confirmation: "low_confidence",
      retrySafety: "safe_with_idempotency_key",
      descriptionForModel: "Use when the user says a completed task should not be counted as done."
    },
    inputSchema: toolEnvelopeSchema.extend({
      userId: userIdSchema,
      itemRef: z.string().min(1),
      note: z.string().optional()
    }),
    handler: async (input) => {
      const matches = await store.searchItems(input.userId, input.itemRef, 3);
      const best = matches[0];
      if (!best || best.confidence < 0.75) {
        return {
          status: "needs_clarification",
          clarificationPrompt: `Which item should I reopen for "${input.itemRef}"?`
        };
      }

      const item = await store.updateItem(best.record.id, {
        status: "open",
        completedAt: null
      });
      const eventInput: Parameters<RyanStore["addItemEvent"]>[0] = {
        userId: input.userId,
        itemId: item.id,
        eventType: "uncompleted",
        occurredAt: nowIso(),
        payload: { note: input.note ?? "", matchedBy: best.reason }
      };
      if (input.sourceMessageId !== undefined) eventInput.sourceMessageId = input.sourceMessageId;
      if (input.idempotencyKey !== undefined) eventInput.idempotencyKey = input.idempotencyKey;
      const event = await store.addItemEvent(eventInput);
      const auditLog = await audit(store, {
        userId: input.userId,
        action: "item.uncomplete",
        toolName: "item.uncomplete",
        sourceMessageId: input.sourceMessageId,
        request: input,
        result: { itemId: item.id, eventId: event.id }
      });
      return {
        status: "applied",
        data: { item },
        eventIds: [event.id],
        auditId: auditLog.id,
        messageForUser: `Reopened "${item.title}".`
      };
    }
  });

  registry.register({
    name: "item.snooze",
    description: "Delay an item or reminder until a future time.",
    metadata: {
      sideEffect: "state_write",
      confirmation: "low_confidence",
      retrySafety: "safe_with_idempotency_key",
      descriptionForModel: "Suppresses reminders until the requested time; does not mark the item complete."
    },
    inputSchema: toolEnvelopeSchema.extend({
      userId: userIdSchema,
      itemRef: z.string().min(1),
      until: z.string().min(1),
      reason: z.string().optional()
    }),
    handler: async (input) => {
      const matches = await store.searchItems(input.userId, input.itemRef, 3);
      const best = matches[0];
      if (!best || best.confidence < 0.75) {
        return {
          status: "needs_clarification",
          clarificationPrompt: `Which item should I snooze for "${input.itemRef}"?`
        };
      }
      const item = await store.updateItem(best.record.id, {
        snoozedUntil: input.until
      });
      const eventInput: Parameters<RyanStore["addItemEvent"]>[0] = {
        userId: input.userId,
        itemId: item.id,
        eventType: "snoozed",
        occurredAt: nowIso(),
        payload: { until: input.until, reason: input.reason ?? "" }
      };
      if (input.sourceMessageId !== undefined) eventInput.sourceMessageId = input.sourceMessageId;
      if (input.idempotencyKey !== undefined) eventInput.idempotencyKey = input.idempotencyKey;
      const event = await store.addItemEvent(eventInput);
      const auditLog = await audit(store, {
        userId: input.userId,
        action: "item.snooze",
        toolName: "item.snooze",
        sourceMessageId: input.sourceMessageId,
        request: input,
        result: { itemId: item.id, eventId: event.id }
      });
      return {
        status: "applied",
        data: { item },
        eventIds: [event.id],
        auditId: auditLog.id,
        messageForUser: `Snoozed "${item.title}" until ${input.until}.`
      };
    }
  });

  registry.register({
    name: "recurrence.setPolicy",
    description: "Create or update recurrence rules for an item.",
    metadata: {
      sideEffect: "state_write",
      confirmation: "low_confidence",
      retrySafety: "safe_with_idempotency_key",
      descriptionForModel:
        "Changes future recurrence behavior. Input shape is `{ \"itemRef\": string, \"policy\": object }`. Use only schema enum values for policy.type. For \"once a week\", \"weekly\", or \"every 7 days after I last did it\", use `{ \"policy\": { \"type\": \"completion_based\", \"intervalDays\": 7, \"resetFromCompletion\": true } }`. For \"not sooner than 7 days\", use `{ \"policy\": { \"type\": \"minimum_interval\", \"minimumIntervalDays\": 7, \"resetFromCompletion\": true } }`. For \"5 times per week\", use `{ \"policy\": { \"type\": \"target_frequency\", \"targetCount\": 5, \"targetWindowDays\": 7, \"resetFromCompletion\": true } }`. Never use `interval` as a type."
    },
    inputSchema: toolEnvelopeSchema.extend({
      userId: userIdSchema,
      itemRef: z.string().min(1),
      policy: z.object({
        type: recurrenceTypeSchema,
        intervalDays: z.number().int().positive().optional(),
        minimumIntervalDays: z.number().int().positive().optional(),
        cron: z.string().optional(),
        targetCount: z.number().int().positive().optional(),
        targetWindowDays: z.number().int().positive().optional(),
        preferredDays: z.array(z.string()).optional(),
        preferredTime: z.string().optional(),
        resetFromCompletion: z.boolean().default(true)
      })
    }),
    handler: async (input) => {
      const policyValidationMessage = validateRecurrencePolicyInput(input.policy);
      if (policyValidationMessage) {
        return {
          status: "rejected",
          messageForUser: `Invalid recurrence policy: ${policyValidationMessage}`,
          warnings: [policyValidationMessage]
        };
      }

      const matches = await store.searchItems(input.userId, input.itemRef, 3);
      const best = matches[0];
      if (!best || best.confidence < 0.75) {
        return {
          status: "needs_clarification",
          clarificationPrompt: `Which item should get this recurrence policy?`
        };
      }
      const policyInput: Parameters<RyanStore["upsertRecurrencePolicy"]>[0] = {
        userId: input.userId,
        itemId: best.record.id,
        type: input.policy.type,
        resetFromCompletion: input.policy.resetFromCompletion,
        status: "active",
        metadata: {}
      };
      if (input.policy.intervalDays !== undefined) policyInput.intervalDays = input.policy.intervalDays;
      if (input.policy.minimumIntervalDays !== undefined) {
        policyInput.minimumIntervalDays = input.policy.minimumIntervalDays;
      }
      if (input.policy.cron !== undefined) policyInput.cron = input.policy.cron;
      if (input.policy.targetCount !== undefined) policyInput.targetCount = input.policy.targetCount;
      if (input.policy.targetWindowDays !== undefined) {
        policyInput.targetWindowDays = input.policy.targetWindowDays;
      }
      if (input.policy.preferredDays !== undefined) policyInput.preferredDays = input.policy.preferredDays;
      if (input.policy.preferredTime !== undefined) policyInput.preferredTime = input.policy.preferredTime;
      const policy = await store.upsertRecurrencePolicy(policyInput);
      let item = best.record;
      if (isDefaultDueMetadata(best.record.metadata)) {
        item = await store.updateItem(best.record.id, {
          dueAt: null,
          metadata: asJsonObject({
            ...best.record.metadata,
            defaultDueAt: false,
            defaultDueClearedForRecurrenceAt: nowIso()
          })
        });
      }
      const events = await store.listRecurrenceEvents(policy.id);
      const state = calculateRecurrenceState(policy, events);
      await store.updateRecurrenceState(state);
      const auditLog = await audit(store, {
        userId: input.userId,
        action: "recurrence.setPolicy",
        toolName: "recurrence.setPolicy",
        sourceMessageId: input.sourceMessageId,
        request: input,
        result: { policyId: policy.id }
      });
      return {
        status: "applied",
        data: { policy, recurrenceState: state },
        auditId: auditLog.id,
        messageForUser: `Updated recurrence for "${item.title}".`
      };
    }
  });

  registry.register({
    name: "recurrence.recordEvent",
    description: "Record that a recurring thing happened, was skipped, missed, or deferred.",
    metadata: {
      sideEffect: "state_write",
      confirmation: "low_confidence",
      retrySafety: "safe_with_idempotency_key",
      descriptionForModel: "Records a recurrence event. Input shape is `{ \"recurrenceRef\": string, \"eventType\": \"completed\" | \"uncompleted\" | \"skipped\" | \"missed\" | \"deferred\", \"occurredAt\"?: ISO string }`. For \"I did it yesterday\", use `eventType: \"completed\"`. For undoing a mistaken completion, use `eventType: \"uncompleted\"` with the same day."
    },
    inputSchema: toolEnvelopeSchema.extend({
      userId: userIdSchema,
      recurrenceRef: z.string().min(1),
      occurredAt: z.string().optional(),
      eventType: z.enum(["completed", "uncompleted", "skipped", "missed", "deferred"]),
      overrideMinimumInterval: z.boolean().default(false),
      note: z.string().optional()
    }),
    handler: async (input) => {
      const matches = await store.searchItems(input.userId, input.recurrenceRef, 3);
      const best = matches[0];
      if (!best || best.confidence < 0.75) {
        return {
          status: "needs_clarification",
          clarificationPrompt: `Which recurring item did you mean by "${input.recurrenceRef}"?`
        };
      }
      const policy = await store.findRecurrencePolicyForItem(best.record.id);
      if (!policy) {
        return {
          status: "needs_clarification",
          clarificationPrompt: `"${best.record.title}" does not have a recurrence policy yet.`
        };
      }
      const occurredAt = input.occurredAt ?? nowIso();
      const previousEvents = await store.listRecurrenceEvents(policy.id);
      if (
        input.eventType === "completed" &&
        !input.overrideMinimumInterval &&
        isBeforeMinimumInterval(policy, occurredAt, previousEvents)
      ) {
        return {
          status: "needs_confirmation",
          confirmationPrompt: `Recording this would be before the minimum interval for "${best.record.title}". Confirm override?`
        };
      }
      const recurrenceEventInput: Parameters<RyanStore["addRecurrenceEvent"]>[0] = {
        userId: input.userId,
        itemId: best.record.id,
        recurrencePolicyId: policy.id,
        eventType: input.eventType,
        occurredAt,
        payload: {}
      };
      if (input.sourceMessageId !== undefined) {
        recurrenceEventInput.sourceMessageId = input.sourceMessageId;
      }
      if (input.idempotencyKey !== undefined) {
        recurrenceEventInput.idempotencyKey = input.idempotencyKey;
      }
      if (input.note !== undefined) recurrenceEventInput.note = input.note;
      const recurrenceEvent = await store.addRecurrenceEvent(recurrenceEventInput);
      const events = await store.listRecurrenceEvents(policy.id);
      const state = calculateRecurrenceState(policy, events);
      await store.updateRecurrenceState(state);
      if (input.eventType === "completed") {
        await store.updateItem(best.record.id, {
          starredAt: null
        });
      }
      const auditLog = await audit(store, {
        userId: input.userId,
        action: "recurrence.recordEvent",
        toolName: "recurrence.recordEvent",
        sourceMessageId: input.sourceMessageId,
        request: input,
        result: { recurrenceEventId: recurrenceEvent.id, nextDueAt: state.nextDueAt }
      });
      return {
        status: "applied",
        data: { recurrenceEvent, recurrenceState: state },
        eventIds: [recurrenceEvent.id],
        auditId: auditLog.id,
        messageForUser: state.nextDueAt
          ? `Recorded "${best.record.title}". Next due: ${state.nextDueAt}.`
          : `Recorded "${best.record.title}".`
      };
    }
  });

  registry.register({
    name: "policy.upsertNotification",
    description: "Create or update notification, quiet-hour, nagging, or pause policy.",
    metadata: {
      sideEffect: "state_write",
      confirmation: "not_required",
      retrySafety: "safe_with_idempotency_key",
      descriptionForModel: "Updates RyanOS notification policy only; it does not send a notification."
    },
    inputSchema: toolEnvelopeSchema.extend({
      userId: userIdSchema,
      scope: z.enum(["global", "area", "project", "item", "channel", "category"]),
      scopeRef: z.string().optional(),
      policy: z.record(z.string(), z.unknown()),
      reason: z.string().optional()
    }),
    handler: async (input) => {
      const rules = asJsonObject({
        ...input.policy,
        reason: input.reason
      });
      const policyInput: Parameters<RyanStore["upsertPolicy"]>[0] = {
        userId: input.userId,
        type: "notification",
        scope: input.scope,
        priority: 0,
        status: "active",
        rules
      };
      if (input.scopeRef !== undefined) policyInput.scopeRef = input.scopeRef;
      if (input.sourceMessageId !== undefined) {
        policyInput.sourceMessageId = input.sourceMessageId;
      }
      const policy = await store.upsertPolicy(policyInput);
      const auditLog = await audit(store, {
        userId: input.userId,
        action: "policy.upsertNotification",
        toolName: "policy.upsertNotification",
        sourceMessageId: input.sourceMessageId,
        request: input,
        result: { policyId: policy.id }
      });
      return {
        status: "applied",
        data: { policy },
        auditId: auditLog.id,
        messageForUser: `Updated notification policy for ${input.scope}.`
      };
    }
  });

  registry.register({
    name: "state.explain",
    description: "Explain current item, recurrence, policy, or audit state.",
    metadata: {
      sideEffect: "read",
      confirmation: "not_required",
      retrySafety: "idempotent",
      descriptionForModel: "Use to explain current state or why RyanOS made a decision."
    },
    inputSchema: toolEnvelopeSchema.extend({
      userId: userIdSchema,
      subjectRef: z.string().optional(),
      question: z.string().min(1),
      includeAudit: z.boolean().default(false)
    }),
    handler: async (input) => {
      return {
        status: "applied",
        data: { question: input.question },
        messageForUser: "State explanation plumbing is available; richer audit-backed explanations come after DB persistence."
      };
    }
  });

  return registry;
}
