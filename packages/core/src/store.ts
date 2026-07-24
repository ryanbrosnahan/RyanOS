import type { JsonObject, UUID } from "@ryanos/shared";
import type {
  AuditLog,
  Area,
  DailyPlan,
  EmailActionProposal,
  EmailScanRun,
  EmailSenderPreference,
  EmailTriageDecision,
  ExternalSource,
  GoogleCalendar,
  GoogleCalendarEvent,
  Item,
  ItemChecklistItem,
  ItemEvent,
  ItemProgressNote,
  LotteryDrawSnapshot,
  LotteryGameId,
  LotteryTaskAlert,
  Opportunity,
  OpportunityProposal,
  Policy,
  ProviderAccount,
  Project,
  RecurrenceEvent,
  RecurrencePolicy,
  RecurrenceState,
  ShoppingCatalogItem,
  ShoppingList,
  ShoppingListItem,
  SourceLink,
  TimeBlockBlock,
  TimeBlockPlan,
  UserIntegrationSetting,
  VocabularyEncounter,
  VocabularyEntry
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
  starredAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  deletedAt?: string | null;
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
  offset?: number;
};

export type ItemProgressNoteCreateData = {
  userId: UUID;
  itemId: UUID;
  body: string;
  occurredAt?: string;
  metadata?: JsonObject;
};

export type ItemProgressNotePatch = Partial<Pick<ItemProgressNote, "body" | "metadata">> & {
  occurredAt?: string;
  deletedAt?: string | null;
};

export type ItemChecklistItemCreateData = {
  userId: UUID;
  itemId: UUID;
  title: string;
  checkedAt?: string;
  sortOrder?: number;
  metadata?: JsonObject;
};

export type ItemChecklistItemPatch = Partial<Pick<ItemChecklistItem, "title" | "sortOrder" | "metadata">> & {
  checkedAt?: string | null;
  deletedAt?: string | null;
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

export type ProviderAccountSummary = {
  provider: string;
  status: string;
  accountCount: number;
  userCount: number;
};

export type GoogleCalendarUpsertData = {
  userId: UUID;
  providerAccountId: UUID;
  externalCalendarId: string;
  name: string;
  timezone?: string;
  accessRole?: string;
  backgroundColor?: string;
  primary?: boolean;
  selectedForAvailability?: boolean;
  allDayBlocksAvailability?: boolean;
  writeEnabled?: boolean;
  status?: GoogleCalendar["status"];
  lastSyncedAt?: string;
  lastError?: string;
  metadata?: JsonObject;
};

export type GoogleCalendarPatch = Partial<
  Pick<
    GoogleCalendar,
    | "name"
    | "timezone"
    | "accessRole"
    | "backgroundColor"
    | "primary"
    | "selectedForAvailability"
    | "allDayBlocksAvailability"
    | "writeEnabled"
    | "status"
    | "lastSyncedAt"
    | "lastError"
    | "metadata"
  >
> & {
  deletedAt?: string | null;
};

export type GoogleCalendarEventUpsertData = {
  userId: UUID;
  providerAccountId: UUID;
  googleCalendarId: UUID;
  externalEventId: string;
  iCalUid?: string;
  title: string;
  startAt: string;
  endAt: string;
  allDay?: boolean;
  transparency?: GoogleCalendarEvent["transparency"];
  status?: string;
  location?: string;
  htmlLink?: string;
  recurringEventId?: string;
  etag?: string;
  ryanosOwned?: boolean;
  syncedAt?: string;
  metadata?: JsonObject;
};

export type GoogleCalendarEventPatch = Partial<
  Pick<
    GoogleCalendarEvent,
    | "title"
    | "startAt"
    | "endAt"
    | "allDay"
    | "transparency"
    | "status"
    | "location"
    | "htmlLink"
    | "recurringEventId"
    | "etag"
    | "ryanosOwned"
    | "syncedAt"
    | "metadata"
  >
> & {
  deletedAt?: string | null;
};

export type TimeBlockPlanUpsertData = {
  userId: UUID;
  dateKey: string;
  timezone: string;
  status: TimeBlockPlan["status"];
  rulePolicyId?: UUID;
  generatedAt?: string;
  publishedAt?: string;
  error?: string;
  metadata?: JsonObject;
};

export type TimeBlockPlanPatch = Partial<
  Pick<TimeBlockPlan, "timezone" | "status" | "rulePolicyId" | "generatedAt" | "publishedAt" | "error" | "metadata">
> & {
  deletedAt?: string | null;
};

export type TimeBlockBlockCreateData = {
  userId: UUID;
  planId: UUID;
  itemId?: UUID;
  googleCalendarId: UUID;
  title: string;
  startAt: string;
  endAt: string;
  status?: TimeBlockBlock["status"];
  pinned?: boolean;
  externalEventId?: string;
  error?: string;
  sortOrder?: number;
  metadata?: JsonObject;
};

export type TimeBlockBlockPatch = Partial<
  Pick<
    TimeBlockBlock,
    "title" | "startAt" | "endAt" | "status" | "pinned" | "externalEventId" | "error" | "sortOrder" | "metadata"
  >
> & {
  itemId?: UUID | null;
  deletedAt?: string | null;
};

export type UserIntegrationSettingUpsertData = {
  userId: UUID;
  integrationId: string;
  enabled?: boolean;
  metadata?: JsonObject;
};

export type UserIntegrationSettingPatch = Partial<Pick<UserIntegrationSetting, "enabled" | "metadata">>;

export type UserIntegrationSettingSummary = {
  integrationId: string;
  enabled: boolean;
  userCount: number;
};

export type LotteryDrawSnapshotUpsertData = {
  gameId: LotteryGameId;
  status: LotteryDrawSnapshot["status"];
  advertisedJackpotDollars?: number;
  cashValueDollars?: number;
  nextDrawAt?: string;
  officialCutoffAt?: string;
  sourceUrl: string;
  fetchedAt?: string;
  lastAttemptAt: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  error?: string;
  metadata?: JsonObject;
};

export type LotteryTaskAlertCreateData = {
  userId: UUID;
  gameId: LotteryGameId;
  drawAt: string;
  advertisedJackpotDollars: number;
  buyByAt: string;
  starredAt?: string;
  item: {
    title: string;
    body: string;
    priority: Item["priority"];
    metadata: JsonObject;
  };
  metadata?: JsonObject;
};

export type LotteryTaskAlertPatch = {
  status?: LotteryTaskAlert["status"];
  itemId?: UUID | null;
  advertisedJackpotDollars?: number;
  buyByAt?: string;
  metadata?: JsonObject;
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
  triageDecisionId?: UUID;
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

export type EmailScanRunCreateData = Omit<
  EmailScanRun,
  "id" | "createdAt" | "updatedAt" | "completedAt"
> & { completedAt?: string };

export type EmailScanRunPatch = Partial<
  Pick<EmailScanRun, "status" | "completedAt" | "leaseExpiresAt" | "counts" | "errors" | "metadata">
>;

export type EmailTriageDecisionUpsertData = Omit<
  EmailTriageDecision,
  "id" | "createdAt" | "updatedAt" | "deletedAt"
>;

export type EmailTriageDecisionPatch = Partial<
  Pick<
    EmailTriageDecision,
    | "outcome"
    | "reasonCode"
    | "reason"
    | "confidence"
    | "retryCount"
    | "nextRetryAt"
    | "evaluatedAt"
    | "metadata"
    | "deletedAt"
  >
>;

export type EmailTriageDecisionListFilters = {
  userId: UUID;
  providerAccountId?: UUID;
  outcome?: EmailTriageDecision["outcome"];
  gmailThreadId?: string;
  limit?: number;
};

export type EmailSenderPreferenceUpsertData = {
  userId: UUID;
  matchType: EmailSenderPreference["matchType"];
  value: string;
  disposition: EmailSenderPreference["disposition"];
  originatingProposalId?: UUID;
  metadata?: JsonObject;
};

export type EmailSenderPreferencePatch = Partial<
  Pick<EmailSenderPreference, "disposition" | "metadata" | "deletedAt">
>;

export type OpportunityCreateData = {
  userId: UUID;
  areaId?: UUID;
  projectId?: UUID;
  title: string;
  status?: Opportunity["status"];
  fit?: Opportunity["fit"];
  dueAt?: string;
  decisionBy?: string;
  valueEstimate?: string;
  nextActionItemId?: UUID;
  summary?: string;
  metadata?: JsonObject;
};

export type OpportunityPatch = Partial<
  Pick<Opportunity, "title" | "status" | "fit" | "valueEstimate" | "nextActionItemId" | "summary" | "metadata">
> & {
  areaId?: UUID | null;
  projectId?: UUID | null;
  dueAt?: string | null;
  decisionBy?: string | null;
};

export type OpportunityProposalUpsertData = {
  userId: UUID;
  sourceId: UUID;
  idempotencyKey: string;
  status?: OpportunityProposal["status"];
  projectSlug: string;
  title: string;
  summary?: string;
  rating?: number;
  fit?: OpportunityProposal["fit"];
  priority?: OpportunityProposal["priority"];
  dueAt?: string;
  decisionBy?: string;
  valueEstimate?: string;
  recommendedAction?: string;
  rationale?: string;
  acceptedOpportunityId?: UUID;
  acceptedItemId?: UUID;
  acceptedAt?: string;
  rejectedAt?: string;
  metadata?: JsonObject;
};

export type OpportunityProposalPatch = Partial<
  Pick<
    OpportunityProposal,
    | "status"
    | "projectSlug"
    | "title"
    | "summary"
    | "rating"
    | "fit"
    | "priority"
    | "valueEstimate"
    | "recommendedAction"
    | "rationale"
    | "acceptedOpportunityId"
    | "acceptedItemId"
    | "metadata"
  >
> & {
  dueAt?: string | null;
  decisionBy?: string | null;
  acceptedAt?: string | null;
  rejectedAt?: string | null;
};

export type OpportunityProposalListFilters = {
  userId: UUID;
  status?: OpportunityProposal["status"];
  projectSlug?: string;
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

export type VocabularyEntryCreateData = {
  userId: UUID;
  term: string;
  normalizedTerm: string;
  languageCode?: string;
  category?: string;
  definition?: string;
  partOfSpeech?: string;
  pronunciation?: string;
  translation?: string;
  notes?: string;
  tags?: string[];
  definitionSource?: string;
  status?: VocabularyEntry["status"];
  metadata?: JsonObject;
};

export type VocabularyEntryPatch = Partial<
  Pick<
    VocabularyEntry,
    | "term"
    | "normalizedTerm"
    | "languageCode"
    | "category"
    | "definition"
    | "partOfSpeech"
    | "pronunciation"
    | "translation"
    | "notes"
    | "tags"
    | "definitionSource"
    | "status"
    | "metadata"
  >
> & {
  deletedAt?: string | null;
};

export type VocabularyEntryListFilters = {
  userId: UUID;
  query?: string;
  category?: string;
  languageCode?: string;
  tag?: string;
  status?: VocabularyEntry["status"];
  limit?: number;
};

export type VocabularyEncounterCreateData = {
  userId: UUID;
  entryId: UUID;
  sourceType?: string;
  sourceTitle?: string;
  sourceUrl?: string;
  context?: string;
  occurredAt?: string;
  metadata?: JsonObject;
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
  createItemProgressNote(data: ItemProgressNoteCreateData): Promise<ItemProgressNote>;
  updateItemProgressNote(noteId: UUID, patch: ItemProgressNotePatch): Promise<ItemProgressNote>;
  listItemProgressNotes(filters: { userId: UUID; itemId: UUID; limit?: number }): Promise<ItemProgressNote[]>;
  getItemProgressNote(noteId: UUID): Promise<ItemProgressNote | undefined>;
  createItemChecklistItem(data: ItemChecklistItemCreateData): Promise<ItemChecklistItem>;
  updateItemChecklistItem(checklistItemId: UUID, patch: ItemChecklistItemPatch): Promise<ItemChecklistItem>;
  listItemChecklistItems(filters: { userId: UUID; itemId: UUID; limit?: number }): Promise<ItemChecklistItem[]>;
  getItemChecklistItem(checklistItemId: UUID): Promise<ItemChecklistItem | undefined>;

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
  getPolicy(policyId: UUID): Promise<Policy | undefined>;
  listPolicies(filters: {
    userId: UUID;
    type?: Policy["type"];
    scope?: string;
    statuses?: Policy["status"][];
    limit?: number;
  }): Promise<Policy[]>;

  getDailyPlan(userId: UUID, dateKey: string): Promise<DailyPlan | undefined>;
  listDailyPlans(filters: { userId: UUID; beforeDateKey?: string; limit?: number }): Promise<DailyPlan[]>;
  upsertDailyPlan(plan: DailyPlanUpsertData): Promise<DailyPlan>;

  upsertProviderAccount(account: ProviderAccountUpsertData): Promise<ProviderAccount>;
  listProviderAccounts(filters: { userId: UUID; provider?: string; limit?: number }): Promise<ProviderAccount[]>;
  listProviderAccountsForProvider(provider: string, limit?: number): Promise<ProviderAccount[]>;
  getProviderAccount(accountId: UUID): Promise<ProviderAccount | undefined>;
  findProviderAccountByExternalId(provider: string, externalAccountId: string): Promise<ProviderAccount | undefined>;
  updateProviderAccount(accountId: UUID, patch: ProviderAccountPatch): Promise<ProviderAccount>;
  listProviderAccountSummaries(): Promise<ProviderAccountSummary[]>;
  upsertGoogleCalendar(calendar: GoogleCalendarUpsertData): Promise<GoogleCalendar>;
  updateGoogleCalendar(calendarId: UUID, patch: GoogleCalendarPatch): Promise<GoogleCalendar>;
  getGoogleCalendar(calendarId: UUID): Promise<GoogleCalendar | undefined>;
  listGoogleCalendars(filters: {
    userId: UUID;
    providerAccountId?: UUID;
    selectedForAvailability?: boolean;
    limit?: number;
  }): Promise<GoogleCalendar[]>;
  upsertGoogleCalendarEvent(event: GoogleCalendarEventUpsertData): Promise<GoogleCalendarEvent>;
  updateGoogleCalendarEvent(eventId: UUID, patch: GoogleCalendarEventPatch): Promise<GoogleCalendarEvent>;
  getGoogleCalendarEvent(eventId: UUID): Promise<GoogleCalendarEvent | undefined>;
  findGoogleCalendarEvent(googleCalendarId: UUID, externalEventId: string): Promise<GoogleCalendarEvent | undefined>;
  listGoogleCalendarEvents(filters: {
    userId: UUID;
    googleCalendarIds?: UUID[];
    startsBefore?: string;
    endsAfter?: string;
    includeDeleted?: boolean;
    limit?: number;
  }): Promise<GoogleCalendarEvent[]>;
  upsertTimeBlockPlan(plan: TimeBlockPlanUpsertData): Promise<TimeBlockPlan>;
  updateTimeBlockPlan(planId: UUID, patch: TimeBlockPlanPatch): Promise<TimeBlockPlan>;
  getTimeBlockPlan(planId: UUID): Promise<TimeBlockPlan | undefined>;
  findTimeBlockPlan(userId: UUID, dateKey: string): Promise<TimeBlockPlan | undefined>;
  createTimeBlockBlock(block: TimeBlockBlockCreateData): Promise<TimeBlockBlock>;
  updateTimeBlockBlock(blockId: UUID, patch: TimeBlockBlockPatch): Promise<TimeBlockBlock>;
  getTimeBlockBlock(blockId: UUID): Promise<TimeBlockBlock | undefined>;
  listTimeBlockBlocks(filters: { userId: UUID; planId?: UUID; itemId?: UUID; limit?: number }): Promise<TimeBlockBlock[]>;
  getUserIntegrationSetting(userId: UUID, integrationId: string): Promise<UserIntegrationSetting | undefined>;
  listUserIntegrationSettings(userId: UUID): Promise<UserIntegrationSetting[]>;
  listUserIntegrationSettingsForIntegration(integrationId: string): Promise<UserIntegrationSetting[]>;
  upsertUserIntegrationSetting(setting: UserIntegrationSettingUpsertData): Promise<UserIntegrationSetting>;
  listUserIntegrationSettingSummaries(): Promise<UserIntegrationSettingSummary[]>;

  upsertLotteryDrawSnapshot(snapshot: LotteryDrawSnapshotUpsertData): Promise<LotteryDrawSnapshot>;
  getLotteryDrawSnapshot(gameId: LotteryGameId): Promise<LotteryDrawSnapshot | undefined>;
  listLotteryDrawSnapshots(): Promise<LotteryDrawSnapshot[]>;
  createLotteryTaskAlert(data: LotteryTaskAlertCreateData): Promise<{
    alert: LotteryTaskAlert;
    item: Item;
    created: boolean;
  }>;
  updateLotteryTaskAlert(alertId: UUID, patch: LotteryTaskAlertPatch): Promise<LotteryTaskAlert>;
  listLotteryTaskAlerts(filters: {
    userId: UUID;
    gameId?: LotteryGameId;
    drawAt?: string;
    statuses?: LotteryTaskAlert["status"][];
    limit?: number;
  }): Promise<LotteryTaskAlert[]>;

  upsertExternalSource(source: ExternalSourceUpsertData): Promise<ExternalSource>;
  getExternalSource(sourceId: UUID): Promise<ExternalSource | undefined>;
  addSourceLink(link: SourceLinkCreateData): Promise<SourceLink>;

  upsertEmailActionProposal(proposal: EmailActionProposalUpsertData): Promise<EmailActionProposal>;
  listEmailActionProposals(filters: EmailActionProposalListFilters): Promise<EmailActionProposal[]>;
  getEmailActionProposal(proposalId: UUID): Promise<EmailActionProposal | undefined>;
  updateEmailActionProposal(proposalId: UUID, patch: EmailActionProposalPatch): Promise<EmailActionProposal>;
  createEmailScanRun(run: EmailScanRunCreateData): Promise<EmailScanRun>;
  updateEmailScanRun(runId: UUID, patch: EmailScanRunPatch): Promise<EmailScanRun>;
  listEmailScanRuns(filters: { userId: UUID; limit?: number }): Promise<EmailScanRun[]>;
  upsertEmailTriageDecision(decision: EmailTriageDecisionUpsertData): Promise<EmailTriageDecision>;
  updateEmailTriageDecision(decisionId: UUID, patch: EmailTriageDecisionPatch): Promise<EmailTriageDecision>;
  getEmailTriageDecision(decisionId: UUID): Promise<EmailTriageDecision | undefined>;
  listEmailTriageDecisions(filters: EmailTriageDecisionListFilters): Promise<EmailTriageDecision[]>;
  upsertEmailSenderPreference(preference: EmailSenderPreferenceUpsertData): Promise<EmailSenderPreference>;
  updateEmailSenderPreference(preferenceId: UUID, patch: EmailSenderPreferencePatch): Promise<EmailSenderPreference>;
  getEmailSenderPreference(preferenceId: UUID): Promise<EmailSenderPreference | undefined>;
  listEmailSenderPreferences(userId: UUID): Promise<EmailSenderPreference[]>;

  createOpportunity(data: OpportunityCreateData): Promise<Opportunity>;
  updateOpportunity(opportunityId: UUID, patch: OpportunityPatch): Promise<Opportunity>;
  getOpportunity(opportunityId: UUID): Promise<Opportunity | undefined>;

  upsertOpportunityProposal(proposal: OpportunityProposalUpsertData): Promise<OpportunityProposal>;
  listOpportunityProposals(filters: OpportunityProposalListFilters): Promise<OpportunityProposal[]>;
  getOpportunityProposal(proposalId: UUID): Promise<OpportunityProposal | undefined>;
  updateOpportunityProposal(proposalId: UUID, patch: OpportunityProposalPatch): Promise<OpportunityProposal>;

  getDefaultShoppingList(userId: UUID): Promise<ShoppingList>;
  createShoppingItem(data: ShoppingItemCreateData): Promise<ShoppingListItem>;
  updateShoppingItem(itemId: UUID, patch: ShoppingItemPatch): Promise<ShoppingListItem>;
  listShoppingItems(filters: ShoppingItemListFilters): Promise<ShoppingListItem[]>;
  getShoppingItem(itemId: UUID): Promise<ShoppingListItem | undefined>;
  upsertShoppingCatalogItem(data: ShoppingCatalogUpsertData): Promise<ShoppingCatalogItem>;
  listShoppingCatalogItems(filters: ShoppingCatalogListFilters): Promise<ShoppingCatalogItem[]>;

  createVocabularyEntry(data: VocabularyEntryCreateData): Promise<VocabularyEntry>;
  updateVocabularyEntry(entryId: UUID, patch: VocabularyEntryPatch): Promise<VocabularyEntry>;
  listVocabularyEntries(filters: VocabularyEntryListFilters): Promise<VocabularyEntry[]>;
  getVocabularyEntry(entryId: UUID): Promise<VocabularyEntry | undefined>;
  findVocabularyEntry(
    userId: UUID,
    languageCode: string,
    normalizedTerm: string
  ): Promise<VocabularyEntry | undefined>;
  addVocabularyEncounter(data: VocabularyEncounterCreateData): Promise<VocabularyEncounter>;
  listVocabularyEncounters(filters: { userId: UUID; entryId?: UUID; limit?: number }): Promise<VocabularyEncounter[]>;

  addAuditLog(log: Omit<AuditLog, "id" | "occurredAt">): Promise<AuditLog>;
  snapshot?(): JsonObject | Promise<JsonObject>;
}
