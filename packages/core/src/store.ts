import type { JsonObject, UUID } from "@ryanos/shared";
import type {
  AuditLog,
  Area,
  DailyPlan,
  EmailActionProposal,
  ExternalSource,
  Item,
  ItemEvent,
  Policy,
  ProviderAccount,
  Project,
  RecurrenceEvent,
  RecurrencePolicy,
  RecurrenceState,
  ShoppingCatalogItem,
  ShoppingList,
  ShoppingListItem,
  SourceLink
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
  Pick<Item, "kind" | "title" | "body" | "status" | "priority" | "estimateMinutes" | "metadata">
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

export type ProviderAccountUpsertData = {
  userId: UUID;
  provider: string;
  externalAccountId?: string;
  displayName?: string;
  email?: string;
  status?: string;
  scopes?: string[];
  metadata?: JsonObject;
};

export type ProviderAccountPatch = Partial<
  Pick<ProviderAccount, "displayName" | "email" | "status" | "scopes" | "metadata">
> & {
  externalAccountId?: string | null;
};

export type ExternalSourceUpsertData = {
  userId: UUID;
  provider: string;
  providerAccountId?: UUID;
  externalId?: string;
  url?: string;
  title?: string;
  summary?: string;
  occurredAt?: string;
  retentionClass?: string;
  rawPayloadExpiresAt?: string;
  metadata?: JsonObject;
};

export type SourceLinkCreateData = Omit<SourceLink, "id" | "createdAt">;

export type EmailActionProposalUpsertData = {
  userId: UUID;
  sourceId: UUID;
  providerAccountId?: UUID;
  idempotencyKey: string;
  actionType: EmailActionProposal["actionType"];
  status?: EmailActionProposal["status"];
  title: string;
  body?: string;
  priority?: EmailActionProposal["priority"];
  dueAt?: string;
  draftReplyText?: string;
  rationale?: string;
  confidence?: number;
  acceptedItemId?: UUID;
  acceptedAt?: string;
  rejectedAt?: string;
  metadata?: JsonObject;
};

export type EmailActionProposalPatch = Partial<
  Pick<
    EmailActionProposal,
    | "status"
    | "title"
    | "body"
    | "priority"
    | "draftReplyText"
    | "rationale"
    | "confidence"
    | "acceptedItemId"
    | "metadata"
  >
> & {
  dueAt?: string | null;
  acceptedAt?: string | null;
  rejectedAt?: string | null;
};

export type EmailActionProposalListFilters = {
  userId: UUID;
  status?: EmailActionProposal["status"];
  providerAccountId?: UUID;
  limit?: number;
};

export type ShoppingListUpsertData = {
  userId: UUID;
  name?: string;
  metadata?: JsonObject;
};

export type ShoppingItemCreateData = {
  userId: UUID;
  listId: UUID;
  catalogItemId?: UUID;
  name: string;
  normalizedName: string;
  category?: string;
  quantity?: string;
  note?: string;
  checkedAt?: string;
  source?: string;
  sortOrder?: number;
  metadata?: JsonObject;
};

export type ShoppingItemPatch = Partial<
  Pick<ShoppingListItem, "name" | "normalizedName" | "category" | "source" | "sortOrder" | "metadata">
> & {
  catalogItemId?: UUID | null;
  quantity?: string | null;
  note?: string | null;
  checkedAt?: string | null;
  deletedAt?: string | null;
};

export type ShoppingItemListFilters = {
  userId: UUID;
  listId?: UUID;
  includeActive?: boolean;
  checkedAfter?: string;
  limit?: number;
};

export type ShoppingCatalogUpsertData = {
  userId: UUID;
  name: string;
  normalizedName: string;
  defaultCategory?: string;
  lastPurchasedAt?: string;
  purchaseCount?: number;
  metadata?: JsonObject;
};

export type ShoppingCatalogListFilters = {
  userId: UUID;
  limit?: number;
};

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

  upsertProviderAccount(account: ProviderAccountUpsertData): Promise<ProviderAccount>;
  listProviderAccounts(filters: { userId: UUID; provider?: string; limit?: number }): Promise<ProviderAccount[]>;
  getProviderAccount(accountId: UUID): Promise<ProviderAccount | undefined>;
  updateProviderAccount(accountId: UUID, patch: ProviderAccountPatch): Promise<ProviderAccount>;

  upsertExternalSource(source: ExternalSourceUpsertData): Promise<ExternalSource>;
  getExternalSource(sourceId: UUID): Promise<ExternalSource | undefined>;
  addSourceLink(link: SourceLinkCreateData): Promise<SourceLink>;

  upsertEmailActionProposal(proposal: EmailActionProposalUpsertData): Promise<EmailActionProposal>;
  listEmailActionProposals(filters: EmailActionProposalListFilters): Promise<EmailActionProposal[]>;
  getEmailActionProposal(proposalId: UUID): Promise<EmailActionProposal | undefined>;
  updateEmailActionProposal(proposalId: UUID, patch: EmailActionProposalPatch): Promise<EmailActionProposal>;

  getDefaultShoppingList(userId: UUID): Promise<ShoppingList>;
  createShoppingItem(data: ShoppingItemCreateData): Promise<ShoppingListItem>;
  updateShoppingItem(itemId: UUID, patch: ShoppingItemPatch): Promise<ShoppingListItem>;
  listShoppingItems(filters: ShoppingItemListFilters): Promise<ShoppingListItem[]>;
  getShoppingItem(itemId: UUID): Promise<ShoppingListItem | undefined>;
  upsertShoppingCatalogItem(data: ShoppingCatalogUpsertData): Promise<ShoppingCatalogItem>;
  listShoppingCatalogItems(filters: ShoppingCatalogListFilters): Promise<ShoppingCatalogItem[]>;

  addAuditLog(log: Omit<AuditLog, "id" | "occurredAt">): Promise<AuditLog>;
  snapshot?(): JsonObject | Promise<JsonObject>;
}
