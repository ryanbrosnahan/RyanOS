# Task integration focused independent review

October 14, 2026. Reviewed the local draft based on `618dca9`, including a fresh
reviewer with no inherited implementation history. One material finding was
reproduced and fixed. The reviewer rechecked the fix and reported no remaining
material findings within the requested scope.

## R1 — Medium / P2 — Recurrence insertion could race approval (fixed)

Location: `packages/db/src/task-integration-store.ts`, `decide`, lines 146–168.
Originally the one-off completion relied on `UPDATE ... AND NOT EXISTS (SELECT
1 FROM recurrence_policies ...)`. An in-flight recurrence insertion acquired
an item foreign-key KEY SHARE lock, compatible with the completion update's
NO KEY UPDATE lock. Its uncommitted row was invisible to the predicate, so the
item could be marked done while the recurring schedule committed concurrently.

The independent reviewer reproduced the PostgreSQL behavior in disposable
synthetic tables. A regression against the real adapter also failed before the
fix (21 passed / 1 failed): approval did not block on the in-flight policy writer.

Fix: approval now acquires the item with `SELECT id FROM items WHERE id = $1
FOR UPDATE` before fresh state and recurrence checks. This conflicts with the
policy insert's FK lock, waits for that writer, and then rejects one-off
completion when the policy is visible. The regression checks database blocking,
HTTP-style 409 rejection from the adapter, and preserved open status. The
independent reviewer inspected this fix and confirmed the finding is resolved.

## Other reviewed boundaries

No further material findings in authenticated owner approval, per-user and
integration namespace isolation, bearer scopes, expiry/revocation, transactional
capture idempotency, durable deletion/dismissal suppression, or evidence labeling.
Owner decisions require a Better Auth session and trusted Origin; bearer tokens
cannot approve a completion or invoke the existing generic completion endpoint.
Retries preserve user edits. Evidence is caller-reported observation and remains
separate from RyanOS's marked-done state even after approval.

Project names/source-ID prefixes are not security boundaries. One integration
identity intentionally spans the user's projects; project-restricted tokens are
not implemented or claimed. Distinct valid integrations cannot read each
other's mapped tasks. Duplicates with different source IDs remain a documented
caller responsibility.

## Test evidence and limits

- Fresh disposable PostgreSQL: **23 focused tests passed**, applying all migration
  SQL. This includes 12 concurrent captures, transactional rollback, concurrent
  recurrence attachment, two valid owners through HTTP injection, a route scope
  matrix, and expiry/revocation on every bearer route.
- Tests include the actual Fastify app wiring and a real synthetic Better Auth
  owner session, trusted/untrusted Origin checks, and rejection of bearer-only
  access to owner/generic completion routes. Store-level cases also use real
  PostgreSQL transactions rather than mocked query responses.
- Full workspace `pnpm test`: **170 passed**, 23 database tests intentionally
  skipped without the dedicated test URL; those 23 passed separately above.
- `pnpm typecheck` and `git diff --check`: passed.
- Test containers were removed. No production changes, live credentials, remote
  pushes or deployment occurred. Production writes and cloud-to-tailnet
  connectivity were not tested and remain outside this local review.

Setup notes now correctly state that **RyanOS Tasks is already installed at
personal scope**. Only new adapter transport/configuration and the separately
approved credential/deployment work remain pending. This review does not enable
those capabilities.

## Search follow-up review

The independent reviewer found and the implementation corrected:

- SQL status-array interpolation: changed to a parameterized `IN` list; tested
  single and multiple status filters against PostgreSQL.
- UUID details accidentally using fuzzy search: added an exact owner-scoped
  item ID condition; regression includes a newer item mentioning the target ID.
- Adverbs bypassing quick-add negation: broadened the guard within a sentence;
  regressions include “don't automatically add” and “do not ever create”.

The search grant is intentionally distinct from captured-source readback. It
reads the owner's existing items for deduplication; it confers no mutation or
completion power. New owner search paths require the current authenticated user
and ignore no caller-provided identity. No live scopes have been granted.

Final follow-up validation: 178 workspace tests passed, with the 25 PostgreSQL
tests skipped in the normal run and passing separately against a fresh disposable
database. `pnpm typecheck` and `git diff --check` passed. Chrome Person 1 verified
search by independent title terms, description search, done + archived-project
filters, stable detail links, and actual chat results with titles/status/project/IDs/
descriptions and clickable details. The scripted local AI fixture made no external
model call. Synthetic account signed out; local API/web services and disposable
containers stopped. Uppercase UUID detail lookup was normalized and tested.

## Activation artifact review

A second clean-base release preparation uses production commit `4e9ee4c` directly.
It adds the native Keychain helper, sanitized local runner, hash-only user-operated
provisioner, and narrow application deployment/rollback scripts. The reviewer
found a startup readiness race in rollback's single health request. The fix uses
bounded guard-aware polling, with an explicit unconfirmed-readiness result.
No material findings remain. Six dummy runner/deployment/native refusal tests,
including compiled Swift checks, and hash-only provisioning DB regressions pass.
Final results: 184 workspace tests, 26 separate PostgreSQL tests, type checking
and diff checks passed. Full AMD64 Docker build remains blocked at official Node
base-image metadata resolution; see TASK_ACTIVATION.md. No activation occurred.
