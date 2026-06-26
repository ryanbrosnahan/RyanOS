import type { ISODateString, JsonObject, UUID } from "@ryanos/shared";

export type ItemKind =
  | "task"
  | "reminder"
  | "decision"
  | "note"
  | "waiting"
  | "habit"
  | "opportunity_action"
  | "other";

export type ItemStatus = "open" | "active" | "waiting" | "done" | "cancelled";
export type Priority = "low" | "normal" | "high" | "urgent";
export type PolicyType =
  | "notification"
  | "planning"
  | "confirmation"
  | "retention"
  | "permission"
  | "other";
export type PolicyStatus = "active" | "paused" | "archived" | "disabled";

export type Area = {
  id: UUID;
  userId: UUID;
  name: string;
  description?: string;
  status: string;
  sortOrder: number;
  metadata: JsonObject;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  deletedAt?: ISODateString;
};

export type Project = {
  id: UUID;
  userId: UUID;
  areaId?: UUID;
  name: string;
  description?: string;
  status: string;
  priority: Priority;
  dueAt?: ISODateString;
  reviewAfter?: ISODateString;
  metadata: JsonObject;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  deletedAt?: ISODateString;
};

export type Item = {
  id: UUID;
  userId: UUID;
  areaId?: UUID;
  projectId?: UUID;
  kind: ItemKind;
  title: string;
  body?: string;
  status: ItemStatus;
  priority: Priority;
  dueAt?: ISODateString;
  startAt?: ISODateString;
  snoozedUntil?: ISODateString;
  estimateMinutes?: number;
  starredAt?: ISODateString;
  completedAt?: ISODateString;
  cancelledAt?: ISODateString;
  revision: number;
  metadata: JsonObject;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  deletedAt?: ISODateString;
};

export type ItemProgressNote = {
  id: UUID;
  userId: UUID;
  itemId: UUID;
  body: string;
  occurredAt: ISODateString;
  metadata: JsonObject;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  deletedAt?: ISODateString;
};

export type ItemChecklistItem = {
  id: UUID;
  userId: UUID;
  itemId: UUID;
  title: string;
  checkedAt?: ISODateString;
  sortOrder: number;
  metadata: JsonObject;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  deletedAt?: ISODateString;
};

export type ItemEventType =
  | "created"
  | "updated"
  | "completed"
  | "uncompleted"
  | "snoozed"
  | "starred"
  | "unstarred"
  | "cancelled"
  | "deleted"
  | "linked_source"
  | "policy_changed"
  | "progress_note_added"
  | "progress_note_updated"
  | "progress_note_deleted"
  | "checklist_item_added"
  | "checklist_item_updated"
  | "checklist_item_checked"
  | "checklist_item_unchecked"
  | "checklist_item_deleted"
  | "checklist_item_reordered";

export type ItemEvent = {
  id: UUID;
  userId: UUID;
  itemId: UUID;
  eventType: ItemEventType;
  occurredAt: ISODateString;
  sourceMessageId?: string;
  idempotencyKey?: string;
  payload: JsonObject;
  createdAt: ISODateString;
};

export type RecurrenceType =
  | "completion_based"
  | "fixed_schedule"
  | "minimum_interval"
  | "target_frequency"
  | "opportunistic";

export type RecurrencePolicy = {
  id: UUID;
  userId: UUID;
  itemId: UUID;
  type: RecurrenceType;
  intervalDays?: number;
  minimumIntervalDays?: number;
  cron?: string;
  targetCount?: number;
  targetWindowDays?: number;
  preferredDays?: string[];
  preferredTime?: string;
  resetFromCompletion: boolean;
  status: "active" | "paused" | "archived";
  metadata: JsonObject;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  deletedAt?: ISODateString;
};

export type RecurrenceEventType =
  | "completed"
  | "uncompleted"
  | "skipped"
  | "missed"
  | "deferred";

export type RecurrenceEvent = {
  id: UUID;
  userId: UUID;
  recurrencePolicyId: UUID;
  itemId: UUID;
  eventType: RecurrenceEventType;
  occurredAt: ISODateString;
  sourceMessageId?: string;
  note?: string;
  idempotencyKey?: string;
  payload: JsonObject;
  createdAt: ISODateString;
};

export type RecurrenceState = {
  recurrencePolicyId: UUID;
  lastEventAt?: ISODateString;
  lastCompletedAt?: ISODateString;
  nextEligibleAt?: ISODateString;
  nextDueAt?: ISODateString;
  stalenessScore: number;
  updatedAt: ISODateString;
};

export type AuditLog = {
  id: UUID;
  userId: UUID;
  actorType: "user" | "ai" | "system" | "worker" | "skill" | "capability";
  action: string;
  targetType?: string;
  targetId?: string;
  sourceMessageId?: string;
  toolName?: string;
  request: JsonObject;
  result: JsonObject;
  status: "success" | "rejected" | "failed" | "needs_confirmation";
  occurredAt: ISODateString;
  metadata: JsonObject;
};

export type Policy = {
  id: UUID;
  userId: UUID;
  type: PolicyType;
  scope: string;
  scopeRef?: string;
  priority: number;
  status: PolicyStatus;
  startsAt?: ISODateString;
  expiresAt?: ISODateString;
  rules: JsonObject;
  sourceMessageId?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  deletedAt?: ISODateString;
};

export type DailyPlan = {
  id: UUID;
  userId: UUID;
  dateKey: string;
  timezone: string;
  prompt: string;
  response?: string;
  successCriteria: string[];
  selectedItemIds: UUID[];
  suggestedItemIds: UUID[];
  suggestionSource: "ai" | "heuristic" | "user";
  status: "active" | "archived";
  metadata: JsonObject;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  deletedAt?: ISODateString;
};

export type ProviderAccount = {
  id: UUID;
  userId: UUID;
  provider: string;
  externalAccountId?: string;
  displayName?: string;
  email?: string;
  status: string;
  scopes: string[];
  metadata: JsonObject;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  deletedAt?: ISODateString;
};

export type UserIntegrationSetting = {
  userId: UUID;
  integrationId: string;
  enabled: boolean;
  metadata: JsonObject;
  createdAt: ISODateString;
  updatedAt: ISODateString;
};

export type ExternalSource = {
  id: UUID;
  userId: UUID;
  provider: string;
  providerAccountId?: UUID;
  externalId?: string;
  url?: string;
  title?: string;
  summary?: string;
  occurredAt?: ISODateString;
  retentionClass: string;
  rawPayloadExpiresAt?: ISODateString;
  metadata: JsonObject;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  deletedAt?: ISODateString;
};

export type SourceLink = {
  id: UUID;
  userId: UUID;
  sourceId: UUID;
  targetType: string;
  targetId: UUID;
  relation: string;
  createdAt: ISODateString;
};

export type OpportunityStatus = "tracking" | "active" | "submitted" | "won" | "lost" | "declined";
export type OpportunityFit = "unknown" | "low" | "medium" | "high";

export type Opportunity = {
  id: UUID;
  userId: UUID;
  areaId?: UUID;
  projectId?: UUID;
  title: string;
  status: OpportunityStatus;
  fit: OpportunityFit;
  dueAt?: ISODateString;
  decisionBy?: ISODateString;
  valueEstimate?: string;
  nextActionItemId?: UUID;
  summary?: string;
  metadata: JsonObject;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  deletedAt?: ISODateString;
};

export type OpportunityProposalStatus = "proposed" | "accepted" | "rejected";

export type OpportunityProposal = {
  id: UUID;
  userId: UUID;
  sourceId: UUID;
  idempotencyKey: string;
  status: OpportunityProposalStatus;
  projectSlug: string;
  title: string;
  summary?: string;
  rating?: number;
  fit: OpportunityFit;
  priority: Priority;
  dueAt?: ISODateString;
  decisionBy?: ISODateString;
  valueEstimate?: string;
  recommendedAction?: string;
  rationale?: string;
  acceptedOpportunityId?: UUID;
  acceptedItemId?: UUID;
  acceptedAt?: ISODateString;
  rejectedAt?: ISODateString;
  metadata: JsonObject;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  deletedAt?: ISODateString;
};

export type EmailActionProposalStatus = "proposed" | "accepted" | "rejected";

export type EmailActionType =
  | "reply"
  | "task"
  | "follow_up"
  | "schedule"
  | "delegate"
  | "other";

export type EmailActionProposal = {
  id: UUID;
  userId: UUID;
  sourceId: UUID;
  providerAccountId?: UUID;
  idempotencyKey: string;
  actionType: EmailActionType;
  status: EmailActionProposalStatus;
  title: string;
  body?: string;
  priority: Priority;
  dueAt?: ISODateString;
  draftReplyText?: string;
  rationale?: string;
  confidence?: number;
  acceptedItemId?: UUID;
  acceptedAt?: ISODateString;
  rejectedAt?: ISODateString;
  metadata: JsonObject;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  deletedAt?: ISODateString;
};

export type ShoppingList = {
  id: UUID;
  userId: UUID;
  name: string;
  metadata: JsonObject;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  deletedAt?: ISODateString;
};

export type ShoppingListItem = {
  id: UUID;
  userId: UUID;
  listId: UUID;
  catalogItemId?: UUID;
  name: string;
  normalizedName: string;
  category: string;
  quantity?: string;
  note?: string;
  checkedAt?: ISODateString;
  source: string;
  sortOrder: number;
  metadata: JsonObject;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  deletedAt?: ISODateString;
};

export type ShoppingCatalogItem = {
  id: UUID;
  userId: UUID;
  name: string;
  normalizedName: string;
  defaultCategory: string;
  lastPurchasedAt?: ISODateString;
  purchaseCount: number;
  metadata: JsonObject;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  deletedAt?: ISODateString;
};

export type VocabularyEntryStatus = "active" | "archived";

export type VocabularyEntry = {
  id: UUID;
  userId: UUID;
  term: string;
  normalizedTerm: string;
  languageCode: string;
  category: string;
  definition?: string;
  partOfSpeech?: string;
  pronunciation?: string;
  translation?: string;
  notes?: string;
  tags: string[];
  definitionSource: string;
  status: VocabularyEntryStatus;
  metadata: JsonObject;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  deletedAt?: ISODateString;
};

export type VocabularyEncounter = {
  id: UUID;
  userId: UUID;
  entryId: UUID;
  sourceType?: string;
  sourceTitle?: string;
  sourceUrl?: string;
  context?: string;
  occurredAt: ISODateString;
  metadata: JsonObject;
  createdAt: ISODateString;
};
