# RyanOS

RyanOS is an AI-first, local-first personal operating system for managing tasks,
projects, recurring responsibilities, opportunities, reminders, decisions, and
proactive assistant workflows.

The core idea: natural language is interpreted by AI into typed tools, and
deterministic handlers validate permissions, recurrence, policies, state
mutation, and audit logging.

## Planning Docs

- [ARCHITECTURE.md](./ARCHITECTURE.md): system architecture and accepted stack.
- [MESSAGE_PIPELINE.md](./MESSAGE_PIPELINE.md): AI-first message and agent loop.
- [TOOL_CONTRACTS.md](./TOOL_CONTRACTS.md): AI-callable tool boundary.
- [DATA_MODEL.md](./DATA_MODEL.md): PostgreSQL/Drizzle data model.
- [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md): V1 through V2 build plan.

## Current Status

Implementation has started. The repo contains the initial Node/TypeScript
workspace, Docker/Postgres setup, Drizzle schema and migration, Fastify API
shell, Graphile Worker shell, Next.js dashboard shell, first typed tool
contracts, a Postgres-backed store adapter with in-memory fallback, persisted
message sessions, and Telegram webhook normalization with redelivery
idempotency. The current typed tool surface includes item search, create,
update, complete, and snooze; recurrence policy/event recording; notification
policy persistence; and state explain placeholders.

## Local Dev

Docker is the preferred local path, matching the pattern used in nearby projects
like `filemytro` and `NoxJury`.

1. Copy env: `cp .env.example .env`
2. Start web, API, and Postgres: `pnpm docker:up`
3. Dashboard: `http://localhost:3000`
4. API health: `http://localhost:4000/health`

The Compose setup binds host ports to `127.0.0.1`, keeps Postgres on a
non-default host port by default, mounts source into containers, and stores
container `node_modules` in named volumes so host installs do not fight Docker
installs.

For direct host development, use Node `20.20.0` from `.node-version`, then run:

```bash
pnpm install
pnpm build
pnpm test
```

## Next Build Step

Connect a real AI provider or Codex bridge to the typed tool runtime, then add
Telegram assistant responses and notification delivery.
