import type { JsonObject, UUID } from "@ryanos/shared";
import type {
  AuditLog,
  Item,
  ItemEvent,
  Policy,
  RecurrenceEvent,
  RecurrencePolicy,
  RecurrenceState
} from "./types.js";

export type ItemCreateData = {
  userId: UUID;
  kind: Item["kind"];
  title: string;
  body?: string;
  areaId?: UUID;
  projectId?: UUID;
  priority?: Item["priority"];
  dueAt?: string;
  startAt?: string;
  estimateMinutes?: number;
  metadata?: JsonObject;
};

export type ItemPatch = Partial<
  Pick<Item, "kind" | "title" | "body" | "status" | "priority" | "estimateMinutes">
> & {
  dueAt?: string | null;
  startAt?: string | null;
  snoozedUntil?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
};

export type SearchMatch<T> = {
  record: T;
  confidence: number;
  reason: string;
};

export type ItemListFilters = {
  userId: UUID;
  statuses?: Item["status"][];
  completedAfter?: string;
  completedBefore?: string;
  limit?: number;
};

export type PolicyUpsertData = Omit<
  Policy,
  "id" | "createdAt" | "updatedAt" | "deletedAt"
>;

export interface RyanStore {
  createItem(data: ItemCreateData): Promise<Item>;
  updateItem(itemId: UUID, patch: ItemPatch): Promise<Item>;
  listItems(filters: ItemListFilters): Promise<Item[]>;
  searchItems(userId: UUID, query: string, limit?: number): Promise<Array<SearchMatch<Item>>>;
  getItem(itemId: UUID): Promise<Item | undefined>;
  addItemEvent(event: Omit<ItemEvent, "id" | "createdAt">): Promise<ItemEvent>;
  findItemEventByIdempotencyKey(userId: UUID, key: string): Promise<ItemEvent | undefined>;

  upsertRecurrencePolicy(
    policy: Omit<RecurrencePolicy, "id" | "createdAt" | "updatedAt">
  ): Promise<RecurrencePolicy>;
  findRecurrencePolicyForItem(itemId: UUID): Promise<RecurrencePolicy | undefined>;
  addRecurrenceEvent(
    event: Omit<RecurrenceEvent, "id" | "createdAt">
  ): Promise<RecurrenceEvent>;
  listRecurrenceEvents(policyId: UUID): Promise<RecurrenceEvent[]>;
  updateRecurrenceState(state: RecurrenceState): Promise<RecurrenceState>;
  getRecurrenceState(policyId: UUID): Promise<RecurrenceState | undefined>;

  upsertPolicy(policy: PolicyUpsertData): Promise<Policy>;

  addAuditLog(log: Omit<AuditLog, "id" | "occurredAt">): Promise<AuditLog>;
  snapshot?(): JsonObject | Promise<JsonObject>;
}
