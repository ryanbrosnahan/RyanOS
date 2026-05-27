import { ToolRegistry, toolEnvelopeSchema } from "@ryanos/ai";
import { nowIso } from "@ryanos/shared";
import { z } from "zod";
import { calculateRecurrenceState, isBeforeMinimumInterval } from "./recurrence.js";
import type { ItemCreateData, RyanStore } from "./store.js";
import type { JsonObject } from "@ryanos/shared";

const userIdSchema = z.string().min(1).default("local-owner");

function asJsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value ?? {})) as JsonObject;
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
    name: "item.create",
    description: "Create a task, reminder, decision, note, waiting item, habit, or other item.",
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
    name: "item.complete",
    description: "Mark an item complete and record a completion event.",
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
    inputSchema: toolEnvelopeSchema.extend({
      userId: userIdSchema,
      itemRef: z.string().min(1),
      policy: z.object({
        type: z.enum(["completion_based", "fixed_schedule", "minimum_interval", "target_frequency", "opportunistic"]),
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
      if (input.eventType === "completed") {
        await store.updateItem(best.record.id, {
          status: "done",
          completedAt: occurredAt
        });
      }
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
    inputSchema: toolEnvelopeSchema.extend({
      userId: userIdSchema,
      scope: z.enum(["global", "area", "project", "item", "channel", "category"]),
      scopeRef: z.string().optional(),
      policy: z.record(z.string(), z.unknown()),
      reason: z.string().optional()
    }),
    handler: async (input) => {
      const auditLog = await audit(store, {
        userId: input.userId,
        action: "policy.upsertNotification",
        toolName: "policy.upsertNotification",
        sourceMessageId: input.sourceMessageId,
        request: input,
        result: { stored: false, reason: "Policy table implementation pending" }
      });
      return {
        status: "proposed",
        auditId: auditLog.id,
        messageForUser: "Notification policy recognized. Persistent policy storage is the next implementation step."
      };
    }
  });

  registry.register({
    name: "state.explain",
    description: "Explain current item, recurrence, policy, or audit state.",
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
