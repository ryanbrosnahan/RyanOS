# Task integration activation handoff — not activated

Prepared in an isolated checkout based directly on deployed
`4e9ee4c9ec443d05aeb59779ba00f1ad86e6c4e4`. The earlier integration patch was based
on `618dca9`, whose sole additional commit changes README/screenshots. This release
includes only the integration and its activation artifacts; it does not include
that documentation commit or either dirty checkout's unrelated work. Source is
uncommitted, unpushed and undeployed pending review. Re-check production revision
and cleanliness immediately before deployment; the script refuses changes.

## Specific approval boundary

Approve a reviewed source commit and published release branch, a Linux AMD64
image built from that exact clean commit, the new additive migration, and brief
replacement of API/web/worker. Existing Tailscale/network settings, PostgreSQL
container, optional Telegram poller, Codex bridge, PostgreSQL-auth setup and old
images are not changed by the narrow deployment. No automatic rollback or database
restore occurs. There may be interrupted in-flight requests and a temporary web/API
outage during recreation. The worker may miss one in-flight iteration. The shared
image means optional services keep their old running image until separately
approved; no API contract break for them is intended.

Separately approve one user-bound integration with scopes:
`tasks:create`, `tasks:read`, **`tasks:search`**, `completion:request`, expiring
30 days after user-operated provisioning with no sliding renewal. Search reads
Ryan's entire item collection, not a project subset, including notes/habits and
completed work, and deleted work when requested. Source readback is limited to
this integration's capture ledger. No token may edit/delete existing tasks,
approve a completion request, or call generic tools. Tokens can propose completion
only for this integration's captured tasks. Existing tasks have no automatic
source-linking/approval mutation path.

## Local preparation and deployment (future authorized operations)

1. Review the isolated diff, run `pnpm test`, `pnpm typecheck`,
   `bash scripts/test-task-integration.sh`, and
   `bash scripts/task-integration/build-keychain-helper.sh`. The Swift self-test is
   memory-only and uses a fixed dummy string. Do not run `create`, `metadata` or
   `read-pipe` during preparation. The latter two access a real Keychain entry.
2. Commit only the approved release changes on `task-integration-release`, then
   explicitly approve publishing that exact branch to origin. No script pushes.
   Use a clean checkout; do not commit or stash the user's unrelated changes.
3. Run `bash scripts/build-task-release.sh release`. The clean commit SHA and
   `release` status become image labels. A `review` image can be built with dirty
   preparation code, but deployment expressly refuses it. Rebuild the final
   image after the approved commit. No production `.env`, Keychain binary or
   credential is in the Docker build context.
4. `bash scripts/deploy-task-release.sh plan` is read-only and makes no remote
   calls. After specific deployment approval:
   `bash scripts/deploy-task-release.sh apply task-integration-release`.
   It requires a clean local tree, exact published SHA, exact AMD64 image labels,
   unchanged Compose/guard scripts, clean expected production SHA, and healthy
   existing PostgreSQL. It stops if the churn guard is tripped; it never resets
   the guard or restarts Docker/NetworkManager/Tailscale.
5. It preserves the current image under `ryanos-app:task-rollback-<UTC timestamp>`
   and writes `/opt/ryanos/backups/task-release-<release SHA prefix>-<UTC timestamp>/`:
   directory mode 0700; `postgres.dump`, `master-key`, `release.txt` mode 0600
   under the existing Lenovo deployment owner. These contain sensitive application
   data/key material. Keep them on Lenovo, owner-only; do not attach them to chat.
   `release.txt` records prior/current SHA, prior image ID and rollback tag.
6. It fetches and detaches at the approved release SHA, verifies the transferred archive checksum and loaded AMD64 image revision/layers, runs `compose run --rm --no-deps migrate`, and recreates **only**
   `api web worker` with `up -d --no-build --no-deps`. It neither installs host
   dependencies nor restarts the bridge, repairs database authentication, publishes
   Android, removes orphans, or retires images. Health is bounded and guard-aware.
7. Verify private HTTPS health, owner sign-in, search/detail UI, unauthenticated
   API denial, no-token scoped API denial and migration state before provisioning.
   Do not create production test tasks. Integration grant/read-only checks can
   validate real access after Ryan provisions the credential.

## Migration and rollback

Production was read-only verified at migration ledger count 16, newest timestamp
`1784911589525` (`0015`). New `0016_square_maelstrom.sql` adds only
`task_integrations`, `task_captures`, `task_completion_requests`, their foreign
keys and two unique indexes. It alters no existing item columns. DDL can briefly
acquire locks; the migration may wait/fail and must not be repeatedly retried
through an unhealthy host. Migration success does not imply application health.

On failed application health, inspect once before deciding rollback. After
approval, use the current release SHA and exact **recorded** prior image ID:
`bash scripts/rollback-task-release.sh <release-sha> <prior-image-id>`.
It validates current source, selects the retained image, recreates API/web/worker,
and waits for guarded readiness. It intentionally leaves the release source
checkout and additive tables in place for diagnosis; source HEAD therefore no
longer identifies the rolled-back running image. Record this state explicitly.
Do not run the deploy script again until source/image state is reconciled.

Existing and newly captured ordinary tasks remain in the same database after
code rollback. Keep capture/suppression ledgers even if unused by old code.
Do not drop new tables or restore the database dump as routine rollback: that
would lose new mappings, evidence or intervening user edits. Database restore
requires a separate data-loss decision. If a credential was already provisioned,
review revocation (`task_integrations.revoked_at`) through the owner/operator
procedure; this release does not add a revocation UI or automate it.

## User-operated credential setup (only after grant approval)

Build the native helper using the command above; its ignored binary remains on
this Mac at `scripts/task-integration/bin/ryanos-task-keychain` and is excluded
from the Docker context. Ryan personally invokes in his terminal:

`node scripts/task-integration/provision.mjs create <verified-Ryan-user-UUID>`

The UUID is not a secret; verify it from the owner's current RyanOS identity,
not a display name or a guessed ID. The helper asks Ryan to type
`GRANT RYANOS MAC ACCESS`, then `CREATE RYANOS CREDENTIAL`. Honor any macOS
Keychain handoff/prompt; the assistant must not submit either real approval.
There is no token entry, clipboard copy or secret in command arguments. Swift
uses `SecRandomCopyBytes` for 32 bytes and stores the resulting base64url token
only in a generic-password Keychain entry:

- service `RyanOS Tasks API`; account `personal-assistant`;
- `WhenUnlockedThisDeviceOnly`, synchronization disabled;
- value includes token, integration ID, owner ID and expiry; not a plaintext file.

Only digest/IDs/expiry are emitted by creation. The Node provisioning helper
pipes that non-secret metadata to the receiver inside Lenovo's existing API
container over existing SSH. Receiver uses parameterized SQL, fixed four scopes,
expiry capped at 30 days (+ five-minute clock allowance), no plaintext token,
owner foreign key and idempotent integration ID. A conflicting resume is refused.

If SSH or confirmation fails after local storage, do **not** generate another
identity. Inspect the non-secret result/state, then Ryan can run
`node scripts/task-integration/provision.mjs resume` after review. This reads
metadata from the existing Keychain entry and retries the same digest/identity;
it never overwrites an existing grant or Keychain entry. Expired/revoked grants
are not resurrected. Rotation/revocation UI is outside this release: stop and
plan those operations explicitly rather than delete/recreate the source ledger.

## Callable runner and shared-skill excerpt

After activation, this Mac's authorized local task environment invokes:

`node scripts/task-integration/runner.mjs search`

with JSON on stdin, for example `{"query":"James tax","includeDeleted":true}`.
Other operations: `read-item` (`{"id":"<UUID>"}`), `read-capture`
(`{"sourceId":"..."}`), `capture` (sourceId/title/body and optional priority/dueAt),
`request-completion` (sourceId/requestKey/evidence). No token/configuration goes
on stdin. The API base is pinned to existing private HTTPS. The helper reads the
credential only into an anonymous pipe; direct terminal or file output is refused.
Runner errors are generic, cookies are omitted, redirects refused, and response
fields allowlisted with known-token echoes redacted. Keychain access failure or
expiry requires handoff, not browser-cookie extraction or another transport.

Suggested shared-skill connection text **after successful real verification**:

> Use the authorized local Mac task environment to call the Keychain-backed
> RyanOS runner. Search across relevant statuses and deleted work, paginate, then
> inspect stable IDs before capture. Reuse the immutable sourceId on retries;
> treat RyanOS edits, cancellations, deletion and suppression as authoritative.
> Automatically capture only clear novel actions with minimal source context;
> omit inferred deadlines. Read back every capture. Submit completion evidence
> separately, ask Ryan about the exact task, and require his owner-panel action.
> The runner cannot mark tasks complete. If the Mac, Keychain or API is unavailable,
> report the operation as not saved; no unattended cloud/offline synchronization
> exists. Never store credentials in the skill or infer API availability from
> the personal skill's installation.

Full API contract: [TASK_INTEGRATION.md](TASK_INTEGRATION.md). Existing James task
is not mapped to this new integration; activation must not re-create it or imply
this runner can clear its date. Date clearing requires the separately authorized
owner UI action after the local fix is deployed.

## Preparation validation and remaining build blocker

The Swift helper compiled on this Mac. Its memory-only self-test passed; negative
tests verify creation refuses non-terminal input and credential reads refuse
regular-file output before any Keychain call. Dummy runner tests cover redaction,
allowlisted fields, cookie/redirect policy, expiry and refusal of completion.
Dummy deployment adapters capture and syntax-check both remote scripts without
contacting Lenovo. Real PostgreSQL tests cover hash-only provisioning, replay and
conflict rejection in addition to the existing integration checks.

The authorized Linux AMD64 production Docker build was attempted with the exact
existing Dockerfile and no real secrets. It stalled at `load metadata for
docker.io/library/node:20.20.0-slim` and was stopped without changing Docker or
network configuration. No complete review image exists. This is a remaining
release gate: repeat the full build and runtime health checks once the existing
registry access works. A final clean-commit `release` build is required regardless
of a successful dirty-source `review` build. Do not deploy a prior cached app image
or substitute a different base to bypass the failed verification.

Final preparation results: 184 workspace tests passed; the 26 PostgreSQL tests
were skipped in the normal run and passed separately against disposable local
PostgreSQL. Type checking, Swift compilation/self-test, native refusal tests,
JavaScript/shell syntax and `git diff --check` passed. Independent static review
found one rollback-readiness issue, now fixed and covered by the mocked rollback
script test; no material findings remain. No live Keychain operation, real token
generation, credential transmission/grant, remote push, network configuration,
deployment or production task mutation occurred during this preparation.

### Build diagnosis follow-up

A later local-only check confirmed no build remained active. The existing official
`node:20.20.0-slim` cache is ARM64, not the required AMD64. Direct HTTPS from the
Mac to `https://registry-1.docker.io/v2/` returned the expected HTTP 401 bearer-auth
challenge, so registry outage was not established. One controlled pull of the
exact official AMD64 tag stalled in the existing `docker-credential-desktop get`
child before any registry response was reported by Docker. Docker's configured
credential store is `desktop`; no credential values were inspected or printed.
The retry was interrupted, yielding `error getting credentials - err: signal:
interrupt`. Process inspection then confirmed no pull/build/helper remained.

The verified blocker is the existing Docker Desktop credential-helper wait, not
a proven Docker Hub outage. Its underlying cause (for example, a pending local
unlock/permission) has not been verified. Do not bypass it with a different
credential configuration, new login, unofficial image or network/security change.
The user/operator should resolve the existing Docker Desktop access state before
another authorized attempt. Full AMD64 build and runtime smoke checks remain
unperformed; dependent build work stopped.

### Current build status — blocker resolved on fresh check

At the fresh check around 23:52 UTC October 14, Docker Engine responded and no
old build/pull remained. One bounded retry pulled the exact official
`node:20.20.0-slim` AMD64 image successfully; no credentials, security/network
settings, or Docker configuration were changed. The prior credential-helper
wait did not recur. Desktop inspection itself was unavailable (computer-control
connection closed), so no particular visible permission prompt was verified.
No user prompt approval or secret entry was performed.

The full original Dockerfile build then completed successfully for Linux AMD64:
`ryanos-app:task-review-4e9ee4c9ec44`, inspected image ID
`sha256:2f26dd3219eb0db68f663f882e28a791666e3e52654d1affeef2247249574746`.
The earlier build-blocker notes above are historical and superseded by this result.
This image is marked **review**, contains the uncommitted prepared changes, and
is deliberately ineligible for the release deployment script. A final clean
approved commit, separately approved push and exact-commit `release` build are
still required before deployment. Prior running application/production unchanged.

Local smoke tests passed on that actual AMD64 image using disposable containers
with no host ports or external container networking:

- All 17 migrations applied to a fresh disposable PostgreSQL database.
- API `/health` returned 200.
- Unauthenticated ordinary items, owner search and scoped task/search routes
  returned 401.
- Standalone web `/api/health` proxy and `/tasks` returned 200, with the expected
  search page heading present.
- The Mac Keychain binary was excluded from the Linux image.
- API/web/database fixtures were removed; no production contact or task changes.

Evidence logs on the Mac: `/tmp/ryanos-release-image-build-fresh.log` and
`/tmp/ryanos-release-image-smoke.log`. No current Docker blocker remains.

Deployment transport verification also compares the transferred archive SHA-256,
loaded AMD64 architecture, clean-release/revision labels and root filesystem layer
hash. This avoids comparing Docker-version-dependent image-ID representations.
The prior server-native image ID remains the rollback reference.
