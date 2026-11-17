# Shared content implementation verification — 2026-11-17

This verification snapshot was prepared before release approval. Ryan subsequently
approved the feature-only commit, push, deployment and live verification. The
results below describe the tested source; they do not by themselves establish
that deployment has completed. No AI credentials, paid calls or model installation
are included in the release.

## Deliverables

- Shared history/review UI, authenticated user-owned API, revocable intake-only
  tokens, URL normalization/deduplication, durable transactional Graphile jobs,
  retries/terminal-failure reconciliation, bounded public capture and media
  extraction, retained timestamped evidence, and manual text fallback.
- Typed unavailable Codex vision provider. It never starts inference: a supported
  all-tools-disabled CLI execution mode has not been verified. There is no
  functioning vision adapter, speculative runtime image or private protocol proxy.
- Functional local whisper.cpp speech adapter: fixed commands, bounded WAV/JSON,
  timeout, timestamp validation, cleanup and mocked tests. No model installed.
- `docs/SHARED_CONTENT.md`: API, iPhone Shortcut setup, security limits, provider
  discussion, configuration, known limits, and release procedure.
- `output/shared-content-feature.patch`: feature-only patch excluding pre-existing
  OAuth, Android, calendar, compose, and deployment-script changes.

## Exact release validation

A read-only archive of Lenovo's deployed Git revision
`3d5931072d0f85c8a6e50579e5a5f09887b8c99c` was used as the release baseline.
The feature-only patch applied cleanly in
`/tmp/ryanos-shared-release-y4cs7xx7` and the resulting source was tested there.
An audit of all pre-existing tracked files found changes only in:

- `apps/api/src/app.ts` (Shared registration/auth routing only)
- `apps/web/app/home-dashboard.tsx`
- `apps/worker/src/index.ts`
- `docker/app.Dockerfile`
- `packages/db/src/index.ts`
- `packages/db/src/schema.ts`
- `packages/db/drizzle/meta/_journal.json`

All other feature files are new. OAuth separation and Android modifications were
not included. The patch and release manifest are review artifacts, not a published
or deployable Git commit.

## Checks completed

| Check | Result |
| --- | --- |
| Working checkout `pnpm typecheck` | Passed |
| Working checkout `pnpm test` | 266 passed; 8 optional integration tests skipped |
| Feature-only deployed-baseline `pnpm typecheck` | Passed |
| Feature-only deployed-baseline `pnpm test` | 257 passed; 8 optional integration tests skipped |
| Feature-only deployed-baseline `pnpm build` | Passed, including `/shared` web production build |
| Real PostgreSQL/Graphile Worker suite | 5 passed in disposable local PostgreSQL |
| Final real FFmpeg media rerun | 3 passed; generated fixtures, no downloaded reels |
| `git diff --check` | Passed |

Different full-suite counts reflect unrelated pending tests excluded from the
release. Optional DB/media suites were run separately, not silently treated as
covered by the default test command. Analysis/speech contract tests use mocks, not paid or logged-in inference. The
unavailable Codex path is tested to fail explicitly. No standalone lint script is configured. The actual iPhone Shortcut,
live Instagram capture, live vision/speech quality and final Docker image have not
been verified. Both supplied reel URLs were throttled during public inspection.

The disposable `ryanos-shared-test-db` container was stopped and auto-removed.
Generated test fixtures, logs and release staging remain in `/tmp` for review.

## Remaining blockers, not hidden configuration assumptions

1. **Vision code/runtime:** Codex CLI 0.145.0 supports images, schemas, ephemeral
   runs and individual feature switches; those controls do not prove a tool-free
   execution surface. The adapter deliberately stops before inference. It requires
   verification/integration of a supported all-tools-disabled control, or a separate
   decision approving a non-agentic vision provider. Neither an API key nor a
   permission to run unrestricted host Codex resolves this safety boundary.
2. **Speech installation/configuration:** Lenovo read-only checks found no
   whisper-cli/whisper/faster-whisper commands or Python whisper/faster_whisper/
   vosk/torch packages. Choose and approve a local whisper.cpp runtime/model (or
   separately discuss a paid speech API), then install/mount it in the API runtime
   and validate its real output. Local adapter code is present.
3. **Deployment workflow:** The required `scripts/deploy-lenovo.sh` rejects
   uncommitted work and requires its release commit to match `origin/main`. Ryan has now approved the feature-only commit/push and deployment. The release
   must still pass local disk-space/build checks and the guarded deployment
   workflow; this historical test report is not a live deployment receipt.
4. **Phone activation:** Create the intake token through the deployed authenticated
   UI, install the Shortcut manually, and verify actual Instagram Share input.

Lenovo read-only readiness check: deployed Codex 0.137.0, FFmpeg and ffprobe present,
NetworkManager/Tailscale/Docker services active, churn guard marker absent. This is
readiness evidence only, not proof that the new feature is running.
