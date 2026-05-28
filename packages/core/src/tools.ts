import { ToolRegistry, toolEnvelopeSchema } from "@ryanos/ai";
import { addDaysIso, nowIso } from "@ryanos/shared";
import { z } from "zod";
import { calculateRecurrenceState, isBeforeMinimumInterval } from "./recurrence.js";
import type { ItemCreateData, ItemPatch, RyanStore } from "./store.js";
import type { JsonObject, UUID } from "@ryanos/shared";
import type { Area, Project } from "./types.js";

const userIdSchema = z.string().min(1).default("local-owner");
const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
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
    description: "Create or update the user's daily focus plan and selected priority items.",
    metadata: {
      sideEffect: "state_write",
      confirmation: "not_required",
      retrySafety: "safe_with_idempotency_key",
      descriptionForModel:
        "Use to save the answer to the daily focus question and choose one to three items that would make the day successful. Prefer a mix of one easy win, one medium task, and one important larger item when available."
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
