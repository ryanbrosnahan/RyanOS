import { describe, expect, it } from "vitest";
import { calculateRecurrenceState, isBeforeMinimumInterval } from "./recurrence.js";
import type { RecurrenceEvent, RecurrencePolicy } from "./types.js";

const basePolicy: RecurrencePolicy = {
  id: "recurrence-1",
  userId: "user-1",
  itemId: "item-1",
  type: "completion_based",
  intervalDays: 7,
  resetFromCompletion: true,
  status: "active",
  metadata: {},
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-01T00:00:00.000Z"
};

function event(overrides: Partial<RecurrenceEvent>): RecurrenceEvent {
  return {
    id: "event-1",
    userId: "user-1",
    recurrencePolicyId: "recurrence-1",
    itemId: "item-1",
    eventType: "completed",
    occurredAt: "2026-05-23T15:00:00.000Z",
    payload: {},
    createdAt: "2026-05-23T15:00:00.000Z",
    ...overrides
  };
}

describe("calculateRecurrenceState", () => {
  it("sets next due from the actual completion date", () => {
    const state = calculateRecurrenceState(
      basePolicy,
      [event({ occurredAt: "2026-05-23T15:00:00.000Z" })],
      "2026-05-26T12:00:00.000Z"
    );

    expect(state.lastCompletedAt).toBe("2026-05-23T15:00:00.000Z");
    expect(state.nextDueAt).toBe("2026-05-30T15:00:00.000Z");
  });

  it("ignores a completed day after a later uncompleted event for that day", () => {
    const state = calculateRecurrenceState(
      basePolicy,
      [
        event({
          id: "event-1",
          eventType: "completed",
          occurredAt: "2026-05-23T15:00:00.000Z",
          createdAt: "2026-05-23T15:00:00.000Z"
        }),
        event({
          id: "event-2",
          eventType: "uncompleted",
          occurredAt: "2026-05-23T15:00:00.000Z",
          createdAt: "2026-05-24T15:00:00.000Z"
        })
      ],
      "2026-05-26T12:00:00.000Z"
    );

    expect(state.lastCompletedAt).toBeUndefined();
    expect(state.nextDueAt).toBe("2026-05-26T12:00:00.000Z");
  });

  it("enforces minimum interval before another completion", () => {
    const { intervalDays: _intervalDays, ...policyBase } = basePolicy;
    const policy: RecurrencePolicy = {
      ...policyBase,
      type: "minimum_interval",
      minimumIntervalDays: 7
    };
    const events = [event({ occurredAt: "2026-05-23T15:00:00.000Z" })];

    expect(isBeforeMinimumInterval(policy, "2026-05-29T15:00:00.000Z", events)).toBe(true);
    expect(isBeforeMinimumInterval(policy, "2026-05-30T15:00:00.000Z", events)).toBe(false);
  });
});
