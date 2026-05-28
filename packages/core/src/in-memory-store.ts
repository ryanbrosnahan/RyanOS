import { createId, nowIso } from "@ryanos/shared";
import type { JsonObject, UUID } from "@ryanos/shared";
import type {
  AreaUpsertData,
  DailyPlanUpsertData,
  ItemCreateData,
  ItemListFilters,
  ItemPatch,
  PolicyUpsertData,
  ProjectUpsertData,
  RyanStore,
  SearchMatch
} from "./store.js";
import type {
  AuditLog,
  Area,
  DailyPlan,
  Item,
  ItemEvent,
  Policy,
  Project,
  RecurrenceEvent,
  RecurrencePolicy,
  RecurrenceState
} from "./types.js";

function cleanQuery(value: string): string {
  return value.trim().toLowerCase();
}

export class InMemoryRyanStore implements RyanStore {
  readonly areas = new Map<UUID, Area>();
  readonly projects = new Map<UUID, Project>();
  readonly items = new Map<UUID, Item>();
  readonly itemEvents: ItemEvent[] = [];
  readonly recurrencePolicies = new Map<UUID, RecurrencePolicy>();
  readonly recurrenceEvents: RecurrenceEvent[] = [];
  readonly recurrenceStates = new Map<UUID, RecurrenceState>();
  readonly policies = new Map<UUID, Policy>();
  readonly dailyPlans = new Map<UUID, DailyPlan>();
  readonly auditLogs: AuditLog[] = [];

  async upsertArea(data: AreaUpsertData): Promise<Area> {
    const timestamp = nowIso();
    const existing = [...this.areas.values()].find(
      (area) =>
        area.userId === data.userId &&
        cleanQuery(area.name) === cleanQuery(data.name) &&
        !area.deletedAt
    );
    const area: Area = {
      ...existing,
      id: existing?.id ?? createId("area"),
      userId: data.userId,
      name: data.name,
      status: data.status ?? existing?.status ?? "active",
      sortOrder: data.sortOrder ?? existing?.sortOrder ?? 0,
      metadata: data.metadata ?? existing?.metadata ?? {},
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    if (data.description !== undefined) area.description = data.description;
    else if (existing?.description !== undefined) area.description = existing.description;
    this.areas.set(area.id, area);
    return area;
  }

  async listAreas(userId: UUID): Promise<Area[]> {
    return [...this.areas.values()]
      .filter((area) => area.userId === userId && !area.deletedAt)
      .sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.name.localeCompare(b.name);
      });
  }

  async searchAreas(
    userId: UUID,
    query: string,
    limit = 5
  ): Promise<Array<SearchMatch<Area>>> {
    const needle = cleanQuery(query);
    return [...this.areas.values()]
      .filter((area) => area.userId === userId && !area.deletedAt)
      .map((area) => {
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
    return this.areas.get(areaId);
  }

  async upsertProject(data: ProjectUpsertData): Promise<Project> {
    const timestamp = nowIso();
    const existing = [...this.projects.values()].find(
      (project) =>
        project.userId === data.userId &&
        cleanQuery(project.name) === cleanQuery(data.name) &&
        (data.areaId === undefined || project.areaId === undefined || project.areaId === data.areaId) &&
        !project.deletedAt
    );
    const project: Project = {
      ...existing,
      id: existing?.id ?? createId("project"),
      userId: data.userId,
      name: data.name,
      status: data.status ?? existing?.status ?? "active",
      priority: data.priority ?? existing?.priority ?? "normal",
      metadata: data.metadata ?? existing?.metadata ?? {},
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    if (data.areaId !== undefined) project.areaId = data.areaId;
    else if (existing?.areaId !== undefined) project.areaId = existing.areaId;
    if (data.description !== undefined) project.description = data.description;
    else if (existing?.description !== undefined) project.description = existing.description;
    if (data.dueAt !== undefined) project.dueAt = data.dueAt;
    else if (existing?.dueAt !== undefined) project.dueAt = existing.dueAt;
    if (data.reviewAfter !== undefined) project.reviewAfter = data.reviewAfter;
    else if (existing?.reviewAfter !== undefined) project.reviewAfter = existing.reviewAfter;
    this.projects.set(project.id, project);
    return project;
  }

  async listProjects(filters: { userId: UUID; areaId?: UUID; limit?: number }): Promise<Project[]> {
    return [...this.projects.values()]
      .filter((project) => {
        if (project.userId !== filters.userId || project.deletedAt) return false;
        return filters.areaId === undefined || project.areaId === filters.areaId;
      })
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, Math.min(Math.max(filters.limit ?? 100, 1), 200));
  }

  async searchProjects(
    userId: UUID,
    query: string,
    limit = 5
  ): Promise<Array<SearchMatch<Project>>> {
    const needle = cleanQuery(query);
    return [...this.projects.values()]
      .filter((project) => project.userId === userId && !project.deletedAt)
      .map((project) => {
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
    return this.projects.get(projectId);
  }

  async createItem(data: ItemCreateData): Promise<Item> {
    const timestamp = nowIso();
    const item: Item = {
      id: createId("item"),
      userId: data.userId,
      kind: data.kind,
      title: data.title,
      status: "open",
      priority: data.priority ?? "normal",
      revision: 1,
      metadata: data.metadata ?? {},
      createdAt: timestamp,
      updatedAt: timestamp
    };
    if (data.body !== undefined) item.body = data.body;
    if (data.areaId !== undefined) item.areaId = data.areaId;
    if (data.projectId !== undefined) item.projectId = data.projectId;
    if (data.dueAt !== undefined) item.dueAt = data.dueAt;
    if (data.startAt !== undefined) item.startAt = data.startAt;
    if (data.estimateMinutes !== undefined) item.estimateMinutes = data.estimateMinutes;
    this.items.set(item.id, item);
    return item;
  }

  async updateItem(itemId: UUID, patch: ItemPatch): Promise<Item> {
    const item = this.items.get(itemId);
    if (!item) {
      throw new Error(`Item not found: ${itemId}`);
    }
    const updated: Item = {
      ...item,
      revision: item.revision + 1,
      updatedAt: nowIso()
    };
    if (patch.kind !== undefined) updated.kind = patch.kind;
    if (patch.title !== undefined) updated.title = patch.title;
    if (patch.body !== undefined) updated.body = patch.body;
    if (patch.status !== undefined) updated.status = patch.status;
    if (patch.priority !== undefined) updated.priority = patch.priority;
    if (patch.metadata !== undefined) updated.metadata = patch.metadata;
    if (patch.estimateMinutes !== undefined) updated.estimateMinutes = patch.estimateMinutes;
    if (patch.areaId !== undefined) {
      if (patch.areaId === null) delete updated.areaId;
      else updated.areaId = patch.areaId;
    }
    if (patch.projectId !== undefined) {
      if (patch.projectId === null) delete updated.projectId;
      else updated.projectId = patch.projectId;
    }
    if (patch.dueAt !== undefined) {
      if (patch.dueAt === null) delete updated.dueAt;
      else updated.dueAt = patch.dueAt;
    }
    if (patch.startAt !== undefined) {
      if (patch.startAt === null) delete updated.startAt;
      else updated.startAt = patch.startAt;
    }
    if (patch.snoozedUntil !== undefined) {
      if (patch.snoozedUntil === null) delete updated.snoozedUntil;
      else updated.snoozedUntil = patch.snoozedUntil;
    }
    if (patch.completedAt !== undefined) {
      if (patch.completedAt === null) delete updated.completedAt;
      else updated.completedAt = patch.completedAt;
    }
    if (patch.cancelledAt !== undefined) {
      if (patch.cancelledAt === null) delete updated.cancelledAt;
      else updated.cancelledAt = patch.cancelledAt;
    }
    this.items.set(itemId, updated);
    return updated;
  }

  async listItems(filters: ItemListFilters): Promise<Item[]> {
    const statuses = filters.statuses ?? ["open", "active", "waiting"];
    return [...this.items.values()]
      .filter(
        (item) => {
          if (item.userId !== filters.userId || item.deletedAt) return false;
          if (statuses.includes(item.status)) return true;
          if (item.status !== "done" || !item.completedAt || !filters.completedAfter) return false;
          if (item.completedAt < filters.completedAfter) return false;
          return filters.completedBefore === undefined || item.completedAt < filters.completedBefore;
        }
      )
      .sort((a, b) => {
        if (a.status === "done" && b.status !== "done") return 1;
        if (a.status !== "done" && b.status === "done") return -1;
        const aDue = a.dueAt ?? "9999-12-31T23:59:59.999Z";
        const bDue = b.dueAt ?? "9999-12-31T23:59:59.999Z";
        if (aDue !== bDue) return aDue.localeCompare(bDue);
        return b.createdAt.localeCompare(a.createdAt);
      })
      .slice(0, Math.min(Math.max(filters.limit ?? 30, 1), 100));
  }

  async searchItems(
    userId: UUID,
    query: string,
    limit = 5
  ): Promise<Array<SearchMatch<Item>>> {
    const needle = cleanQuery(query);
    const matches = [...this.items.values()]
      .filter((item) => item.userId === userId && !item.deletedAt)
      .map((item) => {
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

    return matches;
  }

  async getItem(itemId: UUID): Promise<Item | undefined> {
    return this.items.get(itemId);
  }

  async addItemEvent(event: Omit<ItemEvent, "id" | "createdAt">): Promise<ItemEvent> {
    const created: ItemEvent = {
      ...event,
      id: createId("item_event"),
      createdAt: nowIso()
    };
    this.itemEvents.push(created);
    return created;
  }

  async findItemEventByIdempotencyKey(
    userId: UUID,
    key: string
  ): Promise<ItemEvent | undefined> {
    return this.itemEvents.find(
      (event) => event.userId === userId && event.idempotencyKey === key
    );
  }

  async upsertRecurrencePolicy(
    policy: Omit<RecurrencePolicy, "id" | "createdAt" | "updatedAt">
  ): Promise<RecurrencePolicy> {
    const existing = [...this.recurrencePolicies.values()].find(
      (candidate) => candidate.itemId === policy.itemId && candidate.userId === policy.userId
    );
    const timestamp = nowIso();
    const stored: RecurrencePolicy = {
      ...existing,
      ...policy,
      id: existing?.id ?? createId("recurrence"),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    this.recurrencePolicies.set(stored.id, stored);
    return stored;
  }

  async findRecurrencePolicyForItem(itemId: UUID): Promise<RecurrencePolicy | undefined> {
    return [...this.recurrencePolicies.values()].find(
      (policy) => policy.itemId === itemId && policy.status === "active"
    );
  }

  async addRecurrenceEvent(
    event: Omit<RecurrenceEvent, "id" | "createdAt">
  ): Promise<RecurrenceEvent> {
    const created: RecurrenceEvent = {
      ...event,
      id: createId("recurrence_event"),
      createdAt: nowIso()
    };
    this.recurrenceEvents.push(created);
    return created;
  }

  async listRecurrenceEvents(policyId: UUID): Promise<RecurrenceEvent[]> {
    return this.recurrenceEvents.filter((event) => event.recurrencePolicyId === policyId);
  }

  async updateRecurrenceState(state: RecurrenceState): Promise<RecurrenceState> {
    this.recurrenceStates.set(state.recurrencePolicyId, state);
    return state;
  }

  async getRecurrenceState(policyId: UUID): Promise<RecurrenceState | undefined> {
    return this.recurrenceStates.get(policyId);
  }

  async upsertPolicy(policy: PolicyUpsertData): Promise<Policy> {
    const existing = [...this.policies.values()].find(
      (candidate) =>
        candidate.userId === policy.userId &&
        candidate.type === policy.type &&
        candidate.scope === policy.scope &&
        candidate.scopeRef === policy.scopeRef &&
        !candidate.deletedAt
    );
    const timestamp = nowIso();
    const stored: Policy = {
      ...existing,
      ...policy,
      id: existing?.id ?? createId("policy"),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    this.policies.set(stored.id, stored);
    return stored;
  }

  async getDailyPlan(userId: UUID, dateKey: string): Promise<DailyPlan | undefined> {
    return [...this.dailyPlans.values()].find(
      (plan) => plan.userId === userId && plan.dateKey === dateKey && !plan.deletedAt
    );
  }

  async listDailyPlans(filters: { userId: UUID; beforeDateKey?: string; limit?: number }): Promise<DailyPlan[]> {
    return [...this.dailyPlans.values()]
      .filter((plan) => {
        if (plan.userId !== filters.userId || plan.deletedAt) return false;
        return filters.beforeDateKey === undefined || plan.dateKey < filters.beforeDateKey;
      })
      .sort((a, b) => b.dateKey.localeCompare(a.dateKey))
      .slice(0, Math.min(Math.max(filters.limit ?? 7, 1), 30));
  }

  async upsertDailyPlan(plan: DailyPlanUpsertData): Promise<DailyPlan> {
    const existing = await this.getDailyPlan(plan.userId, plan.dateKey);
    const timestamp = nowIso();
    const stored: DailyPlan = {
      ...existing,
      ...plan,
      id: existing?.id ?? createId("daily_plan"),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    this.dailyPlans.set(stored.id, stored);
    return stored;
  }

  async addAuditLog(log: Omit<AuditLog, "id" | "occurredAt">): Promise<AuditLog> {
    const created: AuditLog = {
      ...log,
      id: createId("audit"),
      occurredAt: nowIso()
    };
    this.auditLogs.push(created);
    return created;
  }

  snapshot(): JsonObject {
    return {
      areaCount: this.areas.size,
      projectCount: this.projects.size,
      itemCount: this.items.size,
      itemEventCount: this.itemEvents.length,
      recurrencePolicyCount: this.recurrencePolicies.size,
      recurrenceEventCount: this.recurrenceEvents.length,
      policyCount: this.policies.size,
      dailyPlanCount: this.dailyPlans.size,
      auditLogCount: this.auditLogs.length
    };
  }
}
