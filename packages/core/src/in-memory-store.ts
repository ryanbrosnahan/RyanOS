import { createId, nowIso } from "@ryanos/shared";
import type { JsonObject, UUID } from "@ryanos/shared";
import type {
  ItemCreateData,
  ItemPatch,
  PolicyUpsertData,
  RyanStore,
  SearchMatch
} from "./store.js";
import type {
  AuditLog,
  Item,
  ItemEvent,
  Policy,
  RecurrenceEvent,
  RecurrencePolicy,
  RecurrenceState
} from "./types.js";

function cleanQuery(value: string): string {
  return value.trim().toLowerCase();
}

export class InMemoryRyanStore implements RyanStore {
  readonly items = new Map<UUID, Item>();
  readonly itemEvents: ItemEvent[] = [];
  readonly recurrencePolicies = new Map<UUID, RecurrencePolicy>();
  readonly recurrenceEvents: RecurrenceEvent[] = [];
  readonly recurrenceStates = new Map<UUID, RecurrenceState>();
  readonly policies = new Map<UUID, Policy>();
  readonly auditLogs: AuditLog[] = [];

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
      ...patch,
      revision: item.revision + 1,
      updatedAt: nowIso()
    };
    this.items.set(itemId, updated);
    return updated;
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
      itemCount: this.items.size,
      itemEventCount: this.itemEvents.length,
      recurrencePolicyCount: this.recurrencePolicies.size,
      recurrenceEventCount: this.recurrenceEvents.length,
      policyCount: this.policies.size,
      auditLogCount: this.auditLogs.length
    };
  }
}
