# RyanOS Message Pipeline

## Goal

RyanOS should be AI-first at the message interpretation layer.

The user should be able to say things naturally:

- "I did my shot yesterday."
- "Stop nagging me about this for a month."
- "That RFP looks interesting but I don't want to think about it until next week."
- "Don't message me before 9am on weekends unless it's really important."
- "Start monitoring Slack for anything from the FileMyTro channel that sounds urgent."

The system should not hardcode phrase parsing for these messages. The AI should
understand the message in context and choose typed tools. Deterministic code
should validate and apply the resulting state changes.

## Core Pattern

```text
Telegram / WhatsApp / Web / Scheduled job
  -> Provider adapter
  -> IncomingMessage
  -> Session and context loader
  -> AI agent with typed tools
  -> Tool calls
  -> Deterministic handlers
  -> Database mutations and audit log
  -> Assistant response or notification
```

This follows the useful pattern from `dcramer/ash`: provider messages are
normalized, the raw text is passed to the agent with context, and the model
chooses tools. The tool layer owns actual state changes.

## Non-Goals

- Do not build a regex command parser for natural language.
- Do not make chat commands the primary interface.
- Do not let AI directly mutate the database.
- Do not let AI bypass permissions, recurrence rules, minimum intervals, or audit
  logging.
- Do not expose raw secrets to the AI or to generated skills.

## IncomingMessage

Every provider should normalize input into a common shape before agent handling.

```ts
type IncomingMessage = {
  id: string;
  provider: "telegram" | "whatsapp" | "web" | "system";
  accountId?: string;
  chatId: string;
  userId: string;
  text: string;
  username?: string;
  displayName?: string;
  replyToMessageId?: string;
  timestamp: string;
  attachments: IncomingAttachment[];
  metadata: Record<string, unknown>;
};
```

Provider adapters may do basic transport work such as:

- verifying sender authorization;
- stripping bot mentions in group chats;
- downloading attachments;
- setting typing indicators or reactions;
- splitting long outbound messages;
- recording delivery metadata.

Provider adapters should not interpret personal task intent.

## Agent Context

Before calling AI, the app should gather structured context:

- authenticated user;
- active chat/session/thread;
- current local time and timezone;
- recent messages;
- relevant active items;
- relevant policies;
- available capabilities and permissions;
- pending confirmations;
- source metadata from reply context;
- recent audit entries if they explain current state;
- optional memory/search context.

The context should be explicit enough that the AI can select the right tool
without brittle parsing logic.

## Tool-Calling Contract

Typed tools are the stable boundary between natural language and the database.

The AI may call tools such as:

```ts
recordRecurringEvent({
  itemRef: "GLP-1 shot",
  occurredAt: "2026-05-25",
  eventType: "completed",
  confidence: 0.91,
  sourceMessageId: "..."
});

upsertNotificationPolicy({
  scope: "weekends",
  quietUntil: "09:00",
  exceptionUrgency: "high",
  sourceMessageId: "..."
});

snoozeItem({
  itemRef: "review RFP",
  until: "2026-06-02T09:00:00-05:00",
  reason: "User wants to revisit next week",
  sourceMessageId: "..."
});

proposeSkill({
  goal: "Monitor Slack for urgent FileMyTro items",
  requiredCapabilities: ["slack.search", "slack.read_channel"],
  proposedSchedule: "every 30 minutes during work hours",
  sourceMessageId: "..."
});
```

The AI chooses and fills tool calls. Tool handlers own validation and mutation.

## Deterministic Handler Responsibilities

Every state-changing tool handler must:

- validate input schema;
- resolve ambiguous references;
- check permissions;
- enforce minimum intervals and recurrence rules;
- handle idempotency;
- decide whether confirmation is required;
- write domain events;
- write audit log entries;
- return a structured result to the AI.

The handler may refuse or ask for confirmation when confidence is too low.

Examples:

- If "my shot" maps confidently to one recurring item, record it.
- If "call him" has multiple likely people, ask a clarifying question.
- If a requested completion would violate a minimum medication interval, refuse
  or require explicit override depending on policy.
- If a request would grant a new external capability, create a proposal instead
  of enabling it.

## Confirmation Policy

The system should avoid pestering for confirmation on low-risk, reversible
actions, but require confirmation for sensitive or ambiguous actions.

Usually safe without confirmation:

- marking a routine task complete;
- snoozing a reminder;
- updating a notification preference;
- creating a low-risk task;
- recording a factual event from the user's own message.

Usually requires confirmation:

- sending an email or external message;
- deleting data;
- granting a new capability;
- connecting a new provider account;
- making purchases;
- committing, deploying, or publishing;
- changing high-impact health or finance rules;
- resolving a materially ambiguous identity or task.

## Idempotency

Messages can be retried or delivered twice. Tool calls must be idempotent.

Use keys derived from:

- provider;
- chat ID;
- message ID;
- tool name;
- normalized target;
- operation type.

If the same user message is processed again, the handler should return the
existing result instead of duplicating events or reminders.

## Audit Trail

Each message turn should produce an audit chain:

1. incoming message received;
2. context loaded;
3. AI provider called;
4. tool call proposed;
5. tool handler validated;
6. state mutation applied or rejected;
7. response/notification sent.

The audit log should make it possible to answer:

- Why did the assistant do this?
- What source message caused it?
- What did the AI infer?
- What did deterministic code validate?
- What changed in the database?
- Was user confirmation required?

## Passive And Proactive Messages

Not all AI turns start from a direct user message.

Scheduled jobs and monitors should create system messages with context, then run
through the same agent/tool loop.

Examples:

- "This grant is due in two weeks. Should we schedule review time?"
- "It has been eight days since this recurring task was completed."
- "The weather is good and this park is open."
- "An inbox monitor found a message that likely needs attention."

System-originated messages should still respect notification policies,
permissions, quiet hours, idempotency, and audit logging.

## Data Model Implication

Current implementation status:

- `/v1/messages` accepts normalized web/system messages and optional typed tool
  calls.
- `/v1/webhooks/telegram` and `/v1/inbound/telegram` normalize Telegram updates
  into `IncomingMessage`.
- Postgres-backed runs persist sessions/messages before AI interpretation.
- Assistant response text is persisted as an outbound message with an
  idempotent `response:<source-message-id>` provider message ID.
- Provider redelivery reuses the stored message row instead of duplicating it.
- Intent interpretation is still behind the AI provider abstraction; the current
  provider is `none`, so no natural-language parser has been added.

The data model should be designed around AI-callable operations, not dashboard
CRUD alone.

For V1, the most important tool families are:

- item create/update/complete/snooze;
- recurring event recording;
- notification policy update;
- daily plan generation;
- opportunity tracking/follow-up;
- source linking;
- skill proposal;
- capability proposal;
- audit lookup/explain.

Dashboard screens should expose and inspect the same state that tools mutate.
