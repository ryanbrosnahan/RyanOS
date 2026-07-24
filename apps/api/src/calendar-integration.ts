import {
  type GoogleCalendar,
  type GoogleCalendarEvent,
  type Item,
  type Policy,
  type ProviderAccount,
  type RyanStore,
  type TimeBlockBlock,
  type TimeBlockPlan
} from "@ryanos/core";
import { nowIso, type JsonObject, type UUID } from "@ryanos/shared";
import {
  dateRangeForDateKey,
  generateTimeBlockSchedule,
  normalizeTimeBlockRule,
  type TimeBlockRule,
  validateTimeBlockRule
} from "./calendar-scheduling.js";
import type {
  CalendarClientLike,
  CalendarEventWriteInput,
  GogCalendarEvent
} from "./gog-calendar.js";

export const GOOGLE_CALENDAR_PROVIDER = "google_calendar";
export const CALENDAR_INTEGRATION_ID = "calendar";
export const TIME_BLOCK_POLICY_SCOPE = "calendar.time_block";

export type CalendarSyncResult = {
  accounts: number;
  calendars: number;
  events: number;
  errors: Array<{ accountId?: string; calendarId?: string; error: string }>;
};

export class CalendarConflictError extends Error {
  constructor(readonly conflicts: Array<{ blockId: string; eventId: string; eventTitle: string }>) {
    super("The calendar changed and this draft now overlaps another event.");
  }
}

export function calendarAccountSettings(account: ProviderAccount): {
  enabled: boolean;
  lastSyncAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
} {
  const metadata = asRecord(account.metadata.calendar) ?? {};
  const settings: {
    enabled: boolean;
    lastSyncAt?: string;
    lastSuccessAt?: string;
    lastError?: string;
  } = {
    enabled: typeof metadata.enabled === "boolean" ? metadata.enabled : true
  };
  if (typeof metadata.lastSyncAt === "string") settings.lastSyncAt = metadata.lastSyncAt;
  if (typeof metadata.lastSuccessAt === "string") settings.lastSuccessAt = metadata.lastSuccessAt;
  if (typeof metadata.lastError === "string") settings.lastError = metadata.lastError;
  return settings;
}

export async function syncCalendarAccounts(input: {
  store: RyanStore;
  client: CalendarClientLike;
  userId: UUID;
  accountEmail?: string;
  includeNewAccounts?: boolean;
}): Promise<ProviderAccount[]> {
  const gogAccounts = await input.client.listAccounts();
  const existing = await input.store.listProviderAccounts({
    userId: input.userId,
    provider: GOOGLE_CALENDAR_PROVIDER,
    limit: 200
  });
  const existingByEmail = new Map(
    existing.flatMap((account) => [
      [account.externalAccountId?.toLowerCase(), account] as const,
      [account.email?.toLowerCase(), account] as const
    ]).filter((entry): entry is [string, ProviderAccount] => entry[0] !== undefined)
  );
  const synced: ProviderAccount[] = [];
  for (const account of gogAccounts) {
    if (!hasService(account.scopes, "calendar")) continue;
    const requested = input.accountEmail === undefined ||
      account.email.toLowerCase() === input.accountEmail.toLowerCase() ||
      account.externalAccountId.toLowerCase() === input.accountEmail.toLowerCase();
    if (!requested) continue;
    const prior = existingByEmail.get(account.externalAccountId.toLowerCase()) ??
      existingByEmail.get(account.email.toLowerCase());
    if (!prior && input.accountEmail === undefined && input.includeNewAccounts !== true) continue;
    const timestamp = nowIso();
    const upsert = await input.store.upsertProviderAccount({
      userId: input.userId,
      provider: GOOGLE_CALENDAR_PROVIDER,
      externalAccountId: account.externalAccountId,
      displayName: account.displayName ?? account.email,
      email: account.email,
      status: account.status === "disabled" ? "disabled" : "active",
      scopes: account.scopes,
      metadata: toJson({
        ...(prior?.metadata ?? {}),
        calendar: {
          ...(asRecord(prior?.metadata.calendar) ?? {}),
          enabled: calendarAccountSettings(prior ?? {
            id: "",
            userId: input.userId,
            provider: GOOGLE_CALENDAR_PROVIDER,
            status: "active",
            scopes: [],
            metadata: {},
            createdAt: timestamp,
            updatedAt: timestamp
          }).enabled,
          lastAccountSyncAt: timestamp
        }
      })
    });
    synced.push(upsert);
  }
  return synced;
}

export async function syncCalendarCatalog(input: {
  store: RyanStore;
  client: CalendarClientLike;
  account: ProviderAccount;
}): Promise<GoogleCalendar[]> {
  if (!input.account.email) throw new Error("Calendar account has no email.");
  const remoteCalendars = await input.client.listCalendars(input.account.email);
  const existing = await input.store.listGoogleCalendars({
    userId: input.account.userId,
    providerAccountId: input.account.id,
    limit: 500
  });
  const existingByExternalId = new Map(existing.map((calendar) => [calendar.externalCalendarId, calendar]));
  const hasSelected = existing.some((calendar) => calendar.selectedForAvailability);
  const hasWriteTarget = existing.some((calendar) => calendar.writeEnabled);
  const seen = new Set<string>();
  const syncedAt = nowIso();
  const result: GoogleCalendar[] = [];
  for (const remote of remoteCalendars) {
    seen.add(remote.id);
    const prior = existingByExternalId.get(remote.id);
    const writable = ["owner", "writer"].includes(remote.accessRole);
    result.push(await input.store.upsertGoogleCalendar({
      userId: input.account.userId,
      providerAccountId: input.account.id,
      externalCalendarId: remote.id,
      name: remote.name,
      ...(remote.timezone ? { timezone: remote.timezone } : {}),
      accessRole: remote.accessRole,
      ...(remote.backgroundColor ? { backgroundColor: remote.backgroundColor } : {}),
      primary: remote.primary,
      selectedForAvailability: prior?.selectedForAvailability ?? (!hasSelected && remote.primary),
      allDayBlocksAvailability: prior?.allDayBlocksAvailability ?? false,
      writeEnabled: prior?.writeEnabled ?? (!hasWriteTarget && remote.primary && writable),
      status: "active",
      lastSyncedAt: syncedAt,
      lastError: "",
      metadata: toJson({
        ...(prior?.metadata ?? {}),
        remote: remote.raw
      })
    }));
  }
  for (const prior of existing) {
    if (!seen.has(prior.externalCalendarId)) {
      await input.store.updateGoogleCalendar(prior.id, {
        status: "disabled",
        selectedForAvailability: false,
        writeEnabled: false,
        lastSyncedAt: syncedAt
      });
    }
  }
  return result;
}

export async function syncUserCalendars(input: {
  store: RyanStore;
  client: CalendarClientLike;
  userId: UUID;
  refreshCatalog?: boolean;
  from?: string;
  to?: string;
}): Promise<CalendarSyncResult> {
  const result: CalendarSyncResult = { accounts: 0, calendars: 0, events: 0, errors: [] };
  const accounts = await input.store.listProviderAccounts({
    userId: input.userId,
    provider: GOOGLE_CALENDAR_PROVIDER,
    limit: 200
  });
  const now = new Date();
  const from = input.from ?? new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const to = input.to ?? new Date(now.getTime() + 60 * 86_400_000).toISOString();
  for (const account of accounts) {
    if (account.status === "disabled" || !calendarAccountSettings(account).enabled || !account.email) continue;
    result.accounts += 1;
    try {
      if (input.refreshCatalog !== false) {
        await syncCalendarCatalog({ store: input.store, client: input.client, account });
      }
      const calendars = await input.store.listGoogleCalendars({
        userId: input.userId,
        providerAccountId: account.id,
        selectedForAvailability: true,
        limit: 500
      });
      for (const calendar of calendars) {
        result.calendars += 1;
        try {
          const remoteEvents = await input.client.listEvents({
            accountEmail: account.email,
            externalCalendarId: calendar.externalCalendarId,
            from,
            to
          });
          const seen = new Set<string>();
          for (const remote of remoteEvents) {
            seen.add(remote.id);
            const event = await upsertRemoteEvent({
              store: input.store,
              account,
              calendar,
              remote
            });
            await reconcileOwnedEvent(input.store, event, remote);
            result.events += 1;
          }
          const cached = await input.store.listGoogleCalendarEvents({
            userId: input.userId,
            googleCalendarIds: [calendar.id],
            startsBefore: to,
            endsAfter: from,
            includeDeleted: false,
            limit: 5000
          });
          for (const event of cached) {
            if (!seen.has(event.externalEventId)) {
              await input.store.updateGoogleCalendarEvent(event.id, { deletedAt: nowIso() });
              if (event.ryanosOwned) await reconcileDeletedOwnedEvent(input.store, event);
            }
          }
          await input.store.updateGoogleCalendar(calendar.id, {
            lastSyncedAt: nowIso(),
            lastError: "",
            status: "active"
          });
        } catch (error) {
          const message = safeError(error);
          result.errors.push({ accountId: account.id, calendarId: calendar.id, error: message });
          await input.store.updateGoogleCalendar(calendar.id, {
            lastSyncedAt: nowIso(),
            lastError: message,
            status: "error"
          });
        }
      }
      await updateAccountHealth(input.store, account, result.errors.some((error) => error.accountId === account.id)
        ? result.errors.find((error) => error.accountId === account.id)?.error
        : undefined);
    } catch (error) {
      const message = safeError(error);
      result.errors.push({ accountId: account.id, error: message });
      await updateAccountHealth(input.store, account, message);
    }
  }
  return result;
}

export async function generateCalendarPlan(input: {
  store: RyanStore;
  userId: UUID;
  dateKey: string;
  rulePolicyId?: UUID;
}): Promise<{ plan: TimeBlockPlan; blocks: TimeBlockBlock[]; unscheduledItems: Item[] }> {
  const policies = await input.store.listPolicies({
    userId: input.userId,
    type: "planning",
    scope: TIME_BLOCK_POLICY_SCOPE,
    statuses: ["active"],
    limit: 100
  });
  const policy = input.rulePolicyId
    ? policies.find((candidate) => candidate.id === input.rulePolicyId)
    : policies[0];
  if (!policy) throw new Error("Create and enable a time-blocking rule first.");
  const rule = normalizeTimeBlockRule(policy.rules);
  const validation = validateTimeBlockRule(rule);
  if (validation) throw new Error(validation);
  const targetCalendar = await input.store.getGoogleCalendar(rule.targetCalendarId);
  if (
    !targetCalendar ||
    targetCalendar.userId !== input.userId ||
    !targetCalendar.writeEnabled ||
    targetCalendar.status === "disabled"
  ) {
    throw new Error("The rule's target calendar is not writable.");
  }
  const selectedCalendars = await input.store.listGoogleCalendars({
    userId: input.userId,
    selectedForAvailability: true,
    limit: 500
  });
  const range = dateRangeForDateKey(input.dateKey, rule.timezone);
  const [events, items] = await Promise.all([
    input.store.listGoogleCalendarEvents({
      userId: input.userId,
      googleCalendarIds: selectedCalendars.map((calendar) => calendar.id),
      startsBefore: range.to,
      endsAfter: range.from,
      limit: 5000
    }),
    input.store.listItems({
      userId: input.userId,
      statuses: ["open", "active"],
      limit: 1000
    })
  ]);
  const schedule = generateTimeBlockSchedule({
    dateKey: input.dateKey,
    rule,
    items,
    events,
    calendars: selectedCalendars
  });
  const existingPlan = await input.store.findTimeBlockPlan(input.userId, input.dateKey);
  if (existingPlan) {
    const oldBlocks = await input.store.listTimeBlockBlocks({
      userId: input.userId,
      planId: existingPlan.id,
      limit: 2000
    });
    for (const block of oldBlocks) {
      if (block.status === "draft" && !block.pinned) {
        await input.store.updateTimeBlockBlock(block.id, { deletedAt: nowIso() });
      }
    }
  }
  const plan = await input.store.upsertTimeBlockPlan({
    userId: input.userId,
    dateKey: input.dateKey,
    timezone: rule.timezone,
    status: "draft",
    rulePolicyId: policy.id,
    generatedAt: nowIso(),
    error: "",
    metadata: toJson({
      unscheduledItemIds: schedule.unscheduledItemIds,
      availableMinutes: schedule.availableMinutes,
      scheduledMinutes: schedule.scheduledMinutes
    })
  });
  for (const [index, block] of schedule.blocks.entries()) {
    await input.store.createTimeBlockBlock({
      userId: input.userId,
      planId: plan.id,
      itemId: block.itemId,
      googleCalendarId: targetCalendar.id,
      title: block.title,
      startAt: block.startAt,
      endAt: block.endAt,
      sortOrder: index,
      metadata: toJson(block.metadata)
    });
  }
  const blocks = await input.store.listTimeBlockBlocks({
    userId: input.userId,
    planId: plan.id,
    limit: 2000
  });
  const itemById = new Map(items.map((item) => [item.id, item]));
  return {
    plan,
    blocks,
    unscheduledItems: schedule.unscheduledItemIds.flatMap((id) => {
      const item = itemById.get(id);
      return item ? [item] : [];
    })
  };
}

export async function calendarPlanView(
  store: RyanStore,
  userId: UUID,
  dateKey: string
): Promise<{
  plan?: TimeBlockPlan;
  blocks: TimeBlockBlock[];
  unscheduledItems: Item[];
}> {
  const plan = await store.findTimeBlockPlan(userId, dateKey);
  if (!plan) return { blocks: [], unscheduledItems: [] };
  const blocks = await store.listTimeBlockBlocks({ userId, planId: plan.id, limit: 2000 });
  const metadata = asRecord(plan.metadata);
  const ids = stringArray(metadata?.unscheduledItemIds);
  const unscheduledItems = (await Promise.all(ids.map((id) => store.getItem(id)))).filter(
    (item): item is Item => item !== undefined && item.userId === userId
  );
  return { plan, blocks, unscheduledItems };
}

export async function publishCalendarPlan(input: {
  store: RyanStore;
  client: CalendarClientLike;
  userId: UUID;
  planId: UUID;
}): Promise<{ plan: TimeBlockPlan; blocks: TimeBlockBlock[] }> {
  const plan = await input.store.getTimeBlockPlan(input.planId);
  if (!plan || plan.userId !== input.userId) throw new Error("Calendar plan not found.");
  const range = dateRangeForDateKey(plan.dateKey, plan.timezone);
  await syncUserCalendars({
    store: input.store,
    client: input.client,
    userId: input.userId,
    refreshCatalog: false,
    from: range.from,
    to: range.to
  });
  const blocks = await input.store.listTimeBlockBlocks({
    userId: input.userId,
    planId: plan.id,
    limit: 2000
  });
  const draftBlocks = blocks.filter((block) => block.status === "draft" || block.status === "failed");
  const calendars = await input.store.listGoogleCalendars({ userId: input.userId, limit: 500 });
  const calendarById = new Map(calendars.map((calendar) => [calendar.id, calendar]));
  const events = await input.store.listGoogleCalendarEvents({
    userId: input.userId,
    googleCalendarIds: calendars.filter((calendar) => calendar.selectedForAvailability).map((calendar) => calendar.id),
    startsBefore: range.to,
    endsAfter: range.from,
    limit: 5000
  });
  const conflicts = draftBlocks.flatMap((block) => events.flatMap((event) => {
    if (event.status === "cancelled" || event.transparency === "transparent") return [];
    if (event.externalEventId === block.externalEventId) return [];
    if (new Date(event.startAt) >= new Date(block.endAt) || new Date(event.endAt) <= new Date(block.startAt)) return [];
    return [{ blockId: block.id, eventId: event.id, eventTitle: event.title }];
  }));
  if (conflicts.length > 0) throw new CalendarConflictError(conflicts);
  await input.store.updateTimeBlockPlan(plan.id, { status: "publishing", error: "" });
  let failures = 0;
  for (const block of draftBlocks) {
    const calendar = calendarById.get(block.googleCalendarId);
    const account = calendar ? await input.store.getProviderAccount(calendar.providerAccountId) : undefined;
    if (!calendar || !account?.email || !calendar.writeEnabled) {
      failures += 1;
      await input.store.updateTimeBlockBlock(block.id, {
        status: "failed",
        error: "Target calendar is not writable."
      });
      continue;
    }
    try {
      const remote = await input.client.createEvent({
        accountEmail: account.email,
        externalCalendarId: calendar.externalCalendarId,
        title: block.title,
        startAt: block.startAt,
        endAt: block.endAt,
        timezone: plan.timezone,
        description: "Scheduled by RyanOS.",
        privateProperties: {
          ryanosOwned: "true",
          ryanosEventKind: "time_block",
          ryanosPlanId: plan.id,
          ryanosBlockId: block.id,
          ...(block.itemId ? { ryanosItemId: block.itemId } : {})
        }
      });
      await input.store.updateTimeBlockBlock(block.id, {
        status: "published",
        externalEventId: remote.id,
        error: ""
      });
      await upsertRemoteEvent({ store: input.store, account, calendar, remote });
    } catch (error) {
      failures += 1;
      await input.store.updateTimeBlockBlock(block.id, {
        status: "failed",
        error: safeError(error)
      });
    }
  }
  const updatedPlan = await input.store.updateTimeBlockPlan(plan.id, {
    status: failures > 0 ? "partial" : "published",
    publishedAt: nowIso(),
    error: failures > 0 ? `${failures} block${failures === 1 ? "" : "s"} failed to publish.` : ""
  });
  return {
    plan: updatedPlan,
    blocks: await input.store.listTimeBlockBlocks({ userId: input.userId, planId: plan.id, limit: 2000 })
  };
}

export async function createPersonalCalendarEvent(input: {
  store: RyanStore;
  client: CalendarClientLike;
  userId: UUID;
  googleCalendarId: UUID;
  title: string;
  startAt: string;
  endAt: string;
  timezone: string;
  description?: string;
  location?: string;
}): Promise<GoogleCalendarEvent> {
  const { calendar, account } = await writableCalendar(input.store, input.userId, input.googleCalendarId);
  const write: CalendarEventWriteInput = {
    accountEmail: account.email!,
    externalCalendarId: calendar.externalCalendarId,
    title: input.title,
    startAt: input.startAt,
    endAt: input.endAt,
    timezone: input.timezone,
    privateProperties: {
      ryanosOwned: "true",
      ryanosEventKind: "personal"
    }
  };
  if (input.description !== undefined) write.description = input.description;
  if (input.location !== undefined) write.location = input.location;
  const remote = await input.client.createEvent(write);
  return upsertRemoteEvent({ store: input.store, account, calendar, remote });
}

export async function updatePersonalCalendarEvent(input: {
  store: RyanStore;
  client: CalendarClientLike;
  userId: UUID;
  eventId: UUID;
  title: string;
  startAt: string;
  endAt: string;
  timezone: string;
  description?: string;
  location?: string;
}): Promise<GoogleCalendarEvent> {
  const event = await input.store.getGoogleCalendarEvent(input.eventId);
  if (!event || event.userId !== input.userId || !event.ryanosOwned || event.metadata.eventKind !== "personal") {
    throw new Error("Only personal events created by RyanOS can be edited.");
  }
  const { calendar, account } = await writableCalendar(input.store, input.userId, event.googleCalendarId);
  const write: CalendarEventWriteInput & { externalEventId: string } = {
    accountEmail: account.email!,
    externalCalendarId: calendar.externalCalendarId,
    externalEventId: event.externalEventId,
    title: input.title,
    startAt: input.startAt,
    endAt: input.endAt,
    timezone: input.timezone,
    privateProperties: {
      ryanosOwned: "true",
      ryanosEventKind: "personal"
    }
  };
  if (input.description !== undefined) write.description = input.description;
  if (input.location !== undefined) write.location = input.location;
  const remote = await input.client.updateEvent(write);
  return upsertRemoteEvent({ store: input.store, account, calendar, remote });
}

export async function deletePersonalCalendarEvent(input: {
  store: RyanStore;
  client: CalendarClientLike;
  userId: UUID;
  eventId: UUID;
}): Promise<void> {
  const event = await input.store.getGoogleCalendarEvent(input.eventId);
  if (!event || event.userId !== input.userId || !event.ryanosOwned || event.metadata.eventKind !== "personal") {
    throw new Error("Only personal events created by RyanOS can be deleted.");
  }
  const { calendar, account } = await writableCalendar(input.store, input.userId, event.googleCalendarId);
  await input.client.deleteEvent({
    accountEmail: account.email!,
    externalCalendarId: calendar.externalCalendarId,
    externalEventId: event.externalEventId
  });
  await input.store.updateGoogleCalendarEvent(event.id, { deletedAt: nowIso() });
}

export function ruleView(policy: Policy): { policy: Policy; rule: TimeBlockRule } {
  return { policy, rule: normalizeTimeBlockRule(policy.rules) };
}

async function writableCalendar(
  store: RyanStore,
  userId: UUID,
  calendarId: UUID
): Promise<{ calendar: GoogleCalendar; account: ProviderAccount }> {
  const calendar = await store.getGoogleCalendar(calendarId);
  if (!calendar || calendar.userId !== userId || !calendar.writeEnabled || calendar.status === "disabled") {
    throw new Error("Writable calendar not found.");
  }
  const account = await store.getProviderAccount(calendar.providerAccountId);
  if (!account || account.userId !== userId || !account.email || account.status === "disabled") {
    throw new Error("Calendar account is not available.");
  }
  return { calendar, account };
}

async function upsertRemoteEvent(input: {
  store: RyanStore;
  account: ProviderAccount;
  calendar: GoogleCalendar;
  remote: GogCalendarEvent;
}): Promise<GoogleCalendarEvent> {
  const privateProperties = input.remote.privateProperties;
  return input.store.upsertGoogleCalendarEvent({
    userId: input.account.userId,
    providerAccountId: input.account.id,
    googleCalendarId: input.calendar.id,
    externalEventId: input.remote.id,
    ...(input.remote.iCalUid ? { iCalUid: input.remote.iCalUid } : {}),
    title: input.remote.title,
    startAt: isoDate(input.remote.startAt),
    endAt: isoDate(input.remote.endAt),
    allDay: input.remote.allDay,
    transparency: input.remote.transparency,
    status: input.remote.status,
    ...(input.remote.location ? { location: input.remote.location } : {}),
    ...(input.remote.htmlLink ? { htmlLink: input.remote.htmlLink } : {}),
    ...(input.remote.recurringEventId ? { recurringEventId: input.remote.recurringEventId } : {}),
    ...(input.remote.etag ? { etag: input.remote.etag } : {}),
    ryanosOwned: privateProperties.ryanosOwned === "true",
    syncedAt: nowIso(),
    metadata: toJson({
      privateProperties,
      eventKind: privateProperties.ryanosEventKind
    })
  });
}

async function reconcileOwnedEvent(
  store: RyanStore,
  event: GoogleCalendarEvent,
  remote: GogCalendarEvent
): Promise<void> {
  const blockId = remote.privateProperties.ryanosBlockId;
  if (!blockId) return;
  const block = await store.getTimeBlockBlock(blockId);
  if (!block || block.userId !== event.userId) return;
  const changed = block.startAt !== event.startAt || block.endAt !== event.endAt || block.title !== event.title;
  await store.updateTimeBlockBlock(block.id, {
    externalEventId: event.externalEventId,
    status: "published",
    ...(changed
      ? {
          title: event.title,
          startAt: event.startAt,
          endAt: event.endAt,
          pinned: true,
          metadata: toJson({ ...block.metadata, pinnedReason: "google_edit" })
        }
      : {})
  });
}

async function reconcileDeletedOwnedEvent(store: RyanStore, event: GoogleCalendarEvent): Promise<void> {
  const metadata = asRecord(event.metadata.privateProperties);
  const blockId = typeof metadata?.ryanosBlockId === "string" ? metadata.ryanosBlockId : undefined;
  if (!blockId) return;
  const block = await store.getTimeBlockBlock(blockId);
  if (!block) return;
  await store.updateTimeBlockBlock(block.id, {
    status: "removed",
    pinned: true,
    metadata: toJson({ ...block.metadata, removedReason: "google_delete" })
  });
}

async function updateAccountHealth(store: RyanStore, account: ProviderAccount, error?: string): Promise<void> {
  const timestamp = nowIso();
  await store.updateProviderAccount(account.id, {
    metadata: toJson({
      ...account.metadata,
      calendar: {
        ...asRecord(account.metadata.calendar),
        enabled: calendarAccountSettings(account).enabled,
        lastSyncAt: timestamp,
        ...(error
          ? { lastError: error, lastFailureAt: timestamp }
          : { lastError: "", lastSuccessAt: timestamp })
      }
    })
  });
}

function hasService(scopes: string[], service: string): boolean {
  return scopes.some((scope) => scope.toLowerCase().includes(service));
}

function isoDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00.000Z`;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid Calendar date: ${value}`);
  return parsed.toISOString();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function toJson(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value ?? {})) as JsonObject;
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1000);
}
