import { addDaysIso, nowIso } from "@ryanos/shared";
import type { RecurrenceEvent, RecurrencePolicy, RecurrenceState } from "./types.js";

function eventDayKey(event: RecurrenceEvent): string {
  return event.occurredAt.slice(0, 10);
}

export function effectiveCompletedRecurrenceEvents(events: RecurrenceEvent[]): RecurrenceEvent[] {
  const byDay = new Map<string, RecurrenceEvent>();
  const ordered = [...events].sort((a, b) => {
    const occurred = a.occurredAt.localeCompare(b.occurredAt);
    if (occurred !== 0) return occurred;
    return a.createdAt.localeCompare(b.createdAt);
  });

  for (const event of ordered) {
    if (event.eventType === "completed") {
      byDay.set(eventDayKey(event), event);
    } else if (event.eventType === "uncompleted") {
      byDay.delete(eventDayKey(event));
    }
  }

  return [...byDay.values()].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}

export function calculateRecurrenceState(
  policy: RecurrencePolicy,
  events: RecurrenceEvent[],
  now = nowIso()
): RecurrenceState {
  const ordered = [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const lastEvent = ordered.at(-1);
  const completed = effectiveCompletedRecurrenceEvents(events);
  const lastCompleted = completed.at(-1);

  const baseState: RecurrenceState = {
    recurrencePolicyId: policy.id,
    stalenessScore: 0,
    updatedAt: now
  };

  if (lastEvent) {
    baseState.lastEventAt = lastEvent.occurredAt;
  }
  if (lastCompleted) {
    baseState.lastCompletedAt = lastCompleted.occurredAt;
  }

  if (policy.minimumIntervalDays && lastCompleted) {
    baseState.nextEligibleAt = addDaysIso(lastCompleted.occurredAt, policy.minimumIntervalDays);
  }

  if (policy.type === "completion_based" && policy.intervalDays && lastCompleted) {
    baseState.nextDueAt = addDaysIso(lastCompleted.occurredAt, policy.intervalDays);
  } else if (policy.type === "minimum_interval" && baseState.nextEligibleAt) {
    baseState.nextDueAt = baseState.nextEligibleAt;
  } else if (!lastCompleted && policy.type !== "fixed_schedule") {
    baseState.nextDueAt = now;
  }

  if (baseState.nextDueAt) {
    const due = new Date(baseState.nextDueAt).getTime();
    const current = new Date(now).getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    baseState.stalenessScore = Math.max(0, Math.floor((current - due) / dayMs));
  }

  return baseState;
}

export function isBeforeMinimumInterval(
  policy: RecurrencePolicy,
  candidateAt: string,
  events: RecurrenceEvent[]
): boolean {
  if (!policy.minimumIntervalDays) {
    return false;
  }
  const completed = effectiveCompletedRecurrenceEvents(events);
  const lastCompleted = completed.at(-1);
  if (!lastCompleted) {
    return false;
  }
  const nextEligibleAt = addDaysIso(lastCompleted.occurredAt, policy.minimumIntervalDays);
  return new Date(candidateAt).getTime() < new Date(nextEligibleAt).getTime();
}
