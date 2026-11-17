# Instagram Shared intake

## Delivered locally

`/shared` is a session-authenticated RyanOS library. It stores canonical Instagram
links, capture results, timestamped JPEG evidence, optional timestamped transcript
and structured analysis, manual material, and review state. Captions/manual text
are rendered as text. Nothing in this feature creates tasks or projects.

The API and existing Graphile Worker run the pipeline on the Lenovo after a safe
release. No Mac process, chat session, new hosted service, or new account is needed
for intake, metadata capture, frame extraction, storage, and review.

## Provider paths and exact activation limits

**There is no functioning vision adapter in this release.** Selecting
`RYANOS_SHARED_ANALYSIS=codex-login` returns the typed error
`codex_tool_free_mode_unavailable`, surfaced as configuration required. Nothing is
sent to Codex. The default likewise performs no AI inference.

Local Codex 0.145.0 supports image/schema inputs and read-only/ephemeral execution,
but individual feature switches do not establish a verified supported mode with
all tools disabled. No unsupported flag, private protocol proxy, speculative
runtime image, or unrestricted host fallback is included. Remaining vision **code
work** is an adapter using a verified supported tool-free execution control, or a
separately approved non-agentic vision provider. This is not merely missing
credentials or configuration. Summary/OCR/suggestion contracts and their mocked
validation tests remain available for that future adapter.

A functional `WhisperCppTranscriber` adapter is implemented and mock tested. It
runs a configured absolute `whisper-cli` binary with a configured local model,
fixed arguments, two threads, a 90-second timeout and bounded WAV/JSON; millisecond
offsets become validated timestamped segments. Temp audio/output is removed.
Enable only after a model/runtime choice is approved, installed in the API runtime,
and smoke-tested, by setting `RYANOS_SHARED_WHISPER_COMMAND` and
`RYANOS_SHARED_WHISPER_MODEL`. No package/model was installed. Read-only Lenovo
checks found Codex 0.137.0 and FFmpeg/ffprobe, but no whisper/whisper-cli/faster-whisper
commands or Python whisper/faster_whisper/vosk/torch packages. Existing host Codex is 0.137.0; the local CLI inspected was 0.145.0. Speech is **installation/configuration
and real-model validation work**, not missing adapter code.

Official sources checked: [Codex configuration schema](https://github.com/openai/codex/blob/main/codex-rs/core/config.schema.json)
and [whisper.cpp CLI](https://github.com/ggml-org/whisper.cpp/blob/master/examples/cli/cli.cpp).
`AI_PROVIDER_RISK_REVIEW.md` accepts Codex login as the preferred direction; this
feature does not infer API billing approval from that decision.

## Provider decision before activation

- **Role:** a vision-capable analyzer reads selected frames/captions/transcripts;
  a speech adapter produces timestamped segments. Neither receives task tools.
- **Need/alternatives:** keep local capture and manual notes with no AI; install a reviewed local whisper.cpp speech runtime/model (adapter implemented)
  and separately evaluate a local vision model; or complete the accepted Codex-login
  vision direction once supported tool isolation is verified. An OpenAI API adapter would be an
  additional paid option and is not implemented or enabled here.
- **Pricing/scale:** local models consume Lenovo CPU/RAM; Codex has login and
  subscription usage limits; API billing scales with audio duration, image tokens,
  output and retries. No precise live pricing or subscription entitlement is
  assumed. Establish per-user spend and concurrency caps before paid activation.
- **Exposure/secrets:** external analysis sends captured content to that provider.
  Credentials stay server-side. Use a dedicated Codex runtime without RyanOS DB,
  master key, Docker socket, SSH keys, task tools, project mounts, or ambient MCP
  connectors. Do not simply launch a broadly credentialed host Codex process.
- **Operations/lock-in/exit:** isolated runtime, authentication renewal, model
  validation, timeout/usage monitoring and local model updates are operational
  work. Provider interfaces plus locally stored evidence permit replacement or
  disabling AI without losing the library. No proprietary output is required.

## API and Shortcut

Owner session routes:

- `POST /v1/shared/tokens`: create/rotate an intake-only 256-bit bearer token.
  Only SHA-256 is stored. Response is not cached; copy the token once.
- `DELETE /v1/shared/tokens`: revoke it. Tokens expire after 90 days.
- `GET /v1/shared?offset=0`: 50 newest links (frames omitted).
- `GET /v1/shared/:id`: owned detail including retained evidence.
- `POST /v1/shared`: `{ "url": "https://www.instagram.com/reel/DfyuklPvzI5/" }`.
- `POST /v1/shared/:id/retry`: explicit retry, one-minute cooldown, at most five
  manual retries per link. Does not clear evidence/manual notes/review state.
- `PATCH /v1/shared/:id`: `{ "manual": { "caption": "...", "transcript": "...",
  "notes": "..." }, "review": "saved" }`. Fields are optional; review can also
  be `unreviewed` or `dismissed`. Manual material remains separately attributed.

Shortcut-only route:

```http
POST /v1/shared/intake
Authorization: Bearer YOUR_INTAKE_TOKEN
Content-Type: application/json

{"url":"https://www.instagram.com/reel/DfyuklPvzI5/?igsh=tracking"}
```

A valid submission returns HTTP 202 with `id`, canonical `url`, and current
`status`. A repeated shortcode returns the same owned record without queuing a
second job. `userId`, arbitrary text, arrays, and extra payload fields are rejected.
Bearer tokens cannot read history, retry captures, or write tasks.

On the iPhone:

1. Connect to the existing RyanOS HTTPS address/Tailscale path. Sign in, open
   **Shared → Set up Save to RyanOS on iPhone**, and create an intake token.
2. Create a Shortcut named **Save to RyanOS**. Enable **Show in Share Sheet** and
   accept URLs (and optionally text, if Instagram supplies a text wrapper).
3. Add **Get URLs from Shortcut Input**, **Get Item from List → First Item**, then
   an **If** to stop and show an error when no URL exists.
4. Add **Get Contents of URL** targeting your actual RyanOS API base plus
   `/v1/shared/intake`. Through the web proxy this is
   `https://YOUR_RYANOS_HOST/api/v1/shared/intake`; a direct API base omits `/api`.
   Choose POST, JSON body, one text field `url` set to the extracted URL. Add
   `Authorization: Bearer YOUR_TOKEN` and `Content-Type: application/json` headers.
5. Inspect the JSON result: show success only when `id` exists; otherwise display
   its `error`. A saved link is not proof that media or analysis succeeded.
6. Test one real Instagram Share invocation, inspect the extracted URL, then
   verify its record and capture status in Shared. Repeat the same post once to
   verify deduplication. Revoke/rotate the token if the Shortcut is shared/leaked.

No Shortcut has been installed, and Instagram's real iPhone share-sheet payload
has not been observed. The JSON endpoint shape is tested. Redirect/share-wrapper
links outside recognized `/p/`, `/reel/`, `/reels/`, `/tv/` paths are rejected; open
such a wrapper in Instagram and copy the canonical post link instead.

## Capture boundaries and honest states

Only public HTTPS Instagram pages are fetched. There are no cookies, login
attempts, private APIs, proxy bypasses, or private-post access. Public metadata and
bounded embedded JSON supply media candidates. CDN downloads allow only
`*.cdninstagram.com` and `*.fbcdn.net`; every redirect is revalidated. IPv4 DNS is
validated and pinned to the request while preserving TLS host verification;
nonpublic addresses, credentials, alternate ports, and arbitrary hosts are denied.

Limits: 30 new captures/user/day, 3 attempts/job, 5 explicit retries/link,
2 MB HTML, 30 MB media, 180 seconds video, 4096px dimensions, 120 seconds/capture,
15-second network idle limit, 20 seconds/subprocess, 3 redirects, 6 regular samples
plus at most 2 scene-change frames, 300 KB/JPEG, 40 KB model response. Graphile uses
one named Shared queue across workers. Media tools receive only a local file with
restricted protocols and verified file signature; temporary media/audio is removed
in `finally`. JPEGs are retained in PostgreSQL and included in DB backups; storage
will grow with the library (up to about 3.2 MB of base64 frames per full capture).
There is no automatic retention purge in this version.

`queued`/`retrying` remain visible while capture runs transactionally. `failed`
means no useful capture succeeded. `partial` preserves available material and
specific warnings. Thumbnail/image-only capture is always partial because video
or carousel coverage is unverified. Silent video is distinct from unavailable or
partial transcription. Even a `ready` adapter result means the selected evidence
was processed, not that every frame or claim was verified. On-screen text is
explicitly labeled as a model reading; inferences are separate from cited evidence.

Known limitations: private/login-gated/throttled posts, renderer drift, incomplete
carousel coverage, short-lived details missed between samples, no uploaded media
fallback (manual text only), and disabled vision inference pending supported tool isolation. Exhausted Graphile transport attempts are reconciled to failed/partial on the
next history/detail read with `worker_delivery_exhausted`; worker downtime before
attempts begin remains queued. Do not interpret queued as success. No raw source URLs with signed CDN query strings or provider errors are
written to logs or returned to the browser.

The reference repository's MIT license was checked at
https://raw.githubusercontent.com/evanpurkhiser/places/main/LICENSE (Evan Purkhiser,
2026). Its directory could not be retrieved in this run. This implementation is
original code using existing Cheerio/Node facilities; no source code was copied.
The two supplied reels were throttled during live inspection; tests make no claims
about their actual content.

## Lenovo release / activation

1. Do **not** deploy this dirty checkout wholesale. It includes pending OAuth
   separation documented in `OAUTH_AI_CUTOVER_2026-10-27.md`, which has unmet grant
   requirements. Prepare a feature-only release from the deployed baseline,
   preserving unrelated changes, and validate that exact release.
2. Follow `HOME_SERVER_RECOVERY.md` and the existing deployment procedure. Build
   images locally, never on Lenovo. The app Dockerfile now includes FFmpeg/ffprobe.
   No networking, host service, production data, or runtime configuration was
   changed by this implementation.
3. Apply migration `0016_shared_content.sql` through normal Drizzle migration.
   Start/migrate Graphile Worker before the first intake, since `add_job` must
   exist. Intake and enqueue are one database transaction: unavailable queue means
   a 503 and no false saved-link success.
4. Run API and worker against the same DB/master key; use required session auth.
   The new internal endpoint uses a purpose-derived HMAC with a five-minute
   timestamp window. Public intake bypasses session middleware only to enforce its
   own scoped token authentication. Shared deliberately does not use dev-local's
   unauthenticated owner fallback.
5. Verify public capture and real iPhone input without AI, then resolve the vision runtime control and choose/install/test a speech model before
   enabling AI. The speech adapter is included; functioning vision remains code work.
   No credentials, paid calls, or production tokens were created here.

## Verification

Unit/route tests: `pnpm --filter @ryanos/api exec vitest run test/shared-content.test.ts test/shared-fetch.test.ts`.
Real DB test: `RYANOS_SHARED_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55439/postgres pnpm --filter @ryanos/api exec vitest run test/shared-postgres.test.ts`.
This DB must be disposable: the test recreates Shared tables and clears its queue.
It never falls back to `DATABASE_URL`.
Real media test: `scripts/test-shared-media.sh` with local FFmpeg/ffprobe on PATH.
Optional DB/media suites are skipped in the ordinary test command unless their
explicit test environment variables are provided. Analysis/transcription tests use
mocks and make no paid calls. See the implementation report for final check counts.
