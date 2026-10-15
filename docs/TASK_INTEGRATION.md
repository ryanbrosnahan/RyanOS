# Personal assistant task integration — local review draft

Prepared October 14, 2026. This code is not deployed or provisioned. It adds no
service dependency, credential, background process, network exposure or account
grant. It uses the existing Fastify API, PostgreSQL and Better Auth libraries.
RyanOS Tasks is already installed at personal scope. The new adapter transport
and configuration are not enabled; installing the skill does not establish connectivity.

## Behavior and authority

A source action has a stable `sourceId` within a durable integration identity.
Use one integration identity across the assistant's projects so the same action
is not duplicated just because a conversation changes projects. Construct IDs
from immutable origin identifiers plus a stable action identifier, for example
`chat:conversation-123:message-456:action-1`. Do not derive them from an editable
title, a timestamp on each run, or the current project name. A token spans its integration namespace across all projects; source-ID prefixes
are naming conventions, not project ACLs. Project-restricted credentials are not
implemented or claimed. The caller must persist/reuse the original ID; the server cannot recognize semantic duplicates
with different IDs. Distinct projects can create distinct legitimate tasks.

`capture` inserts an ordinary `task` exactly once, using a database unique key
and a single transaction for the source ledger, task, creation event and audit.
Concurrent deliveries serialize on the source key. Retries return current RyanOS
state and never overwrite title, notes, dates, status, priority or organization.
No inferred deadline is added: omitted due dates remain unset. Tasks initially
land unscoped; automatic area/project creation is deliberately excluded.

Readback uses the source ledger, not the dashboard's open-items filter, so done,
cancelled, hidden and deleted work does not disappear from integration history.
Task `revision` and `updatedAt` reflect the current user-editable record. Deleted
items return `item: null`. Cancellation/deletion creates a durable suppression
marker when next observed. The source mapping itself prevents recreation even
before that observation. Explicit owner dismissal persists suppression immediately
and rejects pending completion requests, while leaving the ordinary task intact.
There is no integration unsuppress/reset operation. Retain ledger rows as
suppression tombstones; never rotate credentials by deleting/recreating their
integration identity. Backup these tables with the normal database backup.

Completion requests hold caller-reported external observations, individually
identified by a stable `requestKey`. Retrying a request returns its original
status/evidence, including a rejection. A request never marks an item done and
never declares the evidence independently verified. Ryan can approve or reject
individual requests in **Admin → Task completion requests**. Approval requires
his existing owner session, a trusted browser origin, and the task revision
captured by the request. Approval locks the item against in-flight recurrence
insertion before rechecking current state. A changed/deleted/cancelled/already-done task is not
completed. Recurring or converted non-task items require the existing RyanOS
workflow and cannot be completed by this adapter. Rejection leaves task state
unchanged. A fresh request after a stale/rejected one requires a new request key
and renewed human review; the skill should not repeatedly nag or bypass rejection.

`item.status` / `completedAt` are RyanOS state. `completionRequests[].evidence`
is caller-supplied observation, whether the request is pending, rejected or
approved. Even an approved request does not certify those observations as true.
Normal user completion in the existing dashboard remains authoritative. This
adapter does not change other RyanOS task editing/completion routes.

## API and scopes

Browser-facing paths have an `/api` prefix; internal API paths omit it.

| Method and browser path | Authentication | Purpose |
| --- | --- | --- |
| POST `/api/v1/task-integration/tasks` | `tasks:create` bearer scope | Create if absent; current full state only if token also has `tasks:read` |
| GET `/api/v1/task-integration/tasks?sourceId=...` | `tasks:read` bearer scope | Current task, suppression and completion requests for this source |
| POST `/api/v1/task-integration/completion-requests` | `completion:request` bearer scope | Propose completion; no status mutation |
| GET `/api/v1/task-integration-requests` | Owner Better Auth session | First 100 pending requests, oldest first |
| POST `/api/v1/task-integration-requests/:id/decision` | Owner session + trusted Origin | Approve/reject one request |
| POST `/api/v1/task-integration-captures/:id/dismiss` | Owner session + trusted Origin | Suppress one source action |

Create body:

```json
{
  "sourceId": "chat:conversation-123:message-456:action-1",
  "title": "Review the proposed contract terms",
  "body": "Why this matters, a source reference, and concrete next steps.",
  "priority": "normal"
}
```

Optional `dueAt` must be an ISO timestamp with timezone. Unknown fields, including
caller-supplied identity, status and completion fields, are rejected. Source IDs
and request keys accept ASCII letters, digits, `:._/-`, up to 240 characters.
Evidence URLs accept HTTP(S) only; the server never fetches them.

Completion request body:

```json
{
  "sourceId": "chat:conversation-123:message-456:action-1",
  "requestKey": "review-1",
  "evidence": [{
    "summary": "The draft was uploaded; Ryan still needs to confirm review is finished.",
    "sourceUrl": "https://example.com/synthetic-reference",
    "observedAt": "2026-10-14T03:10:00Z"
  }]
}
```

Owner decision: `{ "approve": true, "expectedRevision": 1 }`; reject uses
`approve: false`. Owner dismissal: `{ "dismiss": true }`. No bearer scope can
approve, reject, dismiss, edit existing tasks, or invoke generic tools. Owner
routes fail closed in `dev-local` mode. Token endpoints always require bearer
authentication, including in `dev-local` mode. No token minting API is exposed.

Credentials are scoped to one user and integration namespace. They are looked
up by SHA-256 digest, require an expiry, and support revocation. Only a hash is
stored. Production provisioning/rotation must be a separately approved operation
that retains the integration ID, uses at least 32 cryptographically random bytes,
and never logs plaintext. The user-operated hash-only provisioning helper and Keychain runner are
documented in TASK_ACTIVATION.md; they remain unconfigured. No provisioning UI
exists. No live token was created or used during development.
No rate limiter or completion webhook is introduced; readback is explicit polling
when the assistant runs. This is personal-use code, not an untrusted public API.

## Reachability when the Mac is offline

Verified deployment investigation: Lenovo serves RyanOS privately through
Tailscale Serve; existing authenticated Chrome on this Mac can reach it. Lenovo's
running API source matched its clean `4e9ee4c` checkout. The review code is based
on the Mac checkout's `618dca9`, excluding its uncommitted edits. Existing Codex
RFP automations upload proposals, not ordinary tasks. The server's Codex bridge
is an outbound model interpretation facility, not an inbound cloud task transport.
The existing ingestion credential is not valid for this adapter and should not
be broadened or reused.

If the Mac is offline, Lenovo can continue serving this API to **already authorized
reachable tailnet clients**. That alone does not let a ChatGPT cloud assistant
reach it, inherit the Mac's session, execute a local skill, or inspect every chat.
No supported private ChatGPT-to-tailnet transport was verified in this environment.
The offline capture requirement therefore remains blocked on a transport decision.

Prefer existing infrastructure if an approved assistant execution host already
has supported private access to Lenovo. Verify that host's actual tool execution,
reachability, identity, credential storage and availability before wiring it up.
If such execution is unavailable, separately discuss a private connector/bridge
with a narrow queue boundary on existing infrastructure. A server process cannot
invent access to ChatGPT conversations. Do not claim that adding endpoints, a
skill, Tailscale, an MCP label, or an outbound poller establishes this connection.
No tunnel, public exposure, hosted broker, new SaaS or paid service is proposed
as an assumed solution. Any such dependency needs the AGENTS.md discussion and
explicit approval before adoption.

## Setup checklist — future permissions, not performed

1. **Code review:** approve this API, schema migration and owner review panel.
   Review it alongside newer main changes and preserve unrelated local edits.
2. **Private transport decision:** identify the actual supported assistant
   execution host/connector for all intended projects, including while the Mac
   is offline. Ask Ryan to approve that mechanism and its specific data flow,
   access duration and operational responsibility. Until verified, cloud capture
   is unavailable. Do not grant account access or change networking to work around it.
3. **Credential permission:** ask separately to provision one integration for
   Ryan with `tasks:create`, `tasks:read`, `tasks:search`, `completion:request`, an agreed expiry
   and approved secure storage at the execution host. Explain that these scopes
   permit creating tasks, reading user edits on mapped tasks and submitting
   completion proposals, but not marking tasks complete. Establish revocation
   and rotation ownership; never put a bearer token in a skill or prompt.
4. **Deployment permission:** after review/tests and a database backup, obtain
   separate approval to apply migration `0016_square_maelstrom` and deploy using
   the established Lenovo procedure. Follow production recovery instructions;
   do not build production images on Lenovo. No restart/network change is implied.
5. **Adapter configuration permission:** RyanOS Tasks is already installed at
   personal scope; do not reinstall it. After transport and credential approval,
   approve binding its existing routing policy to the new adapter tools. Confirm
   actual tool availability in each intended ChatGPT project. A skill is not a
   universal event hook: verify which conversations/runs can invoke it. No
   backlog import by default.
6. **Per-completion permission:** present current RyanOS title/status and the
   proposed evidence, ask Ryan whether to mark that specific task done, and have
   him approve the corresponding request in RyanOS. A broad initial capture
   approval is never completion approval. Session cookies stay in RyanOS's browser.
7. **Validation permission:** before a live test, agree on a disposable test task
   and cleanup. Test creation/readback, user edits, dismissal/deletion and a
   rejected completion first. No production test task was created for this draft.

Existing personal skill policy to preserve when configuring the adapter: capture
only clear discovered action items; use concise imperative titles and context/source references; keep
substeps in the task body; omit invented deadlines; reuse stable source IDs;
read RyanOS before reporting status; never rewrite user edits or recreate
suppressed items; distinguish marked-done from externally verified; require
Ryan's explicit approval before completion. On unavailable transport, report
capture as pending/unavailable rather than claiming it was saved.

## Local validation

With Node/pnpm dependencies installed and the existing official `postgres:16-alpine`
image available, run `scripts/test-task-integration.sh`. It builds shared packages,
starts a disposable loopback-only database with synthetic credentials, applies
all migration SQL on a fresh database, runs focused real-PostgreSQL/API tests,
and removes the test container on exit. It does not use production `DATABASE_URL`.
The focused suite is skipped in a normal test run unless
`TEST_TASK_INTEGRATION_DATABASE_URL` is set. It rejects non-loopback hosts and
any database name other than `ryanos_integration_test`.

Also run `pnpm test`, `pnpm typecheck`, and `git diff --check`. Local review has
not exercised production writes, cloud connectivity, credential provisioning or
deployment. The owner panel was also checked in Google Chrome against a loopback-only
synthetic API/web fixture: it displayed the current task and separate evidence;
rejecting a completion removed the request while the task stayed open. The
synthetic account was signed out and the local services/container removed.
API tests exercise a real synthetic Better Auth session and the origin boundary.

Review validation results: full workspace `pnpm test` passed 178 tests;
the database suite is intentionally skipped there without its explicit test URL.
The focused suite passed 25 additional real-PostgreSQL/API tests on a fresh
container, including all migrations, concurrent capture, edit preservation,
deleted/cancelled/dismissed source suppression, rotation, expiry/revocation,
scope isolation, immutable evidence/replay, transactional rollback, stale
approval, concurrent recurrence insertion and recurring-item refusal. `pnpm typecheck` and `git diff --check`
also passed. Production browser writes and offline cloud connectivity remain
untested and unconfigured.

## Actionable search and API-first personal skill contract

The local patch adds `/tasks` and `/tasks/:id` in the web app, linked from Open
items and from chat search responses. Results show the current description,
stable ID, revision, status, project and area. The description remains plain text
and is escaped by React. Search uses case-insensitive AND terms across ID,
title, description, project and area. Empty queries browse the selected filters;
there is no semantic duplicate guarantee. Status filtering happens before
pagination. Results sort by updated time descending then ID, with limit 1–50 and
explicit offset. Read details by exact ID, never a title match.

| Interface | Required authority | Result |
| --- | --- | --- |
| `GET /v1/task-integration/search?query=James%20POA` | Bearer `tasks:search` | `{ records: [{ item, project, area, href }] }` |
| `GET /v1/task-integration/items/:id` | Bearer `tasks:search` | `{ record }`, including current soft-deletion state |
| `GET /v1/task-search` and `GET /v1/task-search/:id` | Current owner Better Auth session | Same records for owner UI |

Optional query filters: `statuses=open,active,waiting,done,cancelled`,
`includeDeleted=true`, `projectId=<uuid>`, `projectStatus=active|archived`,
`limit`, `offset`. Omitted statuses include all five states. RyanOS has no
`archived` **item** status: archived projects and soft-deleted items are separate
filters. Unknown filters and caller identity fields are rejected. Project/area
joins require the same owner as the item. Search is read-only; it does not create
source-ledger records or restore dismissed/deleted items. `tasks:search` is a
separate, broader grant to read all of this owner's items for deduplication;
`tasks:read` alone remains limited to captured sources. This grant needs explicit
approval when provisioning, rather than silently broadening an old token.

`scripts/ryanos-task-client.mjs` is a dependency-free ESM client. A trusted
executor supplies `baseUrl` (API origin or web `/api` proxy) and `token` from its
secret store. It exposes `search`, `readItem`, `readCapture`, `capture` and
`requestCompletion`. It omits cookies, refuses redirects, uses a timeout, and
returns generic errors. It contains no token or provisioning mechanism. It
cannot approve completion. Do not put a credential in a chat, URL, skill file,
CLI arguments or browser storage. No client configuration or live Keychain entry has been installed. The local runner is prepared, not activated.

Proposed personal-skill workflow, applicable across projects once a real tool
adapter is configured:

1. Search likely existing tasks across **all** statuses, then inspect plausible
   IDs. Include deleted items when checking whether Ryan dismissed prior work.
   Do not infer absence from the open dashboard, a result count, or one page.
2. Reuse the source ledger ID for retries. If a different existing task is the
   same action, report its current ID/status and do not capture another source.
   Ask Ryan if matching remains materially ambiguous. Never silently bind an
   external source to an unrelated editable item.
3. Automatically capture a clear, novel action with its source and useful next
   steps. Omit inferred dates. Keep organization changes under Ryan's control.
4. Read current RyanOS state before reporting or proposing completion. Respect
   user edits, cancellation, deletion and suppression. Store external evidence
   separately. Submit a completion request and ask Ryan; only his owner review
   action can mark the task done. Existing unmatched tasks have search/read
   access, but this minimal adapter cannot request completion for them until a
   separately designed owner-approved linking workflow exists.

A global skill supplies instructions; it does not automatically execute in all
cloud projects or grant background access to all conversations. The smallest
currently evidenced execution route is this Mac, already connected to Tailscale,
using the private HTTPS address and an approved scoped API credential after
code deployment. It requires the Mac/executor to be available. No cloud-to-tailnet
route was verified, and offline cloud capture remains blocked. Deploying the
patch, granting the four scopes, securely provisioning/storing the credential,
and wiring an actual callable adapter are separate approvals still outstanding.

The local patch also fixes chat quick-add fallback's negated creation handling
and the UI's refusal to clear due dates. Neither fix is deployed. The live James
task was separately authorized and saved as open, ID
`7d679d90-ad29-4c57-9d4e-eaf05a66cf31`; deployed default-date behavior assigned
October 28, 2026 and the deployed UI cannot clear it. An accidental fallback task
was soft-deleted through the app's confirmation dialog. No other live task was
created or completed during this follow-up.
