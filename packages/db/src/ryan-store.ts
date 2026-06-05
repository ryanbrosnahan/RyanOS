import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import type { JsonObject, UUID } from "@ryanos/shared";
import type {
  AuditLog,
  Area,
  DailyPlan,
  EmailActionProposal,
  EmailActionProposalListFilters,
  EmailActionProposalPatch,
  EmailActionProposalUpsertData,
  ExternalSource,
  ExternalSourceUpsertData,
  Item,
  ItemEvent,
  Policy,
  ProviderAccount,
  ProviderAccountPatch,
  ProviderAccountUpsertData,
  Project,
  RecurrenceEvent,
  RecurrencePolicy,
  RecurrenceState,
  RyanStore,
  AreaUpsertData,
  DailyPlanUpsertData,
  ItemCreateData,
  ItemListFilters,
  ItemPatch,
  PolicyUpsertData,
  ProjectUpsertData,
  SearchMatch,
  SourceLink,
  SourceLinkCreateData
} from "@ryanos/core";
import { isUuid, resolveUserId, type RyanDb } from "./identity.js";
import * as schema from "./schema.js";

function toDate(value: string | undefined): Date | undefined {
  return value === undefined ? undefined : new Date(value);
}

function toIso(value: Date | null | undefined): string | undefined {
  return value === null || value === undefined ? undefined : value.toISOString();
}

function cleanQuery(value: string): string {
  return value.trim().toLowerCase();
}

function asJsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value ?? {})) as JsonObject;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function itemFromRow(row: typeof schema.items.$inferSelect): Item {
  const item: Item = {
    id: row.id,
    userId: row.userId,
    kind: row.kind,
    title: row.title,
    status: row.status,
    priority: row.priority,
    revision: row.revision,
    metadata: asJsonObject(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
  if (row.areaId !== null) item.areaId = row.areaId;
  if (row.projectId !== null) item.projectId = row.projectId;
  if (row.body !== null) item.body = row.body;
  const dueAt = toIso(row.dueAt);
  if (dueAt !== undefined) item.dueAt = dueAt;
  const startAt = toIso(row.startAt);
  if (startAt !== undefined) item.startAt = startAt;
  const snoozedUntil = toIso(row.snoozedUntil);
  if (snoozedUntil !== undefined) item.snoozedUntil = snoozedUntil;
  if (row.estimateMinutes !== null) item.estimateMinutes = row.estimateMinutes;
  const completedAt = toIso(row.completedAt);
  if (completedAt !== undefined) item.completedAt = completedAt;
  const cancelledAt = toIso(row.cancelledAt);
  if (cancelledAt !== undefined) item.cancelledAt = cancelledAt;
  const deletedAt = toIso(row.deletedAt);
  if (deletedAt !== undefined) item.deletedAt = deletedAt;
  return item;
}

function areaFromRow(row: typeof schema.areas.$inferSelect): Area {
  const area: Area = {
    id: row.id,
    userId: row.userId,
    name: row.name,
    status: row.status,
    sortOrder: row.sortOrder,
    metadata: asJsonObject(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
  if (row.description !== null) area.description = row.description;
  const deletedAt = toIso(row.deletedAt);
  if (deletedAt !== undefined) area.deletedAt = deletedAt;
  return area;
}

function projectFromRow(row: typeof schema.projects.$inferSelect): Project {
  const project: Project = {
    id: row.id,
    userId: row.userId,
    name: row.name,
    status: row.status,
    priority: row.priority,
    metadata: asJsonObject(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
  if (row.areaId !== null) project.areaId = row.areaId;
  if (row.description !== null) project.description = row.description;
  const dueAt = toIso(row.dueAt);
  if (dueAt !== undefined) project.dueAt = dueAt;
  const reviewAfter = toIso(row.reviewAfter);
  if (reviewAfter !== undefined) project.reviewAfter = reviewAfter;
  const deletedAt = toIso(row.deletedAt);
  if (deletedAt !== undefined) project.deletedAt = deletedAt;
  return project;
}

function itemEventFromRow(row: typeof schema.itemEvents.$inferSelect): ItemEvent {
  const event: ItemEvent = {
    id: row.id,
    userId: row.userId,
    itemId: row.itemId,
    eventType: row.eventType as ItemEvent["eventType"],
    occurredAt: row.occurredAt.toISOString(),
    payload: asJsonObject(row.payload),
    createdAt: row.createdAt.toISOString()
  };
  if (row.sourceMessageId !== null) event.sourceMessageId = row.sourceMessageId;
  if (row.idempotencyKey !== null) event.idempotencyKey = row.idempotencyKey;
  return event;
}

function recurrencePolicyFromRow(
  row: typeof schema.recurrencePolicies.$inferSelect
): RecurrencePolicy {
  const policy: RecurrencePolicy = {
    id: row.id,
    userId: row.userId,
    itemId: row.itemId,
    type: row.type,
    resetFromCompletion: row.resetFromCompletion,
    status: row.status as RecurrencePolicy["status"],
    metadata: asJsonObject(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
  if (row.intervalDays !== null) policy.intervalDays = row.intervalDays;
  if (row.minimumIntervalDays !== null) policy.minimumIntervalDays = row.minimumIntervalDays;
  if (row.cron !== null) policy.cron = row.cron;
  if (row.targetCount !== null) policy.targetCount = row.targetCount;
  if (row.targetWindowDays !== null) policy.targetWindowDays = row.targetWindowDays;
  if (Array.isArray(row.preferredDays)) {
    policy.preferredDays = row.preferredDays.filter(
      (day): day is string => typeof day === "string"
    );
  }
  if (row.preferredTime !== null) policy.preferredTime = row.preferredTime;
  const deletedAt = toIso(row.deletedAt);
  if (deletedAt !== undefined) policy.deletedAt = deletedAt;
  return policy;
}

function recurrenceEventFromRow(
  row: typeof schema.recurrenceEvents.$inferSelect
): RecurrenceEvent {
  const event: RecurrenceEvent = {
    id: row.id,
    userId: row.userId,
    recurrencePolicyId: row.recurrencePolicyId,
    itemId: row.itemId,
    eventType: row.eventType,
    occurredAt: row.occurredAt.toISOString(),
    payload: asJsonObject(row.payload),
    createdAt: row.createdAt.toISOString()
  };
  if (row.sourceMessageId !== null) event.sourceMessageId = row.sourceMessageId;
  if (row.note !== null) event.note = row.note;
  if (row.idempotencyKey !== null) event.idempotencyKey = row.idempotencyKey;
  return event;
}

function recurrenceStateFromRow(
  row: typeof schema.recurrenceState.$inferSelect
): RecurrenceState {
  const state: RecurrenceState = {
    recurrencePolicyId: row.recurrencePolicyId,
    stalenessScore: row.stalenessScore,
    updatedAt: row.updatedAt.toISOString()
  };
  const lastEventAt = toIso(row.lastEventAt);
  if (lastEventAt !== undefined) state.lastEventAt = lastEventAt;
  const lastCompletedAt = toIso(row.lastCompletedAt);
  if (lastCompletedAt !== undefined) state.lastCompletedAt = lastCompletedAt;
  const nextEligibleAt = toIso(row.nextEligibleAt);
  if (nextEligibleAt !== undefined) state.nextEligibleAt = nextEligibleAt;
  const nextDueAt = toIso(row.nextDueAt);
  if (nextDueAt !== undefined) state.nextDueAt = nextDueAt;
  return state;
}

function auditLogFromRow(row: typeof schema.auditLogs.$inferSelect): AuditLog {
  const log: AuditLog = {
    id: row.id,
    userId: row.userId,
    actorType: row.actorType as AuditLog["actorType"],
    action: row.action,
    request: asJsonObject(row.request),
    result: asJsonObject(row.result),
    status: row.status as AuditLog["status"],
    occurredAt: row.occurredAt.toISOString(),
    metadata: asJsonObject(row.metadata)
  };
  if (row.targetType !== null) log.targetType = row.targetType;
  if (row.targetId !== null) log.targetId = row.targetId;
  if (row.sourceMessageId !== null) log.sourceMessageId = row.sourceMessageId;
  if (row.toolName !== null) log.toolName = row.toolName;
  return log;
}

function policyFromRow(row: typeof schema.policies.$inferSelect): Policy {
  const policy: Policy = {
    id: row.id,
    userId: row.userId,
    type: row.type,
    scope: row.scope,
    priority: row.priority,
    status: row.status as Policy["status"],
    rules: asJsonObject(row.rules),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
  if (row.scopeRef !== null) policy.scopeRef = row.scopeRef;
  const startsAt = toIso(row.startsAt);
  if (startsAt !== undefined) policy.startsAt = startsAt;
  const expiresAt = toIso(row.expiresAt);
  if (expiresAt !== undefined) policy.expiresAt = expiresAt;
  if (row.sourceMessageId !== null) policy.sourceMessageId = row.sourceMessageId;
  const deletedAt = toIso(row.deletedAt);
  if (deletedAt !== undefined) policy.deletedAt = deletedAt;
  return policy;
}

function dailyPlanFromRow(row: typeof schema.dailyPlans.$inferSelect): DailyPlan {
  const plan: DailyPlan = {
    id: row.id,
    userId: row.userId,
    dateKey: row.dateKey,
    timezone: row.timezone,
    prompt: row.prompt,
    successCriteria: stringArray(row.successCriteria),
    selectedItemIds: stringArray(row.selectedItemIds),
    suggestedItemIds: stringArray(row.suggestedItemIds),
    suggestionSource: row.suggestionSource as DailyPlan["suggestionSource"],
    status: row.status as DailyPlan["status"],
    metadata: asJsonObject(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
  if (row.response !== null) plan.response = row.response;
  const deletedAt = toIso(row.deletedAt);
  if (deletedAt !== undefined) plan.deletedAt = deletedAt;
  return plan;
}

function providerAccountFromRow(row: typeof schema.providerAccounts.$inferSelect): ProviderAccount {
  const account: ProviderAccount = {
    id: row.id,
    userId: row.userId,
    provider: row.provider,
    status: row.status,
    scopes: stringArray(row.scopes),
    metadata: asJsonObject(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
  if (row.externalAccountId !== null) account.externalAccountId = row.externalAccountId;
  if (row.displayName !== null) account.displayName = row.displayName;
  if (row.email !== null) account.email = row.email;
  const deletedAt = toIso(row.deletedAt);
  if (deletedAt !== undefined) account.deletedAt = deletedAt;
  return account;
}

function externalSourceFromRow(row: typeof schema.externalSources.$inferSelect): ExternalSource {
  const source: ExternalSource = {
    id: row.id,
    userId: row.userId,
    provider: row.provider,
    retentionClass: row.retentionClass,
    metadata: asJsonObject(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
  if (row.providerAccountId !== null) source.providerAccountId = row.providerAccountId;
  if (row.externalId !== null) source.externalId = row.externalId;
  if (row.url !== null) source.url = row.url;
  if (row.title !== null) source.title = row.title;
  if (row.summary !== null) source.summary = row.summary;
  const occurredAt = toIso(row.occurredAt);
  if (occurredAt !== undefined) source.occurredAt = occurredAt;
  const rawPayloadExpiresAt = toIso(row.rawPayloadExpiresAt);
  if (rawPayloadExpiresAt !== undefined) source.rawPayloadExpiresAt = rawPayloadExpiresAt;
  const deletedAt = toIso(row.deletedAt);
  if (deletedAt !== undefined) source.deletedAt = deletedAt;
  return source;
}

function sourceLinkFromRow(row: typeof schema.sourceLinks.$inferSelect): SourceLink {
  return {
    id: row.id,
    userId: row.userId,
    sourceId: row.sourceId,
    targetType: row.targetType,
    targetId: row.targetId,
    relation: row.relation,
    createdAt: row.createdAt.toISOString()
  };
}

function emailActionProposalFromRow(
  row: typeof schema.emailActionProposals.$inferSelect
): EmailActionProposal {
  const proposal: EmailActionProposal = {
    id: row.id,
    userId: row.userId,
    sourceId: row.sourceId,
    idempotencyKey: row.idempotencyKey,
    actionType: row.actionType as EmailActionProposal["actionType"],
    status: row.status as EmailActionProposal["status"],
    title: row.title,
    priority: row.priority,
    metadata: asJsonObject(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
  if (row.providerAccountId !== null) proposal.providerAccountId = row.providerAccountId;
  if (row.body !== null) proposal.body = row.body;
  const dueAt = toIso(row.dueAt);
  if (dueAt !== undefined) proposal.dueAt = dueAt;
  if (row.draftReplyText !== null) proposal.draftReplyText = row.draftReplyText;
  if (row.rationale !== null) proposal.rationale = row.rationale;
  if (row.confidence !== null) proposal.confidence = row.confidence;
  if (row.acceptedItemId !== null) proposal.acceptedItemId = row.acceptedItemId;
  const acceptedAt = toIso(row.acceptedAt);
  if (acceptedAt !== undefined) proposal.acceptedAt = acceptedAt;
  const rejectedAt = toIso(row.rejectedAt);
  if (rejectedAt !== undefined) proposal.rejectedAt = rejectedAt;
  const deletedAt = toIso(row.deletedAt);
  if (deletedAt !== undefined) proposal.deletedAt = deletedAt;
  return proposal;
}

export class PostgresRyanStore implements RyanStore {
  constructor(private readonly db: RyanDb) {}

  private async resolveUserId(userId: UUID): Promise<UUID> {
    return resolveUserId(this.db, userId);
  }

  async upsertArea(data: AreaUpsertData): Promise<Area> {
    const userId = await this.resolveUserId(data.userId);
    const normalizedName = cleanQuery(data.name);
    const existing = await this.db.query.areas.findFirst({
      where: and(
        eq(schema.areas.userId, userId),
        sql`lower(${schema.areas.name}) = ${normalizedName}`,
        isNull(schema.areas.deletedAt)
      )
    });

    const values: typeof schema.areas.$inferInsert = {
      userId,
      name: data.name,
      status: data.status ?? existing?.status ?? "active",
      sortOrder: data.sortOrder ?? existing?.sortOrder ?? 0,
      metadata: data.metadata ?? existing?.metadata ?? {},
      updatedAt: new Date()
    };
    if (data.description !== undefined) values.description = data.description;
    else if (existing?.description !== null && existing?.description !== undefined) {
      values.description = existing.description;
    }

    if (existing) {
      const [row] = await this.db
        .update(schema.areas)
        .set(values)
        .where(eq(schema.areas.id, existing.id))
        .returning();
      if (!row) throw new Error(`Area not found: ${existing.id}`);
      return areaFromRow(row);
    }

    const [row] = await this.db.insert(schema.areas).values(values).returning();
    if (!row) throw new Error("Failed to upsert area");
    return areaFromRow(row);
  }

  async listAreas(userId: UUID): Promise<Area[]> {
    const resolvedUserId = await this.resolveUserId(userId);
    const rows = await this.db
      .select()
      .from(schema.areas)
      .where(and(eq(schema.areas.userId, resolvedUserId), isNull(schema.areas.deletedAt)))
      .orderBy(asc(schema.areas.sortOrder), asc(schema.areas.name));
    return rows.map(areaFromRow);
  }

  async searchAreas(
    userId: UUID,
    query: string,
    limit = 5
  ): Promise<Array<SearchMatch<Area>>> {
    const resolvedUserId = await this.resolveUserId(userId);
    const needle = cleanQuery(query);
    const rows = await this.db
      .select()
      .from(schema.areas)
      .where(
        isUuid(query)
          ? and(
              eq(schema.areas.userId, resolvedUserId),
              isNull(schema.areas.deletedAt),
              or(eq(schema.areas.id, query), ilike(schema.areas.name, `%${needle}%`))
            )
          : and(
              eq(schema.areas.userId, resolvedUserId),
              isNull(schema.areas.deletedAt),
              ilike(schema.areas.name, `%${needle}%`)
            )
      )
      .limit(Math.max(limit * 4, 20));

    return rows
      .map((row) => {
        const area = areaFromRow(row);
        const name = cleanQuery(area.name);
        let confidence = 0;
        let reason = "No match";
        if (area.id === query) {
          confidence = 1;
          reason = "Exact id match";
        } else if (name === needle) {
          confidence = 0.98;
          reason = "Exact name match";
        } else if (name.includes(needle) || needle.includes(name)) {
          confidence = 0.82;
          reason = "Name contains query";
        }
        return { record: area, confidence, reason };
      })
      .filter((match) => match.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);
  }

  async getArea(areaId: UUID): Promise<Area | undefined> {
    const row = await this.db.query.areas.findFirst({
      where: eq(schema.areas.id, areaId)
    });
    return row ? areaFromRow(row) : undefined;
  }

  async upsertProject(data: ProjectUpsertData): Promise<Project> {
    const userId = await this.resolveUserId(data.userId);
    const normalizedName = cleanQuery(data.name);
    const areaCondition =
      data.areaId === undefined
        ? isNull(schema.projects.areaId)
        : or(eq(schema.projects.areaId, data.areaId), isNull(schema.projects.areaId));
    const existing = await this.db.query.projects.findFirst({
      where: and(
        eq(schema.projects.userId, userId),
        areaCondition,
        sql`lower(${schema.projects.name}) = ${normalizedName}`,
        isNull(schema.projects.deletedAt)
      )
    });

    const values: typeof schema.projects.$inferInsert = {
      userId,
      name: data.name,
      status: data.status ?? existing?.status ?? "active",
      priority: data.priority ?? existing?.priority ?? "normal",
      metadata: data.metadata ?? existing?.metadata ?? {},
      updatedAt: new Date()
    };
    if (data.areaId !== undefined) values.areaId = data.areaId;
    else if (existing?.areaId !== null && existing?.areaId !== undefined) values.areaId = existing.areaId;
    if (data.description !== undefined) values.description = data.description;
    else if (existing?.description !== null && existing?.description !== undefined) {
      values.description = existing.description;
    }
    if (data.dueAt !== undefined) values.dueAt = toDate(data.dueAt);
    else if (existing?.dueAt !== null && existing?.dueAt !== undefined) values.dueAt = existing.dueAt;
    if (data.reviewAfter !== undefined) values.reviewAfter = toDate(data.reviewAfter);
    else if (existing?.reviewAfter !== null && existing?.reviewAfter !== undefined) {
      values.reviewAfter = existing.reviewAfter;
    }

    if (existing) {
      const [row] = await this.db
        .update(schema.projects)
        .set(values)
        .where(eq(schema.projects.id, existing.id))
        .returning();
      if (!row) throw new Error(`Project not found: ${existing.id}`);
      return projectFromRow(row);
    }

    const [row] = await this.db.insert(schema.projects).values(values).returning();
    if (!row) throw new Error("Failed to upsert project");
    return projectFromRow(row);
  }

  async listProjects(filters: { userId: UUID; areaId?: UUID; limit?: number }): Promise<Project[]> {
    const resolvedUserId = await this.resolveUserId(filters.userId);
    const conditions = [
      eq(schema.projects.userId, resolvedUserId),
      isNull(schema.projects.deletedAt)
    ];
    if (filters.areaId !== undefined) conditions.push(eq(schema.projects.areaId, filters.areaId));
    const rows = await this.db
      .select()
      .from(schema.projects)
      .where(and(...conditions))
      .orderBy(asc(schema.projects.name))
      .limit(Math.min(Math.max(filters.limit ?? 100, 1), 200));
    return rows.map(projectFromRow);
  }

  async searchProjects(
    userId: UUID,
    query: string,
    limit = 5
  ): Promise<Array<SearchMatch<Project>>> {
    const resolvedUserId = await this.resolveUserId(userId);
    const needle = cleanQuery(query);
    const rows = await this.db
      .select()
      .from(schema.projects)
      .where(
        isUuid(query)
          ? and(
              eq(schema.projects.userId, resolvedUserId),
              isNull(schema.projects.deletedAt),
              or(eq(schema.projects.id, query), ilike(schema.projects.name, `%${needle}%`))
            )
          : and(
              eq(schema.projects.userId, resolvedUserId),
              isNull(schema.projects.deletedAt),
              ilike(schema.projects.name, `%${needle}%`)
            )
      )
      .limit(Math.max(limit * 4, 20));

    return rows
      .map((row) => {
        const project = projectFromRow(row);
        const name = cleanQuery(project.name);
        let confidence = 0;
        let reason = "No match";
        if (project.id === query) {
          confidence = 1;
          reason = "Exact id match";
        } else if (name === needle) {
          confidence = 0.98;
          reason = "Exact name match";
        } else if (name.includes(needle) || needle.includes(name)) {
          confidence = 0.82;
          reason = "Name contains query";
        }
        return { record: project, confidence, reason };
      })
      .filter((match) => match.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);
  }

  async getProject(projectId: UUID): Promise<Project | undefined> {
    const row = await this.db.query.projects.findFirst({
      where: eq(schema.projects.id, projectId)
    });
    return row ? projectFromRow(row) : undefined;
  }

  async createItem(data: ItemCreateData): Promise<Item> {
    const userId = await this.resolveUserId(data.userId);
    const values: typeof schema.items.$inferInsert = {
      userId,
      kind: data.kind,
      title: data.title,
      priority: data.priority ?? "normal",
      metadata: data.metadata ?? {}
    };
    if (isUuid(data.areaId)) values.areaId = data.areaId;
    if (isUuid(data.projectId)) values.projectId = data.projectId;
    if (data.body !== undefined) values.body = data.body;
    if (data.dueAt !== undefined) values.dueAt = toDate(data.dueAt);
    if (data.startAt !== undefined) values.startAt = toDate(data.startAt);
    if (data.estimateMinutes !== undefined) values.estimateMinutes = data.estimateMinutes;

    const [row] = await this.db.insert(schema.items).values(values).returning();
    if (!row) throw new Error("Failed to create item");
    return itemFromRow(row);
  }

  async updateItem(itemId: UUID, patch: ItemPatch): Promise<Item> {
    const values: Partial<typeof schema.items.$inferInsert> = {
      revision: sql`${schema.items.revision} + 1` as unknown as number,
      updatedAt: new Date()
    };
    if (patch.kind !== undefined) values.kind = patch.kind;
    if (patch.title !== undefined) values.title = patch.title;
    if (patch.body !== undefined) values.body = patch.body;
    if (patch.status !== undefined) values.status = patch.status;
    if (patch.priority !== undefined) values.priority = patch.priority;
    if (patch.metadata !== undefined) values.metadata = patch.metadata;
    if (patch.areaId !== undefined) values.areaId = patch.areaId;
    if (patch.projectId !== undefined) values.projectId = patch.projectId;
    if (patch.dueAt !== undefined) values.dueAt = patch.dueAt === null ? null : toDate(patch.dueAt);
    if (patch.startAt !== undefined) values.startAt = patch.startAt === null ? null : toDate(patch.startAt);
    if (patch.snoozedUntil !== undefined) {
      values.snoozedUntil = patch.snoozedUntil === null ? null : toDate(patch.snoozedUntil);
    }
    if (patch.estimateMinutes !== undefined) values.estimateMinutes = patch.estimateMinutes;
    if (patch.completedAt !== undefined) {
      values.completedAt = patch.completedAt === null ? null : toDate(patch.completedAt);
    }
    if (patch.cancelledAt !== undefined) {
      values.cancelledAt = patch.cancelledAt === null ? null : toDate(patch.cancelledAt);
    }

    const [row] = await this.db
      .update(schema.items)
      .set(values)
      .where(eq(schema.items.id, itemId))
      .returning();
    if (!row) throw new Error(`Item not found: ${itemId}`);
    return itemFromRow(row);
  }

  async listItems(filters: ItemListFilters): Promise<Item[]> {
    const resolvedUserId = await this.resolveUserId(filters.userId);
    const statuses = filters.statuses ?? ["open", "active", "waiting"];
    const completedWindow =
      filters.completedAfter === undefined
        ? undefined
        : and(
            eq(schema.items.status, "done"),
            sql`${schema.items.completedAt} >= ${toDate(filters.completedAfter)}`,
            filters.completedBefore === undefined
              ? sql`true`
              : sql`${schema.items.completedAt} < ${toDate(filters.completedBefore)}`
          );
    const statusCondition =
      completedWindow === undefined
        ? inArray(schema.items.status, statuses)
        : or(inArray(schema.items.status, statuses), completedWindow);

    const rows = await this.db
      .select()
      .from(schema.items)
      .where(
        and(
          eq(schema.items.userId, resolvedUserId),
          isNull(schema.items.deletedAt),
          statusCondition
        )
      )
      .orderBy(
        sql`case when ${schema.items.status} = 'done' then 1 else 0 end`,
        asc(schema.items.dueAt),
        desc(schema.items.createdAt)
      )
      .limit(Math.min(Math.max(filters.limit ?? 30, 1), 100));

    return rows.map(itemFromRow);
  }

  async searchItems(
    userId: UUID,
    query: string,
    limit = 5
  ): Promise<Array<SearchMatch<Item>>> {
    const resolvedUserId = await this.resolveUserId(userId);
    const needle = cleanQuery(query);
    const conditions = [
      eq(schema.items.userId, resolvedUserId),
      isNull(schema.items.deletedAt),
      ilike(schema.items.title, `%${needle}%`)
    ];

    const rows = await this.db
      .select()
      .from(schema.items)
      .where(
        isUuid(query)
          ? and(
              eq(schema.items.userId, resolvedUserId),
              isNull(schema.items.deletedAt),
              or(eq(schema.items.id, query), ilike(schema.items.title, `%${needle}%`))
            )
          : and(...conditions)
      )
      .limit(Math.max(limit * 4, 20));

    return rows
      .map((row) => {
        const item = itemFromRow(row);
        const title = cleanQuery(item.title);
        let confidence = 0;
        let reason = "No match";
        if (item.id === query) {
          confidence = 1;
          reason = "Exact id match";
        } else if (title === needle) {
          confidence = 0.98;
          reason = "Exact title match";
        } else if (title.includes(needle) || needle.includes(title)) {
          confidence = 0.82;
          reason = "Title contains query";
        }
        return { record: item, confidence, reason };
      })
      .filter((match) => match.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);
  }

  async getItem(itemId: UUID): Promise<Item | undefined> {
    const row = await this.db.query.items.findFirst({
      where: eq(schema.items.id, itemId)
    });
    return row ? itemFromRow(row) : undefined;
  }

  async addItemEvent(event: Omit<ItemEvent, "id" | "createdAt">): Promise<ItemEvent> {
    const userId = await this.resolveUserId(event.userId);
    const values: typeof schema.itemEvents.$inferInsert = {
      userId,
      itemId: event.itemId,
      eventType: event.eventType,
      occurredAt: new Date(event.occurredAt),
      payload: event.payload
    };
    if (isUuid(event.sourceMessageId)) values.sourceMessageId = event.sourceMessageId;
    if (event.idempotencyKey !== undefined) values.idempotencyKey = event.idempotencyKey;
    const [row] = await this.db.insert(schema.itemEvents).values(values).returning();
    if (!row) throw new Error("Failed to add item event");
    return itemEventFromRow(row);
  }

  async findItemEventByIdempotencyKey(
    userId: UUID,
    key: string
  ): Promise<ItemEvent | undefined> {
    const resolvedUserId = await this.resolveUserId(userId);
    const row = await this.db.query.itemEvents.findFirst({
      where: and(
        eq(schema.itemEvents.userId, resolvedUserId),
        eq(schema.itemEvents.idempotencyKey, key)
      )
    });
    return row ? itemEventFromRow(row) : undefined;
  }

  async upsertRecurrencePolicy(
    policy: Omit<RecurrencePolicy, "id" | "createdAt" | "updatedAt">
  ): Promise<RecurrencePolicy> {
    const userId = await this.resolveUserId(policy.userId);
    const existing = await this.db.query.recurrencePolicies.findFirst({
      where: and(
        eq(schema.recurrencePolicies.userId, userId),
        eq(schema.recurrencePolicies.itemId, policy.itemId),
        isNull(schema.recurrencePolicies.deletedAt)
      )
    });

    const values: typeof schema.recurrencePolicies.$inferInsert = {
      userId,
      itemId: policy.itemId,
      type: policy.type,
      resetFromCompletion: policy.resetFromCompletion,
      status: policy.status,
      metadata: policy.metadata,
      updatedAt: new Date()
    };
    if (policy.intervalDays !== undefined) values.intervalDays = policy.intervalDays;
    if (policy.minimumIntervalDays !== undefined) {
      values.minimumIntervalDays = policy.minimumIntervalDays;
    }
    if (policy.cron !== undefined) values.cron = policy.cron;
    if (policy.targetCount !== undefined) values.targetCount = policy.targetCount;
    if (policy.targetWindowDays !== undefined) values.targetWindowDays = policy.targetWindowDays;
    if (policy.preferredDays !== undefined) values.preferredDays = policy.preferredDays;
    if (policy.preferredTime !== undefined) values.preferredTime = policy.preferredTime;

    if (existing) {
      const [row] = await this.db
        .update(schema.recurrencePolicies)
        .set(values)
        .where(eq(schema.recurrencePolicies.id, existing.id))
        .returning();
      if (!row) throw new Error(`Recurrence policy not found: ${existing.id}`);
      return recurrencePolicyFromRow(row);
    }

    const [row] = await this.db.insert(schema.recurrencePolicies).values(values).returning();
    if (!row) throw new Error("Failed to create recurrence policy");
    return recurrencePolicyFromRow(row);
  }

  async findRecurrencePolicyForItem(itemId: UUID): Promise<RecurrencePolicy | undefined> {
    const row = await this.db.query.recurrencePolicies.findFirst({
      where: and(
        eq(schema.recurrencePolicies.itemId, itemId),
        eq(schema.recurrencePolicies.status, "active"),
        isNull(schema.recurrencePolicies.deletedAt)
      )
    });
    return row ? recurrencePolicyFromRow(row) : undefined;
  }

  async addRecurrenceEvent(
    event: Omit<RecurrenceEvent, "id" | "createdAt">
  ): Promise<RecurrenceEvent> {
    const userId = await this.resolveUserId(event.userId);
    const values: typeof schema.recurrenceEvents.$inferInsert = {
      userId,
      itemId: event.itemId,
      recurrencePolicyId: event.recurrencePolicyId,
      eventType: event.eventType,
      occurredAt: new Date(event.occurredAt),
      payload: event.payload
    };
    if (isUuid(event.sourceMessageId)) values.sourceMessageId = event.sourceMessageId;
    if (event.note !== undefined) values.note = event.note;
    if (event.idempotencyKey !== undefined) values.idempotencyKey = event.idempotencyKey;
    const [row] = await this.db.insert(schema.recurrenceEvents).values(values).returning();
    if (!row) throw new Error("Failed to add recurrence event");
    return recurrenceEventFromRow(row);
  }

  async listRecurrenceEvents(policyId: UUID): Promise<RecurrenceEvent[]> {
    const rows = await this.db
      .select()
      .from(schema.recurrenceEvents)
      .where(eq(schema.recurrenceEvents.recurrencePolicyId, policyId));
    return rows.map(recurrenceEventFromRow);
  }

  async updateRecurrenceState(state: RecurrenceState): Promise<RecurrenceState> {
    const values: typeof schema.recurrenceState.$inferInsert = {
      recurrencePolicyId: state.recurrencePolicyId,
      lastEventAt: state.lastEventAt === undefined ? null : toDate(state.lastEventAt),
      lastCompletedAt:
        state.lastCompletedAt === undefined ? null : toDate(state.lastCompletedAt),
      nextEligibleAt:
        state.nextEligibleAt === undefined ? null : toDate(state.nextEligibleAt),
      nextDueAt: state.nextDueAt === undefined ? null : toDate(state.nextDueAt),
      stalenessScore: state.stalenessScore,
      updatedAt: new Date(state.updatedAt)
    };

    const [row] = await this.db
      .insert(schema.recurrenceState)
      .values(values)
      .onConflictDoUpdate({
        target: schema.recurrenceState.recurrencePolicyId,
        set: values
      })
      .returning();
    if (!row) throw new Error("Failed to update recurrence state");
    return recurrenceStateFromRow(row);
  }

  async getRecurrenceState(policyId: UUID): Promise<RecurrenceState | undefined> {
    const row = await this.db.query.recurrenceState.findFirst({
      where: eq(schema.recurrenceState.recurrencePolicyId, policyId)
    });
    return row ? recurrenceStateFromRow(row) : undefined;
  }

  async upsertPolicy(policy: PolicyUpsertData): Promise<Policy> {
    const userId = await this.resolveUserId(policy.userId);
    const existing = await this.db.query.policies.findFirst({
      where: and(
        eq(schema.policies.userId, userId),
        eq(schema.policies.type, policy.type),
        eq(schema.policies.scope, policy.scope),
        policy.scopeRef === undefined
          ? isNull(schema.policies.scopeRef)
          : eq(schema.policies.scopeRef, policy.scopeRef),
        isNull(schema.policies.deletedAt)
      )
    });

    const values: typeof schema.policies.$inferInsert = {
      userId,
      type: policy.type,
      scope: policy.scope,
      priority: policy.priority,
      status: policy.status,
      rules: policy.rules,
      updatedAt: new Date()
    };
    if (policy.scopeRef !== undefined) values.scopeRef = policy.scopeRef;
    if (policy.startsAt !== undefined) values.startsAt = toDate(policy.startsAt);
    if (policy.expiresAt !== undefined) values.expiresAt = toDate(policy.expiresAt);
    if (isUuid(policy.sourceMessageId)) values.sourceMessageId = policy.sourceMessageId;

    if (existing) {
      const [row] = await this.db
        .update(schema.policies)
        .set(values)
        .where(eq(schema.policies.id, existing.id))
        .returning();
      if (!row) throw new Error(`Policy not found: ${existing.id}`);
      return policyFromRow(row);
    }

    const [row] = await this.db.insert(schema.policies).values(values).returning();
    if (!row) throw new Error("Failed to upsert policy");
    return policyFromRow(row);
  }

  async getDailyPlan(userId: UUID, dateKey: string): Promise<DailyPlan | undefined> {
    const resolvedUserId = await this.resolveUserId(userId);
    const row = await this.db.query.dailyPlans.findFirst({
      where: and(
        eq(schema.dailyPlans.userId, resolvedUserId),
        eq(schema.dailyPlans.dateKey, dateKey),
        isNull(schema.dailyPlans.deletedAt)
      )
    });
    return row ? dailyPlanFromRow(row) : undefined;
  }

  async listDailyPlans(filters: { userId: UUID; beforeDateKey?: string; limit?: number }): Promise<DailyPlan[]> {
    const resolvedUserId = await this.resolveUserId(filters.userId);
    const conditions = [
      eq(schema.dailyPlans.userId, resolvedUserId),
      isNull(schema.dailyPlans.deletedAt)
    ];
    if (filters.beforeDateKey !== undefined) {
      conditions.push(sql`${schema.dailyPlans.dateKey} < ${filters.beforeDateKey}`);
    }
    const rows = await this.db
      .select()
      .from(schema.dailyPlans)
      .where(and(...conditions))
      .orderBy(desc(schema.dailyPlans.dateKey))
      .limit(Math.min(Math.max(filters.limit ?? 7, 1), 30));
    return rows.map(dailyPlanFromRow);
  }

  async upsertDailyPlan(plan: DailyPlanUpsertData): Promise<DailyPlan> {
    const userId = await this.resolveUserId(plan.userId);
    const existing = await this.db.query.dailyPlans.findFirst({
      where: and(
        eq(schema.dailyPlans.userId, userId),
        eq(schema.dailyPlans.dateKey, plan.dateKey),
        isNull(schema.dailyPlans.deletedAt)
      )
    });
    const values: typeof schema.dailyPlans.$inferInsert = {
      userId,
      dateKey: plan.dateKey,
      timezone: plan.timezone,
      prompt: plan.prompt,
      successCriteria: plan.successCriteria,
      selectedItemIds: plan.selectedItemIds,
      suggestedItemIds: plan.suggestedItemIds,
      suggestionSource: plan.suggestionSource,
      status: plan.status,
      metadata: plan.metadata,
      updatedAt: new Date()
    };
    if (plan.response !== undefined) values.response = plan.response;

    if (existing) {
      const [row] = await this.db
        .update(schema.dailyPlans)
        .set(values)
        .where(eq(schema.dailyPlans.id, existing.id))
        .returning();
      if (!row) throw new Error(`Daily plan not found: ${existing.id}`);
      return dailyPlanFromRow(row);
    }

    const [row] = await this.db.insert(schema.dailyPlans).values(values).returning();
    if (!row) throw new Error("Failed to upsert daily plan");
    return dailyPlanFromRow(row);
  }

  async upsertProviderAccount(data: ProviderAccountUpsertData): Promise<ProviderAccount> {
    const userId = await this.resolveUserId(data.userId);
    const externalCondition =
      data.externalAccountId === undefined
        ? isNull(schema.providerAccounts.externalAccountId)
        : eq(schema.providerAccounts.externalAccountId, data.externalAccountId);
    const existing = await this.db.query.providerAccounts.findFirst({
      where: and(
        eq(schema.providerAccounts.userId, userId),
        eq(schema.providerAccounts.provider, data.provider),
        externalCondition,
        isNull(schema.providerAccounts.deletedAt)
      )
    });
    const values: typeof schema.providerAccounts.$inferInsert = {
      userId,
      provider: data.provider,
      externalAccountId: data.externalAccountId ?? existing?.externalAccountId ?? null,
      displayName: data.displayName ?? existing?.displayName ?? null,
      email: data.email ?? existing?.email ?? null,
      status: data.status ?? existing?.status ?? "active",
      scopes: data.scopes ?? existing?.scopes ?? [],
      metadata: data.metadata ?? existing?.metadata ?? {},
      updatedAt: new Date()
    };

    if (existing) {
      const [row] = await this.db
        .update(schema.providerAccounts)
        .set(values)
        .where(eq(schema.providerAccounts.id, existing.id))
        .returning();
      if (!row) throw new Error(`Provider account not found: ${existing.id}`);
      return providerAccountFromRow(row);
    }

    const [row] = await this.db.insert(schema.providerAccounts).values(values).returning();
    if (!row) throw new Error("Failed to upsert provider account");
    return providerAccountFromRow(row);
  }

  async listProviderAccounts(filters: { userId: UUID; provider?: string; limit?: number }): Promise<ProviderAccount[]> {
    const resolvedUserId = await this.resolveUserId(filters.userId);
    const conditions = [
      eq(schema.providerAccounts.userId, resolvedUserId),
      isNull(schema.providerAccounts.deletedAt)
    ];
    if (filters.provider !== undefined) {
      conditions.push(eq(schema.providerAccounts.provider, filters.provider));
    }
    const rows = await this.db
      .select()
      .from(schema.providerAccounts)
      .where(and(...conditions))
      .orderBy(asc(schema.providerAccounts.displayName), asc(schema.providerAccounts.email))
      .limit(Math.min(Math.max(filters.limit ?? 100, 1), 200));
    return rows.map(providerAccountFromRow);
  }

  async getProviderAccount(accountId: UUID): Promise<ProviderAccount | undefined> {
    const row = await this.db.query.providerAccounts.findFirst({
      where: eq(schema.providerAccounts.id, accountId)
    });
    return row ? providerAccountFromRow(row) : undefined;
  }

  async updateProviderAccount(accountId: UUID, patch: ProviderAccountPatch): Promise<ProviderAccount> {
    const values: Partial<typeof schema.providerAccounts.$inferInsert> = {
      updatedAt: new Date()
    };
    if (patch.externalAccountId !== undefined) values.externalAccountId = patch.externalAccountId;
    if (patch.displayName !== undefined) values.displayName = patch.displayName;
    if (patch.email !== undefined) values.email = patch.email;
    if (patch.status !== undefined) values.status = patch.status;
    if (patch.scopes !== undefined) values.scopes = patch.scopes;
    if (patch.metadata !== undefined) values.metadata = patch.metadata;
    const [row] = await this.db
      .update(schema.providerAccounts)
      .set(values)
      .where(eq(schema.providerAccounts.id, accountId))
      .returning();
    if (!row) throw new Error(`Provider account not found: ${accountId}`);
    return providerAccountFromRow(row);
  }

  async upsertExternalSource(data: ExternalSourceUpsertData): Promise<ExternalSource> {
    const userId = await this.resolveUserId(data.userId);
    const accountCondition =
      data.providerAccountId === undefined
        ? isNull(schema.externalSources.providerAccountId)
        : eq(schema.externalSources.providerAccountId, data.providerAccountId);
    const externalCondition =
      data.externalId === undefined
        ? isNull(schema.externalSources.externalId)
        : eq(schema.externalSources.externalId, data.externalId);
    const existing = await this.db.query.externalSources.findFirst({
      where: and(
        eq(schema.externalSources.userId, userId),
        eq(schema.externalSources.provider, data.provider),
        accountCondition,
        externalCondition,
        isNull(schema.externalSources.deletedAt)
      )
    });

    const values: typeof schema.externalSources.$inferInsert = {
      userId,
      provider: data.provider,
      providerAccountId: data.providerAccountId ?? existing?.providerAccountId ?? null,
      externalId: data.externalId ?? existing?.externalId ?? null,
      url: data.url ?? existing?.url ?? null,
      title: data.title ?? existing?.title ?? null,
      summary: data.summary ?? existing?.summary ?? null,
      occurredAt: data.occurredAt !== undefined ? toDate(data.occurredAt) : existing?.occurredAt ?? null,
      retentionClass: data.retentionClass ?? existing?.retentionClass ?? "summary",
      rawPayloadExpiresAt:
        data.rawPayloadExpiresAt !== undefined
          ? toDate(data.rawPayloadExpiresAt)
          : existing?.rawPayloadExpiresAt ?? null,
      metadata: data.metadata ?? existing?.metadata ?? {},
      updatedAt: new Date()
    };

    if (existing) {
      const [row] = await this.db
        .update(schema.externalSources)
        .set(values)
        .where(eq(schema.externalSources.id, existing.id))
        .returning();
      if (!row) throw new Error(`External source not found: ${existing.id}`);
      return externalSourceFromRow(row);
    }

    const [row] = await this.db.insert(schema.externalSources).values(values).returning();
    if (!row) throw new Error("Failed to upsert external source");
    return externalSourceFromRow(row);
  }

  async getExternalSource(sourceId: UUID): Promise<ExternalSource | undefined> {
    const row = await this.db.query.externalSources.findFirst({
      where: eq(schema.externalSources.id, sourceId)
    });
    return row ? externalSourceFromRow(row) : undefined;
  }

  async addSourceLink(link: SourceLinkCreateData): Promise<SourceLink> {
    const userId = await this.resolveUserId(link.userId);
    const existing = await this.db.query.sourceLinks.findFirst({
      where: and(
        eq(schema.sourceLinks.userId, userId),
        eq(schema.sourceLinks.sourceId, link.sourceId),
        eq(schema.sourceLinks.targetType, link.targetType),
        eq(schema.sourceLinks.targetId, link.targetId),
        eq(schema.sourceLinks.relation, link.relation)
      )
    });
    if (existing) return sourceLinkFromRow(existing);

    const [row] = await this.db
      .insert(schema.sourceLinks)
      .values({
        userId,
        sourceId: link.sourceId,
        targetType: link.targetType,
        targetId: link.targetId,
        relation: link.relation
      })
      .returning();
    if (!row) throw new Error("Failed to add source link");
    return sourceLinkFromRow(row);
  }

  async upsertEmailActionProposal(data: EmailActionProposalUpsertData): Promise<EmailActionProposal> {
    const userId = await this.resolveUserId(data.userId);
    const existing = await this.db.query.emailActionProposals.findFirst({
      where: and(
        eq(schema.emailActionProposals.idempotencyKey, data.idempotencyKey),
        isNull(schema.emailActionProposals.deletedAt)
      )
    });
    const values: typeof schema.emailActionProposals.$inferInsert = {
      userId,
      sourceId: data.sourceId,
      providerAccountId: data.providerAccountId ?? existing?.providerAccountId ?? null,
      idempotencyKey: data.idempotencyKey,
      actionType: data.actionType,
      status: data.status ?? existing?.status ?? "proposed",
      title: data.title,
      body: data.body ?? existing?.body ?? null,
      priority: data.priority ?? existing?.priority ?? "normal",
      dueAt: data.dueAt !== undefined ? toDate(data.dueAt) : existing?.dueAt ?? null,
      draftReplyText: data.draftReplyText ?? existing?.draftReplyText ?? null,
      rationale: data.rationale ?? existing?.rationale ?? null,
      confidence: data.confidence ?? existing?.confidence ?? null,
      acceptedItemId: data.acceptedItemId ?? existing?.acceptedItemId ?? null,
      acceptedAt: data.acceptedAt !== undefined ? toDate(data.acceptedAt) : existing?.acceptedAt ?? null,
      rejectedAt: data.rejectedAt !== undefined ? toDate(data.rejectedAt) : existing?.rejectedAt ?? null,
      metadata: data.metadata ?? existing?.metadata ?? {},
      updatedAt: new Date()
    };

    if (existing) {
      const [row] = await this.db
        .update(schema.emailActionProposals)
        .set(values)
        .where(eq(schema.emailActionProposals.id, existing.id))
        .returning();
      if (!row) throw new Error(`Email action proposal not found: ${existing.id}`);
      return emailActionProposalFromRow(row);
    }

    const [row] = await this.db.insert(schema.emailActionProposals).values(values).returning();
    if (!row) throw new Error("Failed to upsert email action proposal");
    return emailActionProposalFromRow(row);
  }

  async listEmailActionProposals(filters: EmailActionProposalListFilters): Promise<EmailActionProposal[]> {
    const resolvedUserId = await this.resolveUserId(filters.userId);
    const conditions = [
      eq(schema.emailActionProposals.userId, resolvedUserId),
      isNull(schema.emailActionProposals.deletedAt)
    ];
    if (filters.status !== undefined) {
      conditions.push(eq(schema.emailActionProposals.status, filters.status));
    }
    if (filters.providerAccountId !== undefined) {
      conditions.push(eq(schema.emailActionProposals.providerAccountId, filters.providerAccountId));
    }
    const rows = await this.db
      .select()
      .from(schema.emailActionProposals)
      .where(and(...conditions))
      .orderBy(desc(schema.emailActionProposals.createdAt))
      .limit(Math.min(Math.max(filters.limit ?? 50, 1), 200));
    return rows.map(emailActionProposalFromRow);
  }

  async getEmailActionProposal(proposalId: UUID): Promise<EmailActionProposal | undefined> {
    const row = await this.db.query.emailActionProposals.findFirst({
      where: eq(schema.emailActionProposals.id, proposalId)
    });
    return row ? emailActionProposalFromRow(row) : undefined;
  }

  async updateEmailActionProposal(proposalId: UUID, patch: EmailActionProposalPatch): Promise<EmailActionProposal> {
    const values: Partial<typeof schema.emailActionProposals.$inferInsert> = {
      updatedAt: new Date()
    };
    if (patch.status !== undefined) values.status = patch.status;
    if (patch.title !== undefined) values.title = patch.title;
    if (patch.body !== undefined) values.body = patch.body;
    if (patch.priority !== undefined) values.priority = patch.priority;
    if (patch.dueAt !== undefined) values.dueAt = patch.dueAt === null ? null : toDate(patch.dueAt);
    if (patch.draftReplyText !== undefined) values.draftReplyText = patch.draftReplyText;
    if (patch.rationale !== undefined) values.rationale = patch.rationale;
    if (patch.confidence !== undefined) values.confidence = patch.confidence;
    if (patch.acceptedItemId !== undefined) values.acceptedItemId = patch.acceptedItemId;
    if (patch.acceptedAt !== undefined) {
      values.acceptedAt = patch.acceptedAt === null ? null : toDate(patch.acceptedAt);
    }
    if (patch.rejectedAt !== undefined) {
      values.rejectedAt = patch.rejectedAt === null ? null : toDate(patch.rejectedAt);
    }
    if (patch.metadata !== undefined) values.metadata = patch.metadata;
    const [row] = await this.db
      .update(schema.emailActionProposals)
      .set(values)
      .where(eq(schema.emailActionProposals.id, proposalId))
      .returning();
    if (!row) throw new Error(`Email action proposal not found: ${proposalId}`);
    return emailActionProposalFromRow(row);
  }

  async addAuditLog(log: Omit<AuditLog, "id" | "occurredAt">): Promise<AuditLog> {
    const userId = await this.resolveUserId(log.userId);
    const values: typeof schema.auditLogs.$inferInsert = {
      userId,
      actorType: log.actorType,
      action: log.action,
      request: log.request,
      result: log.result,
      status: log.status,
      metadata: log.metadata
    };
    if (log.targetType !== undefined) values.targetType = log.targetType;
    if (log.targetId !== undefined) values.targetId = log.targetId;
    if (isUuid(log.sourceMessageId)) values.sourceMessageId = log.sourceMessageId;
    if (log.toolName !== undefined) values.toolName = log.toolName;
    const [row] = await this.db.insert(schema.auditLogs).values(values).returning();
    if (!row) throw new Error("Failed to add audit log");
    return auditLogFromRow(row);
  }

  async snapshot(): Promise<JsonObject> {
    const [itemCount] = await this.db.select({ value: count() }).from(schema.items);
    const [itemEventCount] = await this.db.select({ value: count() }).from(schema.itemEvents);
    const [recurrencePolicyCount] = await this.db
      .select({ value: count() })
      .from(schema.recurrencePolicies);
    const [recurrenceEventCount] = await this.db
      .select({ value: count() })
      .from(schema.recurrenceEvents);
    const [auditLogCount] = await this.db.select({ value: count() }).from(schema.auditLogs);
    const [dailyPlanCount] = await this.db.select({ value: count() }).from(schema.dailyPlans);
    const [sessionCount] = await this.db.select({ value: count() }).from(schema.sessions);
    const [messageCount] = await this.db.select({ value: count() }).from(schema.messages);
    const [policyCount] = await this.db.select({ value: count() }).from(schema.policies);
    const [providerAccountCount] = await this.db
      .select({ value: count() })
      .from(schema.providerAccounts);
    const [externalSourceCount] = await this.db
      .select({ value: count() })
      .from(schema.externalSources);
    const [emailActionProposalCount] = await this.db
      .select({ value: count() })
      .from(schema.emailActionProposals);

    return {
      storeType: "postgres",
      itemCount: itemCount?.value ?? 0,
      itemEventCount: itemEventCount?.value ?? 0,
      recurrencePolicyCount: recurrencePolicyCount?.value ?? 0,
      recurrenceEventCount: recurrenceEventCount?.value ?? 0,
      auditLogCount: auditLogCount?.value ?? 0,
      dailyPlanCount: dailyPlanCount?.value ?? 0,
      sessionCount: sessionCount?.value ?? 0,
      messageCount: messageCount?.value ?? 0,
      policyCount: policyCount?.value ?? 0,
      providerAccountCount: providerAccountCount?.value ?? 0,
      externalSourceCount: externalSourceCount?.value ?? 0,
      emailActionProposalCount: emailActionProposalCount?.value ?? 0
    };
  }
}
