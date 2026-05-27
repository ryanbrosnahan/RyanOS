import type { ISODateString, JsonObject, UUID } from "@ryanos/shared";

export type ItemKind =
  | "task"
  | "reminder"
  | "decision"
  | "note"
  | "waiting"
  | "habit"
  | "opportunity_action"
  | "other";

export type ItemStatus = "open" | "active" | "waiting" | "done" | "cancelled";
export type Priority = "low" | "normal" | "high" | "urgent";
export type PolicyType =
  | "notification"
  | "planning"
  | "confirmation"
  | "retention"
  | "permission"
  | "other";
export type PolicyStatus = "active" | "paused" | "archived" | "disabled";

export type Area = {
  id: UUID;
  userId: UUID;
  name: string;
  description?: string;
  status: string;
  sortOrder: number;
  metadata: JsonObject;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  deletedAt?: ISODateString;
};

export type Project = {
  id: UUID;
  userId: UUID;
  areaId?: UUID;
  name: string;
  description?: string;
  status: string;
  priority: Priority;
  dueAt?: ISODateString;
  reviewAfter?: ISODateString;
  metadata: JsonObject;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  deletedAt?: ISODateString;
};

export type Item = {
  id: UUID;
  userId: UUID;
  areaId?: UUID;
  projectId?: UUID;
  kind: ItemKind;
  title: string;
  body?: string;
  status: ItemStatus;
  priority: Priority;
  dueAt?: ISODateString;
  startAt?: ISODateString;
  snoozedUntil?: ISODateString;
  estimateMinutes?: number;
  completedAt?: ISODateString;
  cancelledAt?: ISODateString;
  revision: number;
  metadata: JsonObject;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  deletedAt?: ISODateString;
};

export type ItemEventType =
  | "created"
  | "updated"
  | "completed"
  | "uncompleted"
  | "snoozed"
  | "cancelled"
  | "deleted"
  | "linked_source"
  | "policy_changed";

export type ItemEvent = {
  id: UUID;
  userId: UUID;
  itemId: UUID;
  eventType: ItemEventType;
  occurredAt: ISODateString;
  sourceMessageId?: string;
  idempotencyKey?: string;
  payload: JsonObject;
  createdAt: ISODateString;
};

export type RecurrenceType =
  | "completion_based"
  | "fixed_schedule"
  | "minimum_interval"
  | "target_frequency"
  | "opportunistic";

export type RecurrencePolicy = {
  id: UUID;
  userId: UUID;
  itemId: UUID;
  type: RecurrenceType;
  intervalDays?: number;
  minimumIntervalDays?: number;
  cron?: string;
  targetCount?: number;
  targetWindowDays?: number;
  preferredDays?: string[];
  preferredTime?: string;
  resetFromCompletion: boolean;
  status: "active" | "paused" | "archived";
  metadata: JsonObject;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  deletedAt?: ISODateString;
};

export type RecurrenceEventType =
  | "completed"
  | "uncompleted"
  | "skipped"
  | "missed"
  | "deferred";

export type RecurrenceEvent = {
  id: UUID;
  userId: UUID;
  recurrencePolicyId: UUID;
  itemId: UUID;
  eventType: RecurrenceEventType;
  occurredAt: ISODateString;
  sourceMessageId?: string;
  note?: string;
  idempotencyKey?: string;
  payload: JsonObject;
  createdAt: ISODateString;
};

export type RecurrenceState = {
  recurrencePolicyId: UUID;
  lastEventAt?: ISODateString;
  lastCompletedAt?: ISODateString;
  nextEligibleAt?: ISODateString;
  nextDueAt?: ISODateString;
  stalenessScore: number;
  updatedAt: ISODateString;
};

export type AuditLog = {
  id: UUID;
  userId: UUID;
  actorType: "user" | "ai" | "system" | "worker" | "skill" | "capability";
  action: string;
  targetType?: string;
  targetId?: string;
  sourceMessageId?: string;
  toolName?: string;
  request: JsonObject;
  result: JsonObject;
  status: "success" | "rejected" | "failed" | "needs_confirmation";
  occurredAt: ISODateString;
  metadata: JsonObject;
};

export type Policy = {
  id: UUID;
  userId: UUID;
  type: PolicyType;
  scope: string;
  scopeRef?: string;
  priority: number;
  status: PolicyStatus;
  startsAt?: ISODateString;
  expiresAt?: ISODateString;
  rules: JsonObject;
  sourceMessageId?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  deletedAt?: ISODateString;
};
