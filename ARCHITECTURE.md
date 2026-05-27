# RyanOS Architecture

## 1. Product Goal

RyanOS is a local-first personal operating system for managing tasks, projects,
recurring responsibilities, opportunities, reminders, decisions, and proactive
assistant workflows across personal and professional life.

The system should reduce mental load rather than become another inbox. It should
know what matters, remember what has been done, reset recurrence based on real
completion events, and proactively ask for clarification or action when useful.

The product should be generic enough to publish as source-available Fair Source
software. Personal areas, projects, credentials, private skills, and private data
must live outside the public core.

### Companion Documents

- [MESSAGE_PIPELINE.md](./MESSAGE_PIPELINE.md): AI-first message and agent loop.
- [TOOL_CONTRACTS.md](./TOOL_CONTRACTS.md): typed AI-callable tool boundary.
- [DATA_MODEL.md](./DATA_MODEL.md): PostgreSQL/Drizzle data model.
- [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md): V1 through V2 build plan.
- [AI_PROVIDER_RISK_REVIEW.md](./AI_PROVIDER_RISK_REVIEW.md): AI provider,
  agent security, and Codex bridge risk review.

## 2. Design Principles

- Ask before making material tech stack decisions.
- Local-first by default, with a path to home-server deployment.
- User-facing message interpretation is AI-first. Avoid hardcoded natural
  language parsing for chat commands and updates.
- Prefer deterministic state machines for task, reminder, recurrence, backup,
  permissions, validation, state mutation, and notification behavior.
- Use AI for intent understanding, tool selection, fuzzy interpretation,
  summarization, triage, drafting, planning, and skill generation, not as the
  source of truth.
- Treat typed AI-callable tools as the stable contract between natural language
  and the database.
- Store important user actions as events, not just current state.
- Make nagging configurable, explainable, and interrupt-aware.
- Treat user overrides as first-class records.
- Keep skills and capabilities separate: skills are behaviors; capabilities are
  trusted powers.
- AI may propose new powers, but it may not grant those powers to itself.
- Optimize for migration, backup, restore, and future public-auth deployment.

### Dashboard UX Principles

- Avoid stacking cards inside cards. Use borders for primary panels, repeated
  items, controls, and modals; otherwise prefer spacing, section headings,
  subtle separators, and chips.
- Hide low-frequency controls by default. Area/project reassignment and similar
  metadata edits should show the current value first, then reveal inputs through
  an explicit edit icon or edit mode.
- Reserve green and red for semantic status. Green means success, completion, or
  healthy state; red means error, missed, destructive, or negative state.
  Taxonomy colors for areas and projects must use non-semantic tones such as
  blue, sky, cyan, indigo, violet, fuchsia, amber, or stone.
- Dashboard content should emphasize the user's live operating state. Avoid
  surfacing implementation scaffolding unless the user is actively working on
  RyanOS itself.
- The main dashboard is for coaching, daily focus, current commitments, and
  actionable personal context. Implementation status, setup readiness, core
  storage details, and integration diagnostics belong on an admin dashboard.
- Daily planning should start from the question: "What 1-3 outcomes would make
  today count?" The dashboard and chat should present the question daily,
  preserve the user's answer, and keep a small suggested focus set prominent
  near the top.

## 3. Deployment Model

### Accepted Direction

- Use Docker for consistent local and server deployment.
- V1 starts on a laptop or home server.
- Network access starts with LAN and/or Tailscale.
- Use Tailscale Serve for private tailnet access where useful.
- Tailscale Funnel may be used for temporary webhook testing, but it is not the
  main public deployment model.
- Public domain auth is a planned future mode, not required for V1.
- Browser API access is origin-scoped through `RYANOS_CORS_ORIGINS`; add LAN,
  Tailscale, tunnel, or public dashboard origins explicitly before exposing them.

### Deployment Targets

- macOS laptop for development and early use.
- Ubuntu home server for durable local deployment.
- Future public-domain deployment with real authentication and stricter network
  hardening.

### Deferred Decisions

- Whether public access should be direct, behind Cloudflare Tunnel, or behind a
  VPN-only model.
- Exact public-domain deployment topology.

### Accepted Future Direction

- Use Caddy as the default reverse proxy when public HTTPS is needed.
- Keep the public-auth boundary independent of Tailscale so the system can move
  from private access to public access without replacing core application auth.

## 4. System Components

This component layout is accepted as the initial monorepo shape.

```text
apps/web              Dashboard UI
apps/api              HTTP API and app backend
apps/worker           Scheduled jobs, reminders, sync, monitors
apps/bot-telegram     Telegram chat interface
apps/bot-whatsapp     WhatsApp chat interface, added after Telegram

packages/db           Database schema, migrations, query helpers
packages/core         Domain logic: recurrence, scoring, planning, policies
packages/skills       Skill registry, validation, proposal workflow
packages/capabilities Trusted integrations and permissioned operations
packages/ai           AI provider abstraction
packages/sandbox      Isolated execution runner
```

### Message Pipeline

See [MESSAGE_PIPELINE.md](./MESSAGE_PIPELINE.md) for the AI-first message and
agent loop.

The short version:

```text
Provider message
  -> normalize into IncomingMessage
  -> load user, session, context, memory, policies, and available capabilities
  -> call AI with typed tools
  -> AI selects tool calls
  -> deterministic handlers validate and mutate state
  -> audit every step
  -> respond or notify
```

The application should not depend on handcrafted parsing of phrases like
"yesterday", "remind me", or "stop nagging me." AI interprets the message and
calls typed tools. Deterministic code validates dates, permissions, recurrence
rules, minimum intervals, idempotency, and audit logging.

### Accepted Stack Direction

- Node.js and TypeScript for application code.
- Next.js, React, and Tailwind for the dashboard.
- Fastify for the main API service.
- Keep the core backend as a real API service. Do not make Next.js API routes
  the main backend boundary.
- `pnpm` workspaces for the monorepo.
- Avoid Turborepo and Nx initially. Add build orchestration only when repo size
  justifies it.
- Drizzle ORM for database access and migrations.
- PostgreSQL is preferred over MariaDB/MySQL because semantic search, graph-like
  relationships, and vector search are expected to matter.
- `pgvector` should be supported by the schema design, but embeddings do not
  need to be mandatory in V1.
- Graphile Worker for background jobs, retries, delayed jobs, cron-like jobs,
  and debouncing.
- Redis is not part of V1. Add it only if Postgres-backed jobs become the wrong
  tool.
- grammY for Telegram.
- Direct Meta WhatsApp Cloud API for WhatsApp first. Twilio can be added later
  as a provider adapter if SMS, voice, or compliance tooling becomes important.

### Runtime Boundaries

- Graphile Worker executes jobs. RyanOS owns domain scheduling, recurrence, and
  reminder semantics.
- The dashboard talks to the API service.
- Bots talk to the API service and may enqueue jobs.
- Workers execute scheduled jobs and capability-backed sync workflows.
- Next.js may serve UI routes and UI-specific server behavior, but shared
  business logic belongs in packages and API services.

## 5. Data Model

The data model should be generic and domain-neutral. Example seed areas may
include work, health, home, relationships, finance, learning, side projects,
errands, hobbies, travel, and pets, but the system must not hardcode them.

### Core Entities

- `Area`: long-lived domain of life.
- `Project`: outcome-oriented collection of work inside an area.
- `Item`: task, reminder, opportunity, decision, note, waiting item, or other
  actionable record.
- `Event`: immutable record of something that happened.
- `Policy`: user preference or rule that affects behavior.
- `Source`: external origin such as email, calendar, Slack, web search, RFP feed,
  uploaded document, or chat message.
- `Skill`: installable assistant behavior.
- `Capability`: trusted operation that can access external systems or perform
  sensitive actions.
- `AuditLog`: append-only operational history.

### Event Examples

- User completed a task.
- User snoozed a reminder.
- User said a recurring action happened yesterday.
- A new opportunity was found.
- An email was summarized.
- A policy was changed through chat.
- A skill ran.
- A capability was invoked.
- A notification was sent, delivered, failed, or dismissed.

### Multi-Account Integrations

External accounts must be modeled explicitly from V1 so the system can support
multiple Gmail, Calendar, Slack, and other provider accounts.

Core integration concepts:

- `ProviderAccount`: one connected external account.
- `CapabilityGrant`: a permissioned grant for a capability on an account.
- `ExternalSource`: a durable source reference such as an email thread, calendar
  event, Slack channel, RFP page, document, or webhook.

The app must not assume a single Google account or a single account per
provider.

## 6. Task And Reminder Semantics

Recurring items must reset from real events whenever possible.

Examples:

- If sheets are due weekly and they are changed on Saturday, the next reminder is
  based on Saturday, not the original Monday schedule.
- If a medication or shot has a minimum interval, the system must never suggest
  taking it before the minimum interval has elapsed.
- If the user says, "I did this yesterday," the system records the completion at
  yesterday's date and recalculates from there.

### Recurrence Types

- Fixed date or deadline.
- Completion-based cadence.
- Minimum interval.
- Target frequency within a window.
- Opportunistic reminder based on context such as weather, calendar space, or
  stale relationship touchpoints.
- Follow-up reminder tied to an external source or opportunity.

### Open Item Attention

The API should assign every dashboard item an explainable priority score and
signals, then sort open items by that score before the UI renders them.

- Minimum-interval and completion-based items should stay hidden from the
  default open item list until the day before their next due date. On that day
  they should appear as low-priority reminders, then rise sharply on or after
  the due date.
- Target-frequency items should rise as the period ages, the remaining target
  count grows, or the item has not been completed recently.
- One-off tasks and external-deadline items should score from explicit
  priority, due dates, waiting state, and opportunity context.
- Hidden items must remain queryable through explicit admin/debug flags so the
  system can explain why they are not currently cluttering the main dashboard.

### Daily Planning

Daily planning should distinguish:

- Success criteria: one to three things that make the day count.
- Core plan: realistic planned work.
- Stretch items: useful if time and energy permit.
- Easy wins: small tasks that reduce clutter or create momentum.

The system should be blunt when the planned workload exceeds available capacity,
but user overrides should be respected and remembered.

### Job Execution

Graphile Worker is responsible for reliable background execution. It should be
used for:

- Scheduled reminder evaluation.
- Connector sync jobs.
- Notification delivery.
- Backup jobs.
- Skill validation and dry runs.
- Deferred AI work.
- Retryable external API work.

RyanOS domain logic decides what should happen and when. The worker system only
executes queued work reliably.

## 7. Skills And Capabilities

Skills are installable assistant behaviors. Capabilities are trusted powers.

Skills may include prompts, instructions, code, schedules, validation checks, and
metadata. They should not receive raw credentials. When a skill needs sensitive
access, it calls a host-owned capability.

### Skill Package Format

Skills are file-based packages:

```text
skills/<skill-id>/SKILL.md
skills/<skill-id>/scripts/
skills/<skill-id>/tests/
skills/<skill-id>/assets/
skills/<skill-id>/references/
```

`SKILL.md` uses YAML frontmatter for metadata such as name, description, required
capabilities, allowed tools, schedules, validation commands, and version.

The database tracks each installed skill's source, version, enabled state,
permissions, schedules, validation status, and audit history.

### Skill Proposal Flow

When the user asks for a new behavior, such as "start monitoring Slack":

1. The assistant creates a skill proposal.
2. The proposal identifies required capabilities.
3. The system checks whether those capabilities already exist.
4. Missing capabilities require explicit user approval and setup.
5. The skill is created in a pending state.
6. The skill is validated and run in dry-run mode.
7. The user approves enablement.
8. The enabled skill runs with least privilege.

### Capability Examples

- `gmail.search`
- `gmail.read_thread`
- `gmail.draft_reply`
- `gmail.send_reply`
- `calendar.read`
- `calendar.create_event`
- `slack.search`
- `slack.read_channel`
- `telegram.notify`
- `whatsapp.notify`
- `git.create_branch`
- `git.open_pull_request`
- `deploy.preview`
- `deploy.production`

Read, draft, send, delete, purchase, commit, deploy, and notify must be separate
permissions.

### V1 Skill Execution Policy

V1 supports skill proposals, skill validation, and dry runs. Generated skills do
not automatically receive new capabilities or run arbitrary shell commands.

Arbitrary generated code execution is deferred to V2 and must use a restricted
Docker sandbox with no network by default, resource limits, a temporary
filesystem, and no Docker socket mounted into the main app.

## 8. AI Provider Strategy

The system should avoid unnecessary OpenAI API usage. AI should be optional for
many core functions.

### Provider Abstraction

The AI layer should support multiple providers:

- `codex-login`: preferred personal/local provider using Codex/ChatGPT login
  where feasible.
- `openai-responses-api`: optional fallback only when explicitly approved.
- `local-ai`: optional local model provider.
- `none`: deterministic-only mode for jobs that do not require AI.

### Codex Login Boundary

RyanOS should assume `codex-login` is the long-term personal deployment default,
similar in spirit to `dcramer/ash`. The provider is still a runtime adapter, not
the trust root.

The application must depend on typed tool contracts, deterministic handlers,
schema validation, permissions, idempotency, and audit logs. If the Codex-login
runtime changes or is unavailable, RyanOS should degrade to setup-required or
`none` mode instead of corrupting state.

### Human Setup Boundaries

When the system needs an action that only the user can perform, it must ask for
the exact action and stop. Examples:

- log into Codex or refresh Codex credentials;
- create a Telegram bot or provide a bot token;
- approve OpenAI API billing before enabling API-backed providers;
- connect Gmail, Calendar, Slack, WhatsApp, or other external accounts;
- approve a new capability grant or generated skill power;
- paste an OAuth callback/code through an approved setup path.

RyanOS should expose these as setup-required statuses or confirmation prompts,
not as silent failures and not as instructions hidden in logs.

### Embeddings

Because Codex-login style providers may not support embeddings, V1 should work
with structured data and PostgreSQL full-text search. `pgvector` support can be
added when a suitable embedding provider is approved.

API embeddings are disabled by default. Local embeddings or OpenAI API embeddings
may be added later only after explicit approval.

## 9. Notifications

Notification rules are database-backed policies and should be editable through
the dashboard or chat.

Example:

> Do not message me before 9am on weekends unless it is really important.

The system should store this as a policy, not as a loose memory.

### Notification Concepts

- Quiet hours.
- Urgency.
- Escalation.
- Retry rules.
- Channel preference.
- Snooze.
- Suppression.
- Digest versus interruption.
- Delivery failure handling.

### Channels

- Telegram is the preferred first chat/notification interface and should use
  grammY.
- WhatsApp should be supported after Telegram using the direct Meta WhatsApp
  Cloud API first.
- Twilio can be added later as a provider adapter if SMS, voice, WhatsApp
  operational support, or compliance tooling makes it worthwhile.
- Dashboard notifications should exist for non-urgent review.

## 10. Security And Secrets

The app must run on both macOS and Ubuntu. macOS Keychain alone is therefore not
a sufficient primary secret strategy.

### Authentication

Use Better Auth for application authentication and session management.

Even when the app is reachable only over LAN or Tailscale, it should have a real
owner account and session model in V1 so public auth is not a later retrofit.

Keycloak and ZITADEL are intentionally not part of V1. They can be reconsidered
if RyanOS becomes multi-user, organization-heavy, or needs enterprise identity
features.

### Accepted Secret Strategy

- Store OAuth tokens and integration secrets in encrypted PostgreSQL fields.
- Use envelope encryption with a master key kept outside the database.
- Provide the master key to Docker through a secret, mounted file, or environment
  mechanism appropriate to the deployment target.
- Store a `key_version` with encrypted records so rotation is possible.
- Do not expose raw secrets to skills.
- Access external services through host-owned capabilities.
- SOPS/age may be used for encrypted deployment secrets such as `.env` or Docker
  Compose secret files.

V1 implementation note:

- The local master key is loaded from `RYANOS_MASTER_KEY_FILE`, defaulting to
  `./secrets/master-key`, or from `RYANOS_MASTER_KEY` as a fallback.
- `pnpm secrets:generate-key` creates a 32-byte local key with filesystem mode
  `0600`.
- Telegram bot tokens are imported through
  `docker compose exec api pnpm telegram:store-token -- --file /app/secrets/telegram-bot-token`
  and stored as encrypted `secret_records`.
- `TELEGRAM_BOT_TOKEN` is accepted only as a development fallback and should be
  migrated into encrypted storage.

### Secret Operations

- Keep encrypted records tagged with `key_version`.
- Store active and previous master keys outside PostgreSQL.
- Rotate keys with a job that decrypts with the old key, re-encrypts with the new
  key, and updates `key_version`.
- Keep the old key until rotation verification passes.
- Backups include encrypted database values but not the master key.
- Restore requires separately restoring the master key file or deployment secret.
- Restore rehearsals must verify that encrypted OAuth tokens can be decrypted.
- If tokens cannot be decrypted after restore, affected integrations should be
  clearly marked as needing reconnect.

### Future Secret Providers

1Password/op, OpenBao, HashiCorp Vault, or another secret provider may be added
later if operational needs justify it.

OpenBao and HashiCorp Vault are not part of V1. They are useful tools but add
too much operational complexity for the first local-first version.

## 11. Audit Log

The audit log is mandatory infrastructure, not a later admin feature.

Audit records should cover:

- AI actions.
- Skill runs.
- Capability invocations.
- External sync jobs.
- Reminder calculations.
- Notifications.
- User overrides.
- Policy changes.
- Task and project mutations.
- Backup and restore jobs.
- Permission changes.

Audit entries should answer:

- What happened?
- When did it happen?
- Who or what caused it?
- What data was touched?
- What changed?
- Was it successful?
- Where can the source context be found?

## 12. Backups And Restore

Backups are not complete until restore is tested.

### Backup Direction

- Daily PostgreSQL dumps.
- Nightly JSONL exports for important domain records.
- Encrypted secret backup support.
- Scripted sync to local storage server using restic or an equivalent tool.
- Monthly restore rehearsal.

### Restore Requirements

- Restore database state.
- Restore or reconnect secrets.
- Restore skill definitions.
- Restore policy records.
- Rebuild derived indexes if needed.
- Verify scheduled jobs do not double-fire after restore.

## 13. Data Retention

The system should avoid becoming an uncontrolled permanent archive of every
private message and email.

### Suggested Defaults

- Store tasks, reminders, policies, projects, decisions, and audit logs
  durably.
- Store external metadata such as sender, subject, date, source URL, thread ID,
  due date, and extracted action.
- Store summaries and action extraction results.
- Avoid storing full email, Slack, or message bodies by default unless pinned,
  explicitly retained, or needed for an active workflow.
- Keep raw sync payloads short-lived for debugging, defaulting to seven days,
  then expire them.
- Persist audit logs indefinitely at first. Add retention and compaction policies
  only after real data volume is understood.

## 14. Failure Modes

Known failure modes should be visible in the dashboard and audit log.

Examples:

- Duplicate reminders.
- Missed scheduled jobs.
- Expired OAuth tokens.
- Integration rate limits.
- AI interpretation errors.
- Conflicting user instructions.
- Failed skill validation.
- Bad skill update.
- Failed backup.
- Failed restore.
- Home server offline.
- Telegram or WhatsApp delivery failure.

## 15. Human Overrides

Human overrides are first-class state.

If the user changes behavior through chat, the system should store:

- Original state or policy.
- New state or policy.
- Source message.
- Timestamp.
- Expiration, if any.
- Reason, if provided or inferred.
- Actor.

Examples:

- "Stop nagging me about this for a month."
- "I did my shot yesterday."
- "Actually I called Grandpa on Sunday."
- "Do not treat this RFP as important anymore."

## 16. Public Source Boundary

The public project should contain:

- Generic engine.
- Generic schemas.
- Generic dashboard.
- Generic skills framework.
- Generic capabilities framework.
- Example seed areas and demo data.

The private deployment should contain:

- Personal data.
- Credentials.
- Private areas and projects.
- Private skills.
- Private integration configuration.
- Private notification policies.
- Private backups.

The public project is licensed under FSL-1.1-ALv2 by default. Describe RyanOS
as source-available or Fair Source, not open source, unless referring to a
specific version after its Apache 2.0 future-license conversion date.

## 17. V1 Scope

V1 should prove the core operating loop:

- Create and manage areas, projects, and items.
- Track completion-based recurring reminders.
- Accept chat updates for completion, snooze, and policy changes.
- Produce a daily plan with success criteria.
- Send Telegram notifications.
- Support a single owner account with Better Auth.
- Keep an audit log.
- Run scheduled jobs.
- Back up and restore a local deployment.
- Support multiple external accounts per provider in the data model.
- Support skill proposals, validation, and dry runs.
- Support capabilities as the trusted integration boundary.
- Defer arbitrary generated-code execution until the sandbox is designed and
  reviewed.

## 18. Deferred Decisions

- Exact public-domain deployment topology.
- Whether embeddings should be local or API-based when vector search becomes
  necessary.
- Whether to add Redis or another queue system if Graphile Worker becomes
  insufficient.
- Exact sandbox runner implementation.
- How much of the AI provider bridge should rely on Codex login.
- Whether Twilio should be added as a second WhatsApp/SMS provider.
