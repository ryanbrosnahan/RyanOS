import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
};

const softDelete = {
  deletedAt: timestamp("deleted_at", { withTimezone: true })
};

export const itemKindEnum = pgEnum("item_kind", [
  "task",
  "reminder",
  "decision",
  "note",
  "waiting",
  "habit",
  "opportunity_action",
  "other"
]);

export const itemStatusEnum = pgEnum("item_status", [
  "open",
  "active",
  "waiting",
  "done",
  "cancelled"
]);

export const priorityEnum = pgEnum("priority", ["low", "normal", "high", "urgent"]);
export const recurrenceTypeEnum = pgEnum("recurrence_type", [
  "completion_based",
  "fixed_schedule",
  "minimum_interval",
  "target_frequency",
  "opportunistic"
]);

export const recurrenceEventTypeEnum = pgEnum("recurrence_event_type", [
  "completed",
  "uncompleted",
  "skipped",
  "missed",
  "deferred"
]);

export const policyTypeEnum = pgEnum("policy_type", [
  "notification",
  "planning",
  "confirmation",
  "retention",
  "permission",
  "other"
]);

export const objectStatusEnum = pgEnum("object_status", [
  "active",
  "paused",
  "archived",
  "disabled",
  "proposed",
  "validated",
  "enabled",
  "rejected"
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  authUserId: text("auth_user_id"),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  timezone: text("timezone").notNull().default("America/Chicago"),
  locale: text("locale").notNull().default("en-US"),
  ...timestamps
}, (table) => ({
  emailIdx: uniqueIndex("users_email_idx").on(table.email),
  authUserIdx: uniqueIndex("users_auth_user_id_idx").on(table.authUserId)
}));

export const authUsers = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  emailVerified: boolean("emailVerified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  emailIdx: uniqueIndex("auth_user_email_idx").on(table.email)
}));

export const authSessions = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
  token: text("token").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId").notNull().references(() => authUsers.id, { onDelete: "cascade" })
}, (table) => ({
  tokenIdx: uniqueIndex("auth_session_token_idx").on(table.token),
  userIdx: index("auth_session_user_idx").on(table.userId)
}));

export const authAccounts = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  providerAccountIdx: uniqueIndex("auth_account_provider_account_idx").on(table.providerId, table.accountId),
  userIdx: index("auth_account_user_idx").on(table.userId)
}));

export const authVerifications = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  identifierIdx: index("auth_verification_identifier_idx").on(table.identifier)
}));

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  provider: text("provider").notNull(),
  providerChatId: text("provider_chat_id").notNull(),
  providerThreadId: text("provider_thread_id"),
  title: text("title"),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  metadata: jsonb("metadata").notNull().default({}),
  ...timestamps
}, (table) => ({
  providerChatIdx: uniqueIndex("sessions_provider_chat_idx").on(
    table.userId,
    table.provider,
    table.providerChatId
  )
}));

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull().references(() => sessions.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  provider: text("provider").notNull(),
  providerMessageId: text("provider_message_id"),
  direction: text("direction").notNull(),
  text: text("text").notNull().default(""),
  senderDisplayName: text("sender_display_name"),
  replyToMessageId: uuid("reply_to_message_id"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  sessionOccurredIdx: index("messages_session_occurred_idx").on(table.sessionId, table.occurredAt),
  providerMessageIdx: uniqueIndex("messages_provider_message_idx").on(
    table.provider,
    table.sessionId,
    table.providerMessageId
  )
}));

export const areas = pgTable("areas", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("active"),
  sortOrder: integer("sort_order").notNull().default(0),
  metadata: jsonb("metadata").notNull().default({}),
  ...timestamps,
  ...softDelete
});

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  areaId: uuid("area_id").references(() => areas.id),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("active"),
  priority: priorityEnum("priority").notNull().default("normal"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  reviewAfter: timestamp("review_after", { withTimezone: true }),
  metadata: jsonb("metadata").notNull().default({}),
  ...timestamps,
  ...softDelete
});

export const items = pgTable("items", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  areaId: uuid("area_id").references(() => areas.id),
  projectId: uuid("project_id").references(() => projects.id),
  kind: itemKindEnum("kind").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  status: itemStatusEnum("status").notNull().default("open"),
  priority: priorityEnum("priority").notNull().default("normal"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  startAt: timestamp("start_at", { withTimezone: true }),
  snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
  estimateMinutes: integer("estimate_minutes"),
  starredAt: timestamp("starred_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  revision: integer("revision").notNull().default(1),
  metadata: jsonb("metadata").notNull().default({}),
  ...timestamps,
  ...softDelete
}, (table) => ({
  statusDueIdx: index("items_status_due_idx").on(table.userId, table.status, table.dueAt),
  projectStatusIdx: index("items_project_status_idx").on(table.userId, table.projectId, table.status),
  starredActiveIdx: index("items_starred_active_idx")
    .on(table.userId, table.starredAt)
    .where(sql`${table.starredAt} is not null and ${table.deletedAt} is null and ${table.status} in ('open', 'active', 'waiting')`)
}));

export const itemEvents = pgTable("item_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  itemId: uuid("item_id").notNull().references(() => items.id),
  eventType: text("event_type").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  sourceMessageId: uuid("source_message_id").references(() => messages.id),
  idempotencyKey: text("idempotency_key"),
  payload: jsonb("payload").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  itemOccurredIdx: index("item_events_item_occurred_idx").on(table.itemId, table.occurredAt),
  idempotencyIdx: uniqueIndex("item_events_idempotency_idx").on(table.userId, table.idempotencyKey)
}));

export const itemProgressNotes = pgTable("item_progress_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  itemId: uuid("item_id").notNull().references(() => items.id),
  body: text("body").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  ...timestamps,
  ...softDelete
}, (table) => ({
  itemOccurredIdx: index("item_progress_notes_item_occurred_idx").on(table.itemId, table.occurredAt),
  userItemIdx: index("item_progress_notes_user_item_idx").on(table.userId, table.itemId)
}));

export const itemChecklistItems = pgTable("item_checklist_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  itemId: uuid("item_id").notNull().references(() => items.id),
  title: text("title").notNull(),
  checkedAt: timestamp("checked_at", { withTimezone: true }),
  sortOrder: integer("sort_order").notNull().default(0),
  metadata: jsonb("metadata").notNull().default({}),
  ...timestamps,
  ...softDelete
}, (table) => ({
  itemSortIdx: index("item_checklist_items_item_sort_idx").on(table.itemId, table.sortOrder),
  userItemIdx: index("item_checklist_items_user_item_idx").on(table.userId, table.itemId)
}));

export const shoppingLists = pgTable("shopping_lists", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  name: text("name").notNull().default("Shopping"),
  metadata: jsonb("metadata").notNull().default({}),
  ...timestamps,
  ...softDelete
}, (table) => ({
  userNameIdx: uniqueIndex("shopping_lists_user_name_idx").on(table.userId, table.name)
}));

export const shoppingCatalogItems = pgTable("shopping_catalog_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull(),
  defaultCategory: text("default_category").notNull().default("miscellaneous"),
  lastPurchasedAt: timestamp("last_purchased_at", { withTimezone: true }),
  purchaseCount: integer("purchase_count").notNull().default(0),
  metadata: jsonb("metadata").notNull().default({}),
  ...timestamps,
  ...softDelete
}, (table) => ({
  userNormalizedIdx: uniqueIndex("shopping_catalog_items_user_normalized_idx").on(
    table.userId,
    table.normalizedName
  )
}));

export const shoppingListItems = pgTable("shopping_list_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  listId: uuid("list_id").notNull().references(() => shoppingLists.id),
  catalogItemId: uuid("catalog_item_id").references(() => shoppingCatalogItems.id),
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull(),
  category: text("category").notNull().default("miscellaneous"),
  quantity: text("quantity"),
  note: text("note"),
  checkedAt: timestamp("checked_at", { withTimezone: true }),
  source: text("source").notNull().default("manual"),
  sortOrder: integer("sort_order").notNull().default(0),
  metadata: jsonb("metadata").notNull().default({}),
  ...timestamps,
  ...softDelete
}, (table) => ({
  userListCheckedIdx: index("shopping_list_items_user_list_checked_idx").on(
    table.userId,
    table.listId,
    table.checkedAt
  ),
  userListNormalizedIdx: index("shopping_list_items_user_list_normalized_idx").on(
    table.userId,
    table.listId,
    table.normalizedName
  )
}));

export const vocabularyEntries = pgTable("vocabulary_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  term: text("term").notNull(),
  normalizedTerm: text("normalized_term").notNull(),
  languageCode: text("language_code").notNull().default("en"),
  category: text("category").notNull().default("general"),
  definition: text("definition"),
  partOfSpeech: text("part_of_speech"),
  pronunciation: text("pronunciation"),
  translation: text("translation"),
  notes: text("notes"),
  tags: jsonb("tags").notNull().default([]),
  definitionSource: text("definition_source").notNull().default("manual"),
  status: text("status").notNull().default("active"),
  metadata: jsonb("metadata").notNull().default({}),
  ...timestamps,
  ...softDelete
}, (table) => ({
  userLanguageTermIdx: uniqueIndex("vocabulary_entries_user_language_term_idx").on(
    table.userId,
    table.languageCode,
    table.normalizedTerm
  ),
  userCategoryIdx: index("vocabulary_entries_user_category_idx").on(
    table.userId,
    table.category,
    table.updatedAt
  ),
  userLanguageIdx: index("vocabulary_entries_user_language_idx").on(
    table.userId,
    table.languageCode,
    table.updatedAt
  ),
  userStatusUpdatedIdx: index("vocabulary_entries_user_status_updated_idx").on(
    table.userId,
    table.status,
    table.updatedAt
  )
}));

export const vocabularyEncounters = pgTable("vocabulary_encounters", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  entryId: uuid("entry_id").notNull().references(() => vocabularyEntries.id),
  sourceType: text("source_type"),
  sourceTitle: text("source_title"),
  sourceUrl: text("source_url"),
  context: text("context"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  userEntryOccurredIdx: index("vocabulary_encounters_user_entry_occurred_idx").on(
    table.userId,
    table.entryId,
    table.occurredAt
  ),
  userOccurredIdx: index("vocabulary_encounters_user_occurred_idx").on(
    table.userId,
    table.occurredAt
  )
}));

export const recurrencePolicies = pgTable("recurrence_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  itemId: uuid("item_id").notNull().references(() => items.id),
  type: recurrenceTypeEnum("type").notNull(),
  intervalDays: integer("interval_days"),
  minimumIntervalDays: integer("minimum_interval_days"),
  cron: text("cron"),
  targetCount: integer("target_count"),
  targetWindowDays: integer("target_window_days"),
  preferredDays: jsonb("preferred_days").notNull().default([]),
  preferredTime: text("preferred_time"),
  resetFromCompletion: boolean("reset_from_completion").notNull().default(true),
  status: text("status").notNull().default("active"),
  metadata: jsonb("metadata").notNull().default({}),
  ...timestamps,
  ...softDelete
});

export const recurrenceEvents = pgTable("recurrence_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  recurrencePolicyId: uuid("recurrence_policy_id").notNull().references(() => recurrencePolicies.id),
  itemId: uuid("item_id").notNull().references(() => items.id),
  eventType: recurrenceEventTypeEnum("event_type").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  sourceMessageId: uuid("source_message_id").references(() => messages.id),
  note: text("note"),
  idempotencyKey: text("idempotency_key"),
  payload: jsonb("payload").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const recurrenceState = pgTable("recurrence_state", {
  recurrencePolicyId: uuid("recurrence_policy_id").primaryKey().references(() => recurrencePolicies.id),
  lastEventAt: timestamp("last_event_at", { withTimezone: true }),
  lastCompletedAt: timestamp("last_completed_at", { withTimezone: true }),
  nextEligibleAt: timestamp("next_eligible_at", { withTimezone: true }),
  nextDueAt: timestamp("next_due_at", { withTimezone: true }),
  stalenessScore: integer("staleness_score").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const policies = pgTable("policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  type: policyTypeEnum("type").notNull(),
  scope: text("scope").notNull(),
  scopeRef: text("scope_ref"),
  priority: integer("priority").notNull().default(0),
  status: text("status").notNull().default("active"),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  rules: jsonb("rules").notNull().default({}),
  sourceMessageId: uuid("source_message_id").references(() => messages.id),
  ...timestamps,
  ...softDelete
});

export const dailyPlans = pgTable("daily_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  dateKey: text("date_key").notNull(),
  timezone: text("timezone").notNull().default("America/Chicago"),
  prompt: text("prompt").notNull(),
  response: text("response"),
  successCriteria: jsonb("success_criteria").notNull().default([]),
  selectedItemIds: jsonb("selected_item_ids").notNull().default([]),
  suggestedItemIds: jsonb("suggested_item_ids").notNull().default([]),
  suggestionSource: text("suggestion_source").notNull().default("heuristic"),
  status: text("status").notNull().default("active"),
  metadata: jsonb("metadata").notNull().default({}),
  ...timestamps,
  ...softDelete
}, (table) => ({
  userDateIdx: uniqueIndex("daily_plans_user_date_idx").on(table.userId, table.dateKey)
}));

export const providerAccounts = pgTable("provider_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  provider: text("provider").notNull(),
  externalAccountId: text("external_account_id"),
  displayName: text("display_name"),
  email: text("email"),
  status: text("status").notNull().default("active"),
  scopes: jsonb("scopes").notNull().default([]),
  metadata: jsonb("metadata").notNull().default({}),
  ...timestamps,
  ...softDelete
}, (table) => ({
  providerExternalIdx: uniqueIndex("provider_accounts_external_idx").on(
    table.provider,
    table.externalAccountId
  )
}));

export const secretRecords = pgTable("secret_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  providerAccountId: uuid("provider_account_id").references(() => providerAccounts.id),
  kind: text("kind").notNull(),
  ciphertext: text("ciphertext").notNull(),
  nonce: text("nonce").notNull(),
  keyVersion: text("key_version").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  metadata: jsonb("metadata").notNull().default({}),
  ...timestamps
});

export const externalSources = pgTable("external_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  provider: text("provider").notNull(),
  providerAccountId: uuid("provider_account_id").references(() => providerAccounts.id),
  externalId: text("external_id"),
  url: text("url"),
  title: text("title"),
  summary: text("summary"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }),
  retentionClass: text("retention_class").notNull().default("summary"),
  rawPayloadExpiresAt: timestamp("raw_payload_expires_at", { withTimezone: true }),
  metadata: jsonb("metadata").notNull().default({}),
  ...timestamps,
  ...softDelete
}, (table) => ({
  providerExternalIdx: uniqueIndex("external_sources_provider_external_idx").on(
    table.provider,
    table.providerAccountId,
    table.externalId
  ),
  userProviderOccurredIdx: index("external_sources_user_provider_occurred_idx").on(
    table.userId,
    table.provider,
    table.occurredAt
  )
}));

export const emailActionProposals = pgTable("email_action_proposals", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  sourceId: uuid("source_id").notNull().references(() => externalSources.id),
  providerAccountId: uuid("provider_account_id").references(() => providerAccounts.id),
  idempotencyKey: text("idempotency_key").notNull(),
  actionType: text("action_type").notNull(),
  status: text("status").notNull().default("proposed"),
  title: text("title").notNull(),
  body: text("body"),
  priority: priorityEnum("priority").notNull().default("normal"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  draftReplyText: text("draft_reply_text"),
  rationale: text("rationale"),
  confidence: integer("confidence"),
  acceptedItemId: uuid("accepted_item_id").references(() => items.id),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  metadata: jsonb("metadata").notNull().default({}),
  ...timestamps,
  ...softDelete
}, (table) => ({
  idempotencyIdx: uniqueIndex("email_action_proposals_idempotency_idx").on(
    table.idempotencyKey
  ),
  userStatusIdx: index("email_action_proposals_user_status_idx").on(
    table.userId,
    table.status,
    table.createdAt
  ),
  sourceIdx: index("email_action_proposals_source_idx").on(table.sourceId)
}));

export const opportunities = pgTable("opportunities", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  areaId: uuid("area_id").references(() => areas.id),
  projectId: uuid("project_id").references(() => projects.id),
  title: text("title").notNull(),
  status: text("status").notNull().default("tracking"),
  fit: text("fit").notNull().default("unknown"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  decisionBy: timestamp("decision_by", { withTimezone: true }),
  valueEstimate: text("value_estimate"),
  nextActionItemId: uuid("next_action_item_id").references(() => items.id),
  summary: text("summary"),
  metadata: jsonb("metadata").notNull().default({}),
  ...timestamps,
  ...softDelete
}, (table) => ({
  userStatusIdx: index("opportunities_user_status_idx").on(
    table.userId,
    table.status,
    table.updatedAt
  )
}));

export const opportunityProposals = pgTable("opportunity_proposals", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  sourceId: uuid("source_id").notNull().references(() => externalSources.id),
  idempotencyKey: text("idempotency_key").notNull(),
  status: text("status").notNull().default("proposed"),
  projectSlug: text("project_slug").notNull(),
  title: text("title").notNull(),
  summary: text("summary"),
  rating: real("rating"),
  fit: text("fit").notNull().default("unknown"),
  priority: priorityEnum("priority").notNull().default("normal"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  decisionBy: timestamp("decision_by", { withTimezone: true }),
  valueEstimate: text("value_estimate"),
  recommendedAction: text("recommended_action"),
  rationale: text("rationale"),
  acceptedOpportunityId: uuid("accepted_opportunity_id").references(() => opportunities.id),
  acceptedItemId: uuid("accepted_item_id").references(() => items.id),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  metadata: jsonb("metadata").notNull().default({}),
  ...timestamps,
  ...softDelete
}, (table) => ({
  idempotencyIdx: uniqueIndex("opportunity_proposals_idempotency_idx").on(
    table.idempotencyKey
  ),
  userStatusIdx: index("opportunity_proposals_user_status_idx").on(
    table.userId,
    table.status,
    table.createdAt
  ),
  sourceIdx: index("opportunity_proposals_source_idx").on(table.sourceId),
  projectIdx: index("opportunity_proposals_project_idx").on(table.userId, table.projectSlug)
}));

export const sourceLinks = pgTable("source_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  sourceId: uuid("source_id").notNull().references(() => externalSources.id),
  targetType: text("target_type").notNull(),
  targetId: uuid("target_id").notNull(),
  relation: text("relation").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const capabilities = pgTable("capabilities", {
  id: uuid("id").primaryKey().defaultRandom(),
  capabilityId: text("capability_id").notNull(),
  provider: text("provider").notNull(),
  description: text("description").notNull(),
  sensitive: boolean("sensitive").notNull().default(false),
  status: text("status").notNull().default("available"),
  definition: jsonb("definition").notNull().default({}),
  ...timestamps
}, (table) => ({
  capabilityIdIdx: uniqueIndex("capabilities_capability_id_idx").on(table.capabilityId)
}));

export const capabilityOperations = pgTable("capability_operations", {
  id: uuid("id").primaryKey().defaultRandom(),
  capabilityId: uuid("capability_id").notNull().references(() => capabilities.id),
  name: text("name").notNull(),
  description: text("description").notNull(),
  mutating: boolean("mutating").notNull().default(false),
  sensitive: boolean("sensitive").notNull().default(false),
  requiresAuth: boolean("requires_auth").notNull().default(true),
  inputSchema: jsonb("input_schema").notNull().default({}),
  outputSchema: jsonb("output_schema").notNull().default({}),
  ...timestamps
}, (table) => ({
  capabilityOperationIdx: uniqueIndex("capability_operations_name_idx").on(
    table.capabilityId,
    table.name
  )
}));

export const capabilityGrants = pgTable("capability_grants", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  providerAccountId: uuid("provider_account_id").references(() => providerAccounts.id),
  capabilityId: uuid("capability_id").notNull().references(() => capabilities.id),
  operationName: text("operation_name").notNull(),
  scope: jsonb("scope").notNull().default({}),
  status: text("status").notNull().default("active"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  sourceMessageId: uuid("source_message_id").references(() => messages.id),
  metadata: jsonb("metadata").notNull().default({}),
  ...timestamps
});

export const skills = pgTable("skills", {
  id: uuid("id").primaryKey().defaultRandom(),
  skillId: text("skill_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  source: text("source").notNull(),
  version: text("version"),
  status: text("status").notNull().default("proposed"),
  riskLevel: text("risk_level").notNull().default("low"),
  packagePath: text("package_path"),
  definition: jsonb("definition").notNull().default({}),
  ...timestamps,
  ...softDelete
}, (table) => ({
  skillIdIdx: uniqueIndex("skills_skill_id_idx").on(table.skillId)
}));

export const skillCapabilityRequirements = pgTable("skill_capability_requirements", {
  id: uuid("id").primaryKey().defaultRandom(),
  skillId: uuid("skill_id").notNull().references(() => skills.id),
  capabilityId: uuid("capability_id").notNull().references(() => capabilities.id),
  operationName: text("operation_name"),
  required: boolean("required").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const schedules = pgTable("schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  kind: text("kind").notNull(),
  status: text("status").notNull().default("active"),
  message: text("message").notNull(),
  triggerAt: timestamp("trigger_at", { withTimezone: true }),
  cron: text("cron"),
  timezone: text("timezone").notNull().default("America/Chicago"),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  targetType: text("target_type"),
  targetId: uuid("target_id"),
  provider: text("provider"),
  providerChatId: text("provider_chat_id"),
  metadata: jsonb("metadata").notNull().default({}),
  ...timestamps,
  ...softDelete
});

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  actorType: text("actor_type").notNull(),
  actorId: text("actor_id"),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  sourceMessageId: uuid("source_message_id").references(() => messages.id),
  toolName: text("tool_name"),
  capabilityId: text("capability_id"),
  skillId: text("skill_id"),
  request: jsonb("request").notNull().default({}),
  result: jsonb("result").notNull().default({}),
  status: text("status").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb("metadata").notNull().default({})
});

export const searchDocuments = pgTable("search_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  metadata: jsonb("metadata").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  targetIdx: uniqueIndex("search_documents_target_idx").on(table.targetType, table.targetId)
}));
