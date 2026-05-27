import type { JsonObject, UUID } from "@ryanos/shared";
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

export type AreaUpsertData = {
  userId: UUID;
  name: string;
  description?: string;
  status?: string;
  sortOrder?: number;
  metadata?: JsonObject;
};

export type ProjectUpsertData = {
  userId: UUID;
  areaId?: UUID;
  name: string;
  description?: string;
  status?: string;
  priority?: Project["priority"];
  dueAt?: string;
  reviewAfter?: string;
  metadata?: JsonObject;
};

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
  areaId?: UUID | null;
  projectId?: UUID | null;
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

export type DailyPlanUpsertData = Omit<
  DailyPlan,
  "id" | "createdAt" | "updatedAt" | "deletedAt"
>;

export interface RyanStore {
  upsertArea(area: AreaUpsertData): Promise<Area>;
  listAreas(userId: UUID): Promise<Area[]>;
  searchAreas(userId: UUID, query: string, limit?: number): Promise<Array<SearchMatch<Area>>>;
  getArea(areaId: UUID): Promise<Area | undefined>;

  upsertProject(project: ProjectUpsertData): Promise<Project>;
  listProjects(filters: { userId: UUID; areaId?: UUID; limit?: number }): Promise<Project[]>;
  searchProjects(
    userId: UUID,
    query: string,
    limit?: number
  ): Promise<Array<SearchMatch<Project>>>;
  getProject(projectId: UUID): Promise<Project | undefined>;

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

  getDailyPlan(userId: UUID, dateKey: string): Promise<DailyPlan | undefined>;
  listDailyPlans(filters: { userId: UUID; beforeDateKey?: string; limit?: number }): Promise<DailyPlan[]>;
  upsertDailyPlan(plan: DailyPlanUpsertData): Promise<DailyPlan>;

  addAuditLog(log: Omit<AuditLog, "id" | "occurredAt">): Promise<AuditLog>;
  snapshot?(): JsonObject | Promise<JsonObject>;
}
