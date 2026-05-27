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
inbound/outbound message sessions, and Telegram webhook normalization with redelivery
idempotency. Telegram assistant responses can be delivered through the Bot API
once the encrypted bot token is imported. The dashboard includes a setup-status panel and web chat intake
that posts natural language through the same message pipeline and reloads recent
persisted chat history, plus a read-only open-item list. Local secret handling
now supports an external master key plus encrypted `secret_records` for
integration credentials. The current typed tool surface includes item search, create,
update, complete, and snooze; recurrence policy/event recording; notification
policy persistence; and state explain placeholders.

## Local Dev

Docker is the preferred local path, matching the pattern used in nearby projects
like `filemytro` and `NoxJury`.

1. Copy env: `cp .env.example .env`
2. Start web, API, and Postgres: `pnpm docker:up`
3. Dashboard: `http://localhost:3100`
4. API health: `http://localhost:4100/health`
5. Setup status: `http://localhost:4100/v1/setup/status`

The Compose setup binds host ports to `127.0.0.1`, keeps Postgres on a
non-default host port by default, mounts source into containers, and stores root
and workspace package `node_modules` in named volumes so host installs do not
fight Docker installs.

Default Docker host ports are `WEB_PORT=3100`, `API_PORT=4100`, and
`DB_HOST_PORT=54334`. The API and web containers still listen on their normal
internal ports; only the host bindings move.

Browser access to the API is intentionally origin-scoped. For local development,
`RYANOS_CORS_ORIGINS` defaults to `http://localhost:3100,http://127.0.0.1:3100`.
Add the eventual LAN, Tailscale, or public dashboard origin there before using
that access path.

When RyanOS needs a human setup action, such as Codex login or a Telegram bot
token, it should expose that through setup status instead of failing silently or
working around the missing connector.

## Local Secrets

RyanOS stores long-lived integration credentials encrypted in Postgres. The
database backup contains ciphertext only; the master key lives outside the
database in `secrets/master-key`.

Generate the local master key:

```bash
pnpm secrets:generate-key
```

Telegram setup uses a local import path so the bot token does not pass through
the dashboard or chat:

```bash
# after creating a bot with BotFather, put the token in secrets/telegram-bot-token
docker compose exec api pnpm telegram:store-token -- --file /app/secrets/telegram-bot-token
```

`TELEGRAM_BOT_TOKEN` remains a development fallback, but the preferred path is
encrypted DB storage plus a separately backed-up master key.

For local testing, start the Telegram poller:

```bash
pnpm docker:telegram
```

Then inspect the logs for the bot username:

```bash
docker compose logs -f telegram-poller
```

Open that bot in Telegram and send `/start` or any plain text message. RyanOS
will ingest the message through the same `/v1/inbound/telegram` path used by
future webhooks.

The poller sends a Telegram typing action while RyanOS is processing a message.
Disable it with `TELEGRAM_SEND_TYPING=false` or tune the heartbeat with
`TELEGRAM_TYPING_INTERVAL_MS`.

For Docker-backed AI interpretation through the logged-in Codex app, run the
host bridge:

```bash
RYANOS_CODEX_BRIDGE_HOST=0.0.0.0 RYANOS_CODEX_BRIDGE_TOKEN=<local token> pnpm codex:bridge
```

The Docker API uses `RYANOS_CODEX_BRIDGE_URL` and
`RYANOS_CODEX_BRIDGE_TOKEN` from `.env`. Keep the bridge local-only; do not
expose it publicly.

While Docker services are running, treat dependencies as Docker-owned. To switch
back to direct host development, stop the services and run:

```bash
pnpm install --force --store-dir /Users/ryan/Library/pnpm/store/v10
```

For direct host development, use Node `20.20.0` from `.node-version`, then run:

```bash
pnpm install
pnpm build
pnpm test
```

## Next Build Step

Connect the Codex-login bridge to the typed tool runtime, then add scheduled
notification delivery using the encrypted token store.
