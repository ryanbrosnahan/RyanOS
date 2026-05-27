# RyanOS Tool Contracts

## Purpose

RyanOS is AI-first at the message layer. The assistant should interpret natural
language and choose typed tools. Tool handlers then validate, enforce policy, and
mutate state deterministically.

This document defines the V1 and V2 AI-callable tool surface. It is the contract
between natural language and the database.

## Design Rules

- AI chooses tools; deterministic code owns state.
- Tools accept structured JSON, not raw natural-language commands.
- Every mutating tool writes domain events and audit log entries.
- Every mutating tool accepts an idempotency key or derives one from source
  context.
- Tools return structured results optimized for the AI to explain back to the
  user.
- Tool handlers may ask for confirmation when confidence, safety, or permissions
  require it.
- Tools never receive raw provider secrets.
- External systems are accessed through capabilities, not direct credentials.
- V1 generated skills may propose behavior but cannot auto-enable new powers.

## Common Envelope

All AI-callable tools should share a common envelope.

```ts
type ToolEnvelope = {
  sourceMessageId?: string;
  sourceProvider?: "telegram" | "whatsapp" | "web" | "system";
  sourceChatId?: string;
  sourceUserId?: string;
  timezone?: string;
  confidence?: number;
  idempotencyKey?: string;
  dryRun?: boolean;
  requireConfirmation?: boolean;
};
```

Tool handlers should ignore caller-supplied identity when a trusted session or
context token is available. Identity and routing come from verified runtime
context.

## Common Result

```ts
type ToolResult<T = unknown> = {
  status:
    | "applied"
    | "proposed"
    | "needs_confirmation"
    | "needs_clarification"
    | "replayed"
    | "rejected"
    | "failed";
  data?: T;
  messageForUser?: string;
  clarificationPrompt?: string;
  confirmationPrompt?: string;
  auditId?: string;
  eventIds?: string[];
  warnings?: string[];
};
```

The assistant should use `messageForUser`, `clarificationPrompt`, and
`confirmationPrompt` when responding, but the database state is authoritative.

## Confirmation Defaults

Usually safe without confirmation:

- Create a normal item.
- Mark a routine item complete.
- Record a recurring event from the user's own message.
- Snooze a reminder.
- Update notification quiet hours.
- Link a source to an item or opportunity.
- Create an opportunity from a source.

Usually requires confirmation:

- Send an external message.
- Delete or permanently archive data.
- Grant a new capability.
- Connect a new provider account.
- Purchase, pay, or transfer money.
- Commit, push, deploy, or publish.
- Override a health or safety minimum interval.
- Resolve a materially ambiguous person, account, or item.

## Tool Families

V1 should include the core tools needed for the daily operating loop. V2 expands
into generated skills, deeper integrations, and self-improvement.

## V1: Item Tools

### `item.search`

Find candidate items, projects, areas, opportunities, or recurring definitions
for an ambiguous user reference.

```ts
type ItemSearchInput = ToolEnvelope & {
  query: string;
  kinds?: Array<"item" | "project" | "area" | "opportunity" | "recurrence">;
  includeDone?: boolean;
  limit?: number;
};
```

Validation:

- Scope results to visible records.
- Prefer active/open records.
- Include confidence and reason for each match.

Result data:

```ts
type ItemSearchResult = {
  matches: Array<{
    id: string;
    kind: string;
    title: string;
    status?: string;
    confidence: number;
    reason: string;
  }>;
};
```

### `item.create`

Create a task, reminder, decision, note, waiting item, or generic item.

```ts
type ItemCreateInput = ToolEnvelope & {
  title: string;
  kind: "task" | "reminder" | "decision" | "note" | "waiting" | "habit" | "other";
  areaRef?: string;
  projectRef?: string;
  priority?: "low" | "normal" | "high" | "urgent";
  dueAt?: string;
  startAt?: string;
  estimateMinutes?: number;
  tags?: string[];
  body?: string;
  sourceRefs?: string[];
};
```

Examples:

- "Add a task to review the grant next week."
- "Remind me to send Shaun the party bus decision."
- "Create a waiting item for the county RFP response."

Validation:

- Resolve `areaRef` and `projectRef` or create as inbox item.
- Validate date/time in user's timezone.
- Use idempotency to avoid duplicate tasks from retried messages.

### `item.update`

Update an existing item.

```ts
type ItemUpdateInput = ToolEnvelope & {
  itemRef: string;
  patch: {
    title?: string;
    status?: "open" | "active" | "waiting" | "done" | "cancelled";
    areaRef?: string | null;
    projectRef?: string | null;
    priority?: "low" | "normal" | "high" | "urgent";
    dueAt?: string | null;
    startAt?: string | null;
    estimateMinutes?: number | null;
    tagsAdd?: string[];
    tagsRemove?: string[];
    bodyAppend?: string;
  };
};
```

Validation:

- Require clarification if `itemRef` resolves to multiple likely records.
- Use optimistic concurrency internally.

### `item.complete`

Mark an item complete.

```ts
type ItemCompleteInput = ToolEnvelope & {
  itemRef: string;
  completedAt?: string;
  note?: string;
};
```

Examples:

- "I changed the sheets Saturday."
- "I called Grandpa yesterday."
- "Done with the RFP triage."

Validation:

- If `completedAt` is missing, use message timestamp.
- If a relative date is supplied, resolve using user timezone.
- If item is recurring, completion may trigger next due calculation.

### `item.snooze`

Delay an item, reminder, or opportunity follow-up.

```ts
type ItemSnoozeInput = ToolEnvelope & {
  itemRef: string;
  until: string;
  reason?: string;
};
```

Examples:

- "Can't today, remind me tomorrow."
- "Don't bug me about that grant until next week."

Validation:

- `until` must be in the future unless explicitly recording a past override.
- Preserve original due/reminder state in event payload.

### `item.cancel`

Cancel or soft-delete an item.

```ts
type ItemCancelInput = ToolEnvelope & {
  itemRef: string;
  reason?: string;
  deleteMode?: "cancel" | "soft_delete";
};
```

Confirmation:

- Usually ask before soft-delete unless the item was just created by mistake.

## V1: Recurrence Tools

### `recurrence.setPolicy`

Create or update recurrence rules for an item.

```ts
type RecurrenceSetPolicyInput = ToolEnvelope & {
  itemRef: string;
  policy: {
    type: "completion_based" | "fixed_schedule" | "minimum_interval" | "target_frequency" | "opportunistic";
    intervalDays?: number;
    minimumIntervalDays?: number;
    cron?: string;
    targetCount?: number;
    targetWindowDays?: number;
    preferredDays?: string[];
    preferredTime?: string;
    nagPolicyRef?: string;
    resetFromCompletion?: boolean;
  };
};
```

Examples:

- "I want to change sheets about once a week, based on when I last did it."
- "My shot should never be less than seven days apart."
- "Try to get me to the gym three times a week."

Validation:

- `minimumIntervalDays` must be enforced before reminders or suggestions.
- Completion-based recurrences calculate next due from the latest completion
  event.

### `recurrence.recordEvent`

Record that a recurring thing happened.

```ts
type RecurrenceRecordEventInput = ToolEnvelope & {
  recurrenceRef: string;
  occurredAt?: string;
  eventType: "completed" | "skipped" | "missed" | "deferred";
  note?: string;
};
```

Examples:

- "I did my shot yesterday."
- "Toby got his monthly meds this morning."
- "I changed the sheets Saturday."

Validation:

- Use message timestamp when `occurredAt` is missing.
- Reject or require confirmation if event violates a minimum interval.
- Update derived next due date after event commit.

## V1: Policy Tools

### `policy.upsertNotification`

Create or update notification policy.

```ts
type PolicyUpsertNotificationInput = ToolEnvelope & {
  scope:
    | "global"
    | "area"
    | "project"
    | "item"
    | "channel"
    | "category";
  scopeRef?: string;
  policy: {
    quietHours?: Array<{
      days?: string[];
      start?: string;
      end?: string;
    }>;
    defaultChannel?: "telegram" | "whatsapp" | "dashboard";
    nagIntensity?: "low" | "normal" | "high";
    escalationAfter?: string;
    exceptionUrgency?: "high" | "urgent";
    digestOnly?: boolean;
    pauseUntil?: string;
  };
  reason?: string;
};
```

Examples:

- "Don't message me before 9am on weekends unless it's really important."
- "Nag me harder about Court Nox this week."
- "Stop reminding me about this for a month."

Validation:

- Resolve policy precedence.
- Store source message and previous policy snapshot.

### `policy.explain`

Explain why the system notified, suppressed, escalated, or planned something.

```ts
type PolicyExplainInput = ToolEnvelope & {
  subjectRef: string;
  question?: string;
};
```

Examples:

- "Why did you remind me about this today?"
- "Why didn't this show up in my daily plan?"

## V1: Planning Tools

### `plan.generateDaily`

Generate a daily plan from current tasks, calendar constraints, policies, and
energy/capacity assumptions.

```ts
type PlanGenerateDailyInput = ToolEnvelope & {
  date?: string;
  mode?: "whole_day" | "morning" | "afternoon" | "evening";
  capacityMinutes?: number;
  includeStretch?: boolean;
};
```

Result data:

```ts
type DailyPlan = {
  date: string;
  successCriteria: Array<{ itemId: string; title: string; reason: string }>;
  corePlan: Array<{ itemId: string; title: string; suggestedBlock?: string }>;
  stretch: Array<{ itemId: string; title: string }>;
  easyWins: Array<{ itemId: string; title: string }>;
  overloadWarning?: string;
};
```

Validation:

- Do not silently overcommit the day.
- Return an overload warning when planned work exceeds capacity.

### `plan.commitDaily`

Persist a selected daily plan.

```ts
type PlanCommitDailyInput = ToolEnvelope & {
  planId?: string;
  date: string;
  selectedItemRefs: string[];
  note?: string;
};
```

Confirmation:

- Not required unless committing calendar changes or notifications.

## V1: Source And Opportunity Tools

### `source.link`

Link an external source to an item, project, opportunity, person, or decision.

```ts
type SourceLinkInput = ToolEnvelope & {
  source: {
    provider: "gmail" | "calendar" | "slack" | "web" | "document" | "manual" | "rfp_feed";
    externalId?: string;
    url?: string;
    title?: string;
    summary?: string;
    occurredAt?: string;
    metadata?: Record<string, unknown>;
  };
  targetRef: string;
  relation: "supports" | "created_from" | "follow_up_for" | "evidence" | "context";
};
```

### `opportunity.create`

Create an opportunity from an RFP, grant, sales lead, email, search result, or
manual note.

```ts
type OpportunityCreateInput = ToolEnvelope & {
  title: string;
  sourceRefs?: string[];
  dueAt?: string;
  decisionBy?: string;
  fit?: "unknown" | "low" | "medium" | "high";
  valueEstimate?: string;
  nextAction?: string;
  projectRef?: string;
  notes?: string;
};
```

Examples:

- "This grant could be relevant; follow up in two weeks."
- "That RFP seems like a good fit but not urgent."

Validation:

- If `dueAt` exists, create or update a follow-up item.
- Avoid duplicate opportunities from the same source URL/thread.

### `opportunity.update`

Update status, fit, deadline, or next action for an opportunity.

```ts
type OpportunityUpdateInput = ToolEnvelope & {
  opportunityRef: string;
  patch: {
    status?: "tracking" | "active" | "submitted" | "won" | "lost" | "declined";
    dueAt?: string | null;
    decisionBy?: string | null;
    fit?: "unknown" | "low" | "medium" | "high";
    nextAction?: string | null;
    notesAppend?: string;
  };
};
```

## V1: Capability Tools

### `capability.propose`

Create a proposal for a new trusted power.

```ts
type CapabilityProposeInput = ToolEnvelope & {
  capabilityId: string;
  description: string;
  provider: string;
  operations: Array<{
    name: string;
    mutating: boolean;
    sensitive: boolean;
  }>;
  requestedFor: "skill" | "integration" | "user_request";
  reason: string;
};
```

Examples:

- "Start monitoring Slack."
- "Check all my Gmail accounts."

Validation:

- Proposals do not grant access.
- Mutating operations require separate permission from read/draft operations.

### `capability.auth.begin`

Start an approved provider auth flow.

```ts
type CapabilityAuthBeginInput = ToolEnvelope & {
  capabilityId: string;
  providerAccountHint?: string;
};
```

Confirmation:

- Requires an approved capability proposal or explicit user action.

## V1: Skill Tools

### `skill.propose`

Propose a new skill or skill change.

```ts
type SkillProposeInput = ToolEnvelope & {
  goal: string;
  triggerExamples: string[];
  requiredCapabilities: string[];
  schedule?: string;
  riskLevel: "low" | "medium" | "high";
  proposedBehavior: string;
};
```

Examples:

- "Start monitoring Slack for urgent FileMyTro stuff."
- "Make a skill that helps triage wedding emails."

Validation:

- Skill proposals are pending by default.
- Required capabilities must exist or be proposed separately.
- No generated code execution in V1.

### `skill.validate`

Validate a pending skill package.

```ts
type SkillValidateInput = ToolEnvelope & {
  skillRef: string;
};
```

### `skill.enable`

Enable a validated skill.

```ts
type SkillEnableInput = ToolEnvelope & {
  skillRef: string;
  enabled: boolean;
};
```

Confirmation:

- Required when enabling a skill for the first time.
- Required when the skill uses sensitive capabilities.

## V1: Explanation Tools

### `state.explain`

Explain current state, recent decisions, reminders, or assistant behavior.

```ts
type StateExplainInput = ToolEnvelope & {
  subjectRef?: string;
  question: string;
  includeAudit?: boolean;
};
```

Examples:

- "What should I do today?"
- "Why are you nagging me about this?"
- "What happened with that grant from last week?"

## V1.5: Drafting Tools

These tools can be added after core item/recurrence/policy tools work.

### `draft.createExternalResponse`

Create a draft for email, Slack, WhatsApp, or another external system.

```ts
type DraftCreateExternalResponseInput = ToolEnvelope & {
  provider: "gmail" | "slack" | "whatsapp";
  accountRef?: string;
  threadRef?: string;
  recipientRefs?: string[];
  subject?: string;
  body: string;
  tone?: string;
  sourceRefs?: string[];
};
```

Confirmation:

- Drafting does not require confirmation if no external send occurs.
- Sending requires a separate mutating capability and confirmation.

## V2: Generated Skills And Self-Improvement

### `skill.generatePackage`

Generate or update a skill package in a pending workspace.

```ts
type SkillGeneratePackageInput = ToolEnvelope & {
  proposalRef: string;
  targetSkillId: string;
};
```

Validation:

- Generated package must include `SKILL.md`.
- Package must validate against skill schema.
- Tests or dry-run instructions are required for non-trivial skills.
- No raw secrets in skill files.

### `skill.runDryRun`

Run a pending skill in dry-run mode.

```ts
type SkillRunDryRunInput = ToolEnvelope & {
  skillRef: string;
  sampleInput: string;
};
```

### `repo.proposeChange`

Propose app code changes for self-improvement.

```ts
type RepoProposeChangeInput = ToolEnvelope & {
  goal: string;
  affectedAreas: string[];
  expectedBehavior: string;
  riskLevel: "low" | "medium" | "high";
};
```

Rules:

- AI may propose patches, branches, or pull requests.
- AI may not deploy production changes without explicit approval.
- Code changes require tests appropriate to risk.

### `sandbox.execute`

Run approved generated code in a restricted sandbox.

```ts
type SandboxExecuteInput = ToolEnvelope & {
  skillRef?: string;
  command: string[];
  network?: "none" | "approved_hosts";
  timeoutSeconds?: number;
};
```

V2 only. Not part of V1.

## Tool Implementation Checklist

Every mutating tool must implement:

- JSON schema validation.
- Verified caller context.
- Permission check.
- Idempotency.
- Optimistic concurrency where editing existing records.
- Domain event write.
- Audit log write.
- Structured result.
- Tests for success, ambiguity, permission failure, and replay.

## Open Questions

- Exact confidence thresholds for auto-apply versus clarification.
- Whether medication/health items should have a global stricter confirmation
  policy.
- How much `codex-bridge` can support structured tool calling reliably.
- Whether V1 should expose tools through OpenAI-style tool definitions, an MCP
  server, or an internal abstraction that can adapt to both.

