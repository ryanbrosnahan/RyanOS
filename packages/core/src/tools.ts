import { ToolRegistry, toolEnvelopeSchema } from "@ryanos/ai";
import { nowIso } from "@ryanos/shared";
import { z } from "zod";
import { calculateRecurrenceState, isBeforeMinimumInterval } from "./recurrence.js";
import type { ItemCreateData, ItemPatch, RyanStore } from "./store.js";
import type { JsonObject } from "@ryanos/shared";

const userIdSchema = z.string().min(1).default("local-owner");
const recurrenceTypeSchema = z.preprocess(
  (value) => (value === "interval" ? "completion_based" : value),
  z.enum(["completion_based", "fixed_schedule", "minimum_interval", "target_frequency", "opportunistic"])
);

function asJsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value ?? {})) as JsonObject;
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
    name: "item.create",
    description: "Create a task, reminder, decision, note, waiting item, habit, or other item.",
    metadata: {
      sideEffect: "state_write",
      confirmation: "not_required",
      retrySafety: "safe_with_idempotency_key",
      descriptionForModel: "Creates a RyanOS item only; does not contact external systems. Use `kind` for item type, for example `{ \"title\": \"Go to the gym\", \"kind\": \"habit\" }`."
    },
    inputSchema: toolEnvelopeSchema.extend({
      userId: userIdSchema,
      title: z.string().min(1),
      kind: z.enum(["task", "reminder", "decision", "note", "waiting", "habit", "other"]).default("task"),
      priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
      dueAt: z.string().optional(),
      startAt: z.string().optional(),
      estimateMinutes: z.number().int().positive().optional(),
      body: z.string().optional()
    }),
    handler: async (input) => {
      const createData: ItemCreateData = {
        userId: input.userId,
        kind: input.kind,
        title: input.title,
        priority: input.priority
      };
      if (input.dueAt !== undefined) createData.dueAt = input.dueAt;
      if (input.startAt !== undefined) createData.startAt = input.startAt;
      if (input.estimateMinutes !== undefined) createData.estimateMinutes = input.estimateMinutes;
      if (input.body !== undefined) createData.body = input.body;

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
        result: { itemId: item.id, eventId: event.id }
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
        kind: z.enum(["task", "reminder", "decision", "note", "waiting", "habit", "other"]).optional(),
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
        messageForUser: `Updated recurrence for "${best.record.title}".`
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
      descriptionForModel: "Records a recurrence event. Input shape is `{ \"recurrenceRef\": string, \"eventType\": \"completed\" | \"skipped\" | \"missed\" | \"deferred\", \"occurredAt\"?: ISO string }`. For \"I did it yesterday\", use `eventType: \"completed\"`."
    },
    inputSchema: toolEnvelopeSchema.extend({
      userId: userIdSchema,
      recurrenceRef: z.string().min(1),
      occurredAt: z.string().optional(),
      eventType: z.enum(["completed", "skipped", "missed", "deferred"]),
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
