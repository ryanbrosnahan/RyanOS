import { addDaysIso, nowIso } from "@ryanos/shared";
import type { RecurrenceEvent, RecurrencePolicy, RecurrenceState } from "./types.js";

export function calculateRecurrenceState(
  policy: RecurrencePolicy,
  events: RecurrenceEvent[],
  now = nowIso()
): RecurrenceState {
  const ordered = [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const lastEvent = ordered.at(-1);
  const completed = ordered.filter((event) => event.eventType === "completed");
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
  const completed = events
    .filter((event) => event.eventType === "completed")
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const lastCompleted = completed.at(-1);
  if (!lastCompleted) {
    return false;
  }
  const nextEligibleAt = addDaysIso(lastCompleted.occurredAt, policy.minimumIntervalDays);
  return new Date(candidateAt).getTime() < new Date(nextEligibleAt).getTime();
}

