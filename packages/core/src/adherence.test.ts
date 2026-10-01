import { describe, expect, it } from "vitest";
import { buildAdherenceReport } from "./adherence.js";
import type { RecurrenceEvent, RecurrencePolicy } from "./types.js";

const policy: RecurrencePolicy = {
  id: "rule",
  itemId: "gym",
  userId: "owner",
  type: "target_frequency",
  targetCount: 3,
  targetWindowDays: 7,
  resetFromCompletion: true,
  status: "active",
  metadata: {},
  createdAt: "2020-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};
function event(
  day: string,
  eventType: RecurrenceEvent["eventType"] = "completed",
  createdAt?: string,
): RecurrenceEvent {
  const occurredAt = day.includes("T") ? day : `${day}T12:00:00Z`;
  return {
    id: day,
    recurrencePolicyId: "rule",
    itemId: "gym",
    userId: "owner",
    eventType,
    occurredAt,
    createdAt: createdAt ?? occurredAt,
    payload: {},
  };
}
const report = (
  events: RecurrenceEvent[],
  now = "2026-01-15T12:00:00Z",
  timezone = "UTC",
  rule = policy,
) => buildAdherenceReport({ policy: rule, events, now, timezone });

describe("adherence reports", () => {
  it("starts at the first effective completion and includes inactive days", () => {
    const result = report([
      event("2025-12-01", "skipped"),
      event("2026-01-01"),
      event("2026-01-03"),
      event("2026-01-04", "skipped"),
    ]);
    expect(result.start).toBe("2026-01-01");
    expect(result.total).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.trackedDays).toBe(15);
    expect(result.weeklyAverage).toBeCloseTo(14 / 15);
    expect(result.monthlyAverage).toBeCloseTo(((2 / 15) * 365.2425) / 12);
    expect(result.adherence).toMatchObject({
      expected: 6,
      credited: 2,
      windows: 2,
      met: 0,
    });
  });
  it("caps each closed period and excludes the open period", () => {
    const result = report(
      [1, 2, 3, 4, 5, 8, 15].map((day) =>
        event(`2026-01-${String(day).padStart(2, "0")}`),
      ),
    );
    expect(result.total).toBe(7);
    expect(result.adherence).toMatchObject({
      expected: 6,
      credited: 4,
      met: 1,
      windows: 2,
    });
    expect(result.adherence?.percent).toBeCloseTo((100 * 4) / 6);
  });
  it("counts one completion per local day and honors backdated corrections", () => {
    const result = report([
      event("2026-01-01T23:00:00Z"),
      event("2026-01-01T22:00:00Z"),
      event("2026-01-01T12:00:00Z", "uncompleted", "2026-01-04T00:00:00Z"),
      event("2026-01-02"),
      event("2026-01-02T14:00:00Z"),
    ]);
    expect(result.total).toBe(1);
    expect(result.start).toBe("2026-01-02");
  });
  it("uses local dates across DST and UTC midnight without fractional day errors", () => {
    const result = report(
      [event("2026-03-08T05:30:00Z"), event("2026-03-08T07:30:00Z")],
      "2026-03-09T04:00:00Z",
      "America/Chicago",
    );
    expect(result.start).toBe("2026-03-07");
    expect(result.through).toBe("2026-03-08");
    expect(result.trackedDays).toBe(2);
    expect(result.total).toBe(2);
  });
  it("returns an honest empty state and ignores future completions", () => {
    const result = report([
      event("2026-02-01"),
      event("2026-01-01", "skipped"),
    ]);
    expect(result.start).toBeNull();
    expect(result.total).toBe(0);
    expect(result.weeklyAverage).toBe(0);
    expect(result.adherence?.percent).toBeNull();
  });
  it("includes lifetime history beyond the visible year and leap days", () => {
    const result = report(
      [event("2023-01-01"), event("2024-02-29")],
      "2024-12-31T12:00:00Z",
    );
    expect(result.trackedDays).toBe(731);
    expect(result.total).toBe(2);
    expect(result.calendar).toHaveLength(366);
    expect(
      result.months.find((month) => month.month === "2024-02"),
    ).toMatchObject({ completed: 1, trackedDays: 29, partial: false });
  });
  it("does not invent a quota for minimum interval or opportunistic rules", () => {
    for (const type of ["minimum_interval", "opportunistic"] as const) {
      expect(
        report([event("2026-01-01")], undefined, undefined, { ...policy, type })
          .adherence,
      ).toBeNull();
    }
  });
  it("uses full scheduled months for a monthly benchmark, excluding nonexistent dates", () => {
    const result = report(
      [event("2026-01-01"), event("2026-03-03"), event("2026-03-04")],
      "2026-04-01T12:00:00Z",
      "UTC",
      { ...policy, type: "fixed_schedule", cron: "0 9 31 * *" },
    );
    expect(result.adherence).toMatchObject({
      expected: 2,
      credited: 2,
      windows: 2,
      met: 2,
      percent: 100,
    });
  });
});
