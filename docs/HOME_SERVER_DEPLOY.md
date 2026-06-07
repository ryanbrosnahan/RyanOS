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
- `RYANOS_CODEX_BRIDGE_TOKEN`
- `RYANOS_CODEX_WORKDIR`

The bootstrap script generates `DB_PASSWORD` and `RYANOS_CODEX_BRIDGE_TOKEN`
automatically if they still have the `change-me` placeholder values. It also
sets `RYANOS_CODEX_BRIDGE_HOST` to the Docker bridge IP when available so the
API container can reach the host-side Codex bridge through
`host.docker.internal`.

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

Register credentials and authorize each Gmail account from inside the API
container:

```bash
cd /opt/ryanos
docker compose -f docker-compose.server.yml exec api gog auth credentials /app/secrets/google-oauth-client.json
docker compose -f docker-compose.server.yml exec api gog auth add account@gmail.com --services gmail --manual
docker compose -f docker-compose.server.yml exec api gog auth doctor --check
```

Then open RyanOS Admin, use Gmail sync, enable the desired accounts, and run
Scan now. RyanOS V1 reads unread inbox mail from the last 7 days, stores
proposed to-dos, and only creates a normal RyanOS item after accepting a
proposal. It does not mark messages read, label messages, create Gmail drafts,
or send mail.

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

## Tailscale Serve

Expose the web service privately inside the tailnet:

```bash
sudo tailscale serve --bg --https=443 localhost:3100
tailscale serve status
```

If Tailscale says Serve is not enabled, open the URL it prints, enable Serve for
the tailnet, then rerun the `tailscale serve` command.

Open the reported HTTPS URL from the phone. Do not use Tailscale Funnel for
RyanOS until real owner authentication is implemented.

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
