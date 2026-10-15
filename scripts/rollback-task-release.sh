#!/usr/bin/env bash
# User-operated code rollback only. Never drops additive tables or restores a database.
set -euo pipefail
[[ $# == 2 && "$1" =~ ^[0-9a-f]{40}$ && "$2" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo 'Use <current-release-sha> <recorded-prior-image-id>' >&2; exit 1; }
ssh -o BatchMode=yes -o IdentitiesOnly=yes lenovo bash -s -- "$1" "$2" <<'REMOTE'
set -euo pipefail
cd /opt/ryanos
source scripts/lenovo-deploy-safety.sh
ryanos_docker_preflight
[[ "$(git rev-parse HEAD)" == "$1" && -z "$(git status --porcelain)" ]]
ryanos_guarded_run 15 docker image inspect "$2" >/dev/null
# Exact prior image must come from the release record/retained rollback tag.
ryanos_guarded_run 15 docker image tag "$2" ryanos-app:server
ryanos_guarded_run 180 docker compose -f docker-compose.server.yml up -d --no-build --no-deps api web worker
# Keep release source + additive schema for diagnosis; record image rollback separately.
for attempt in {1..30}; do
  ryanos_guard_is_clear
  if curl -fsS --max-time 5 http://127.0.0.1:3100/api/health >/dev/null; then
    echo 'Prior application image restored and healthy; source and additive database schema retained.'
    exit 0
  fi
  sleep 2
done
echo 'Prior image selected; readiness unconfirmed. Inspect health before any further restart. Schema and data retained.' >&2
exit 1
REMOTE
