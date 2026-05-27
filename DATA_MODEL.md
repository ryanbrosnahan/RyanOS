# RyanOS Data Model

## Purpose

The data model supports an AI-first personal operating system. Chat messages are
interpreted by AI into typed tools, while deterministic handlers validate and
mutate PostgreSQL state.

This model is domain-generic. User-specific areas, projects, skills, accounts,
and data are private deployment state, not public-code assumptions.

## Database Direction

- PostgreSQL is the canonical store.
- Drizzle owns schema and migrations.
- `pgvector` should be enabled in Docker and supported by schema design, but V1
  must work without embeddings.
- Use Postgres full-text search in V1.
- Use append-only events and audit logs for explainability.
- Use soft delete for user-facing records unless permanent deletion is
  explicitly requested and safe.

## Naming Conventions

- Primary keys are UUIDs unless a short human-facing code is useful.
- External provider identifiers are never primary keys.
- Tables include `created_at` and `updated_at` unless append-only.
- Mutable user-facing records include `deleted_at`.
- Mutating tables use `revision` for optimistic concurrency when practical.
- JSONB is acceptable for extensibility, but core workflow fields should be
  typed columns.

## Core Identity

### `users`

Owner/user accounts for app auth and scoping.

Key fields:

- `id`
- `email`
- `display_name`
- `timezone`
- `locale`
- `created_at`
- `updated_at`

V1 can be single-owner, but the schema should not make multi-user impossible.

### `sessions`

Conversation sessions across providers.

Key fields:

- `id`
- `user_id`
- `provider`
- `provider_chat_id`
- `provider_thread_id`
- `title`
- `last_message_at`
- `metadata`
- `created_at`
- `updated_at`

### `messages`

Normalized incoming and outgoing messages.

Key fields:

- `id`
- `session_id`
- `user_id`
- `provider`
- `provider_message_id`
- `direction`: `inbound` | `outbound` | `system`
- `text`
- `sender_display_name`
- `reply_to_message_id`
- `occurred_at`
- `metadata`
- `created_at`

Message text can be retained for RyanOS chat. External provider payloads should
follow the retention policy in `ARCHITECTURE.md`.

Idempotency:

- `sessions` are unique by `(provider, provider_chat_id)`.
- `messages` are unique by `(provider, session_id, provider_message_id)` when a
  provider message ID is present.

## Areas, Projects, And Items

### `areas`

Long-lived domains of life.

Key fields:

- `id`
- `user_id`
- `name`
- `description`
- `status`: `active` | `paused` | `archived`
- `sort_order`
- `metadata`
- `created_at`
- `updated_at`
- `deleted_at`

### `projects`

Outcome-oriented work within or across areas.

Key fields:

- `id`
- `user_id`
- `area_id`
- `name`
- `description`
- `status`: `active` | `paused` | `done` | `archived`
- `priority`
- `due_at`
- `review_after`
- `metadata`
- `created_at`
- `updated_at`
- `deleted_at`

### `items`

The central actionable object. Items cover tasks, reminders, decisions, notes,
waiting items, habits, opportunities' next actions, and other user-visible work.

Key fields:

- `id`
- `user_id`
- `area_id`
- `project_id`
- `kind`: `task` | `reminder` | `decision` | `note` | `waiting` | `habit` | `opportunity_action` | `other`
- `title`
- `body`
- `status`: `open` | `active` | `waiting` | `done` | `cancelled`
- `priority`: `low` | `normal` | `high` | `urgent`
- `due_at`
- `start_at`
- `snoozed_until`
- `estimate_minutes`
- `completed_at`
- `cancelled_at`
- `revision`
- `metadata`
- `created_at`
- `updated_at`
- `deleted_at`

Indexes:

- `(user_id, status, due_at)`
- `(user_id, project_id, status)`
- full-text index on `title` and `body`

### `item_events`

Append-only domain events for item lifecycle.

Key fields:

- `id`
- `user_id`
- `item_id`
- `event_type`: `created` | `updated` | `completed` | `uncompleted` | `snoozed` | `cancelled` | `deleted` | `linked_source` | `policy_changed`
- `occurred_at`
- `source_message_id`
- `idempotency_key`
- `payload`
- `created_at`

Constraints:

- Unique `(user_id, idempotency_key)` when `idempotency_key` is not null.

## Recurrence

### `recurrence_policies`

Rules for recurring items. Recurrence is separate from item status so the same
item can have event history and derived reminders.

Key fields:

- `id`
- `user_id`
- `item_id`
- `type`: `completion_based` | `fixed_schedule` | `minimum_interval` | `target_frequency` | `opportunistic`
- `interval_days`
- `minimum_interval_days`
- `cron`
- `target_count`
- `target_window_days`
- `preferred_days`
- `preferred_time`
- `reset_from_completion`
- `nag_policy_id`
- `status`: `active` | `paused` | `archived`
- `metadata`
- `created_at`
- `updated_at`
- `deleted_at`

### `recurrence_events`

Append-only record of recurring actions.

Key fields:

- `id`
- `user_id`
- `recurrence_policy_id`
- `item_id`
- `event_type`: `completed` | `skipped` | `missed` | `deferred`
- `occurred_at`
- `source_message_id`
- `note`
- `idempotency_key`
- `payload`
- `created_at`

### `recurrence_state`

Derived state for efficient querying. Rebuildable from events.

Key fields:

- `recurrence_policy_id`
- `last_event_at`
- `last_completed_at`
- `next_eligible_at`
- `next_due_at`
- `staleness_score`
- `updated_at`

Rules:

- Minimum intervals set `next_eligible_at`.
- Completion-based policies calculate `next_due_at` from latest completion.
- Fixed schedules calculate from cron/timezone.
- Derived state may be rebuilt if logic changes.

## Policies

### `policies`

Generic user/system behavior rules.

Key fields:

- `id`
- `user_id`
- `type`: `notification` | `planning` | `confirmation` | `retention` | `permission` | `other`
- `scope`: `global` | `area` | `project` | `item` | `channel` | `category`
- `scope_ref`
- `priority`
- `status`: `active` | `paused` | `archived`
- `starts_at`
- `expires_at`
- `rules`
- `source_message_id`
- `created_at`
- `updated_at`
- `deleted_at`

### `policy_events`

Append-only history of policy changes and overrides.

Key fields:

- `id`
- `user_id`
- `policy_id`
- `event_type`: `created` | `updated` | `paused` | `resumed` | `expired` | `overridden`
- `occurred_at`
- `source_message_id`
- `previous_snapshot`
- `new_snapshot`
- `reason`
- `created_at`

## Sources And Opportunities

### `external_sources`

Durable references to emails, calendar events, Slack messages, RFP pages,
documents, uploads, or manual sources.

Key fields:

- `id`
- `user_id`
- `provider`
- `provider_account_id`
- `external_id`
- `url`
- `title`
- `summary`
- `occurred_at`
- `retention_class`: `metadata_only` | `summary` | `pinned_full`
- `raw_payload_expires_at`
- `metadata`
- `created_at`
- `updated_at`
- `deleted_at`

Indexes:

- Unique `(provider_account_id, external_id)` when both are present.
- `(user_id, provider, occurred_at)`

### `source_links`

Typed links from sources to app objects.

Key fields:

- `id`
- `user_id`
- `source_id`
- `target_type`: `area` | `project` | `item` | `opportunity` | `person` | `decision` | `skill`
- `target_id`
- `relation`: `created_from` | `supports` | `follow_up_for` | `evidence` | `context`
- `created_at`

### `opportunities`

RFPs, grants, sales leads, partnership leads, or other external opportunities.

Key fields:

- `id`
- `user_id`
- `area_id`
- `project_id`
- `title`
- `status`: `tracking` | `active` | `submitted` | `won` | `lost` | `declined`
- `fit`: `unknown` | `low` | `medium` | `high`
- `due_at`
- `decision_by`
- `value_estimate`
- `next_action_item_id`
- `summary`
- `metadata`
- `created_at`
- `updated_at`
- `deleted_at`

### `opportunity_events`

Append-only opportunity history.

Key fields:

- `id`
- `user_id`
- `opportunity_id`
- `event_type`: `created` | `updated` | `status_changed` | `source_linked` | `follow_up_created`
- `occurred_at`
- `source_message_id`
- `payload`
- `created_at`

## Planning

### `daily_plans`

Generated or committed daily plans.

Key fields:

- `id`
- `user_id`
- `date`
- `status`: `draft` | `committed` | `superseded`
- `capacity_minutes`
- `overload_warning`
- `source_message_id`
- `created_at`
- `updated_at`

### `daily_plan_items`

Plan membership and role.

Key fields:

- `id`
- `daily_plan_id`
- `item_id`
- `role`: `success_criterion` | `core` | `stretch` | `easy_win`
- `suggested_block`
- `reason`
- `sort_order`
- `created_at`

## Integrations And Capabilities

### `provider_accounts`

Connected external accounts.

Key fields:

- `id`
- `user_id`
- `provider`: `gmail` | `google_calendar` | `slack` | `telegram` | `whatsapp` | `github` | `other`
- `external_account_id`
- `display_name`
- `email`
- `status`: `active` | `expired` | `revoked` | `error`
- `scopes`
- `metadata`
- `created_at`
- `updated_at`
- `deleted_at`

### `secret_records`

Encrypted OAuth tokens or integration secrets.

Key fields:

- `id`
- `user_id`
- `provider_account_id`
- `kind`
- `ciphertext`
- `nonce`
- `key_version`
- `expires_at`
- `metadata`
- `created_at`
- `updated_at`

Rules:

- No raw token in logs or skill-visible payloads.
- Backups include ciphertext but not master keys.

### `capabilities`

Registered trusted powers.

Key fields:

- `id`
- `capability_id`: namespaced, such as `gmail.search`
- `provider`
- `description`
- `sensitive`
- `status`: `available` | `disabled` | `deprecated`
- `definition`
- `created_at`
- `updated_at`

### `capability_operations`

Operations under a capability.

Key fields:

- `id`
- `capability_id`
- `name`
- `description`
- `mutating`
- `sensitive`
- `requires_auth`
- `input_schema`
- `output_schema`
- `created_at`
- `updated_at`

### `capability_grants`

User-approved grants for capabilities and operations.

Key fields:

- `id`
- `user_id`
- `provider_account_id`
- `capability_id`
- `operation_name`
- `scope`
- `status`: `active` | `paused` | `revoked` | `expired`
- `approved_at`
- `expires_at`
- `source_message_id`
- `metadata`
- `created_at`
- `updated_at`

### `capability_events`

Append-only capability history.

Key fields:

- `id`
- `user_id`
- `capability_id`
- `provider_account_id`
- `operation_name`
- `event_type`: `proposed` | `approved` | `auth_started` | `auth_completed` | `invoked` | `failed` | `revoked`
- `occurred_at`
- `source_message_id`
- `payload`
- `created_at`

## Skills

### `skills`

Installed or proposed skill packages.

Key fields:

- `id`
- `skill_id`
- `name`
- `description`
- `source`: `bundled` | `installed` | `user` | `workspace` | `generated`
- `version`
- `status`: `proposed` | `validated` | `enabled` | `disabled` | `rejected`
- `risk_level`
- `package_path`
- `definition`
- `created_at`
- `updated_at`
- `deleted_at`

### `skill_capability_requirements`

Declared capability requirements for a skill.

Key fields:

- `id`
- `skill_id`
- `capability_id`
- `operation_name`
- `required`
- `created_at`

### `skill_runs`

Execution records for skills.

Key fields:

- `id`
- `user_id`
- `skill_id`
- `status`: `started` | `succeeded` | `failed` | `cancelled`
- `source_message_id`
- `input`
- `output_summary`
- `error`
- `started_at`
- `completed_at`
- `created_at`

### `skill_events`

Append-only skill lifecycle history.

Key fields:

- `id`
- `user_id`
- `skill_id`
- `event_type`: `proposed` | `generated` | `validated` | `enabled` | `disabled` | `run_started` | `run_completed` | `run_failed`
- `occurred_at`
- `source_message_id`
- `payload`
- `created_at`

## Jobs And Schedules

Graphile Worker will own job execution tables internally. RyanOS should own
domain schedule definitions and reminders.

### `schedules`

User-visible scheduled behavior.

Key fields:

- `id`
- `user_id`
- `kind`: `one_shot` | `periodic` | `recurrence_evaluation` | `monitor`
- `status`: `active` | `paused` | `archived`
- `message`
- `trigger_at`
- `cron`
- `timezone`
- `last_run_at`
- `next_run_at`
- `target_type`
- `target_id`
- `provider`
- `provider_chat_id`
- `metadata`
- `created_at`
- `updated_at`
- `deleted_at`

Rules:

- Scheduled jobs should route through the same AI/tool pipeline as user messages
  when interpretation or judgment is needed.
- Worker retry behavior belongs to Graphile Worker.
- Domain idempotency belongs to RyanOS handlers.

## Audit

### `audit_logs`

Mandatory operational history.

Key fields:

- `id`
- `user_id`
- `actor_type`: `user` | `ai` | `system` | `worker` | `skill` | `capability`
- `actor_id`
- `action`
- `target_type`
- `target_id`
- `source_message_id`
- `tool_name`
- `capability_id`
- `skill_id`
- `request`
- `result`
- `status`: `success` | `rejected` | `failed` | `needs_confirmation`
- `occurred_at`
- `metadata`

Audit records should answer why a thing happened and what source caused it.

## Search And Memory

### `search_documents`

Unified search surface for items, projects, sources, opportunities, people, and
summaries.

Key fields:

- `id`
- `user_id`
- `target_type`
- `target_id`
- `title`
- `body`
- `tsv`
- `embedding`
- `metadata`
- `updated_at`

V1:

- Populate `tsv`.
- Leave `embedding` null.

V2:

- Add local or approved API embeddings.
- Use vector search as an additive retrieval path.

## Relationships

RyanOS should support typed links without forcing every entity into a graph DB.

### `entity_links`

Generic typed edges between app objects.

Key fields:

- `id`
- `user_id`
- `from_type`
- `from_id`
- `to_type`
- `to_id`
- `relation`
- `metadata`
- `created_at`

Examples:

- item belongs to opportunity;
- source supports decision;
- person related to project;
- skill generated from proposal;
- policy applies to area.

## V1 Minimum Tables

The smallest useful V1 schema should include:

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
- `external_sources`
- `source_links`
- `opportunities`
- `provider_accounts`
- `secret_records`
- `capabilities`
- `capability_operations`
- `capability_grants`
- `skills`
- `skill_capability_requirements`
- `schedules`
- `audit_logs`
- `search_documents`

Daily plans, opportunity events, skill runs, and capability events may be added
in early V1 migrations if they are needed before the dashboard.

## Migration Discipline

- Use Drizzle migrations.
- Avoid destructive migrations until backup/restore is working.
- Include seed/demo data separate from private user data.
- Keep private deployment data out of the OSS repo.
- Build restore tests before relying on the system for real reminders.
