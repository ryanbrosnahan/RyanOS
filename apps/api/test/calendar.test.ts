import { InMemoryRyanStore } from "@ryanos/core";
import type { UUID } from "@ryanos/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type {
  CalendarClientLike,
  CalendarEventWriteInput,
  GogCalendarEvent
} from "../src/gog-calendar.js";

function remoteEvent(
  id: string,
  input: Pick<CalendarEventWriteInput, "title" | "startAt" | "endAt">,
  privateProperties: Record<string, string> = {}
): GogCalendarEvent {
  return {
    id,
    title: input.title,
    startAt: input.startAt,
    endAt: input.endAt,
    allDay: false,
    transparency: "opaque",
    status: "confirmed",
    privateProperties,
    raw: {}
  };
}

class FakeCalendarClient implements CalendarClientLike {
  readonly created: CalendarEventWriteInput[] = [];

  async listAccounts() {
    return [{
      email: "ryan@example.com",
      externalAccountId: "ryan@example.com",
      displayName: "Ryan",
      scopes: ["calendar"],
      status: "active",
      raw: {}
    }];
  }

  async startRemoteAuth() {
    return { authUrl: "https://accounts.google.com/o/oauth2/auth?client_id=test" };
  }

  async completeRemoteAuth() {}

  async listCalendars() {
    return [{
      id: "primary",
      name: "Primary",
      timezone: "UTC",
      accessRole: "owner",
      primary: true,
      raw: {}
    }];
  }

  async listEvents() {
    return [];
  }

  async getEvent() {
    return remoteEvent("event-1", {
      title: "Existing",
      startAt: "2026-07-24T10:00:00.000Z",
      endAt: "2026-07-24T11:00:00.000Z"
    });
  }

  async createEvent(input: CalendarEventWriteInput) {
    this.created.push(input);
    return remoteEvent(`event-${this.created.length}`, input, input.privateProperties);
  }

  async updateEvent(input: CalendarEventWriteInput & { externalEventId: string }) {
    return remoteEvent(input.externalEventId, input, input.privateProperties);
  }

  async deleteEvent() {}
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("calendar integration API", () => {
  it("generates a draft and publishes owned blocks to the selected calendar", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const store = new InMemoryRyanStore();
    const client = new FakeCalendarClient();
    const userId = "local-owner" as UUID;
    await store.upsertUserIntegrationSetting({
      userId,
      integrationId: "calendar",
      enabled: true,
      metadata: {}
    });
    const account = await store.upsertProviderAccount({
      userId,
      provider: "google_calendar",
      externalAccountId: "ryan@example.com",
      email: "ryan@example.com",
      status: "active",
      scopes: ["calendar"],
      metadata: {
        calendar: {
          enabled: true,
          lastSuccessAt: new Date().toISOString()
        }
      }
    });
    const calendar = await store.upsertGoogleCalendar({
      userId,
      providerAccountId: account.id,
      externalCalendarId: "primary",
      name: "Primary",
      timezone: "UTC",
      accessRole: "owner",
      primary: true,
      selectedForAvailability: true,
      allDayBlocksAvailability: false,
      writeEnabled: true,
      status: "active",
      metadata: {}
    });
    const item = await store.createItem({
      userId,
      kind: "task",
      title: "Prepare filing",
      priority: "high",
      estimateMinutes: 60,
      metadata: {}
    });
    await store.updateItem(item.id, { starredAt: "2026-07-24T12:00:00.000Z" });
    const app = buildApp({ store, calendarClient: client });

    const rule = await app.inject({
      method: "POST",
      url: "/v1/calendar/rules",
      payload: {
        name: "Work day",
        timezone: "UTC",
        availability: {
          "5": [{ start: "09:00", end: "17:00" }]
        },
        targetCalendarId: calendar.id,
        includeStarred: true,
        includeDue: true,
        areaIds: [],
        projectIds: [],
        bufferBeforeMinutes: 15,
        bufferAfterMinutes: 15,
        defaultEstimateMinutes: 30,
        minimumChunkMinutes: 15,
        maximumBlockMinutes: 120,
        splitTasks: true,
        enabled: true
      }
    });
    expect(rule.statusCode).toBe(200);

    const generated = await app.inject({
      method: "POST",
      url: "/v1/calendar/plans/generate",
      payload: { date: "2026-07-24" }
    });
    expect(generated.statusCode).toBe(200);
    expect(generated.json()).toMatchObject({
      plan: { status: "draft", dateKey: "2026-07-24" },
      blocks: [expect.objectContaining({ title: "Prepare filing", status: "draft" })]
    });

    const planId = generated.json().plan.id as string;
    const published = await app.inject({
      method: "POST",
      url: `/v1/calendar/plans/${planId}/publish`,
      payload: {}
    });
    await app.close();

    expect(published.statusCode).toBe(200);
    expect(published.json()).toMatchObject({
      plan: { id: planId, status: "published" },
      blocks: [expect.objectContaining({ status: "published" })]
    });
    expect(client.created).toHaveLength(1);
    expect(client.created[0]?.privateProperties).toMatchObject({
      ryanosOwned: "true",
      ryanosEventKind: "time_block",
      ryanosPlanId: planId
    });
  });

  it("rejects a rule that targets another user's calendar", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const store = new InMemoryRyanStore();
    const otherAccount = await store.upsertProviderAccount({
      userId: "other-user" as UUID,
      provider: "google_calendar",
      externalAccountId: "other@example.com",
      email: "other@example.com",
      status: "active",
      scopes: ["calendar"],
      metadata: {}
    });
    const otherCalendar = await store.upsertGoogleCalendar({
      userId: "other-user" as UUID,
      providerAccountId: otherAccount.id,
      externalCalendarId: "primary",
      name: "Other",
      accessRole: "owner",
      selectedForAvailability: true,
      writeEnabled: true,
      status: "active",
      metadata: {}
    });
    const app = buildApp({ store, calendarClient: new FakeCalendarClient() });
    const response = await app.inject({
      method: "POST",
      url: "/v1/calendar/rules",
      payload: {
        name: "Invalid",
        timezone: "UTC",
        availability: { "5": [{ start: "09:00", end: "10:00" }] },
        targetCalendarId: otherCalendar.id,
        includeStarred: true,
        includeDue: false,
        areaIds: [],
        projectIds: [],
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
        defaultEstimateMinutes: 30,
        minimumChunkMinutes: 15,
        maximumBlockMinutes: 60,
        splitTasks: true,
        enabled: true
      }
    });
    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/user's writable target calendar/);
  });
});
