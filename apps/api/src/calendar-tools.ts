import { toolEnvelopeSchema, type ToolRegistry, type ToolResult } from "@ryanos/ai";
import type { RyanStore } from "@ryanos/core";
import { nowIso, type JsonObject, type UUID } from "@ryanos/shared";
import { z } from "zod";
import {
  TIME_BLOCK_POLICY_SCOPE,
  createPersonalCalendarEvent,
  generateCalendarPlan,
  publishCalendarPlan,
  ruleView
} from "./calendar-integration.js";
import {
  dateRangeForDateKey,
  localDateKey,
  normalizeTimeBlockRule,
  validateTimeBlockRule
} from "./calendar-scheduling.js";
import type { CalendarClientLike } from "./gog-calendar.js";

const userIdSchema = z.string().min(1).default("local-owner");
const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeWindowSchema = z.object({
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
});
const ruleSchema = z.object({
  name: z.string().trim().min(1).max(100),
  timezone: z.string().min(1),
  availability: z.record(z.string(), z.array(timeWindowSchema)),
  targetCalendarId: z.string().min(1),
  includeStarred: z.boolean().default(true),
  includeDue: z.boolean().default(true),
  areaIds: z.array(z.string()).default([]),
  projectIds: z.array(z.string()).default([]),
  bufferBeforeMinutes: z.number().int().min(0).max(180).default(15),
  bufferAfterMinutes: z.number().int().min(0).max(180).default(15),
  defaultEstimateMinutes: z.number().int().min(5).max(480).default(30),
  minimumChunkMinutes: z.number().int().min(5).max(240).default(15),
  maximumBlockMinutes: z.number().int().min(15).max(480).default(120),
  splitTasks: z.boolean().default(true),
  scheduledDraftTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  enabled: z.boolean().default(true)
});

function json(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value ?? {})) as JsonObject;
}

async function audit(
  store: RyanStore,
  input: {
    userId: string;
    action: string;
    toolName: string;
    sourceMessageId?: string | undefined;
    request: unknown;
    result: unknown;
  }
) {
  return store.addAuditLog({
    userId: input.userId,
    actorType: "ai",
    action: input.action,
    toolName: input.toolName,
    ...(input.sourceMessageId ? { sourceMessageId: input.sourceMessageId } : {}),
    request: json(input.request),
    result: json(input.result),
    status: "success",
    metadata: {}
  });
}

function defaultDate(timezone: string | undefined): string {
  return localDateKey(new Date(), timezone ?? "UTC");
}

export function registerCalendarTools(input: {
  tools: ToolRegistry;
  store: RyanStore;
  client: CalendarClientLike;
}): void {
  input.tools.register({
    name: "calendar.events.list",
    description: "List the user's cached Google Calendar events for a date or explicit time range.",
    metadata: {
      sideEffect: "read",
      confirmation: "not_required",
      retrySafety: "idempotent",
      descriptionForModel:
        "Use before planning or answering calendar questions. Prefer date plus timezone unless the user supplies an exact range."
    },
    inputSchema: toolEnvelopeSchema.extend({
      userId: userIdSchema,
      date: dateKeySchema.optional(),
      timezone: z.string().optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional()
    }),
    handler: async (toolInput): Promise<ToolResult> => {
      const date = toolInput.date ?? defaultDate(toolInput.timezone);
      const range = toolInput.from && toolInput.to
        ? { from: toolInput.from, to: toolInput.to }
        : dateRangeForDateKey(date, toolInput.timezone ?? "UTC");
      const calendars = await input.store.listGoogleCalendars({
        userId: toolInput.userId,
        selectedForAvailability: true,
        limit: 500
      });
      const events = await input.store.listGoogleCalendarEvents({
        userId: toolInput.userId,
        googleCalendarIds: calendars.map((calendar) => calendar.id),
        startsBefore: range.to,
        endsAfter: range.from,
        limit: 5000
      });
      return {
        status: "applied",
        data: { date, events },
        messageForUser: events.length === 0
          ? `No calendar events are cached for ${date}.`
          : `Found ${events.length} calendar event${events.length === 1 ? "" : "s"} for ${date}.`
      };
    }
  });

  input.tools.register({
    name: "calendar.event.create",
    description: "Create a personal event on the user's writable Google Calendar.",
    metadata: {
      sideEffect: "external_send",
      confirmation: "required",
      retrySafety: "safe_with_idempotency_key",
      descriptionForModel:
        "Use only when the user explicitly asks to add an event. This writes to Google Calendar and requires confirmation."
    },
    inputSchema: toolEnvelopeSchema.extend({
      userId: userIdSchema,
      googleCalendarId: z.string().optional(),
      title: z.string().trim().min(1).max(500),
      startAt: z.string().datetime(),
      endAt: z.string().datetime(),
      timezone: z.string().min(1),
      description: z.string().max(10000).optional(),
      location: z.string().max(1000).optional()
    }),
    handler: async (toolInput): Promise<ToolResult> => {
      const target = toolInput.googleCalendarId
        ? await input.store.getGoogleCalendar(toolInput.googleCalendarId)
        : (await input.store.listGoogleCalendars({
            userId: toolInput.userId,
            limit: 500
          })).find((calendar) => calendar.writeEnabled && calendar.status !== "disabled");
      if (!target || target.userId !== toolInput.userId) {
        return {
          status: "needs_clarification",
          clarificationPrompt: "Which writable Google Calendar should receive this event?"
        };
      }
      const event = await createPersonalCalendarEvent({
        store: input.store,
        client: input.client,
        userId: toolInput.userId as UUID,
        googleCalendarId: target.id,
        title: toolInput.title,
        startAt: toolInput.startAt,
        endAt: toolInput.endAt,
        timezone: toolInput.timezone,
        ...(toolInput.description ? { description: toolInput.description } : {}),
        ...(toolInput.location ? { location: toolInput.location } : {})
      });
      const log = await audit(input.store, {
        userId: toolInput.userId,
        action: "calendar.event.create",
        toolName: "calendar.event.create",
        sourceMessageId: toolInput.sourceMessageId,
        request: toolInput,
        result: { eventId: event.id }
      });
      return {
        status: "applied",
        data: { event },
        auditId: log.id,
        messageForUser: `Added "${event.title}" to Google Calendar.`
      };
    }
  });

  input.tools.register({
    name: "calendar.plan.generate",
    description: "Generate a draft time-block plan around calendar availability and eligible RyanOS tasks.",
    metadata: {
      sideEffect: "state_write",
      confirmation: "not_required",
      retrySafety: "idempotent",
      descriptionForModel:
        "Use to build or rebuild a draft schedule. It does not write Google Calendar events until calendar.plan.publish is called."
    },
    inputSchema: toolEnvelopeSchema.extend({
      userId: userIdSchema,
      date: dateKeySchema.optional(),
      timezone: z.string().optional(),
      rulePolicyId: z.string().optional()
    }),
    handler: async (toolInput): Promise<ToolResult> => {
      const date = toolInput.date ?? defaultDate(toolInput.timezone);
      const result = await generateCalendarPlan({
        store: input.store,
        userId: toolInput.userId as UUID,
        dateKey: date,
        ...(toolInput.rulePolicyId ? { rulePolicyId: toolInput.rulePolicyId } : {})
      });
      const log = await audit(input.store, {
        userId: toolInput.userId,
        action: "calendar.plan.generate",
        toolName: "calendar.plan.generate",
        sourceMessageId: toolInput.sourceMessageId,
        request: toolInput,
        result: { planId: result.plan.id, blockCount: result.blocks.length }
      });
      return {
        status: "applied",
        data: result,
        auditId: log.id,
        messageForUser: `Built a draft with ${result.blocks.length} time block${result.blocks.length === 1 ? "" : "s"} for ${date}.`
      };
    }
  });

  input.tools.register({
    name: "calendar.plan.publish",
    description: "Publish a draft RyanOS time-block plan to Google Calendar.",
    metadata: {
      sideEffect: "external_send",
      confirmation: "required",
      retrySafety: "safe_with_idempotency_key",
      descriptionForModel:
        "Use only after the user explicitly asks to publish the draft. This creates external Google Calendar events."
    },
    inputSchema: toolEnvelopeSchema.extend({
      userId: userIdSchema,
      planId: z.string().optional(),
      date: dateKeySchema.optional(),
      timezone: z.string().optional()
    }),
    handler: async (toolInput): Promise<ToolResult> => {
      const date = toolInput.date ?? defaultDate(toolInput.timezone);
      const plan = toolInput.planId
        ? await input.store.getTimeBlockPlan(toolInput.planId)
        : await input.store.findTimeBlockPlan(toolInput.userId, date);
      if (!plan || plan.userId !== toolInput.userId) {
        return {
          status: "needs_clarification",
          clarificationPrompt: `There is no draft schedule for ${date}. Should I build one first?`
        };
      }
      const result = await publishCalendarPlan({
        store: input.store,
        client: input.client,
        userId: toolInput.userId as UUID,
        planId: plan.id
      });
      const log = await audit(input.store, {
        userId: toolInput.userId,
        action: "calendar.plan.publish",
        toolName: "calendar.plan.publish",
        sourceMessageId: toolInput.sourceMessageId,
        request: toolInput,
        result: { planId: result.plan.id, status: result.plan.status }
      });
      return {
        status: "applied",
        data: result,
        auditId: log.id,
        messageForUser: `Published the ${plan.dateKey} schedule to Google Calendar.`
      };
    }
  });

  input.tools.register({
    name: "calendar.rule.upsert",
    description: "Create or update a RyanOS time-block scheduling rule.",
    metadata: {
      sideEffect: "state_write",
      confirmation: "not_required",
      retrySafety: "safe_with_idempotency_key",
      descriptionForModel:
        "Use when the user asks to configure working windows, buffers, eligible tasks, estimates, splitting, or scheduled draft time."
    },
    inputSchema: toolEnvelopeSchema.extend({
      userId: userIdSchema,
      ruleId: z.string().optional(),
      rule: ruleSchema
    }),
    handler: async (toolInput): Promise<ToolResult> => {
      const rule = normalizeTimeBlockRule(toolInput.rule);
      const validationError = validateTimeBlockRule(rule);
      if (validationError) {
        return {
          status: "rejected",
          messageForUser: validationError,
          warnings: [validationError]
        };
      }
      const existing = toolInput.ruleId
        ? await input.store.getPolicy(toolInput.ruleId)
        : undefined;
      if (existing && existing.userId !== toolInput.userId) {
        return { status: "rejected", messageForUser: "Calendar rule not found." };
      }
      const policy = await input.store.upsertPolicy({
        userId: toolInput.userId,
        type: "planning",
        scope: TIME_BLOCK_POLICY_SCOPE,
        scopeRef: existing?.scopeRef ?? `calendar:${toolInput.rule.name.toLowerCase().replace(/\s+/g, "-")}`,
        priority: existing?.priority ?? 0,
        status: toolInput.rule.enabled ? "active" : "disabled",
        rules: json(rule)
      });
      const log = await audit(input.store, {
        userId: toolInput.userId,
        action: "calendar.rule.upsert",
        toolName: "calendar.rule.upsert",
        sourceMessageId: toolInput.sourceMessageId,
        request: toolInput,
        result: { policyId: policy.id }
      });
      return {
        status: "applied",
        data: ruleView(policy),
        auditId: log.id,
        messageForUser: `Saved calendar rule "${toolInput.rule.name}".`
      };
    }
  });
}
