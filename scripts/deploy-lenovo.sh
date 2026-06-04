#!/usr/bin/env bash
set -euo pipefail

REMOTE="${RYANOS_DEPLOY_REMOTE:-lenovo}"
REMOTE_DIR="${RYANOS_DEPLOY_DIR:-/opt/ryanos}"
BRANCH="${RYANOS_DEPLOY_BRANCH:-main}"
COMPOSE_FILE="${RYANOS_DEPLOY_COMPOSE_FILE:-docker-compose.server.yml}"
SSH_OPTS=(-o BatchMode=yes -o IdentitiesOnly=yes)

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd -- "$script_dir/.." && pwd)"

cd "$repo_dir"

current_branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$current_branch" != "$BRANCH" ]; then
  echo "Refusing to deploy branch '$current_branch'; expected '$BRANCH'." >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Refusing to deploy with uncommitted local changes." >&2
  exit 1
fi

git fetch origin "$BRANCH"
if ! git merge-base --is-ancestor "HEAD" "origin/$BRANCH"; then
  echo "Local HEAD is ahead of origin/$BRANCH. Push before deploying." >&2
  exit 1
fi
if ! git merge-base --is-ancestor "origin/$BRANCH" "HEAD"; then
  echo "Local HEAD is behind origin/$BRANCH. Pull before deploying." >&2
  exit 1
fi

pnpm test
pnpm typecheck
docker compose -f "$COMPOSE_FILE" config >/dev/null

ssh "${SSH_OPTS[@]}" "$REMOTE" "set -euo pipefail
  if [ ! -d '$REMOTE_DIR/.git' ]; then
    echo 'Missing repo at $REMOTE_DIR. Clone git@github.com:ryanbrosnahan/RyanOS.git there first.' >&2
    exit 1
  fi
  cd '$REMOTE_DIR'
  git fetch origin '$BRANCH'
  git checkout '$BRANCH'
  git pull --ff-only origin '$BRANCH'
  if [ ! -f .env ]; then
    echo 'Missing $REMOTE_DIR/.env. Copy .env.server.example to .env and fill secrets before deploying.' >&2
    exit 1
  fi
  if [ ! -f secrets/master-key ]; then
    echo 'Missing $REMOTE_DIR/secrets/master-key. Generate or restore it before deploying.' >&2
    exit 1
  fi
  docker compose -f '$COMPOSE_FILE' build
  docker compose -f '$COMPOSE_FILE' up -d postgres
  scripts/ensure-postgres-docker-auth.sh '$COMPOSE_FILE'
  docker compose -f '$COMPOSE_FILE' run --rm migrate
  docker compose -f '$COMPOSE_FILE' up -d --remove-orphans api web worker
  docker compose -f '$COMPOSE_FILE' ps
  curl -fsS http://127.0.0.1:\${WEB_PORT:-3100}/api/health
"
