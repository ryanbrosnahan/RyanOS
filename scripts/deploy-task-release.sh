#!/usr/bin/env bash
# Narrow release only: no push, bridge restart, DB-auth repair, image retirement, or network changes.
set -euo pipefail
cd "$(dirname "$0")/.."
base=4e9ee4c9ec443d05aeb59779ba00f1ad86e6c4e4
mode="${1:-plan}"
if [[ "$mode" == plan ]]; then
  echo 'After approval: push reviewed release branch separately; build clean AMD64 release image.'
  echo 'Apply verifies exact source/image, backs up DB + master key (owner-only), runs additive migration, replaces api/web/worker only.'
  echo 'No automatic rollback. Retain prior image and schema. Rollback command requires recorded prior image ID.'
  exit 0
fi
[[ "$mode" == apply && $# == 2 && "$2" =~ ^[A-Za-z0-9][A-Za-z0-9/_-]*$ ]] || { echo 'Use plan or apply <published-release-branch>' >&2; exit 1; }
branch="$2"
[[ -z "$(git status --porcelain)" ]] || { echo 'Refusing dirty source checkout.' >&2; exit 1; }
sha=$(git rev-parse HEAD)
git merge-base --is-ancestor "$base" "$sha"
# Compose and guard behavior must match the reviewed production configuration.
git diff --quiet "$base" "$sha" -- docker-compose.server.yml scripts/lenovo-deploy-safety.sh
git fetch origin "$branch"
[[ "$(git rev-parse FETCH_HEAD)" == "$sha" ]] || { echo 'Published release SHA differs.' >&2; exit 1; }
image="ryanos-app:task-release-${sha:0:12}"
[[ "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")" == "$sha" ]]
[[ "$(docker image inspect --format '{{index .Config.Labels "io.ryanos.tree-status"}}' "$image")" == release ]]
[[ "$(docker image inspect --format '{{.Architecture}}' "$image")" == amd64 ]]
layers_hash=$(docker image inspect --format '{{json .RootFS.Layers}}' "$image" | shasum -a 256 | awk '{print $1}')
archive=$(mktemp -t ryanos-task-release.XXXXXX)
trap 'rm -f "$archive"' EXIT
remote_archive="/tmp/ryanos-task-release-${sha:0:12}.tar.gz"
docker image save "$image" | gzip -1 > "$archive"
archive_hash=$(shasum -a 256 "$archive" | awk '{print $1}')
scp -o BatchMode=yes -o IdentitiesOnly=yes "$archive" "lenovo:$remote_archive"
ssh -o BatchMode=yes -o IdentitiesOnly=yes lenovo bash -s -- "$base" "$sha" "$branch" "$archive_hash" "$layers_hash" <<'REMOTE'
set -euo pipefail
base="$1"; sha="$2"; branch="$3"; archive_hash="$4"; layers_hash="$5"
cd /opt/ryanos
source scripts/lenovo-deploy-safety.sh
ryanos_docker_preflight
[[ "$(git rev-parse HEAD)" == "$base" && -z "$(git status --porcelain)" ]] || { echo 'Production source changed; review again.' >&2; exit 1; }
[[ -f secrets/master-key ]]
# Require existing healthy database and app; do not start/repair their infrastructure.
[[ "$(ryanos_guarded_run 15 docker inspect --format '{{.State.Health.Status}}' ryanos-postgres)" == healthy ]]
prior_image=$(ryanos_guarded_run 15 docker inspect --format '{{.Image}}' ryanos-api)
[[ "$(ryanos_guarded_run 15 docker inspect --format '{{.Image}}' ryanos-web)" == "$prior_image" ]]
[[ "$(ryanos_guarded_run 15 docker inspect --format '{{.Image}}' ryanos-worker)" == "$prior_image" ]]
archive="/tmp/ryanos-task-release-${sha:0:12}.tar.gz"
trap 'rm -f "$archive"' EXIT
chmod 0600 "$archive"
[[ "$(sha256sum "$archive" | awk '{print $1}')" == "$archive_hash" ]]
rollback_tag="ryanos-app:task-rollback-$(date -u +%Y%m%dT%H%M%SZ)"
ryanos_guarded_run 15 docker image tag "$prior_image" "$rollback_tag"
umask 077
backup_dir="backups/task-release-${sha:0:12}-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -m 0700 "$backup_dir"
ryanos_guarded_run 300 docker compose -f docker-compose.server.yml exec -T postgres sh -c 'exec pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$backup_dir/postgres.dump"
test -s "$backup_dir/postgres.dump"
install -m 0600 secrets/master-key "$backup_dir/master-key"
printf 'prior_sha=%s\nrelease_sha=%s\nprior_image=%s\nrollback_tag=%s\n' "$base" "$sha" "$prior_image" "$rollback_tag" > "$backup_dir/release.txt"
git fetch origin "$branch"
[[ "$(git rev-parse FETCH_HEAD)" == "$sha" ]]
git diff --quiet "$base" "$sha" -- docker-compose.server.yml scripts/lenovo-deploy-safety.sh
git switch --detach "$sha"
gzip -dc "$archive" | ryanos_guarded_run 600 docker image load >/dev/null
image="ryanos-app:task-release-${sha:0:12}"
[[ "$(ryanos_guarded_run 15 docker image inspect --format '{{.Architecture}}' "$image")" == amd64 ]]
[[ "$(ryanos_guarded_run 15 docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")" == "$sha" ]]
[[ "$(ryanos_guarded_run 15 docker image inspect --format '{{index .Config.Labels "io.ryanos.tree-status"}}' "$image")" == release ]]
[[ "$(ryanos_guarded_run 15 docker image inspect --format '{{json .RootFS.Layers}}' "$image" | sha256sum | awk '{print $1}')" == "$layers_hash" ]]
# All app services use this shared image; leave postgres/bridge/optional services alone.
ryanos_guarded_run 15 docker image tag "$image" ryanos-app:server
printf 'Backup: /opt/ryanos/%s; rollback image: %s (%s)\n' "$backup_dir" "$rollback_tag" "$prior_image"
ryanos_guarded_run 300 docker compose -f docker-compose.server.yml run --rm --no-deps migrate
ryanos_guarded_run 180 docker compose -f docker-compose.server.yml up -d --no-build --no-deps api web worker
for attempt in {1..30}; do
  ryanos_guard_is_clear
  if curl -fsS --max-time 5 http://127.0.0.1:3100/api/health >/dev/null; then echo "Release healthy: $sha"; exit 0; fi
  sleep 2
done
echo 'Health failed. Retained backup and rollback image; stop for review. No automatic data restore.' >&2
exit 1
REMOTE
