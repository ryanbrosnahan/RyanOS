import { InMemoryRyanStore } from "@ryanos/core";
import type { UUID } from "@ryanos/shared";
import { describe, expect, it } from "vitest";
import {
  generateTimeBlockSchedule,
  normalizeTimeBlockRule,
  validateTimeBlockRule
} from "../src/calendar-scheduling.js";

async function schedulingFixture() {
  const store = new InMemoryRyanStore();
  const userId = "user-calendar" as UUID;
  const account = await store.upsertProviderAccount({
    userId,
    provider: "google_calendar",
    externalAccountId: "ryan@example.com",
    email: "ryan@example.com",
    status: "active",
    scopes: ["calendar"],
    metadata: {}
  });
  const calendar = await store.upsertGoogleCalendar({
    userId,
    providerAccountId: account.id,
    externalCalendarId: "primary",
    name: "Primary",
    timezone: "UTC",
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
  const storedItem = (await store.getItem(item.id))!;
  const rule = normalizeTimeBlockRule({
    name: "Work day",
    timezone: "UTC",
    targetCalendarId: calendar.id,
    availability: {
      "5": [{ start: "09:00", end: "12:00" }]
    },
    includeStarred: true,
    includeDue: true,
    bufferBeforeMinutes: 15,
    bufferAfterMinutes: 15,
    defaultEstimateMinutes: 30,
    minimumChunkMinutes: 15,
    maximumBlockMinutes: 120,
    splitTasks: true
  });
  return { store, userId, account, calendar, item: storedItem, rule };
}

describe("calendar time-block scheduling", () => {
  it("schedules starred work around busy events and buffers", async () => {
    const { store, userId, account, calendar, item, rule } = await schedulingFixture();
    const busy = await store.upsertGoogleCalendarEvent({
      userId,
      providerAccountId: account.id,
      googleCalendarId: calendar.id,
      externalEventId: "busy-1",
      title: "Call",
      startAt: "2026-07-24T10:00:00.000Z",
      endAt: "2026-07-24T10:30:00.000Z",
      status: "confirmed",
      transparency: "opaque",
      syncedAt: "2026-07-24T08:00:00.000Z",
      metadata: {}
    });

    const result = generateTimeBlockSchedule({
      dateKey: "2026-07-24",
      rule,
      items: [item],
      events: [busy],
      calendars: [calendar]
    });

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]).toMatchObject({
      itemId: item.id,
      startAt: "2026-07-24T10:45:00.000Z",
      endAt: "2026-07-24T11:45:00.000Z"
    });
    expect(result.availableMinutes).toBe(120);
    expect(result.unscheduledItemIds).toEqual([]);
  });

  it("ignores transparent events and all-day events unless their calendar blocks availability", async () => {
    const { store, userId, account, calendar, item, rule } = await schedulingFixture();
    const allDay = await store.upsertGoogleCalendarEvent({
      userId,
      providerAccountId: account.id,
      googleCalendarId: calendar.id,
      externalEventId: "all-day",
      title: "Birthday",
      startAt: "2026-07-24T00:00:00.000Z",
      endAt: "2026-07-25T00:00:00.000Z",
      allDay: true,
      status: "confirmed",
      transparency: "opaque",
      metadata: {}
    });
    const transparent = await store.upsertGoogleCalendarEvent({
      userId,
      providerAccountId: account.id,
      googleCalendarId: calendar.id,
      externalEventId: "free",
      title: "FYI",
      startAt: "2026-07-24T09:00:00.000Z",
      endAt: "2026-07-24T11:00:00.000Z",
      status: "confirmed",
      transparency: "transparent",
      metadata: {}
    });

    const result = generateTimeBlockSchedule({
      dateKey: "2026-07-24",
      rule,
      items: [item],
      events: [allDay, transparent],
      calendars: [calendar]
    });

    expect(result.blocks[0]?.startAt).toBe("2026-07-24T09:00:00.000Z");
  });

  it("splits long work and reports the remainder when the day is full", async () => {
    const { store, calendar, item, rule } = await schedulingFixture();
    const longItem = await store.updateItem(item.id, { estimateMinutes: 240 });

    const result = generateTimeBlockSchedule({
      dateKey: "2026-07-24",
      rule: { ...rule, maximumBlockMinutes: 90, minimumChunkMinutes: 30 },
      items: [longItem],
      events: [],
      calendars: [calendar]
    });

    expect(result.blocks.map((block) => block.estimatedMinutes)).toEqual([90, 90]);
    expect(result.scheduledMinutes).toBe(180);
    expect(result.unscheduledItemIds).toEqual([item.id]);
  });

  it("requires availability, a target calendar, and an eligible task source", () => {
    const rule = normalizeTimeBlockRule({
      availability: {},
      includeStarred: false,
      includeDue: false
    });
    expect(validateTimeBlockRule(rule)).toBe("Choose a writable target calendar.");
    expect(validateTimeBlockRule({ ...rule, targetCalendarId: "calendar-1" }))
      .toBe("Add at least one availability window.");
    expect(validateTimeBlockRule({
      ...rule,
      targetCalendarId: "calendar-1",
      availability: { "1": [{ start: "09:00", end: "10:00" }] }
    })).toBe("Enable starred tasks, due tasks, or both.");
  });
});
