#!/usr/bin/env bash
set -euo pipefail

REMOTE="${RYANOS_DEPLOY_REMOTE:-lenovo}"
REMOTE_DIR="${RYANOS_DEPLOY_DIR:-/opt/ryanos}"
BRANCH="${RYANOS_DEPLOY_BRANCH:-main}"

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd -- "$script_dir/.." && pwd)"
origin_url="$(git -C "$repo_dir" config --get remote.origin.url)"
default_repo_url="$origin_url"
if [[ "$origin_url" =~ ^git@github\.com:(.+)\.git$ ]]; then
  default_repo_url="https://github.com/${BASH_REMATCH[1]}.git"
fi
REPO_URL="${RYANOS_REPO_URL:-$default_repo_url}"

quote() {
  printf "%q" "$1"
}

local_remote_script="$(mktemp -t ryanos-bootstrap.XXXXXX)"
remote_script="/tmp/ryanos-bootstrap-$$.sh"
trap 'rm -f "$local_remote_script"' EXIT

cat > "$local_remote_script" <<'REMOTE_SCRIPT'
set -euo pipefail

REMOTE_DIR="${RYANOS_REMOTE_DIR:?}"
REPO_URL="${RYANOS_REPO_URL:?}"
BRANCH="${RYANOS_BRANCH:?}"

echo "Checking sudo access. Enter the password for this server user if prompted."
sudo -v

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    return
  fi

  . /etc/os-release
  docker_codename="${UBUNTU_CODENAME:-${VERSION_CODENAME:-jammy}}"

  sudo apt-get update
  sudo apt-get install -y ca-certificates curl gnupg
  sudo install -m 0755 -d /etc/apt/keyrings
  if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
      | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  fi
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${docker_codename} stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo usermod -aG docker "$USER"
}

install_node_and_cli() {
  node_major="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)"
  if [ "$node_major" -lt 20 ]; then
    # Linux Mint/Ubuntu distro Node packages can leave libnode-dev headers that
    # conflict with the NodeSource nodejs package.
    sudo apt-get remove -y nodejs npm libnode-dev libnode72 nodejs-doc || true
    sudo apt-get autoremove -y || true
    sudo dpkg --configure -a
    sudo apt-get install -f -y
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
  fi

  sudo npm install -g pnpm@10.11.0 @openai/codex
}

prepare_repo() {
  sudo mkdir -p "$REMOTE_DIR"
  sudo chown -R "$USER:$USER" "$REMOTE_DIR"

  if [ ! -d "$REMOTE_DIR/.git" ]; then
    if [ "$(find "$REMOTE_DIR" -mindepth 1 -maxdepth 1 | wc -l)" -ne 0 ]; then
      echo "$REMOTE_DIR is not empty and is not a git repository." >&2
      exit 1
    fi
    git clone "$REPO_URL" "$REMOTE_DIR"
  fi

  cd "$REMOTE_DIR"
  git fetch origin "$BRANCH"
  git checkout "$BRANCH"
  git pull --ff-only origin "$BRANCH"
}

prepare_env() {
  cd "$REMOTE_DIR"
  mkdir -p secrets "$HOME/.local/share/ryanos/codex-workdir"

  if [ ! -f .env ]; then
    cp .env.server.example .env
  fi

  if grep -q '^DB_PASSWORD=change-me$' .env; then
    sed -i "s/^DB_PASSWORD=.*/DB_PASSWORD=$(openssl rand -hex 24)/" .env
  fi
  if grep -q '^RYANOS_CODEX_BRIDGE_TOKEN=change-me$' .env; then
    sed -i "s/^RYANOS_CODEX_BRIDGE_TOKEN=.*/RYANOS_CODEX_BRIDGE_TOKEN=$(openssl rand -hex 32)/" .env
  fi
  if grep -q '^RYANOS_CODEX_WORKDIR=$' .env; then
    sed -i "s|^RYANOS_CODEX_WORKDIR=.*|RYANOS_CODEX_WORKDIR=$HOME/.local/share/ryanos/codex-workdir|" .env
  fi
  docker_bridge_host="$(ip -4 addr show docker0 2>/dev/null | awk '/inet / {print $2}' | cut -d/ -f1 | head -n 1)"
  if [ -n "$docker_bridge_host" ]; then
    if grep -q '^RYANOS_CODEX_BRIDGE_HOST=' .env; then
      sed -i "s|^RYANOS_CODEX_BRIDGE_HOST=.*|RYANOS_CODEX_BRIDGE_HOST=$docker_bridge_host|" .env
    else
      printf '\nRYANOS_CODEX_BRIDGE_HOST=%s\n' "$docker_bridge_host" >> .env
    fi
  fi

  pnpm install --frozen-lockfile
  if [ ! -f secrets/master-key ]; then
    pnpm secrets:generate-key
  fi
}

install_codex_bridge_service() {
  mkdir -p "$HOME/.config/systemd/user"
  cp "$REMOTE_DIR/ops/systemd/ryanos-codex-bridge.service" "$HOME/.config/systemd/user/"
  systemctl --user daemon-reload
  systemctl --user enable --now ryanos-codex-bridge.service
  sudo loginctl enable-linger "$USER"
}

configure_tailscale_serve() {
  if ! timeout 20s sudo tailscale serve --bg --https=443 localhost:3100; then
    cat <<'TAILSCALE_SERVE_NOTICE'

Tailscale Serve could not be configured automatically.
If Tailscale printed an enable URL, open it in a browser, enable Serve for this
tailnet, then run:

  sudo tailscale serve --bg --https=443 localhost:3100

The RyanOS Docker deployment can continue before Serve is enabled.
TAILSCALE_SERVE_NOTICE
    return 0
  fi
  timeout 10s tailscale serve status || true
}

install_docker
install_node_and_cli
prepare_repo
prepare_env
install_codex_bridge_service
configure_tailscale_serve

cat <<'DONE'

Lenovo bootstrap is complete.

If Docker was installed or this user was newly added to the docker group, open a
new SSH session before running scripts/deploy-lenovo.sh from the laptop.

Run `codex --login` on lenovo if the Codex bridge status reports that Codex is
not authenticated.
DONE
REMOTE_SCRIPT

scp -q "$local_remote_script" "$REMOTE:$remote_script"
ssh -tt "$REMOTE" "\
  status=0; \
  RYANOS_REMOTE_DIR=$(quote "$REMOTE_DIR") \
  RYANOS_REPO_URL=$(quote "$REPO_URL") \
  RYANOS_BRANCH=$(quote "$BRANCH") \
  bash $(quote "$remote_script") || status=\$?; \
  rm -f $(quote "$remote_script"); \
  exit \$status"
