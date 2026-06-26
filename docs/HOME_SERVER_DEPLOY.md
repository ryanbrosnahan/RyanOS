# Home Server Deploy

RyanOS can run from the Lenovo home server while code edits continue on this
laptop. The server deployment is private to Tailscale and exposes only the web
service through Tailscale Serve.

## One-time SSH setup

The local SSH alias should use the dedicated Lenovo key:

```sshconfig
Host lenovo
  HostName 100.113.198.1
  User ryan
  IdentityFile ~/.ssh/ryan_lenovo_desktop
  IdentitiesOnly yes
```

Append this laptop's public key to `/home/ryan/.ssh/authorized_keys` on the
server:

```bash
cat ~/.ssh/ryan_lenovo_desktop.pub
```

After the key is installed, this should succeed without a password:

```bash
ssh lenovo true
```

## One-time server setup

The server needs Docker, Node 20, pnpm, Codex CLI, a clone at `/opt/ryanos`,
server-only secrets, a Codex bridge user service, and Tailscale Serve. The
bootstrap script performs those steps and will prompt for the server sudo
password:

```bash
scripts/bootstrap-lenovo.sh
```

By default the bootstrap script converts the local GitHub SSH remote to an HTTPS
clone URL. For a private repo or deploy-key setup, run it with
`RYANOS_REPO_URL=git@github.com:ryanbrosnahan/RyanOS.git`.

Manual equivalent on `lenovo`:

```bash
sudo mkdir -p /opt/ryanos
sudo chown ryan:ryan /opt/ryanos
git clone git@github.com:ryanbrosnahan/RyanOS.git /opt/ryanos
cd /opt/ryanos
cp .env.server.example .env
mkdir -p secrets
pnpm secrets:generate-key
```

Edit `/opt/ryanos/.env` and set at least:

- `DB_PASSWORD`
- `BETTER_AUTH_URL`
- `BETTER_AUTH_SECRET`
- `RYANOS_INVITE_CODES`
- `RYANOS_SUPERADMIN_EMAILS`
- `RYANOS_CODEX_BRIDGE_TOKEN`
- `RYANOS_CODEX_WORKDIR`

The bootstrap script generates `DB_PASSWORD`, `BETTER_AUTH_SECRET`,
`RYANOS_INVITE_CODES`, and `RYANOS_CODEX_BRIDGE_TOKEN` automatically if they
still have the `change-me` placeholder values. It also sets
`RYANOS_CODEX_BRIDGE_HOST` to the Docker bridge IP when available so the API
container can reach the host-side Codex bridge through `host.docker.internal`.

## Auth

The server deployment runs with `RYANOS_AUTH_MODE=required`. RyanOS uses Better
Auth as a self-hosted library inside the API container, backed by the same
Postgres database as the rest of the app. It does not require a Better Auth
hosted account or paid managed service.

Set the public browser origin in `/opt/ryanos/.env`:

```bash
RYANOS_AUTH_MODE=required
BETTER_AUTH_URL=https://<your-tailscale-serve-name>
BETTER_AUTH_SECRET=<long-random-secret>
RYANOS_INVITE_CODES=<comma-separated-signup-codes>
RYANOS_AUTH_SECURE_COOKIES=true
RYANOS_SUPERADMIN_EMAILS=<your-ryanos-account-email>
```

Only people with a valid invite code can create accounts while email/password
sign-up is enabled. After the first trusted accounts exist, rotate or remove
unused invite codes.

`RYANOS_SUPERADMIN_EMAILS` is a bootstrap/recovery allowlist. Matching users are
promoted to `superadmin` when they log in, but RyanOS does not automatically
demote users if the env value changes later.

If restoring an existing deployment, restore both the Postgres data and the
matching `secrets/master-key`. Encrypted integration tokens cannot be decrypted
without the original master key.

## Gmail via gog

The server image includes `gog` pinned by `GOGCLI_VERSION` and keeps its auth
state in the Docker volume mounted at `/app/.gogcli`. In `/opt/ryanos/.env`,
set:

```bash
GOGCLI_VERSION=v0.15.0
GOG_HOME=/app/.gogcli
XDG_CONFIG_HOME=/app/.gogcli
GOG_KEYRING_BACKEND=file
GOG_KEYRING_PASSWORD=<long-random-password>
EMAIL_TRIAGE_ENABLED=true
EMAIL_SCAN_QUERY=in:inbox is:unread newer_than:7d
EMAIL_SCAN_MAX_PER_ACCOUNT=25
EMAIL_SCAN_INTERVAL_MINUTES=60
```

Create or download a Google OAuth desktop client JSON and put it on Lenovo at:

```bash
/opt/ryanos/secrets/google-oauth-client.json
```

Register credentials from inside the API container:

```bash
cd /opt/ryanos
docker compose -f docker-compose.server.yml exec api gog auth credentials /app/secrets/google-oauth-client.json
docker compose -f docker-compose.server.yml exec api gog auth doctor --check
```

Then open RyanOS Admin, expand Integrations -> Gmail, and add each Gmail account
with the browser-assisted auth flow. RyanOS uses read-only Gmail access for this
pass. The manual `gog auth add account@gmail.com --services gmail --manual`
command remains a fallback if remote auth is unavailable.

Use Gmail sync, enable the desired accounts, and run Scan now. RyanOS V1 reads
unread inbox mail from the last 7 days, stores proposed to-dos, and only creates
a normal RyanOS item after accepting a proposal. It does not mark messages read,
label messages, create Gmail drafts, or send mail.

## RFP and grant reports

RyanOS can ingest machine-readable reports from user-owned Codex RFP/grant
search automations. The preferred setup is DB-backed: open RyanOS Admin,
generate a Codex RFP ingest token, then add the generated upload snippet to each
local Codex automation. RyanOS stores only a token hash in Postgres; the
plaintext token is shown once and stays in the user's local Codex automation
setup.

The project automation should keep writing its human notes to
`docs/rfp-auto-search.md`, write a JSON sidecar such as
`docs/rfp-auto-search.ryanos.json`, and POST that JSON to the Admin-generated
endpoint:

```json
{
  "automationId": "court-nox-rfp-search",
  "projectSlug": "court-nox",
  "runAt": "2026-06-24T14:03:58Z",
  "reportPath": "/Users/ryan/Projects/active/NoxJury/docs/rfp-auto-search.md",
  "candidates": [
    {
      "title": "James City County Commonwealth Attorney Case Management Software",
      "sourceUrls": ["https://www.jamescitycountyva.gov/DocumentCenter/View/42989"],
      "rating": 7.5,
      "dueAt": "2026-07-06",
      "fit": "high",
      "summary": "RFI for case management software.",
      "rationale": "Good shaping opportunity for CourtNox workflows.",
      "recommendedAction": "Decide whether to submit the James City RFI."
    }
  ]
}
```

The older worker-side file polling path remains available for local/dev
fallbacks, but it requires paths visible inside the worker runtime and an
explicit ingest token:

```bash
RYANOS_RFP_REPORT_SOURCES='["/Users/ryan/Projects/active/NoxJury/docs/rfp-auto-search.ryanos.json","/Users/ryan/Projects/active/filemytro/docs/rfp-auto-search.ryanos.json"]'
RYANOS_RFP_INGEST_TOKEN='<Admin-generated Codex RFP ingest token>'
RFP_REPORT_INGEST_INTERVAL_MINUTES=60
```

RyanOS only surfaces candidates rated at least 7/10, marked `urgent`, or marked
`promoteToRyanOS`. Accepting a proposed lead creates an opportunity plus one
`opportunity_action` item; rejecting it creates nothing.

## Codex bridge

The API calls Codex through a host-side bridge, not by exposing Codex to the
browser. Install the user service:

```bash
mkdir -p ~/.config/systemd/user ~/.local/share/ryanos/codex-workdir
cp /opt/ryanos/ops/systemd/ryanos-codex-bridge.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now ryanos-codex-bridge.service
loginctl enable-linger ryan
```

Check it:

```bash
cd /opt/ryanos
set -a; . ./.env; set +a
bridge_host="${RYANOS_CODEX_BRIDGE_HOST:-127.0.0.1}"
if [ "$bridge_host" = "0.0.0.0" ]; then bridge_host=127.0.0.1; fi
curl -fsS "http://${bridge_host}:${RYANOS_CODEX_BRIDGE_PORT:-4111}/health"
systemctl --user status ryanos-codex-bridge.service
```

## Start the app

On `lenovo`:

```bash
cd /opt/ryanos
docker compose -f docker-compose.server.yml build
docker compose -f docker-compose.server.yml up -d postgres
scripts/ensure-postgres-docker-auth.sh docker-compose.server.yml
docker compose -f docker-compose.server.yml run --rm migrate
docker compose -f docker-compose.server.yml up -d api web worker
curl -fsS http://127.0.0.1:3100/api/health
```

If Telegram polling is ready, set this in `/opt/ryanos/.env`:

```bash
COMPOSE_PROFILES=telegram
```

Then start or redeploy:

```bash
docker compose -f docker-compose.server.yml --profile telegram up -d --build
```

Create the Telegram bot with BotFather, then open RyanOS Admin as a superadmin,
expand Integrations -> Telegram, and paste the bot token there. RyanOS stores it
encrypted in Postgres and never echoes it back.

Each user links their own Telegram sender by opening Integrations -> Telegram,
generating a link code, and sending `/start <code>` to the bot. The legacy
`TELEGRAM_USER_EMAIL_MAP=<telegram-sender-id>:<ryanos-account-email>` env value
still works as a fallback, but link codes are the normal workflow.

## Tailscale Serve

Expose the web service privately inside the tailnet:

```bash
sudo tailscale serve --bg --https=443 localhost:3100
tailscale serve status
```

If Tailscale says Serve is not enabled, open the URL it prints, enable Serve for
the tailnet, then rerun the `tailscale serve` command.

Open the reported HTTPS URL from the phone. Do not use Tailscale Funnel for
RyanOS unless `RYANOS_AUTH_MODE=required`, secure cookies, invite codes, and the
public auth URL are configured and reviewed.

## Deploy after local edits

From this laptop:

```bash
git status
pnpm test
git push origin main
scripts/deploy-lenovo.sh
```

The deploy script refuses to run with uncommitted changes, verifies local tests
and Compose config, pulls `origin/main` on `lenovo`, rebuilds, restarts, and
checks `/api/health` through the web service.

By default the deploy script also builds the Android debug APK locally, uploads
it to `/opt/ryanos/releases/android/ryanos-latest.apk`, and writes
`/opt/ryanos/releases/android/manifest.json`. The web container serves those
files at `/downloads/android/ryanos-latest.apk` and
`/downloads/android/manifest.json`, and the Android app uses the manifest for
its in-app update check. Set `RYANOS_DEPLOY_ANDROID_APK=0` to skip APK
publishing for a server-only deploy.
