# RyanOS Implementation Plan

## Goal

Build RyanOS as an AI-first, local-first personal operating system. The assistant
interprets natural language into typed tool calls; deterministic code validates
and mutates state.

The plan covers V1 through V2. V1 proves the core loop. V2 adds generated
skills, deeper integrations, self-improvement, and stronger autonomy controls.

## Operating Principles

- Ask before material tech stack changes.
- Build the AI/tool loop before dashboard polish.
- Keep deterministic state authoritative.
- Do not hardcode natural-language parsing.
- Keep secrets and capabilities host-owned.
- Make every mutation auditable.
- Keep user-specific configuration/data outside the OSS boundary.
- Prefer small vertical slices over broad unfinished surfaces.

## Ash-Inspired Patterns To Adopt

When implementation details are uncertain, prefer these patterns from
`dcramer/ash`:

- Normalize provider messages, then let the agent interpret raw text with
  context and tools.
- Keep todo/task state as a reliable ledger, not best-effort memory extraction.
- Route scheduled jobs back through the agent with timing context when judgment
  is needed.
- Use host-owned capabilities for sensitive external systems.
- Never give skills raw long-lived credentials.
- Treat skills as explicit, isolated behaviors invoked through a tool.
- Let skills declare required capabilities, but keep provider/runtime wiring
  host-owned.
- Use signed/verified runtime context for identity and routing.
- Optimize tool and schedule outputs for AI consumption and user explanation.
- Keep extension hooks explicit instead of adding feature-specific branches to
  core runtime.

## Accepted Stack

- Docker Compose.
- Node.js and TypeScript.
- `pnpm` workspaces.
- Fastify API service.
- Next.js, React, and Tailwind dashboard.
- PostgreSQL with `pgvector` available.
- Drizzle ORM and migrations.
- Graphile Worker.
- Better Auth.
- grammY for Telegram.
- Direct Meta WhatsApp Cloud API after Telegram.
- Caddy for future public HTTPS.

## Repository Shape

```text
apps/
  api/                 Fastify API and AI/tool orchestration endpoints
  web/                 Next.js dashboard
  worker/              Graphile Worker jobs
  bot-telegram/        Telegram provider adapter
  bot-whatsapp/        WhatsApp provider adapter, post-Telegram

packages/
  ai/                  Provider abstraction and tool-calling adapter
  capabilities/        Trusted integration contracts and host operations
  core/                Domain logic: recurrence, policies, planning
  db/                  Drizzle schema, migrations, seeds
  skills/              Skill registry, validator, proposal model
  sandbox/             V2 isolated execution runner
  shared/              Shared types and utilities

docs/
  Optional later home for architecture docs if root gets crowded
```

The current root planning docs can remain at repo root until code scaffolding.

## Milestone 0: Planning Baseline

Status: in progress.

Artifacts:

- `ARCHITECTURE.md`
- `MESSAGE_PIPELINE.md`
- `TOOL_CONTRACTS.md`
- `DATA_MODEL.md`
- `IMPLEMENTATION_PLAN.md`

Acceptance criteria:

- AI-first message flow is explicit.
- V1 and V2 boundaries are defined.
- Deferred decisions are intentional and small.
- The next step can be scaffolding without reopening core architecture.

## Milestone 1: Project Scaffold

Purpose: create the working repo foundation without implementing product
behavior yet.

Tasks:

- Initialize `pnpm` workspace.
- Add TypeScript config shared across packages.
- Add ESLint/Prettier or equivalent formatting.
- Add Docker Compose with Postgres.
- Enable `pgvector` extension in Postgres image/init.
- Create `apps/api` with Fastify health endpoint.
- Create `apps/worker` with Graphile Worker boot path.
- Create `apps/web` with Next.js.
- Create `packages/db` with Drizzle config.
- Create `packages/core`, `packages/ai`, `packages/capabilities`,
  `packages/skills`, `packages/shared`.
- Add `.env.example`.
- Add local dev scripts.

Acceptance criteria:

- `docker compose up` starts Postgres and app services.
- API health endpoint responds.
- Worker process starts and can connect to DB.
- Web app loads.
- Drizzle can run an empty or initial migration.

Out of scope:

- Real AI calls.
- Telegram.
- Dashboard UX beyond shell.

## Milestone 2: Database Foundation

Purpose: implement the smallest reliable state model.

Tasks:

- Create initial Drizzle schema for:
  - `users`
  - `sessions`
  - `messages`
  - `areas`
  - `projects`
  - `items`
  - `item_events`
  - `recurrence_policies`
  - `recurrence_events`
  - `recurrence_state`
  - `policies`
  - `policy_events`
  - `audit_logs`
  - `search_documents`
- Add seed/demo data.
- Add repository functions for core tables.
- Add optimistic concurrency support for mutable records.
- Add idempotency helpers.
- Add audit helper.

Acceptance criteria:

- Migrations run from clean DB.
- Tests cover item create/update/complete/snooze.
- Tests cover idempotency replay.
- Tests cover audit write on mutation.
- Tests cover recurrence next-due calculation from completion events.

Out of scope:

- Full provider accounts.
- Skills.
- External integrations.

## Milestone 3: AI Tool Runtime

Purpose: implement AI-first interpretation with typed tools.

Tasks:

- Define internal `ToolDefinition` format.
- Define `ToolEnvelope` and common result types.
- Implement tool registry.
- Implement deterministic handlers for:
  - `item.search`
  - `item.create`
  - `item.update`
  - `item.complete`
  - `item.snooze`
  - `recurrence.setPolicy`
  - `recurrence.recordEvent`
  - `policy.upsertNotification`
  - `state.explain`
- Implement AI provider abstraction:
  - `none`
  - `openai-api` optional
  - `codex-bridge` placeholder/experimental
  - `local-ai` placeholder
- Add a manual/dev endpoint to submit a message and inspect proposed tool calls.
- Add transcript/session persistence.

Acceptance criteria:

- A raw message can produce a typed tool call.
- Tool call can mutate DB through deterministic handler.
- Tool handler can return `needs_clarification` or `needs_confirmation`.
- Tool calls are audited.
- The system can run in deterministic-only test mode by injecting tool calls
  without an AI provider.

Out of scope:

- Perfect AI provider implementation.
- Generated skills.
- External account access.

## Milestone 4: Core Recurrence And Policies

Purpose: make RyanOS useful for recurring life tasks and nag behavior.

Tasks:

- Implement recurrence engines:
  - completion-based cadence;
  - minimum interval;
  - fixed schedule;
  - target frequency;
  - opportunistic placeholder.
- Implement policy evaluation for:
  - quiet hours;
  - nag intensity;
  - pause/snooze;
  - urgency exceptions.
- Implement reminder evaluation job.
- Implement notification decision result without sending externally yet.
- Implement `policy.explain`.

Acceptance criteria:

- "I did X yesterday" resets next due from yesterday.
- Minimum interval prevents reminders before eligible date.
- Snooze suppresses reminders until expected time.
- Quiet hours suppress or defer non-urgent notifications.
- Explain tool can answer why an item is or is not due.

Out of scope:

- Weather/calendar opportunistic reminders.
- WhatsApp.

## Milestone 5: Telegram Interface

Purpose: prove real AI-first chat.

Tasks:

- Build Telegram provider with grammY.
- Normalize messages into `IncomingMessage`.
- Support allowlisted users.
- Persist incoming/outgoing messages.
- Connect Telegram messages to AI/tool runtime.
- Send assistant responses.
- Support confirmation prompts.
- Support simple button replies if useful.
- Add notification delivery via Telegram.

Acceptance criteria:

- User can message: "I changed the sheets yesterday."
- AI calls the correct typed tool.
- DB records event and recalculates recurrence.
- Telegram receives a concise confirmation.
- Repeated Telegram delivery does not duplicate event.
- "Remind me tomorrow" snoozes the item.
- "Why are you nagging me?" explains from state/audit.

Out of scope:

- Group passive listening.
- WhatsApp.
- Email/Gmail.

## Milestone 6: Dashboard V1

Purpose: give the chat a visible control surface.

Tasks:

- Build app shell.
- Show today's plan.
- Show due/overdue/upcoming items.
- Show areas/projects.
- Show recurring items and last/next dates.
- Show policy summaries.
- Show audit timeline for selected item.
- Allow basic item/project edits.
- Allow approving confirmations/proposals.

Acceptance criteria:

- User can see what the assistant thinks is important.
- User can inspect why an item is due.
- User can modify key policies without DB access.
- Dashboard and chat show the same state.

Out of scope:

- Polished analytics.
- Complex calendar UI.

## Milestone 7: Planning Engine

Purpose: support "what should I do today?"

Tasks:

- Implement `plan.generateDaily`.
- Implement `plan.commitDaily`.
- Add capacity model.
- Rank items by urgency, importance, deadlines, recurrence, staleness, and
  burnout/balance rules.
- Split plan into:
  - success criteria;
  - core plan;
  - stretch;
  - easy wins.
- Add overload warnings.

Acceptance criteria:

- Daily plan returns one to three success criteria.
- Plan avoids pretending an overloaded day is realistic.
- User overrides are respected and recorded.
- Dashboard displays committed plan.

Out of scope:

- Calendar auto-blocking.
- Sophisticated energy modeling.

## Milestone 8: Sources And Opportunities

Purpose: keep RFPs, grants, leads, and follow-ups from falling out of memory.

Tasks:

- Add source/opportunity tables if not already migrated.
- Implement:
  - `source.link`
  - `opportunity.create`
  - `opportunity.update`
- Add source metadata retention rules.
- Add opportunity dashboard.
- Add follow-up item creation from due dates.
- Add manual/web-source ingestion endpoint.

Acceptance criteria:

- User or automation can create an opportunity from a source.
- Opportunity has due date, fit, status, next action.
- Due opportunities appear in planning and reminders.
- Duplicate source URL/thread does not create duplicate opportunity.

Out of scope:

- Automated RFP crawling beyond existing external automations.
- Full Gmail/Slack sync.

## Milestone 9: Capability Framework V1

Purpose: establish the trusted boundary for external integrations.

Tasks:

- Implement capability registry tables.
- Implement capability definition format.
- Implement grant model.
- Implement encrypted secret records.
- Implement OAuth/token storage helpers.
- Implement capability invocation audit.
- Implement proposal/approval flow.
- Add a fake/demo capability provider for tests.

Acceptance criteria:

- Capabilities are namespaced and operation-specific.
- Read/draft/send/delete are separate grants.
- Skills and AI cannot access raw secrets.
- Capability calls are audited.
- Missing capability creates proposal, not silent failure.

Out of scope:

- Real Gmail/Slack providers unless needed for dogfooding.

## Milestone 10: Skills V1

Purpose: support skill proposals and safe manual enablement.

Tasks:

- Implement skill package parser for `skills/<id>/SKILL.md`.
- Implement YAML frontmatter validation.
- Track installed/proposed skills in DB.
- Implement:
  - `skill.propose`
  - `skill.validate`
  - `skill.enable`
- Support required capability declarations.
- Support disabled/pending/enabled state.
- Add dashboard approval UI.

Acceptance criteria:

- User can ask for a new skill.
- AI creates a skill proposal.
- System identifies required capabilities.
- Skill can be validated but not automatically privileged.
- User can enable/disable a skill.

Out of scope:

- Arbitrary generated code execution.
- Auto-installing dependencies.

## Milestone 11: Backup And Restore

Purpose: make the system safe to rely on.

Tasks:

- Add `pg_dump` backup script.
- Add JSONL export for core domain records.
- Add encrypted secret backup instructions.
- Add restore script.
- Add restore rehearsal command.
- Add scheduled backup job.
- Add dashboard backup status.

Acceptance criteria:

- Clean environment can restore DB from backup.
- Encrypted secrets decrypt when master key is restored.
- If secrets cannot decrypt, integrations are marked reconnect-required.
- Restore does not double-fire scheduled jobs.
- Monthly restore rehearsal can be automated.

Out of scope:

- Cloud backup providers unless explicitly chosen.

## V1 Release Criteria

V1 is ready when:

- Telegram chat can drive core item, recurrence, snooze, and policy changes.
- Dashboard shows the same state and audit trail.
- Daily plan works.
- Recurring reminders reset from completion events.
- RFP/opportunity follow-ups are trackable.
- Backups and restore are tested.
- AI provider use is isolated behind `packages/ai`.
- No raw secrets are exposed to AI or skills.

## V1.5: Practical Integrations

Purpose: add high-value integrations after the core is reliable.

Candidate work:

- Gmail capability provider:
  - search messages;
  - read thread metadata/summary;
  - draft reply;
  - send reply only with confirmation.
- Google Calendar capability provider:
  - read calendars;
  - detect availability;
  - create event only with confirmation.
- Slack capability provider:
  - search/read channels;
  - monitor configured channels;
  - draft replies, no send by default.
- WhatsApp provider:
  - notifications;
  - inbound chat handling;
  - confirmation flows.
- Calendar-aware daily planning.
- Weather-aware opportunistic reminders.
- Better source ingestion from RFP feeds/search automations.

Acceptance criteria:

- Multi-account provider model works.
- Email triage creates actionable items or drafts without auto-sending.
- Calendar data influences planning without taking over the calendar.
- Slack monitor can propose tasks without mutating Slack.

## V2: Dynamic Skills And Self-Improvement

Purpose: let RyanOS extend itself safely.

### V2.1 Generated Skill Packages

Tasks:

- Implement `skill.generatePackage`.
- Implement skill workspace with pending generated packages.
- Generate `SKILL.md`, tests, references, and scripts where needed.
- Validate generated skills.
- Add skill diff review UI.
- Add versioning and rollback.

Acceptance criteria:

- User can request "monitor Slack for X."
- System proposes required capabilities.
- Once approved, system generates a pending skill package.
- Skill dry-run shows expected behavior.
- User approves before enablement.

### V2.2 Restricted Sandbox

Tasks:

- Implement Docker sandbox runner.
- No network by default.
- Explicit approved-host network mode.
- Read-only base filesystem.
- Temporary writable workspace.
- CPU/memory/time limits.
- No Docker socket mounted into main app.
- Redact secrets from logs.
- Add sandbox audit records.

Acceptance criteria:

- Generated code can run in dry-run mode safely.
- Network access requires explicit policy.
- Sandbox failures are visible and do not crash core services.

### V2.3 Self-Improvement Workflow

Tasks:

- Implement `repo.proposeChange`.
- Allow AI to create local patches or branches.
- Add test plan generation.
- Add review UI.
- Add optional GitHub PR creation capability.
- Require explicit approval for commit/push/deploy.

Acceptance criteria:

- User can ask RyanOS to improve a workflow.
- AI proposes code changes with risk and tests.
- User can review before applying.
- Tests run before merge.
- Production deploy remains explicitly approved.

### V2.4 Advanced Memory And Search

Tasks:

- Add local embeddings or approved API embeddings.
- Populate `search_documents.embedding`.
- Add hybrid retrieval:
  - structured filters;
  - full-text;
  - vector;
  - recent activity;
  - linked entities.
- Add memory compaction/summarization for long-running sources.

Acceptance criteria:

- "What happened with that thing from last week?" reliably retrieves context.
- Search quality improves without replacing structured state.
- Embeddings are additive, not required for core reminders.

### V2.5 Proactive Assistant

Tasks:

- Add monitor framework for email, Slack, RFPs, calendar, weather, and stale
  relationship touchpoints.
- Add interruption budget.
- Add proactive prompt generation.
- Add escalation and digest policies.
- Add "nag less/more" feedback loop.

Acceptance criteria:

- System initiates useful conversations.
- User can adjust nagging by chat.
- Proactive messages are explainable.
- Quiet hours and urgency are respected.

### V2.6 Public Deployment Hardening

Tasks:

- Add Caddy reverse proxy.
- Harden Better Auth deployment settings.
- Add production cookie/session policy.
- Add rate limiting.
- Add webhook signature validation.
- Add encrypted off-device backups if desired.
- Add public-domain deployment guide.

Acceptance criteria:

- System can move from Tailscale/LAN to public domain.
- Public deployment does not weaken capability/secret boundaries.

## Testing Strategy

Unit tests:

- recurrence calculations;
- policy evaluation;
- idempotency;
- permission checks;
- tool handler validation;
- audit writes.

Integration tests:

- message to tool call to DB mutation;
- worker job to reminder evaluation;
- Telegram inbound/outbound with mocked provider;
- backup/restore rehearsal;
- capability provider fake.

End-to-end tests:

- "I did X yesterday";
- "remind me tomorrow";
- "do not message me before 9am on weekends";
- "what should I do today?";
- "this RFP is due in two weeks";
- "start monitoring Slack" creates proposals, not privileges.

## First Build Slice

The first implementation slice should be:

1. Scaffold repo and Docker Postgres.
2. Create minimal schema for users, sessions, messages, items, events,
   recurrence, policies, audit.
3. Implement tool registry and deterministic handlers for:
   - `item.create`
   - `item.complete`
   - `item.snooze`
   - `recurrence.recordEvent`
   - `policy.upsertNotification`
   - `state.explain`
4. Add a dev message endpoint.
5. Add Telegram after the dev endpoint proves the flow.

This gives the fastest proof that RyanOS is actually AI-first without waiting
for the whole dashboard or all integrations.

Status:

- Repo, Docker Postgres, Fastify API, worker shell, Next dashboard, Drizzle
  schema/migrations, core tools, recurrence logic, and Postgres store adapter
  are implemented.
- `/v1/messages` persists chat turns and can execute typed tool calls in
  deterministic test mode.
- Telegram webhook ingestion normalizes provider messages without interpreting
  intent and is idempotent across redelivery.
- Remaining in this slice: real AI provider/Codex bridge selection, outbound
  Telegram responses, and notification delivery.

## Remaining Decisions

- Exact first AI provider implementation path for structured tool calling.
- Whether `codex-bridge` can be robust enough for V1 dogfooding.
- Exact local embedding model, if/when local embeddings are added.
- Exact public deployment topology.
- Exact sandbox implementation details.
- Whether Twilio is needed after direct WhatsApp Cloud API.
