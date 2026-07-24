import { and, asc, count, desc, eq, gt, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { JsonObject, UUID } from "@ryanos/shared";
import type {
  AuditLog,
  Area,
  DailyPlan,
  EmailActionProposal,
  EmailActionProposalListFilters,
  EmailActionProposalPatch,
  EmailActionProposalUpsertData,
  EmailScanRun,
  EmailScanRunCreateData,
  EmailScanRunPatch,
  EmailSenderPreference,
  EmailSenderPreferencePatch,
  EmailSenderPreferenceUpsertData,
  EmailTriageDecision,
  EmailTriageDecisionListFilters,
  EmailTriageDecisionPatch,
  EmailTriageDecisionUpsertData,
  ExternalSource,
  ExternalSourceUpsertData,
  GoogleCalendar,
  GoogleCalendarEvent,
  GoogleCalendarEventPatch,
  GoogleCalendarEventUpsertData,
  GoogleCalendarPatch,
  GoogleCalendarUpsertData,
  Item,
  ItemChecklistItem,
  ItemChecklistItemCreateData,
  ItemChecklistItemPatch,
  ItemEvent,
  Opportunity,
  OpportunityCreateData,
  OpportunityPatch,
  OpportunityProposal,
  OpportunityProposalListFilters,
  OpportunityProposalPatch,
  OpportunityProposalUpsertData,
  Policy,
  ProviderAccount,
  ProviderAccountPatch,
  ProviderAccountSummary,
  ProviderAccountUpsertData,
  Project,
  RecurrenceEvent,
  RecurrencePolicy,
  RecurrenceState,
  RyanStore,
  ShoppingCatalogItem,
  ShoppingCatalogListFilters,
  ShoppingCatalogUpsertData,
  ShoppingItemCreateData,
  ShoppingItemListFilters,
  ShoppingItemPatch,
  ShoppingList,
  ShoppingListItem,
  AreaUpsertData,
  DailyPlanUpsertData,
  ItemCreateData,
  ItemListFilters,
  ItemPatch,
  ItemProgressNote,
  ItemProgressNoteCreateData,
  ItemProgressNotePatch,
  LotteryDrawSnapshot,
  LotteryDrawSnapshotUpsertData,
  LotteryGameId,
  LotteryTaskAlert,
  LotteryTaskAlertCreateData,
  LotteryTaskAlertPatch,
  PolicyUpsertData,
  ProjectUpsertData,
  SearchMatch,
  SourceLink,
  SourceLinkCreateData,
  TimeBlockBlock,
  TimeBlockBlockCreateData,
  TimeBlockBlockPatch,
  TimeBlockPlan,
  TimeBlockPlanPatch,
  TimeBlockPlanUpsertData,
  UserIntegrationSetting,
  UserIntegrationSettingSummary,
  UserIntegrationSettingUpsertData,
  VocabularyEncounter,
  VocabularyEncounterCreateData,
  VocabularyEntry,
  VocabularyEntryCreateData,
  VocabularyEntryListFilters,
  VocabularyEntryPatch
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
  const starredAt = toIso(row.starredAt);
  if (starredAt !== undefined) item.starredAt = starredAt;
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

function itemProgressNoteFromRow(row: typeof schema.itemProgressNotes.$inferSelect): ItemProgressNote {
  const note: ItemProgressNote = {
    id: row.id,
    userId: row.userId,
    itemId: row.itemId,
    body: row.body,
    occurredAt: row.occurredAt.toISOString(),
    metadata: asJsonObject(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
  const deletedAt = toIso(row.deletedAt);
  if (deletedAt !== undefined) note.deletedAt = deletedAt;
  return note;
}

function itemChecklistItemFromRow(row: typeof schema.itemChecklistItems.$inferSelect): ItemChecklistItem {
  const checklistItem: ItemChecklistItem = {
    id: row.id,
    userId: row.userId,
    itemId: row.itemId,
    title: row.title,
    sortOrder: row.sortOrder,
    metadata: asJsonObject(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
  const checkedAt = toIso(row.checkedAt);
  if (checkedAt !== undefined) checklistItem.checkedAt = checkedAt;
  const deletedAt = toIso(row.deletedAt);
  if (deletedAt !== undefined) checklistItem.deletedAt = deletedAt;
  return checklistItem;
}

function shoppingListFromRow(row: typeof schema.shoppingLists.$inferSelect): ShoppingList {
  const list: ShoppingList = {
    id: row.id,
    userId: row.userId,
    name: row.name,
    metadata: asJsonObject(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
  const deletedAt = toIso(row.deletedAt);
  if (deletedAt !== undefined) list.deletedAt = deletedAt;
  return list;
}

function shoppingListItemFromRow(row: typeof schema.shoppingListItems.$inferSelect): ShoppingListItem {
  const item: ShoppingListItem = {
    id: row.id,
    userId: row.userId,
    listId: row.listId,
    name: row.name,
    normalizedName: row.normalizedName,
    category: row.category,
    source: row.source,
    sortOrder: row.sortOrder,
    metadata: asJsonObject(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
  if (row.catalogItemId !== null) item.catalogItemId = row.catalogItemId;
  if (row.quantity !== null) item.quantity = row.quantity;
  if (row.note !== null) item.note = row.note;
  const checkedAt = toIso(row.checkedAt);
  if (checkedAt !== undefined) item.checkedAt = checkedAt;
  const deletedAt = toIso(row.deletedAt);
  if (deletedAt !== undefined) item.deletedAt = deletedAt;
  return item;
}

function shoppingCatalogItemFromRow(row: typeof schema.shoppingCatalogItems.$inferSelect): ShoppingCatalogItem {
  const item: ShoppingCatalogItem = {
    id: row.id,
    userId: row.userId,
    name: row.name,
    normalizedName: row.normalizedName,
    defaultCategory: row.defaultCategory,
    purchaseCount: row.purchaseCount,
    metadata: asJsonObject(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
  const lastPurchasedAt = toIso(row.lastPurchasedAt);
  if (lastPurchasedAt !== undefined) item.lastPurchasedAt = lastPurchasedAt;
  const deletedAt = toIso(row.deletedAt);
  if (deletedAt !== undefined) item.deletedAt = deletedAt;
  return item;
}

function vocabularyEntryFromRow(row: typeof schema.vocabularyEntries.$inferSelect): VocabularyEntry {
  const entry: VocabularyEntry = {
    id: row.id,
    userId: row.userId,
    term: row.term,
    normalizedTerm: row.normalizedTerm,
    languageCode: row.languageCode,
    category: row.category,
    tags: stringArray(row.tags),
    definitionSource: row.definitionSource,
    status: row.status as VocabularyEntry["status"],
    metadata: asJsonObject(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
  if (row.definition !== null) entry.definition = row.definition;
  if (row.partOfSpeech !== null) entry.partOfSpeech = row.partOfSpeech;
  if (row.pronunciation !== null) entry.pronunciation = row.pronunciation;
  if (row.translation !== null) entry.translation = row.translation;
  if (row.notes !== null) entry.notes = row.notes;
  const deletedAt = toIso(row.deletedAt);
  if (deletedAt !== undefined) entry.deletedAt = deletedAt;
  return entry;
}

function vocabularyEncounterFromRow(row: typeof schema.vocabularyEncounters.$inferSelect): VocabularyEncounter {
  const encounter: VocabularyEncounter = {
    id: row.id,
    userId: row.userId,
    entryId: row.entryId,
    occurredAt: row.occurredAt.toISOString(),
    metadata: asJsonObject(row.metadata),
    createdAt: row.createdAt.toISOString()
  };
  if (row.sourceType !== null) encounter.sourceType = row.sourceType;
  if (row.sourceTitle !== null) encounter.sourceTitle = row.sourceTitle;
  if (row.sourceUrl !== null) encounter.sourceUrl = row.sourceUrl;
  if (row.context !== null) encounter.context = row.context;
  return encounter;
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

function googleCalendarFromRow(row: typeof schema.googleCalendars.$inferSelect): GoogleCalendar {
  const calendar: GoogleCalendar = {
    id: row.id,
    userId: row.userId,
    providerAccountId: row.providerAccountId,
    externalCalendarId: row.externalCalendarId,
    name: row.name,
    accessRole: row.accessRole,
    primary: row.primary,
    selectedForAvailability: row.selectedForAvailability,
    allDayBlocksAvailability: row.allDayBlocksAvailability,
    writeEnabled: row.writeEnabled,
    status: row.status as GoogleCalendar["status"],
    metadata: asJsonObject(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
  if (row.timezone !== null) calendar.timezone = row.timezone;
  if (row.backgroundColor !== null) calendar.backgroundColor = row.backgroundColor;
  if (row.lastSyncedAt !== null) calendar.lastSyncedAt = row.lastSyncedAt.toISOString();
  if (row.lastError !== null) calendar.lastError = row.lastError;
  if (row.deletedAt !== null) calendar.deletedAt = row.deletedAt.toISOString();
  return calendar;
}

function googleCalendarEventFromRow(row: typeof schema.googleCalendarEvents.$inferSelect): GoogleCalendarEvent {
  const event: GoogleCalendarEvent = {
    id: row.id,
    userId: row.userId,
    providerAccountId: row.providerAccountId,
    googleCalendarId: row.googleCalendarId,
    externalEventId: row.externalEventId,
    title: row.title,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    allDay: row.allDay,
    transparency: row.transparency as GoogleCalendarEvent["transparency"],
    status: row.status,
    ryanosOwned: row.ryanosOwned,
    syncedAt: row.syncedAt.toISOString(),
    metadata: asJsonObject(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
  if (row.iCalUid !== null) event.iCalUid = row.iCalUid;
  if (row.location !== null) event.location = row.location;
  if (row.htmlLink !== null) event.htmlLink = row.htmlLink;
  if (row.recurringEventId !== null) event.recurringEventId = row.recurringEventId;
  if (row.etag !== null) event.etag = row.etag;
  if (row.deletedAt !== null) event.deletedAt = row.deletedAt.toISOString();
  return event;
}

function timeBlockPlanFromRow(row: typeof schema.timeBlockPlans.$inferSelect): TimeBlockPlan {
  const plan: TimeBlockPlan = {
    id: row.id,
    userId: row.userId,
    dateKey: row.dateKey,
    timezone: row.timezone,
    status: row.status as TimeBlockPlan["status"],
    generatedAt: row.generatedAt.toISOString(),
    metadata: asJsonObject(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
  if (row.rulePolicyId !== null) plan.rulePolicyId = row.rulePolicyId;
  if (row.publishedAt !== null) plan.publishedAt = row.publishedAt.toISOString();
  if (row.error !== null) plan.error = row.error;
  if (row.deletedAt !== null) plan.deletedAt = row.deletedAt.toISOString();
  return plan;
}

function timeBlockBlockFromRow(row: typeof schema.timeBlockBlocks.$inferSelect): TimeBlockBlock {
  const block: TimeBlockBlock = {
    id: row.id,
    userId: row.userId,
    planId: row.planId,
    googleCalendarId: row.googleCalendarId,
    title: row.title,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    status: row.status as TimeBlockBlock["status"],
    pinned: row.pinned,
    sortOrder: row.sortOrder,
    metadata: asJsonObject(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
  if (row.itemId !== null) block.itemId = row.itemId;
  if (row.externalEventId !== null) block.externalEventId = row.externalEventId;
  if (row.error !== null) block.error = row.error;
  if (row.deletedAt !== null) block.deletedAt = row.deletedAt.toISOString();
  return block;
}

function userIntegrationSettingFromRow(row: typeof schema.userIntegrationSettings.$inferSelect): UserIntegrationSetting {
  return {
    userId: row.userId,
    integrationId: row.integrationId,
    enabled: row.enabled,
    metadata: asJsonObject(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function lotteryDrawSnapshotFromRow(
  row: typeof schema.lotteryDrawSnapshots.$inferSelect
): LotteryDrawSnapshot {
  const snapshot: LotteryDrawSnapshot = {
    id: row.id,
    gameId: row.gameId as LotteryGameId,
    status: row.status as LotteryDrawSnapshot["status"],
    sourceUrl: row.sourceUrl,
    lastAttemptAt: row.lastAttemptAt.toISOString(),
    metadata: asJsonObject(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
  if (row.advertisedJackpotDollars !== null) {
    snapshot.advertisedJackpotDollars = row.advertisedJackpotDollars;
  }
  if (row.cashValueDollars !== null) snapshot.cashValueDollars = row.cashValueDollars;
  const optionalDates = {
    nextDrawAt: row.nextDrawAt,
    officialCutoffAt: row.officialCutoffAt,
    fetchedAt: row.fetchedAt,
    lastSuccessAt: row.lastSuccessAt,
    lastFailureAt: row.lastFailureAt
  };
  for (const [field, value] of Object.entries(optionalDates)) {
    if (value !== null) Object.assign(snapshot, { [field]: value.toISOString() });
  }
  if (row.error !== null) snapshot.error = row.error;
  return snapshot;
}

function lotteryTaskAlertFromRow(row: typeof schema.lotteryTaskAlerts.$inferSelect): LotteryTaskAlert {
  const alert: LotteryTaskAlert = {
    id: row.id,
    userId: row.userId,
    gameId: row.gameId as LotteryGameId,
    drawAt: row.drawAt.toISOString(),
    status: row.status as LotteryTaskAlert["status"],
    advertisedJackpotDollars: row.advertisedJackpotDollars,
    buyByAt: row.buyByAt.toISOString(),
    metadata: asJsonObject(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
  if (row.itemId !== null) alert.itemId = row.itemId;
  return alert;
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
  if (row.triageDecisionId !== null) proposal.triageDecisionId = row.triageDecisionId;
  if (row.acceptedItemId !== null) proposal.acceptedItemId = row.acceptedItemId;
  const acceptedAt = toIso(row.acceptedAt);
  if (acceptedAt !== undefined) proposal.acceptedAt = acceptedAt;
  const rejectedAt = toIso(row.rejectedAt);
  if (rejectedAt !== undefined) proposal.rejectedAt = rejectedAt;
  const deletedAt = toIso(row.deletedAt);
  if (deletedAt !== undefined) proposal.deletedAt = deletedAt;
  return proposal;
}

function emailScanRunFromRow(row: typeof schema.emailScanRuns.$inferSelect): EmailScanRun {
  const run: EmailScanRun = {
    id: row.id,
    userId: row.userId,
    trigger: row.trigger as EmailScanRun["trigger"],
    status: row.status as EmailScanRun["status"],
    classifierVersion: row.classifierVersion,
    startedAt: row.startedAt.toISOString(),
    leaseExpiresAt: row.leaseExpiresAt.toISOString(),
    counts: asJsonObject(row.counts),
    errors: asJsonObject(row.errors),
    metadata: asJsonObject(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
  const completedAt = toIso(row.completedAt);
  if (completedAt !== undefined) run.completedAt = completedAt;
  return run;
}

function emailTriageDecisionFromRow(
  row: typeof schema.emailTriageDecisions.$inferSelect
): EmailTriageDecision {
  const decision: EmailTriageDecision = {
    id: row.id,
    userId: row.userId,
    sourceId: row.sourceId,
    providerAccountId: row.providerAccountId,
    gmailMessageId: row.gmailMessageId,
    gmailThreadId: row.gmailThreadId,
    contentFingerprint: row.contentFingerprint,
    classifierVersion: row.classifierVersion,
    outcome: row.outcome as EmailTriageDecision["outcome"],
    retryCount: row.retryCount,
    evaluatedAt: row.evaluatedAt.toISOString(),
    metadata: asJsonObject(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
  if (row.reasonCode !== null) decision.reasonCode = row.reasonCode;
  if (row.reason !== null) decision.reason = row.reason;
  if (row.confidence !== null) decision.confidence = row.confidence;
  if (row.senderAddress !== null) decision.senderAddress = row.senderAddress;
  const nextRetryAt = toIso(row.nextRetryAt);
  if (nextRetryAt !== undefined) decision.nextRetryAt = nextRetryAt;
  const deletedAt = toIso(row.deletedAt);
  if (deletedAt !== undefined) decision.deletedAt = deletedAt;
  return decision;
}

function emailSenderPreferenceFromRow(
  row: typeof schema.emailSenderPreferences.$inferSelect
): EmailSenderPreference {
  const preference: EmailSenderPreference = {
    id: row.id,
    userId: row.userId,
    matchType: row.matchType as EmailSenderPreference["matchType"],
    value: row.value,
    disposition: row.disposition as EmailSenderPreference["disposition"],
    metadata: asJsonObject(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
  if (row.originatingProposalId !== null) preference.originatingProposalId = row.originatingProposalId;
  const deletedAt = toIso(row.deletedAt);
  if (deletedAt !== undefined) preference.deletedAt = deletedAt;
  return preference;
}

function opportunityFromRow(row: typeof schema.opportunities.$inferSelect): Opportunity {
  const opportunity: Opportunity = {
    id: row.id,
    userId: row.userId,
    title: row.title,
    status: row.status as Opportunity["status"],
    fit: row.fit as Opportunity["fit"],
    metadata: asJsonObject(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
  if (row.areaId !== null) opportunity.areaId = row.areaId;
  if (row.projectId !== null) opportunity.projectId = row.projectId;
  const dueAt = toIso(row.dueAt);
  if (dueAt !== undefined) opportunity.dueAt = dueAt;
  const decisionBy = toIso(row.decisionBy);
  if (decisionBy !== undefined) opportunity.decisionBy = decisionBy;
  if (row.valueEstimate !== null) opportunity.valueEstimate = row.valueEstimate;
  if (row.nextActionItemId !== null) opportunity.nextActionItemId = row.nextActionItemId;
  if (row.summary !== null) opportunity.summary = row.summary;
  const deletedAt = toIso(row.deletedAt);
  if (deletedAt !== undefined) opportunity.deletedAt = deletedAt;
  return opportunity;
}

function opportunityProposalFromRow(
  row: typeof schema.opportunityProposals.$inferSelect
): OpportunityProposal {
  const proposal: OpportunityProposal = {
    id: row.id,
    userId: row.userId,
    sourceId: row.sourceId,
    idempotencyKey: row.idempotencyKey,
    status: row.status as OpportunityProposal["status"],
    projectSlug: row.projectSlug,
    title: row.title,
    fit: row.fit as OpportunityProposal["fit"],
    priority: row.priority,
    metadata: asJsonObject(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
  if (row.summary !== null) proposal.summary = row.summary;
  if (row.rating !== null) proposal.rating = row.rating;
  const dueAt = toIso(row.dueAt);
  if (dueAt !== undefined) proposal.dueAt = dueAt;
  const decisionBy = toIso(row.decisionBy);
  if (decisionBy !== undefined) proposal.decisionBy = decisionBy;
  if (row.valueEstimate !== null) proposal.valueEstimate = row.valueEstimate;
  if (row.recommendedAction !== null) proposal.recommendedAction = row.recommendedAction;
  if (row.rationale !== null) proposal.rationale = row.rationale;
  if (row.acceptedOpportunityId !== null) proposal.acceptedOpportunityId = row.acceptedOpportunityId;
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
    if (patch.starredAt !== undefined) {
      values.starredAt = patch.starredAt === null ? null : toDate(patch.starredAt);
    }
    if (patch.completedAt !== undefined) {
      values.completedAt = patch.completedAt === null ? null : toDate(patch.completedAt);
    }
    if (patch.cancelledAt !== undefined) {
      values.cancelledAt = patch.cancelledAt === null ? null : toDate(patch.cancelledAt);
    }
    if (patch.deletedAt !== undefined) {
      values.deletedAt = patch.deletedAt === null ? null : toDate(patch.deletedAt);
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
        sql`case when ${schema.items.starredAt} is not null then 0 else 1 end`,
        desc(schema.items.starredAt),
        asc(schema.items.dueAt),
        desc(schema.items.createdAt)
      )
      .limit(Math.min(Math.max(filters.limit ?? 30, 1), 200))
      .offset(Math.max(filters.offset ?? 0, 0));

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

  async createItemProgressNote(data: ItemProgressNoteCreateData): Promise<ItemProgressNote> {
    const userId = await this.resolveUserId(data.userId);
    const values: typeof schema.itemProgressNotes.$inferInsert = {
      userId,
      itemId: data.itemId,
      body: data.body,
      occurredAt: data.occurredAt === undefined ? new Date() : new Date(data.occurredAt),
      metadata: data.metadata ?? {}
    };
    const [row] = await this.db.insert(schema.itemProgressNotes).values(values).returning();
    if (!row) throw new Error("Failed to create item progress note");
    return itemProgressNoteFromRow(row);
  }

  async updateItemProgressNote(noteId: UUID, patch: ItemProgressNotePatch): Promise<ItemProgressNote> {
    const values: Partial<typeof schema.itemProgressNotes.$inferInsert> = {
      updatedAt: new Date()
    };
    if (patch.body !== undefined) values.body = patch.body;
    if (patch.occurredAt !== undefined) values.occurredAt = new Date(patch.occurredAt);
    if (patch.metadata !== undefined) values.metadata = patch.metadata;
    if (patch.deletedAt !== undefined) {
      values.deletedAt = patch.deletedAt === null ? null : new Date(patch.deletedAt);
    }
    const [row] = await this.db
      .update(schema.itemProgressNotes)
      .set(values)
      .where(eq(schema.itemProgressNotes.id, noteId))
      .returning();
    if (!row) throw new Error(`Item progress note not found: ${noteId}`);
    return itemProgressNoteFromRow(row);
  }

  async listItemProgressNotes(filters: {
    userId: UUID;
    itemId: UUID;
    limit?: number;
  }): Promise<ItemProgressNote[]> {
    const resolvedUserId = await this.resolveUserId(filters.userId);
    const rows = await this.db
      .select()
      .from(schema.itemProgressNotes)
      .where(
        and(
          eq(schema.itemProgressNotes.userId, resolvedUserId),
          eq(schema.itemProgressNotes.itemId, filters.itemId),
          isNull(schema.itemProgressNotes.deletedAt)
        )
      )
      .orderBy(desc(schema.itemProgressNotes.occurredAt), desc(schema.itemProgressNotes.createdAt))
      .limit(Math.min(Math.max(filters.limit ?? 100, 1), 200));
    return rows.map(itemProgressNoteFromRow);
  }

  async getItemProgressNote(noteId: UUID): Promise<ItemProgressNote | undefined> {
    const row = await this.db.query.itemProgressNotes.findFirst({
      where: eq(schema.itemProgressNotes.id, noteId)
    });
    return row ? itemProgressNoteFromRow(row) : undefined;
  }

  async createItemChecklistItem(data: ItemChecklistItemCreateData): Promise<ItemChecklistItem> {
    const userId = await this.resolveUserId(data.userId);
    const sortOrder =
      data.sortOrder ??
      (
        await this.db
          .select({ value: count() })
          .from(schema.itemChecklistItems)
          .where(
            and(
              eq(schema.itemChecklistItems.userId, userId),
              eq(schema.itemChecklistItems.itemId, data.itemId),
              isNull(schema.itemChecklistItems.deletedAt)
            )
          )
      )[0]?.value ??
      0;
    const values: typeof schema.itemChecklistItems.$inferInsert = {
      userId,
      itemId: data.itemId,
      title: data.title,
      sortOrder,
      metadata: data.metadata ?? {}
    };
    if (data.checkedAt !== undefined) values.checkedAt = new Date(data.checkedAt);
    const [row] = await this.db.insert(schema.itemChecklistItems).values(values).returning();
    if (!row) throw new Error("Failed to create item checklist item");
    return itemChecklistItemFromRow(row);
  }

  async updateItemChecklistItem(
    checklistItemId: UUID,
    patch: ItemChecklistItemPatch
  ): Promise<ItemChecklistItem> {
    const values: Partial<typeof schema.itemChecklistItems.$inferInsert> = {
      updatedAt: new Date()
    };
    if (patch.title !== undefined) values.title = patch.title;
    if (patch.sortOrder !== undefined) values.sortOrder = patch.sortOrder;
    if (patch.metadata !== undefined) values.metadata = patch.metadata;
    if (patch.checkedAt !== undefined) {
      values.checkedAt = patch.checkedAt === null ? null : new Date(patch.checkedAt);
    }
    if (patch.deletedAt !== undefined) {
      values.deletedAt = patch.deletedAt === null ? null : new Date(patch.deletedAt);
    }
    const [row] = await this.db
      .update(schema.itemChecklistItems)
      .set(values)
      .where(eq(schema.itemChecklistItems.id, checklistItemId))
      .returning();
    if (!row) throw new Error(`Item checklist item not found: ${checklistItemId}`);
    return itemChecklistItemFromRow(row);
  }

  async listItemChecklistItems(filters: {
    userId: UUID;
    itemId: UUID;
    limit?: number;
  }): Promise<ItemChecklistItem[]> {
    const resolvedUserId = await this.resolveUserId(filters.userId);
    const rows = await this.db
      .select()
      .from(schema.itemChecklistItems)
      .where(
        and(
          eq(schema.itemChecklistItems.userId, resolvedUserId),
          eq(schema.itemChecklistItems.itemId, filters.itemId),
          isNull(schema.itemChecklistItems.deletedAt)
        )
      )
      .orderBy(asc(schema.itemChecklistItems.sortOrder), asc(schema.itemChecklistItems.createdAt))
      .limit(Math.min(Math.max(filters.limit ?? 100, 1), 200));
    return rows.map(itemChecklistItemFromRow);
  }

  async getItemChecklistItem(checklistItemId: UUID): Promise<ItemChecklistItem | undefined> {
    const row = await this.db.query.itemChecklistItems.findFirst({
      where: eq(schema.itemChecklistItems.id, checklistItemId)
    });
    return row ? itemChecklistItemFromRow(row) : undefined;
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

  async getPolicy(policyId: UUID): Promise<Policy | undefined> {
    const row = await this.db.query.policies.findFirst({
      where: eq(schema.policies.id, policyId)
    });
    return row ? policyFromRow(row) : undefined;
  }

  async listPolicies(filters: {
    userId: UUID;
    type?: Policy["type"];
    scope?: string;
    statuses?: Policy["status"][];
    limit?: number;
  }): Promise<Policy[]> {
    const userId = await this.resolveUserId(filters.userId);
    const conditions = [
      eq(schema.policies.userId, userId),
      isNull(schema.policies.deletedAt)
    ];
    if (filters.type !== undefined) conditions.push(eq(schema.policies.type, filters.type));
    if (filters.scope !== undefined) conditions.push(eq(schema.policies.scope, filters.scope));
    if (filters.statuses !== undefined) conditions.push(inArray(schema.policies.status, filters.statuses));
    const rows = await this.db
      .select()
      .from(schema.policies)
      .where(and(...conditions))
      .orderBy(desc(schema.policies.updatedAt))
      .limit(Math.min(Math.max(filters.limit ?? 100, 1), 500));
    return rows.map(policyFromRow);
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

  async listProviderAccountsForProvider(provider: string, limit = 500): Promise<ProviderAccount[]> {
    const rows = await this.db
      .select()
      .from(schema.providerAccounts)
      .where(and(eq(schema.providerAccounts.provider, provider), isNull(schema.providerAccounts.deletedAt)))
      .orderBy(asc(schema.providerAccounts.userId), asc(schema.providerAccounts.email))
      .limit(Math.min(Math.max(limit, 1), 1000));
    return rows.map(providerAccountFromRow);
  }

  async getProviderAccount(accountId: UUID): Promise<ProviderAccount | undefined> {
    const row = await this.db.query.providerAccounts.findFirst({
      where: eq(schema.providerAccounts.id, accountId)
    });
    return row ? providerAccountFromRow(row) : undefined;
  }

  async findProviderAccountByExternalId(provider: string, externalAccountId: string): Promise<ProviderAccount | undefined> {
    const row = await this.db.query.providerAccounts.findFirst({
      where: and(
        eq(schema.providerAccounts.provider, provider),
        eq(schema.providerAccounts.externalAccountId, externalAccountId),
        isNull(schema.providerAccounts.deletedAt)
      )
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

  async listProviderAccountSummaries(): Promise<ProviderAccountSummary[]> {
    const rows = await this.db
      .select({
        provider: schema.providerAccounts.provider,
        status: schema.providerAccounts.status,
        accountCount: count(),
        userCount: sql<number>`count(distinct ${schema.providerAccounts.userId})`
      })
      .from(schema.providerAccounts)
      .where(isNull(schema.providerAccounts.deletedAt))
      .groupBy(schema.providerAccounts.provider, schema.providerAccounts.status)
      .orderBy(asc(schema.providerAccounts.provider), asc(schema.providerAccounts.status));
    return rows.map((row) => ({
      provider: row.provider,
      status: row.status,
      accountCount: Number(row.accountCount),
      userCount: Number(row.userCount)
    }));
  }

  async upsertGoogleCalendar(data: GoogleCalendarUpsertData): Promise<GoogleCalendar> {
    const userId = await this.resolveUserId(data.userId);
    const existing = await this.db.query.googleCalendars.findFirst({
      where: and(
        eq(schema.googleCalendars.providerAccountId, data.providerAccountId),
        eq(schema.googleCalendars.externalCalendarId, data.externalCalendarId)
      )
    });
    const values: typeof schema.googleCalendars.$inferInsert = {
      userId,
      providerAccountId: data.providerAccountId,
      externalCalendarId: data.externalCalendarId,
      name: data.name,
      timezone: data.timezone ?? existing?.timezone ?? null,
      accessRole: data.accessRole ?? existing?.accessRole ?? "reader",
      backgroundColor: data.backgroundColor ?? existing?.backgroundColor ?? null,
      primary: data.primary ?? existing?.primary ?? false,
      selectedForAvailability: data.selectedForAvailability ?? existing?.selectedForAvailability ?? false,
      allDayBlocksAvailability: data.allDayBlocksAvailability ?? existing?.allDayBlocksAvailability ?? false,
      writeEnabled: data.writeEnabled ?? existing?.writeEnabled ?? false,
      status: data.status ?? existing?.status ?? "active",
      lastSyncedAt: data.lastSyncedAt !== undefined ? new Date(data.lastSyncedAt) : existing?.lastSyncedAt ?? null,
      lastError: data.lastError ?? existing?.lastError ?? null,
      metadata: data.metadata ?? existing?.metadata ?? {},
      deletedAt: null,
      updatedAt: new Date()
    };
    if (existing) {
      const [row] = await this.db
        .update(schema.googleCalendars)
        .set(values)
        .where(eq(schema.googleCalendars.id, existing.id))
        .returning();
      if (!row) throw new Error(`Google calendar not found: ${existing.id}`);
      return googleCalendarFromRow(row);
    }
    const [row] = await this.db.insert(schema.googleCalendars).values(values).returning();
    if (!row) throw new Error("Failed to upsert Google calendar");
    return googleCalendarFromRow(row);
  }

  async updateGoogleCalendar(calendarId: UUID, patch: GoogleCalendarPatch): Promise<GoogleCalendar> {
    const values: Partial<typeof schema.googleCalendars.$inferInsert> = {
      updatedAt: new Date()
    };
    if (patch.name !== undefined) values.name = patch.name;
    if (patch.timezone !== undefined) values.timezone = patch.timezone;
    if (patch.accessRole !== undefined) values.accessRole = patch.accessRole;
    if (patch.backgroundColor !== undefined) values.backgroundColor = patch.backgroundColor;
    if (patch.primary !== undefined) values.primary = patch.primary;
    if (patch.selectedForAvailability !== undefined) values.selectedForAvailability = patch.selectedForAvailability;
    if (patch.allDayBlocksAvailability !== undefined) values.allDayBlocksAvailability = patch.allDayBlocksAvailability;
    if (patch.writeEnabled !== undefined) values.writeEnabled = patch.writeEnabled;
    if (patch.status !== undefined) values.status = patch.status;
    if (patch.lastSyncedAt !== undefined) values.lastSyncedAt = new Date(patch.lastSyncedAt);
    if (patch.lastError !== undefined) values.lastError = patch.lastError;
    if (patch.metadata !== undefined) values.metadata = patch.metadata;
    if (patch.deletedAt !== undefined) values.deletedAt = patch.deletedAt === null ? null : new Date(patch.deletedAt);
    const [row] = await this.db
      .update(schema.googleCalendars)
      .set(values)
      .where(eq(schema.googleCalendars.id, calendarId))
      .returning();
    if (!row) throw new Error(`Google calendar not found: ${calendarId}`);
    return googleCalendarFromRow(row);
  }

  async getGoogleCalendar(calendarId: UUID): Promise<GoogleCalendar | undefined> {
    const row = await this.db.query.googleCalendars.findFirst({
      where: eq(schema.googleCalendars.id, calendarId)
    });
    return row ? googleCalendarFromRow(row) : undefined;
  }

  async listGoogleCalendars(filters: {
    userId: UUID;
    providerAccountId?: UUID;
    selectedForAvailability?: boolean;
    limit?: number;
  }): Promise<GoogleCalendar[]> {
    const userId = await this.resolveUserId(filters.userId);
    const conditions = [
      eq(schema.googleCalendars.userId, userId),
      isNull(schema.googleCalendars.deletedAt)
    ];
    if (filters.providerAccountId !== undefined) {
      conditions.push(eq(schema.googleCalendars.providerAccountId, filters.providerAccountId));
    }
    if (filters.selectedForAvailability !== undefined) {
      conditions.push(eq(schema.googleCalendars.selectedForAvailability, filters.selectedForAvailability));
    }
    const rows = await this.db
      .select()
      .from(schema.googleCalendars)
      .where(and(...conditions))
      .orderBy(desc(schema.googleCalendars.primary), asc(schema.googleCalendars.name))
      .limit(Math.min(Math.max(filters.limit ?? 200, 1), 500));
    return rows.map(googleCalendarFromRow);
  }

  async upsertGoogleCalendarEvent(data: GoogleCalendarEventUpsertData): Promise<GoogleCalendarEvent> {
    const userId = await this.resolveUserId(data.userId);
    const existing = await this.db.query.googleCalendarEvents.findFirst({
      where: and(
        eq(schema.googleCalendarEvents.googleCalendarId, data.googleCalendarId),
        eq(schema.googleCalendarEvents.externalEventId, data.externalEventId)
      )
    });
    const values: typeof schema.googleCalendarEvents.$inferInsert = {
      userId,
      providerAccountId: data.providerAccountId,
      googleCalendarId: data.googleCalendarId,
      externalEventId: data.externalEventId,
      iCalUid: data.iCalUid ?? existing?.iCalUid ?? null,
      title: data.title,
      startAt: new Date(data.startAt),
      endAt: new Date(data.endAt),
      allDay: data.allDay ?? existing?.allDay ?? false,
      transparency: data.transparency ?? existing?.transparency ?? "opaque",
      status: data.status ?? existing?.status ?? "confirmed",
      location: data.location ?? existing?.location ?? null,
      htmlLink: data.htmlLink ?? existing?.htmlLink ?? null,
      recurringEventId: data.recurringEventId ?? existing?.recurringEventId ?? null,
      etag: data.etag ?? existing?.etag ?? null,
      ryanosOwned: data.ryanosOwned ?? existing?.ryanosOwned ?? false,
      syncedAt: new Date(data.syncedAt ?? new Date().toISOString()),
      metadata: data.metadata ?? existing?.metadata ?? {},
      deletedAt: null,
      updatedAt: new Date()
    };
    if (existing) {
      const [row] = await this.db
        .update(schema.googleCalendarEvents)
        .set(values)
        .where(eq(schema.googleCalendarEvents.id, existing.id))
        .returning();
      if (!row) throw new Error(`Google calendar event not found: ${existing.id}`);
      return googleCalendarEventFromRow(row);
    }
    const [row] = await this.db.insert(schema.googleCalendarEvents).values(values).returning();
    if (!row) throw new Error("Failed to upsert Google calendar event");
    return googleCalendarEventFromRow(row);
  }

  async updateGoogleCalendarEvent(eventId: UUID, patch: GoogleCalendarEventPatch): Promise<GoogleCalendarEvent> {
    const values: Partial<typeof schema.googleCalendarEvents.$inferInsert> = { updatedAt: new Date() };
    if (patch.title !== undefined) values.title = patch.title;
    if (patch.startAt !== undefined) values.startAt = new Date(patch.startAt);
    if (patch.endAt !== undefined) values.endAt = new Date(patch.endAt);
    if (patch.allDay !== undefined) values.allDay = patch.allDay;
    if (patch.transparency !== undefined) values.transparency = patch.transparency;
    if (patch.status !== undefined) values.status = patch.status;
    if (patch.location !== undefined) values.location = patch.location;
    if (patch.htmlLink !== undefined) values.htmlLink = patch.htmlLink;
    if (patch.recurringEventId !== undefined) values.recurringEventId = patch.recurringEventId;
    if (patch.etag !== undefined) values.etag = patch.etag;
    if (patch.ryanosOwned !== undefined) values.ryanosOwned = patch.ryanosOwned;
    if (patch.syncedAt !== undefined) values.syncedAt = new Date(patch.syncedAt);
    if (patch.metadata !== undefined) values.metadata = patch.metadata;
    if (patch.deletedAt !== undefined) values.deletedAt = patch.deletedAt === null ? null : new Date(patch.deletedAt);
    const [row] = await this.db
      .update(schema.googleCalendarEvents)
      .set(values)
      .where(eq(schema.googleCalendarEvents.id, eventId))
      .returning();
    if (!row) throw new Error(`Google calendar event not found: ${eventId}`);
    return googleCalendarEventFromRow(row);
  }

  async getGoogleCalendarEvent(eventId: UUID): Promise<GoogleCalendarEvent | undefined> {
    const row = await this.db.query.googleCalendarEvents.findFirst({
      where: eq(schema.googleCalendarEvents.id, eventId)
    });
    return row ? googleCalendarEventFromRow(row) : undefined;
  }

  async findGoogleCalendarEvent(googleCalendarId: UUID, externalEventId: string): Promise<GoogleCalendarEvent | undefined> {
    const row = await this.db.query.googleCalendarEvents.findFirst({
      where: and(
        eq(schema.googleCalendarEvents.googleCalendarId, googleCalendarId),
        eq(schema.googleCalendarEvents.externalEventId, externalEventId)
      )
    });
    return row ? googleCalendarEventFromRow(row) : undefined;
  }

  async listGoogleCalendarEvents(filters: {
    userId: UUID;
    googleCalendarIds?: UUID[];
    startsBefore?: string;
    endsAfter?: string;
    includeDeleted?: boolean;
    limit?: number;
  }): Promise<GoogleCalendarEvent[]> {
    if (filters.googleCalendarIds?.length === 0) return [];
    const userId = await this.resolveUserId(filters.userId);
    const conditions = [eq(schema.googleCalendarEvents.userId, userId)];
    if (!filters.includeDeleted) conditions.push(isNull(schema.googleCalendarEvents.deletedAt));
    if (filters.googleCalendarIds !== undefined) {
      conditions.push(inArray(schema.googleCalendarEvents.googleCalendarId, filters.googleCalendarIds));
    }
    if (filters.startsBefore !== undefined) {
      conditions.push(lt(schema.googleCalendarEvents.startAt, new Date(filters.startsBefore)));
    }
    if (filters.endsAfter !== undefined) {
      conditions.push(gt(schema.googleCalendarEvents.endAt, new Date(filters.endsAfter)));
    }
    const rows = await this.db
      .select()
      .from(schema.googleCalendarEvents)
      .where(and(...conditions))
      .orderBy(asc(schema.googleCalendarEvents.startAt))
      .limit(Math.min(Math.max(filters.limit ?? 1000, 1), 5000));
    return rows.map(googleCalendarEventFromRow);
  }

  async upsertTimeBlockPlan(data: TimeBlockPlanUpsertData): Promise<TimeBlockPlan> {
    const userId = await this.resolveUserId(data.userId);
    const existing = await this.db.query.timeBlockPlans.findFirst({
      where: and(
        eq(schema.timeBlockPlans.userId, userId),
        eq(schema.timeBlockPlans.dateKey, data.dateKey),
        isNull(schema.timeBlockPlans.deletedAt)
      )
    });
    const values: typeof schema.timeBlockPlans.$inferInsert = {
      userId,
      dateKey: data.dateKey,
      timezone: data.timezone,
      status: data.status,
      rulePolicyId: data.rulePolicyId ?? existing?.rulePolicyId ?? null,
      generatedAt: new Date(data.generatedAt ?? new Date().toISOString()),
      publishedAt: data.publishedAt !== undefined ? new Date(data.publishedAt) : existing?.publishedAt ?? null,
      error: data.error ?? existing?.error ?? null,
      metadata: data.metadata ?? existing?.metadata ?? {},
      updatedAt: new Date()
    };
    if (existing) {
      const [row] = await this.db
        .update(schema.timeBlockPlans)
        .set(values)
        .where(eq(schema.timeBlockPlans.id, existing.id))
        .returning();
      if (!row) throw new Error(`Time block plan not found: ${existing.id}`);
      return timeBlockPlanFromRow(row);
    }
    const [row] = await this.db.insert(schema.timeBlockPlans).values(values).returning();
    if (!row) throw new Error("Failed to upsert time block plan");
    return timeBlockPlanFromRow(row);
  }

  async updateTimeBlockPlan(planId: UUID, patch: TimeBlockPlanPatch): Promise<TimeBlockPlan> {
    const values: Partial<typeof schema.timeBlockPlans.$inferInsert> = { updatedAt: new Date() };
    if (patch.timezone !== undefined) values.timezone = patch.timezone;
    if (patch.status !== undefined) values.status = patch.status;
    if (patch.rulePolicyId !== undefined) values.rulePolicyId = patch.rulePolicyId;
    if (patch.generatedAt !== undefined) values.generatedAt = new Date(patch.generatedAt);
    if (patch.publishedAt !== undefined) values.publishedAt = new Date(patch.publishedAt);
    if (patch.error !== undefined) values.error = patch.error;
    if (patch.metadata !== undefined) values.metadata = patch.metadata;
    if (patch.deletedAt !== undefined) values.deletedAt = patch.deletedAt === null ? null : new Date(patch.deletedAt);
    const [row] = await this.db
      .update(schema.timeBlockPlans)
      .set(values)
      .where(eq(schema.timeBlockPlans.id, planId))
      .returning();
    if (!row) throw new Error(`Time block plan not found: ${planId}`);
    return timeBlockPlanFromRow(row);
  }

  async getTimeBlockPlan(planId: UUID): Promise<TimeBlockPlan | undefined> {
    const row = await this.db.query.timeBlockPlans.findFirst({
      where: eq(schema.timeBlockPlans.id, planId)
    });
    return row ? timeBlockPlanFromRow(row) : undefined;
  }

  async findTimeBlockPlan(userId: UUID, dateKey: string): Promise<TimeBlockPlan | undefined> {
    const resolvedUserId = await this.resolveUserId(userId);
    const row = await this.db.query.timeBlockPlans.findFirst({
      where: and(
        eq(schema.timeBlockPlans.userId, resolvedUserId),
        eq(schema.timeBlockPlans.dateKey, dateKey),
        isNull(schema.timeBlockPlans.deletedAt)
      )
    });
    return row ? timeBlockPlanFromRow(row) : undefined;
  }

  async createTimeBlockBlock(data: TimeBlockBlockCreateData): Promise<TimeBlockBlock> {
    const userId = await this.resolveUserId(data.userId);
    const [row] = await this.db
      .insert(schema.timeBlockBlocks)
      .values({
        userId,
        planId: data.planId,
        itemId: data.itemId ?? null,
        googleCalendarId: data.googleCalendarId,
        title: data.title,
        startAt: new Date(data.startAt),
        endAt: new Date(data.endAt),
        status: data.status ?? "draft",
        pinned: data.pinned ?? false,
        externalEventId: data.externalEventId ?? null,
        error: data.error ?? null,
        sortOrder: data.sortOrder ?? 0,
        metadata: data.metadata ?? {}
      })
      .returning();
    if (!row) throw new Error("Failed to create time block");
    return timeBlockBlockFromRow(row);
  }

  async updateTimeBlockBlock(blockId: UUID, patch: TimeBlockBlockPatch): Promise<TimeBlockBlock> {
    const values: Partial<typeof schema.timeBlockBlocks.$inferInsert> = { updatedAt: new Date() };
    if (patch.itemId !== undefined) values.itemId = patch.itemId;
    if (patch.title !== undefined) values.title = patch.title;
    if (patch.startAt !== undefined) values.startAt = new Date(patch.startAt);
    if (patch.endAt !== undefined) values.endAt = new Date(patch.endAt);
    if (patch.status !== undefined) values.status = patch.status;
    if (patch.pinned !== undefined) values.pinned = patch.pinned;
    if (patch.externalEventId !== undefined) values.externalEventId = patch.externalEventId;
    if (patch.error !== undefined) values.error = patch.error;
    if (patch.sortOrder !== undefined) values.sortOrder = patch.sortOrder;
    if (patch.metadata !== undefined) values.metadata = patch.metadata;
    if (patch.deletedAt !== undefined) values.deletedAt = patch.deletedAt === null ? null : new Date(patch.deletedAt);
    const [row] = await this.db
      .update(schema.timeBlockBlocks)
      .set(values)
      .where(eq(schema.timeBlockBlocks.id, blockId))
      .returning();
    if (!row) throw new Error(`Time block not found: ${blockId}`);
    return timeBlockBlockFromRow(row);
  }

  async getTimeBlockBlock(blockId: UUID): Promise<TimeBlockBlock | undefined> {
    const row = await this.db.query.timeBlockBlocks.findFirst({
      where: eq(schema.timeBlockBlocks.id, blockId)
    });
    return row ? timeBlockBlockFromRow(row) : undefined;
  }

  async listTimeBlockBlocks(filters: {
    userId: UUID;
    planId?: UUID;
    itemId?: UUID;
    limit?: number;
  }): Promise<TimeBlockBlock[]> {
    const userId = await this.resolveUserId(filters.userId);
    const conditions = [
      eq(schema.timeBlockBlocks.userId, userId),
      isNull(schema.timeBlockBlocks.deletedAt)
    ];
    if (filters.planId !== undefined) conditions.push(eq(schema.timeBlockBlocks.planId, filters.planId));
    if (filters.itemId !== undefined) conditions.push(eq(schema.timeBlockBlocks.itemId, filters.itemId));
    const rows = await this.db
      .select()
      .from(schema.timeBlockBlocks)
      .where(and(...conditions))
      .orderBy(asc(schema.timeBlockBlocks.startAt), asc(schema.timeBlockBlocks.sortOrder))
      .limit(Math.min(Math.max(filters.limit ?? 500, 1), 2000));
    return rows.map(timeBlockBlockFromRow);
  }

  async getUserIntegrationSetting(userId: UUID, integrationId: string): Promise<UserIntegrationSetting | undefined> {
    const resolvedUserId = await this.resolveUserId(userId);
    const row = await this.db.query.userIntegrationSettings.findFirst({
      where: and(
        eq(schema.userIntegrationSettings.userId, resolvedUserId),
        eq(schema.userIntegrationSettings.integrationId, integrationId)
      )
    });
    return row ? userIntegrationSettingFromRow(row) : undefined;
  }

  async listUserIntegrationSettings(userId: UUID): Promise<UserIntegrationSetting[]> {
    const resolvedUserId = await this.resolveUserId(userId);
    const rows = await this.db
      .select()
      .from(schema.userIntegrationSettings)
      .where(eq(schema.userIntegrationSettings.userId, resolvedUserId))
      .orderBy(asc(schema.userIntegrationSettings.integrationId));
    return rows.map(userIntegrationSettingFromRow);
  }

  async listUserIntegrationSettingsForIntegration(integrationId: string): Promise<UserIntegrationSetting[]> {
    const rows = await this.db
      .select()
      .from(schema.userIntegrationSettings)
      .where(eq(schema.userIntegrationSettings.integrationId, integrationId))
      .orderBy(asc(schema.userIntegrationSettings.userId));
    return rows.map(userIntegrationSettingFromRow);
  }

  async upsertUserIntegrationSetting(data: UserIntegrationSettingUpsertData): Promise<UserIntegrationSetting> {
    const userId = await this.resolveUserId(data.userId);
    const existing = await this.db.query.userIntegrationSettings.findFirst({
      where: and(
        eq(schema.userIntegrationSettings.userId, userId),
        eq(schema.userIntegrationSettings.integrationId, data.integrationId)
      )
    });
    const values: typeof schema.userIntegrationSettings.$inferInsert = {
      userId,
      integrationId: data.integrationId,
      enabled: data.enabled ?? existing?.enabled ?? true,
      metadata: data.metadata ?? existing?.metadata ?? {},
      updatedAt: new Date()
    };
    const [row] = await this.db
      .insert(schema.userIntegrationSettings)
      .values(values)
      .onConflictDoUpdate({
        target: [
          schema.userIntegrationSettings.userId,
          schema.userIntegrationSettings.integrationId
        ],
        set: {
          enabled: values.enabled,
          metadata: values.metadata,
          updatedAt: new Date()
        }
      })
      .returning();
    if (!row) throw new Error("Failed to upsert user integration setting");
    return userIntegrationSettingFromRow(row);
  }

  async listUserIntegrationSettingSummaries(): Promise<UserIntegrationSettingSummary[]> {
    const rows = await this.db
      .select({
        integrationId: schema.userIntegrationSettings.integrationId,
        enabled: schema.userIntegrationSettings.enabled,
        userCount: sql<number>`count(distinct ${schema.userIntegrationSettings.userId})`
      })
      .from(schema.userIntegrationSettings)
      .groupBy(schema.userIntegrationSettings.integrationId, schema.userIntegrationSettings.enabled)
      .orderBy(asc(schema.userIntegrationSettings.integrationId), desc(schema.userIntegrationSettings.enabled));
    return rows.map((row) => ({
      integrationId: row.integrationId,
      enabled: row.enabled,
      userCount: Number(row.userCount)
    }));
  }

  async upsertLotteryDrawSnapshot(data: LotteryDrawSnapshotUpsertData): Promise<LotteryDrawSnapshot> {
    const existing = await this.db.query.lotteryDrawSnapshots.findFirst({
      where: eq(schema.lotteryDrawSnapshots.gameId, data.gameId)
    });
    const values: typeof schema.lotteryDrawSnapshots.$inferInsert = {
      gameId: data.gameId,
      status: data.status,
      advertisedJackpotDollars:
        data.advertisedJackpotDollars ?? existing?.advertisedJackpotDollars ?? null,
      cashValueDollars: data.cashValueDollars ?? existing?.cashValueDollars ?? null,
      nextDrawAt: data.nextDrawAt ? new Date(data.nextDrawAt) : existing?.nextDrawAt ?? null,
      officialCutoffAt: data.officialCutoffAt
        ? new Date(data.officialCutoffAt)
        : existing?.officialCutoffAt ?? null,
      sourceUrl: data.sourceUrl,
      fetchedAt: data.fetchedAt ? new Date(data.fetchedAt) : existing?.fetchedAt ?? null,
      lastAttemptAt: new Date(data.lastAttemptAt),
      lastSuccessAt: data.lastSuccessAt
        ? new Date(data.lastSuccessAt)
        : existing?.lastSuccessAt ?? null,
      lastFailureAt: data.lastFailureAt
        ? new Date(data.lastFailureAt)
        : existing?.lastFailureAt ?? null,
      error: data.status === "ready" ? null : data.error ?? existing?.error ?? null,
      metadata: data.metadata ?? existing?.metadata ?? {},
      updatedAt: new Date()
    };
    const [row] = await this.db
      .insert(schema.lotteryDrawSnapshots)
      .values(values)
      .onConflictDoUpdate({
        target: schema.lotteryDrawSnapshots.gameId,
        set: {
          status: values.status,
          advertisedJackpotDollars: values.advertisedJackpotDollars,
          cashValueDollars: values.cashValueDollars,
          nextDrawAt: values.nextDrawAt,
          officialCutoffAt: values.officialCutoffAt,
          sourceUrl: values.sourceUrl,
          fetchedAt: values.fetchedAt,
          lastAttemptAt: values.lastAttemptAt,
          lastSuccessAt: values.lastSuccessAt,
          lastFailureAt: values.lastFailureAt,
          error: values.error,
          metadata: values.metadata,
          updatedAt: new Date()
        }
      })
      .returning();
    if (!row) throw new Error(`Failed to upsert lottery draw snapshot: ${data.gameId}`);
    return lotteryDrawSnapshotFromRow(row);
  }

  async getLotteryDrawSnapshot(gameId: LotteryGameId): Promise<LotteryDrawSnapshot | undefined> {
    const row = await this.db.query.lotteryDrawSnapshots.findFirst({
      where: eq(schema.lotteryDrawSnapshots.gameId, gameId)
    });
    return row ? lotteryDrawSnapshotFromRow(row) : undefined;
  }

  async listLotteryDrawSnapshots(): Promise<LotteryDrawSnapshot[]> {
    const rows = await this.db
      .select()
      .from(schema.lotteryDrawSnapshots)
      .orderBy(asc(schema.lotteryDrawSnapshots.gameId));
    return rows.map(lotteryDrawSnapshotFromRow);
  }

  async createLotteryTaskAlert(data: LotteryTaskAlertCreateData): Promise<{
    alert: LotteryTaskAlert;
    item: Item;
    created: boolean;
  }> {
    const userId = await this.resolveUserId(data.userId);
    return this.db.transaction(async (tx) => {
      const [insertedAlert] = await tx
        .insert(schema.lotteryTaskAlerts)
        .values({
          userId,
          gameId: data.gameId,
          drawAt: new Date(data.drawAt),
          status: "created",
          advertisedJackpotDollars: data.advertisedJackpotDollars,
          buyByAt: new Date(data.buyByAt),
          metadata: data.metadata ?? {}
        })
        .onConflictDoNothing({
          target: [
            schema.lotteryTaskAlerts.userId,
            schema.lotteryTaskAlerts.gameId,
            schema.lotteryTaskAlerts.drawAt
          ]
        })
        .returning();

      if (!insertedAlert) {
        const existing = await tx.query.lotteryTaskAlerts.findFirst({
          where: and(
            eq(schema.lotteryTaskAlerts.userId, userId),
            eq(schema.lotteryTaskAlerts.gameId, data.gameId),
            eq(schema.lotteryTaskAlerts.drawAt, new Date(data.drawAt))
          )
        });
        if (!existing?.itemId) throw new Error("Existing lottery alert is missing its item.");
        const item = await tx.query.items.findFirst({
          where: eq(schema.items.id, existing.itemId)
        });
        if (!item) throw new Error(`Lottery alert item not found: ${existing.itemId}`);
        return {
          alert: lotteryTaskAlertFromRow(existing),
          item: itemFromRow(item),
          created: false
        };
      }

      const [item] = await tx
        .insert(schema.items)
        .values({
          userId,
          kind: "task",
          title: data.item.title,
          body: data.item.body,
          status: "open",
          priority: data.item.priority,
          dueAt: new Date(data.buyByAt),
          starredAt: data.starredAt ? new Date(data.starredAt) : null,
          metadata: data.item.metadata
        })
        .returning();
      if (!item) throw new Error("Failed to create lottery task.");

      const [linkedAlert] = await tx
        .update(schema.lotteryTaskAlerts)
        .set({
          itemId: item.id,
          updatedAt: new Date()
        })
        .where(eq(schema.lotteryTaskAlerts.id, insertedAlert.id))
        .returning();
      if (!linkedAlert) throw new Error("Failed to link lottery task alert.");
      return {
        alert: lotteryTaskAlertFromRow(linkedAlert),
        item: itemFromRow(item),
        created: true
      };
    });
  }

  async updateLotteryTaskAlert(alertId: UUID, patch: LotteryTaskAlertPatch): Promise<LotteryTaskAlert> {
    const values: Partial<typeof schema.lotteryTaskAlerts.$inferInsert> = {
      updatedAt: new Date()
    };
    if (patch.status !== undefined) values.status = patch.status;
    if (patch.itemId !== undefined) values.itemId = patch.itemId;
    if (patch.advertisedJackpotDollars !== undefined) {
      values.advertisedJackpotDollars = patch.advertisedJackpotDollars;
    }
    if (patch.buyByAt !== undefined) values.buyByAt = new Date(patch.buyByAt);
    if (patch.metadata !== undefined) values.metadata = patch.metadata;
    const [row] = await this.db
      .update(schema.lotteryTaskAlerts)
      .set(values)
      .where(eq(schema.lotteryTaskAlerts.id, alertId))
      .returning();
    if (!row) throw new Error(`Lottery alert not found: ${alertId}`);
    return lotteryTaskAlertFromRow(row);
  }

  async listLotteryTaskAlerts(filters: {
    userId: UUID;
    gameId?: LotteryGameId;
    drawAt?: string;
    statuses?: LotteryTaskAlert["status"][];
    limit?: number;
  }): Promise<LotteryTaskAlert[]> {
    const userId = await this.resolveUserId(filters.userId);
    const conditions = [eq(schema.lotteryTaskAlerts.userId, userId)];
    if (filters.gameId !== undefined) {
      conditions.push(eq(schema.lotteryTaskAlerts.gameId, filters.gameId));
    }
    if (filters.drawAt !== undefined) {
      conditions.push(eq(schema.lotteryTaskAlerts.drawAt, new Date(filters.drawAt)));
    }
    if (filters.statuses !== undefined) {
      conditions.push(inArray(schema.lotteryTaskAlerts.status, filters.statuses));
    }
    const rows = await this.db
      .select()
      .from(schema.lotteryTaskAlerts)
      .where(and(...conditions))
      .orderBy(desc(schema.lotteryTaskAlerts.drawAt))
      .limit(Math.min(Math.max(filters.limit ?? 100, 1), 500));
    return rows.map(lotteryTaskAlertFromRow);
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
      triageDecisionId: data.triageDecisionId ?? existing?.triageDecisionId ?? null,
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

  async createEmailScanRun(data: EmailScanRunCreateData): Promise<EmailScanRun> {
    const userId = await this.resolveUserId(data.userId);
    const values: typeof schema.emailScanRuns.$inferInsert = {
      userId,
      trigger: data.trigger,
      status: data.status,
      classifierVersion: data.classifierVersion,
      startedAt: new Date(data.startedAt),
      leaseExpiresAt: new Date(data.leaseExpiresAt),
      counts: data.counts,
      errors: data.errors,
      metadata: data.metadata
    };
    if (data.completedAt !== undefined) values.completedAt = new Date(data.completedAt);
    const [row] = await this.db.insert(schema.emailScanRuns).values(values).returning();
    if (!row) throw new Error("Failed to create email scan run");
    return emailScanRunFromRow(row);
  }

  async updateEmailScanRun(runId: UUID, patch: EmailScanRunPatch): Promise<EmailScanRun> {
    const values: Partial<typeof schema.emailScanRuns.$inferInsert> = { updatedAt: new Date() };
    if (patch.status !== undefined) values.status = patch.status;
    if (patch.completedAt !== undefined) values.completedAt = new Date(patch.completedAt);
    if (patch.leaseExpiresAt !== undefined) values.leaseExpiresAt = new Date(patch.leaseExpiresAt);
    if (patch.counts !== undefined) values.counts = patch.counts;
    if (patch.errors !== undefined) values.errors = patch.errors;
    if (patch.metadata !== undefined) values.metadata = patch.metadata;
    const [row] = await this.db.update(schema.emailScanRuns).set(values)
      .where(eq(schema.emailScanRuns.id, runId)).returning();
    if (!row) throw new Error(`Email scan run not found: ${runId}`);
    return emailScanRunFromRow(row);
  }

  async listEmailScanRuns(filters: { userId: UUID; limit?: number }): Promise<EmailScanRun[]> {
    const userId = await this.resolveUserId(filters.userId);
    const rows = await this.db.select().from(schema.emailScanRuns)
      .where(eq(schema.emailScanRuns.userId, userId))
      .orderBy(desc(schema.emailScanRuns.startedAt))
      .limit(Math.min(Math.max(filters.limit ?? 20, 1), 100));
    return rows.map(emailScanRunFromRow);
  }

  async upsertEmailTriageDecision(data: EmailTriageDecisionUpsertData): Promise<EmailTriageDecision> {
    const userId = await this.resolveUserId(data.userId);
    const values: typeof schema.emailTriageDecisions.$inferInsert = {
      userId,
      sourceId: data.sourceId,
      providerAccountId: data.providerAccountId,
      gmailMessageId: data.gmailMessageId,
      gmailThreadId: data.gmailThreadId,
      contentFingerprint: data.contentFingerprint,
      classifierVersion: data.classifierVersion,
      outcome: data.outcome,
      reasonCode: data.reasonCode ?? null,
      reason: data.reason ?? null,
      confidence: data.confidence ?? null,
      senderAddress: data.senderAddress ?? null,
      retryCount: data.retryCount,
      nextRetryAt: toDate(data.nextRetryAt) ?? null,
      evaluatedAt: toDate(data.evaluatedAt),
      metadata: data.metadata,
      updatedAt: new Date()
    };
    const [row] = await this.db.insert(schema.emailTriageDecisions).values(values)
      .onConflictDoUpdate({
        target: [
          schema.emailTriageDecisions.providerAccountId,
          schema.emailTriageDecisions.gmailMessageId,
          schema.emailTriageDecisions.contentFingerprint,
          schema.emailTriageDecisions.classifierVersion
        ],
        set: {
          sourceId: values.sourceId,
          outcome: values.outcome,
          reasonCode: values.reasonCode,
          reason: values.reason,
          confidence: values.confidence,
          senderAddress: values.senderAddress,
          retryCount: values.retryCount,
          nextRetryAt: values.nextRetryAt,
          evaluatedAt: values.evaluatedAt,
          metadata: values.metadata,
          updatedAt: new Date()
        }
      }).returning();
    if (!row) throw new Error("Failed to upsert email triage decision");
    return emailTriageDecisionFromRow(row);
  }

  async updateEmailTriageDecision(decisionId: UUID, patch: EmailTriageDecisionPatch): Promise<EmailTriageDecision> {
    const values: Partial<typeof schema.emailTriageDecisions.$inferInsert> = { updatedAt: new Date() };
    if (patch.outcome !== undefined) values.outcome = patch.outcome;
    if (patch.reasonCode !== undefined) values.reasonCode = patch.reasonCode;
    if (patch.reason !== undefined) values.reason = patch.reason;
    if (patch.confidence !== undefined) values.confidence = patch.confidence;
    if (patch.retryCount !== undefined) values.retryCount = patch.retryCount;
    if (patch.nextRetryAt !== undefined) values.nextRetryAt = toDate(patch.nextRetryAt);
    if (patch.evaluatedAt !== undefined) values.evaluatedAt = toDate(patch.evaluatedAt);
    if (patch.metadata !== undefined) values.metadata = patch.metadata;
    if (patch.deletedAt !== undefined) values.deletedAt = toDate(patch.deletedAt);
    const [row] = await this.db.update(schema.emailTriageDecisions).set(values)
      .where(eq(schema.emailTriageDecisions.id, decisionId)).returning();
    if (!row) throw new Error(`Email triage decision not found: ${decisionId}`);
    return emailTriageDecisionFromRow(row);
  }

  async getEmailTriageDecision(decisionId: UUID): Promise<EmailTriageDecision | undefined> {
    const row = await this.db.query.emailTriageDecisions.findFirst({
      where: eq(schema.emailTriageDecisions.id, decisionId)
    });
    return row ? emailTriageDecisionFromRow(row) : undefined;
  }

  async listEmailTriageDecisions(filters: EmailTriageDecisionListFilters): Promise<EmailTriageDecision[]> {
    const userId = await this.resolveUserId(filters.userId);
    const conditions = [
      eq(schema.emailTriageDecisions.userId, userId),
      isNull(schema.emailTriageDecisions.deletedAt)
    ];
    if (filters.providerAccountId !== undefined) {
      conditions.push(eq(schema.emailTriageDecisions.providerAccountId, filters.providerAccountId));
    }
    if (filters.outcome !== undefined) conditions.push(eq(schema.emailTriageDecisions.outcome, filters.outcome));
    if (filters.gmailThreadId !== undefined) {
      conditions.push(eq(schema.emailTriageDecisions.gmailThreadId, filters.gmailThreadId));
    }
    const rows = await this.db.select().from(schema.emailTriageDecisions)
      .where(and(...conditions)).orderBy(desc(schema.emailTriageDecisions.evaluatedAt))
      .limit(Math.min(Math.max(filters.limit ?? 50, 1), 200));
    return rows.map(emailTriageDecisionFromRow);
  }

  async upsertEmailSenderPreference(data: EmailSenderPreferenceUpsertData): Promise<EmailSenderPreference> {
    const userId = await this.resolveUserId(data.userId);
    const existing = await this.db.query.emailSenderPreferences.findFirst({
      where: and(
        eq(schema.emailSenderPreferences.userId, userId),
        eq(schema.emailSenderPreferences.matchType, data.matchType),
        eq(schema.emailSenderPreferences.value, data.value),
        isNull(schema.emailSenderPreferences.deletedAt)
      )
    });
    if (existing) {
      const [row] = await this.db.update(schema.emailSenderPreferences).set({
        disposition: data.disposition,
        originatingProposalId: data.originatingProposalId ?? existing.originatingProposalId,
        metadata: data.metadata ?? existing.metadata,
        updatedAt: new Date()
      }).where(eq(schema.emailSenderPreferences.id, existing.id)).returning();
      if (!row) throw new Error(`Email sender preference not found: ${existing.id}`);
      return emailSenderPreferenceFromRow(row);
    }
    const [row] = await this.db.insert(schema.emailSenderPreferences).values({
      userId,
      matchType: data.matchType,
      value: data.value,
      disposition: data.disposition,
      originatingProposalId: data.originatingProposalId ?? null,
      metadata: data.metadata ?? {}
    }).returning();
    if (!row) throw new Error("Failed to create email sender preference");
    return emailSenderPreferenceFromRow(row);
  }

  async updateEmailSenderPreference(
    preferenceId: UUID,
    patch: EmailSenderPreferencePatch
  ): Promise<EmailSenderPreference> {
    const values: Partial<typeof schema.emailSenderPreferences.$inferInsert> = { updatedAt: new Date() };
    if (patch.disposition !== undefined) values.disposition = patch.disposition;
    if (patch.metadata !== undefined) values.metadata = patch.metadata;
    if (patch.deletedAt !== undefined) values.deletedAt = toDate(patch.deletedAt);
    const [row] = await this.db.update(schema.emailSenderPreferences).set(values)
      .where(eq(schema.emailSenderPreferences.id, preferenceId)).returning();
    if (!row) throw new Error(`Email sender preference not found: ${preferenceId}`);
    return emailSenderPreferenceFromRow(row);
  }

  async getEmailSenderPreference(preferenceId: UUID): Promise<EmailSenderPreference | undefined> {
    const row = await this.db.query.emailSenderPreferences.findFirst({
      where: eq(schema.emailSenderPreferences.id, preferenceId)
    });
    return row ? emailSenderPreferenceFromRow(row) : undefined;
  }

  async listEmailSenderPreferences(userId: UUID): Promise<EmailSenderPreference[]> {
    const resolvedUserId = await this.resolveUserId(userId);
    const rows = await this.db.select().from(schema.emailSenderPreferences)
      .where(and(
        eq(schema.emailSenderPreferences.userId, resolvedUserId),
        isNull(schema.emailSenderPreferences.deletedAt)
      )).orderBy(asc(schema.emailSenderPreferences.matchType), asc(schema.emailSenderPreferences.value));
    return rows.map(emailSenderPreferenceFromRow);
  }

  async createOpportunity(data: OpportunityCreateData): Promise<Opportunity> {
    const userId = await this.resolveUserId(data.userId);
    const values: typeof schema.opportunities.$inferInsert = {
      userId,
      title: data.title,
      status: data.status ?? "tracking",
      fit: data.fit ?? "unknown",
      metadata: data.metadata ?? {}
    };
    if (data.areaId !== undefined) values.areaId = data.areaId;
    if (data.projectId !== undefined) values.projectId = data.projectId;
    if (data.dueAt !== undefined) values.dueAt = toDate(data.dueAt);
    if (data.decisionBy !== undefined) values.decisionBy = toDate(data.decisionBy);
    if (data.valueEstimate !== undefined) values.valueEstimate = data.valueEstimate;
    if (data.nextActionItemId !== undefined) values.nextActionItemId = data.nextActionItemId;
    if (data.summary !== undefined) values.summary = data.summary;
    const [row] = await this.db.insert(schema.opportunities).values(values).returning();
    if (!row) throw new Error("Failed to create opportunity");
    return opportunityFromRow(row);
  }

  async updateOpportunity(opportunityId: UUID, patch: OpportunityPatch): Promise<Opportunity> {
    const values: Partial<typeof schema.opportunities.$inferInsert> = {
      updatedAt: new Date()
    };
    if (patch.areaId !== undefined) values.areaId = patch.areaId;
    if (patch.projectId !== undefined) values.projectId = patch.projectId;
    if (patch.title !== undefined) values.title = patch.title;
    if (patch.status !== undefined) values.status = patch.status;
    if (patch.fit !== undefined) values.fit = patch.fit;
    if (patch.dueAt !== undefined) values.dueAt = patch.dueAt === null ? null : toDate(patch.dueAt);
    if (patch.decisionBy !== undefined) {
      values.decisionBy = patch.decisionBy === null ? null : toDate(patch.decisionBy);
    }
    if (patch.valueEstimate !== undefined) values.valueEstimate = patch.valueEstimate;
    if (patch.nextActionItemId !== undefined) values.nextActionItemId = patch.nextActionItemId;
    if (patch.summary !== undefined) values.summary = patch.summary;
    if (patch.metadata !== undefined) values.metadata = patch.metadata;
    const [row] = await this.db
      .update(schema.opportunities)
      .set(values)
      .where(eq(schema.opportunities.id, opportunityId))
      .returning();
    if (!row) throw new Error(`Opportunity not found: ${opportunityId}`);
    return opportunityFromRow(row);
  }

  async getOpportunity(opportunityId: UUID): Promise<Opportunity | undefined> {
    const row = await this.db.query.opportunities.findFirst({
      where: eq(schema.opportunities.id, opportunityId)
    });
    return row ? opportunityFromRow(row) : undefined;
  }

  async upsertOpportunityProposal(data: OpportunityProposalUpsertData): Promise<OpportunityProposal> {
    const userId = await this.resolveUserId(data.userId);
    const existing = await this.db.query.opportunityProposals.findFirst({
      where: and(
        eq(schema.opportunityProposals.idempotencyKey, data.idempotencyKey),
        isNull(schema.opportunityProposals.deletedAt)
      )
    });
    const values: typeof schema.opportunityProposals.$inferInsert = {
      userId,
      sourceId: data.sourceId,
      idempotencyKey: data.idempotencyKey,
      status: data.status ?? existing?.status ?? "proposed",
      projectSlug: data.projectSlug,
      title: data.title,
      summary: data.summary ?? existing?.summary ?? null,
      rating: data.rating ?? existing?.rating ?? null,
      fit: data.fit ?? existing?.fit ?? "unknown",
      priority: data.priority ?? existing?.priority ?? "normal",
      dueAt: data.dueAt !== undefined ? toDate(data.dueAt) : existing?.dueAt ?? null,
      decisionBy: data.decisionBy !== undefined ? toDate(data.decisionBy) : existing?.decisionBy ?? null,
      valueEstimate: data.valueEstimate ?? existing?.valueEstimate ?? null,
      recommendedAction: data.recommendedAction ?? existing?.recommendedAction ?? null,
      rationale: data.rationale ?? existing?.rationale ?? null,
      acceptedOpportunityId: data.acceptedOpportunityId ?? existing?.acceptedOpportunityId ?? null,
      acceptedItemId: data.acceptedItemId ?? existing?.acceptedItemId ?? null,
      acceptedAt: data.acceptedAt !== undefined ? toDate(data.acceptedAt) : existing?.acceptedAt ?? null,
      rejectedAt: data.rejectedAt !== undefined ? toDate(data.rejectedAt) : existing?.rejectedAt ?? null,
      metadata: data.metadata ?? existing?.metadata ?? {},
      updatedAt: new Date()
    };

    if (existing) {
      const [row] = await this.db
        .update(schema.opportunityProposals)
        .set(values)
        .where(eq(schema.opportunityProposals.id, existing.id))
        .returning();
      if (!row) throw new Error(`Opportunity proposal not found: ${existing.id}`);
      return opportunityProposalFromRow(row);
    }

    const [row] = await this.db.insert(schema.opportunityProposals).values(values).returning();
    if (!row) throw new Error("Failed to upsert opportunity proposal");
    return opportunityProposalFromRow(row);
  }

  async listOpportunityProposals(filters: OpportunityProposalListFilters): Promise<OpportunityProposal[]> {
    const resolvedUserId = await this.resolveUserId(filters.userId);
    const conditions = [
      eq(schema.opportunityProposals.userId, resolvedUserId),
      isNull(schema.opportunityProposals.deletedAt)
    ];
    if (filters.status !== undefined) {
      conditions.push(eq(schema.opportunityProposals.status, filters.status));
    }
    if (filters.projectSlug !== undefined) {
      conditions.push(eq(schema.opportunityProposals.projectSlug, filters.projectSlug));
    }
    const rows = await this.db
      .select()
      .from(schema.opportunityProposals)
      .where(and(...conditions))
      .orderBy(desc(schema.opportunityProposals.createdAt))
      .limit(Math.min(Math.max(filters.limit ?? 50, 1), 200));
    return rows.map(opportunityProposalFromRow);
  }

  async getOpportunityProposal(proposalId: UUID): Promise<OpportunityProposal | undefined> {
    const row = await this.db.query.opportunityProposals.findFirst({
      where: eq(schema.opportunityProposals.id, proposalId)
    });
    return row ? opportunityProposalFromRow(row) : undefined;
  }

  async updateOpportunityProposal(proposalId: UUID, patch: OpportunityProposalPatch): Promise<OpportunityProposal> {
    const values: Partial<typeof schema.opportunityProposals.$inferInsert> = {
      updatedAt: new Date()
    };
    if (patch.status !== undefined) values.status = patch.status;
    if (patch.projectSlug !== undefined) values.projectSlug = patch.projectSlug;
    if (patch.title !== undefined) values.title = patch.title;
    if (patch.summary !== undefined) values.summary = patch.summary;
    if (patch.rating !== undefined) values.rating = patch.rating;
    if (patch.fit !== undefined) values.fit = patch.fit;
    if (patch.priority !== undefined) values.priority = patch.priority;
    if (patch.dueAt !== undefined) values.dueAt = patch.dueAt === null ? null : toDate(patch.dueAt);
    if (patch.decisionBy !== undefined) {
      values.decisionBy = patch.decisionBy === null ? null : toDate(patch.decisionBy);
    }
    if (patch.valueEstimate !== undefined) values.valueEstimate = patch.valueEstimate;
    if (patch.recommendedAction !== undefined) values.recommendedAction = patch.recommendedAction;
    if (patch.rationale !== undefined) values.rationale = patch.rationale;
    if (patch.acceptedOpportunityId !== undefined) values.acceptedOpportunityId = patch.acceptedOpportunityId;
    if (patch.acceptedItemId !== undefined) values.acceptedItemId = patch.acceptedItemId;
    if (patch.acceptedAt !== undefined) {
      values.acceptedAt = patch.acceptedAt === null ? null : toDate(patch.acceptedAt);
    }
    if (patch.rejectedAt !== undefined) {
      values.rejectedAt = patch.rejectedAt === null ? null : toDate(patch.rejectedAt);
    }
    if (patch.metadata !== undefined) values.metadata = patch.metadata;
    const [row] = await this.db
      .update(schema.opportunityProposals)
      .set(values)
      .where(eq(schema.opportunityProposals.id, proposalId))
      .returning();
    if (!row) throw new Error(`Opportunity proposal not found: ${proposalId}`);
    return opportunityProposalFromRow(row);
  }

  async getDefaultShoppingList(userId: UUID): Promise<ShoppingList> {
    const resolvedUserId = await this.resolveUserId(userId);
    const existing = await this.db.query.shoppingLists.findFirst({
      where: and(
        eq(schema.shoppingLists.userId, resolvedUserId),
        eq(schema.shoppingLists.name, "Shopping"),
        isNull(schema.shoppingLists.deletedAt)
      )
    });
    if (existing) return shoppingListFromRow(existing);

    const [row] = await this.db
      .insert(schema.shoppingLists)
      .values({
        userId: resolvedUserId,
        name: "Shopping",
        metadata: {}
      })
      .returning();
    if (!row) throw new Error("Failed to create shopping list");
    return shoppingListFromRow(row);
  }

  async createShoppingItem(data: ShoppingItemCreateData): Promise<ShoppingListItem> {
    const userId = await this.resolveUserId(data.userId);
    const values: typeof schema.shoppingListItems.$inferInsert = {
      userId,
      listId: data.listId,
      name: data.name,
      normalizedName: data.normalizedName,
      category: data.category ?? "miscellaneous",
      source: data.source ?? "manual",
      sortOrder: data.sortOrder ?? 0,
      metadata: data.metadata ?? {}
    };
    if (isUuid(data.catalogItemId)) values.catalogItemId = data.catalogItemId;
    if (data.quantity !== undefined) values.quantity = data.quantity;
    if (data.note !== undefined) values.note = data.note;
    if (data.checkedAt !== undefined) values.checkedAt = toDate(data.checkedAt);
    const [row] = await this.db.insert(schema.shoppingListItems).values(values).returning();
    if (!row) throw new Error("Failed to create shopping item");
    return shoppingListItemFromRow(row);
  }

  async updateShoppingItem(itemId: UUID, patch: ShoppingItemPatch): Promise<ShoppingListItem> {
    const values: Partial<typeof schema.shoppingListItems.$inferInsert> = {
      updatedAt: new Date()
    };
    if (patch.name !== undefined) values.name = patch.name;
    if (patch.normalizedName !== undefined) values.normalizedName = patch.normalizedName;
    if (patch.category !== undefined) values.category = patch.category;
    if (patch.quantity !== undefined) values.quantity = patch.quantity;
    if (patch.note !== undefined) values.note = patch.note;
    if (patch.source !== undefined) values.source = patch.source;
    if (patch.sortOrder !== undefined) values.sortOrder = patch.sortOrder;
    if (patch.metadata !== undefined) values.metadata = patch.metadata;
    if (patch.catalogItemId !== undefined) values.catalogItemId = patch.catalogItemId;
    if (patch.checkedAt !== undefined) {
      values.checkedAt = patch.checkedAt === null ? null : toDate(patch.checkedAt);
    }
    if (patch.deletedAt !== undefined) {
      values.deletedAt = patch.deletedAt === null ? null : toDate(patch.deletedAt);
    }
    const [row] = await this.db
      .update(schema.shoppingListItems)
      .set(values)
      .where(eq(schema.shoppingListItems.id, itemId))
      .returning();
    if (!row) throw new Error(`Shopping item not found: ${itemId}`);
    return shoppingListItemFromRow(row);
  }

  async listShoppingItems(filters: ShoppingItemListFilters): Promise<ShoppingListItem[]> {
    const resolvedUserId = await this.resolveUserId(filters.userId);
    const conditions = [
      eq(schema.shoppingListItems.userId, resolvedUserId),
      isNull(schema.shoppingListItems.deletedAt)
    ];
    if (filters.listId !== undefined) {
      conditions.push(eq(schema.shoppingListItems.listId, filters.listId));
    }
    if (filters.checkedAfter !== undefined && filters.includeActive !== false) {
      conditions.push(
        or(
          isNull(schema.shoppingListItems.checkedAt),
          sql`${schema.shoppingListItems.checkedAt} >= ${toDate(filters.checkedAfter)}`
        )!
      );
    } else if (filters.checkedAfter !== undefined) {
      conditions.push(sql`${schema.shoppingListItems.checkedAt} >= ${toDate(filters.checkedAfter)}`);
    } else if (filters.includeActive === false) {
      conditions.push(sql`${schema.shoppingListItems.checkedAt} is not null`);
    }

    const rows = await this.db
      .select()
      .from(schema.shoppingListItems)
      .where(and(...conditions))
      .orderBy(
        sql`case when ${schema.shoppingListItems.checkedAt} is null then 0 else 1 end`,
        asc(schema.shoppingListItems.category),
        asc(schema.shoppingListItems.sortOrder),
        asc(schema.shoppingListItems.createdAt)
      )
      .limit(Math.min(Math.max(filters.limit ?? 100, 1), 200));

    return rows.map(shoppingListItemFromRow);
  }

  async getShoppingItem(itemId: UUID): Promise<ShoppingListItem | undefined> {
    const row = await this.db.query.shoppingListItems.findFirst({
      where: eq(schema.shoppingListItems.id, itemId)
    });
    return row ? shoppingListItemFromRow(row) : undefined;
  }

  async upsertShoppingCatalogItem(data: ShoppingCatalogUpsertData): Promise<ShoppingCatalogItem> {
    const userId = await this.resolveUserId(data.userId);
    const existing = await this.db.query.shoppingCatalogItems.findFirst({
      where: and(
        eq(schema.shoppingCatalogItems.userId, userId),
        eq(schema.shoppingCatalogItems.normalizedName, data.normalizedName),
        isNull(schema.shoppingCatalogItems.deletedAt)
      )
    });
    const values: typeof schema.shoppingCatalogItems.$inferInsert = {
      userId,
      name: data.name,
      normalizedName: data.normalizedName,
      defaultCategory: data.defaultCategory ?? existing?.defaultCategory ?? "miscellaneous",
      purchaseCount: data.purchaseCount ?? existing?.purchaseCount ?? 0,
      metadata: data.metadata ?? existing?.metadata ?? {},
      updatedAt: new Date()
    };
    if (data.lastPurchasedAt !== undefined) values.lastPurchasedAt = toDate(data.lastPurchasedAt);
    if (existing) {
      const [row] = await this.db
        .update(schema.shoppingCatalogItems)
        .set(values)
        .where(eq(schema.shoppingCatalogItems.id, existing.id))
        .returning();
      if (!row) throw new Error(`Shopping catalog item not found: ${existing.id}`);
      return shoppingCatalogItemFromRow(row);
    }
    const [row] = await this.db.insert(schema.shoppingCatalogItems).values(values).returning();
    if (!row) throw new Error("Failed to create shopping catalog item");
    return shoppingCatalogItemFromRow(row);
  }

  async listShoppingCatalogItems(filters: ShoppingCatalogListFilters): Promise<ShoppingCatalogItem[]> {
    const resolvedUserId = await this.resolveUserId(filters.userId);
    const rows = await this.db
      .select()
      .from(schema.shoppingCatalogItems)
      .where(
        and(
          eq(schema.shoppingCatalogItems.userId, resolvedUserId),
          isNull(schema.shoppingCatalogItems.deletedAt)
        )
      )
      .orderBy(desc(schema.shoppingCatalogItems.lastPurchasedAt), desc(schema.shoppingCatalogItems.purchaseCount))
      .limit(Math.min(Math.max(filters.limit ?? 50, 1), 100));
    return rows.map(shoppingCatalogItemFromRow);
  }

  async createVocabularyEntry(data: VocabularyEntryCreateData): Promise<VocabularyEntry> {
    const userId = await this.resolveUserId(data.userId);
    const values: typeof schema.vocabularyEntries.$inferInsert = {
      userId,
      term: data.term,
      normalizedTerm: data.normalizedTerm,
      languageCode: data.languageCode ?? "en",
      category: data.category ?? "general",
      tags: data.tags ?? [],
      definitionSource: data.definitionSource ?? "manual",
      status: data.status ?? "active",
      metadata: data.metadata ?? {}
    };
    if (data.definition !== undefined) values.definition = data.definition;
    if (data.partOfSpeech !== undefined) values.partOfSpeech = data.partOfSpeech;
    if (data.pronunciation !== undefined) values.pronunciation = data.pronunciation;
    if (data.translation !== undefined) values.translation = data.translation;
    if (data.notes !== undefined) values.notes = data.notes;
    const [row] = await this.db.insert(schema.vocabularyEntries).values(values).returning();
    if (!row) throw new Error("Failed to create vocabulary entry");
    return vocabularyEntryFromRow(row);
  }

  async updateVocabularyEntry(entryId: UUID, patch: VocabularyEntryPatch): Promise<VocabularyEntry> {
    const values: Partial<typeof schema.vocabularyEntries.$inferInsert> = {
      updatedAt: new Date()
    };
    if (patch.term !== undefined) values.term = patch.term;
    if (patch.normalizedTerm !== undefined) values.normalizedTerm = patch.normalizedTerm;
    if (patch.languageCode !== undefined) values.languageCode = patch.languageCode;
    if (patch.category !== undefined) values.category = patch.category;
    if (patch.definition !== undefined) values.definition = patch.definition;
    if (patch.partOfSpeech !== undefined) values.partOfSpeech = patch.partOfSpeech;
    if (patch.pronunciation !== undefined) values.pronunciation = patch.pronunciation;
    if (patch.translation !== undefined) values.translation = patch.translation;
    if (patch.notes !== undefined) values.notes = patch.notes;
    if (patch.tags !== undefined) values.tags = patch.tags;
    if (patch.definitionSource !== undefined) values.definitionSource = patch.definitionSource;
    if (patch.status !== undefined) values.status = patch.status;
    if (patch.metadata !== undefined) values.metadata = patch.metadata;
    if (patch.deletedAt !== undefined) {
      values.deletedAt = patch.deletedAt === null ? null : toDate(patch.deletedAt);
    }
    const [row] = await this.db
      .update(schema.vocabularyEntries)
      .set(values)
      .where(eq(schema.vocabularyEntries.id, entryId))
      .returning();
    if (!row) throw new Error(`Vocabulary entry not found: ${entryId}`);
    return vocabularyEntryFromRow(row);
  }

  async listVocabularyEntries(filters: VocabularyEntryListFilters): Promise<VocabularyEntry[]> {
    const resolvedUserId = await this.resolveUserId(filters.userId);
    const conditions = [
      eq(schema.vocabularyEntries.userId, resolvedUserId),
      isNull(schema.vocabularyEntries.deletedAt)
    ];
    if (filters.status !== undefined) {
      conditions.push(eq(schema.vocabularyEntries.status, filters.status));
    }
    if (filters.category !== undefined) {
      conditions.push(eq(schema.vocabularyEntries.category, filters.category));
    }
    if (filters.languageCode !== undefined) {
      conditions.push(eq(schema.vocabularyEntries.languageCode, filters.languageCode));
    }
    if (filters.query !== undefined && filters.query.trim().length > 0) {
      const pattern = `%${filters.query.trim()}%`;
      conditions.push(
        or(
          ilike(schema.vocabularyEntries.term, pattern),
          ilike(schema.vocabularyEntries.definition, pattern),
          ilike(schema.vocabularyEntries.translation, pattern),
          ilike(schema.vocabularyEntries.notes, pattern),
          sql`${schema.vocabularyEntries.tags}::text ilike ${pattern}`
        )!
      );
    }
    if (filters.tag !== undefined && filters.tag.trim().length > 0) {
      const tag = filters.tag.trim().toLowerCase();
      conditions.push(sql`exists (
        select 1
        from jsonb_array_elements_text(${schema.vocabularyEntries.tags}) as tag_value(value)
        where lower(tag_value.value) = ${tag}
      )`);
    }

    const rows = await this.db
      .select()
      .from(schema.vocabularyEntries)
      .where(and(...conditions))
      .orderBy(desc(schema.vocabularyEntries.updatedAt))
      .limit(Math.min(Math.max(filters.limit ?? 50, 1), 100));
    return rows.map(vocabularyEntryFromRow);
  }

  async getVocabularyEntry(entryId: UUID): Promise<VocabularyEntry | undefined> {
    const row = await this.db.query.vocabularyEntries.findFirst({
      where: eq(schema.vocabularyEntries.id, entryId)
    });
    return row ? vocabularyEntryFromRow(row) : undefined;
  }

  async findVocabularyEntry(
    userId: UUID,
    languageCode: string,
    normalizedTerm: string
  ): Promise<VocabularyEntry | undefined> {
    const resolvedUserId = await this.resolveUserId(userId);
    const row = await this.db.query.vocabularyEntries.findFirst({
      where: and(
        eq(schema.vocabularyEntries.userId, resolvedUserId),
        eq(schema.vocabularyEntries.languageCode, languageCode),
        eq(schema.vocabularyEntries.normalizedTerm, normalizedTerm),
        isNull(schema.vocabularyEntries.deletedAt)
      )
    });
    return row ? vocabularyEntryFromRow(row) : undefined;
  }

  async addVocabularyEncounter(data: VocabularyEncounterCreateData): Promise<VocabularyEncounter> {
    const userId = await this.resolveUserId(data.userId);
    const values: typeof schema.vocabularyEncounters.$inferInsert = {
      userId,
      entryId: data.entryId,
      occurredAt: toDate(data.occurredAt) ?? new Date(),
      metadata: data.metadata ?? {}
    };
    if (data.sourceType !== undefined) values.sourceType = data.sourceType;
    if (data.sourceTitle !== undefined) values.sourceTitle = data.sourceTitle;
    if (data.sourceUrl !== undefined) values.sourceUrl = data.sourceUrl;
    if (data.context !== undefined) values.context = data.context;
    const [row] = await this.db.insert(schema.vocabularyEncounters).values(values).returning();
    if (!row) throw new Error("Failed to create vocabulary encounter");
    return vocabularyEncounterFromRow(row);
  }

  async listVocabularyEncounters(filters: { userId: UUID; entryId?: UUID; limit?: number }): Promise<VocabularyEncounter[]> {
    const resolvedUserId = await this.resolveUserId(filters.userId);
    const conditions = [eq(schema.vocabularyEncounters.userId, resolvedUserId)];
    if (filters.entryId !== undefined) {
      conditions.push(eq(schema.vocabularyEncounters.entryId, filters.entryId));
    }
    const rows = await this.db
      .select()
      .from(schema.vocabularyEncounters)
      .where(and(...conditions))
      .orderBy(desc(schema.vocabularyEncounters.occurredAt))
      .limit(Math.min(Math.max(filters.limit ?? 100, 1), 200));
    return rows.map(vocabularyEncounterFromRow);
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
    const [opportunityCount] = await this.db
      .select({ value: count() })
      .from(schema.opportunities);
    const [opportunityProposalCount] = await this.db
      .select({ value: count() })
      .from(schema.opportunityProposals);
    const [vocabularyEntryCount] = await this.db
      .select({ value: count() })
      .from(schema.vocabularyEntries);
    const [vocabularyEncounterCount] = await this.db
      .select({ value: count() })
      .from(schema.vocabularyEncounters);

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
      emailActionProposalCount: emailActionProposalCount?.value ?? 0,
      opportunityCount: opportunityCount?.value ?? 0,
      opportunityProposalCount: opportunityProposalCount?.value ?? 0,
      vocabularyEntryCount: vocabularyEntryCount?.value ?? 0,
      vocabularyEncounterCount: vocabularyEncounterCount?.value ?? 0
    };
  }
}
