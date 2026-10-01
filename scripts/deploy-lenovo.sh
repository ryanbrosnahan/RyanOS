#!/usr/bin/env bash
set -euo pipefail

REMOTE="${RYANOS_DEPLOY_REMOTE:-lenovo}"
REMOTE_DIR="${RYANOS_DEPLOY_DIR:-/opt/ryanos}"
BRANCH="${RYANOS_DEPLOY_BRANCH:-main}"
COMPOSE_FILE="${RYANOS_DEPLOY_COMPOSE_FILE:-docker-compose.server.yml}"
SSH_OPTS=(-o BatchMode=yes -o IdentitiesOnly=yes)
ANDROID_APK_PATH=""
ANDROID_MANIFEST_PATH=""
IMAGE_ARCHIVE_PATH=""
ANDROID_STUDIO_JBR="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
RESUME_SHA="${RYANOS_DEPLOY_RESUME_SHA:-}"
RESUME_IMAGE_ID="${RYANOS_DEPLOY_RESUME_IMAGE_ID:-}"
RESUME_ROLLBACK_TAG="${RYANOS_DEPLOY_RESUME_ROLLBACK_TAG:-}"

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd -- "$script_dir/.." && pwd)"
source "$script_dir/lenovo-deploy-safety.sh"
source "$script_dir/ryanos-image-retention.sh"
remote_safety_functions="$(declare -f ryanos_guard_is_clear ryanos_guarded_run ryanos_docker_preflight ryanos_validate_loaded_release)"
remote_cleanup_functions="$(declare -f ryanos_image_docker ryanos_retire_images)"

cd "$repo_dir"

cleanup() {
  if [ -n "${ANDROID_MANIFEST_PATH:-}" ]; then
    rm -f "$ANDROID_MANIFEST_PATH"
  fi
  if [ -n "${IMAGE_ARCHIVE_PATH:-}" ]; then
    rm -f "$IMAGE_ARCHIVE_PATH"
  fi
}
trap cleanup EXIT

sha256_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}

file_size_bytes() {
  stat -f%z "$1" 2>/dev/null || stat -c%s "$1"
}

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

if [[ -n "$RESUME_SHA$RESUME_IMAGE_ID$RESUME_ROLLBACK_TAG" ]]; then
  if [[ ! "$RESUME_SHA" =~ ^[0-9a-f]{40}$ || ! "$RESUME_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ || ! "$RESUME_ROLLBACK_TAG" =~ ^ryanos-app:rollback-[0-9]{8}T[0-9]{6}Z$ ]]; then
    echo 'Resume requires the full release SHA, exact previously tested image ID, and original rollback tag.' >&2
    exit 1
  fi
  git merge-base --is-ancestor "$RESUME_SHA" HEAD || {
    echo 'The interrupted release is not an ancestor of the current branch.' >&2
    exit 1
  }
  echo "Resuming previously built and tested release $RESUME_SHA; retaining its source and image identity."
fi
DEPLOY_FULL_SHA="$(git rev-parse "${RESUME_SHA:-HEAD}")"
DEPLOY_SHA="${DEPLOY_FULL_SHA:0:12}"
REMOTE_IMAGE_ARCHIVE="/tmp/ryanos-image-$DEPLOY_SHA.tar.gz"

# Refuse before doing expensive local work if the production host is guarded
# or Docker is unavailable. The guard marker also prevents a Docker client from
# hanging while a deliberately paused daemon is awaiting review.
ssh "${SSH_OPTS[@]}" "$REMOTE" "set -euo pipefail
  $remote_safety_functions
  ryanos_docker_preflight
"

if [[ -z "$RESUME_SHA" ]]; then
  pnpm test
  pnpm typecheck
  BETTER_AUTH_URL="${BETTER_AUTH_URL:-https://ryanos.localhost.invalid}" \
  BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-local-compose-config-placeholder-secret}" \
  RYANOS_INVITE_CODES="${RYANOS_INVITE_CODES:-local-compose-config-placeholder}" \
  docker compose -f "$COMPOSE_FILE" config >/dev/null

  # Build on the developer Mac and transfer the finished Linux image. BuildKit
  # network churn on the Lenovo has been associated with host instability, so a
  # production deployment must never build an application image there.
  DOCKER_DEFAULT_PLATFORM=linux/amd64 \
  BETTER_AUTH_URL="${BETTER_AUTH_URL:-https://ryanos.localhost.invalid}" \
  BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-local-compose-config-placeholder-secret}" \
  RYANOS_INVITE_CODES="${RYANOS_INVITE_CODES:-local-compose-config-placeholder}" \
  docker compose -f "$COMPOSE_FILE" build api
  docker image tag ryanos-app:server "ryanos-app:server-$DEPLOY_SHA"
  IMAGE_ARCHIVE_PATH="$(mktemp -t ryanos-image.XXXXXX)"
  docker image save ryanos-app:server "ryanos-app:server-$DEPLOY_SHA" | gzip -1 >"$IMAGE_ARCHIVE_PATH"

  if [ "${RYANOS_DEPLOY_ANDROID_APK:-1}" != "0" ]; then
    if [ ! -x apps/android/gradlew ]; then
      echo "Missing Android Gradle wrapper. Set RYANOS_DEPLOY_ANDROID_APK=0 to skip APK publishing." >&2
      exit 1
    fi
    if [ -z "${JAVA_HOME:-}" ] && [ -x "$ANDROID_STUDIO_JBR/bin/java" ]; then
      export JAVA_HOME="$ANDROID_STUDIO_JBR"
    fi
    (
      cd apps/android
      ./gradlew :app:assembleDebug
    )
    ANDROID_APK_PATH="$repo_dir/apps/android/app/build/outputs/apk/debug/app-debug.apk"
    if [ ! -f "$ANDROID_APK_PATH" ]; then
      echo "Android APK build finished, but $ANDROID_APK_PATH was not found." >&2
      exit 1
    fi
    android_version_code="$(sed -nE 's/^[[:space:]]*versionCode = ([0-9]+).*$/\1/p' apps/android/app/build.gradle.kts | head -n 1)"
    android_version_name="$(sed -nE 's/^[[:space:]]*versionName = "([^"]+)".*$/\1/p' apps/android/app/build.gradle.kts | head -n 1)"
    if [ -z "$android_version_code" ] || [ -z "$android_version_name" ]; then
      echo "Could not read Android versionCode/versionName from apps/android/app/build.gradle.kts." >&2
      exit 1
    fi
    ANDROID_MANIFEST_PATH="$(mktemp)"
    printf '{\n' > "$ANDROID_MANIFEST_PATH"
    printf '  "versionCode": %s,\n' "$android_version_code" >> "$ANDROID_MANIFEST_PATH"
    printf '  "versionName": "%s",\n' "$android_version_name" >> "$ANDROID_MANIFEST_PATH"
    printf '  "apkUrl": "/downloads/android/ryanos-latest.apk",\n' >> "$ANDROID_MANIFEST_PATH"
    printf '  "apkSha256": "%s",\n' "$(sha256_file "$ANDROID_APK_PATH")" >> "$ANDROID_MANIFEST_PATH"
    printf '  "apkSizeBytes": %s,\n' "$(file_size_bytes "$ANDROID_APK_PATH")" >> "$ANDROID_MANIFEST_PATH"
    printf '  "publishedAt": "%s",\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" >> "$ANDROID_MANIFEST_PATH"
    printf '  "variant": "debug"\n' >> "$ANDROID_MANIFEST_PATH"
    printf '}\n' >> "$ANDROID_MANIFEST_PATH"
  fi

  scp "${SSH_OPTS[@]}" "$IMAGE_ARCHIVE_PATH" "$REMOTE:$REMOTE_IMAGE_ARCHIVE"
fi

ssh "${SSH_OPTS[@]}" "$REMOTE" "set -euo pipefail
  $remote_safety_functions
  remote_image_archive='$REMOTE_IMAGE_ARCHIVE'
  cleanup_remote_image() {
    rm -f \"\$remote_image_archive\"
  }
  trap cleanup_remote_image EXIT

  ryanos_docker_preflight
  if [ ! -d '$REMOTE_DIR/.git' ]; then
    echo 'Missing repo at $REMOTE_DIR. Clone git@github.com:ryanbrosnahan/RyanOS.git there first.' >&2
    exit 1
  fi
  cd '$REMOTE_DIR'
  if [ ! -f .env ]; then
    echo 'Missing $REMOTE_DIR/.env. Copy .env.server.example to .env and fill secrets before deploying.' >&2
    exit 1
  fi
  if [ ! -f secrets/master-key ]; then
    echo 'Missing $REMOTE_DIR/secrets/master-key. Generate or restore it before deploying.' >&2
    exit 1
  fi
  if [ -n '$RESUME_SHA' ]; then
    ryanos_validate_loaded_release '$DEPLOY_FULL_SHA' '$RESUME_IMAGE_ID' '$RESUME_ROLLBACK_TAG'
    rollback_tag='$RESUME_ROLLBACK_TAG'
  else
    git fetch origin '$BRANCH'
    git checkout '$BRANCH'
    git pull --ff-only origin '$BRANCH'
    test \"\$(git rev-parse HEAD)\" = '$DEPLOY_FULL_SHA' || {
      echo 'Remote source changed after local build; refusing mismatched deployment.' >&2
      exit 1
    }
    pnpm install --frozen-lockfile
    pnpm --filter @ryanos/ai build
    test -x node_modules/.bin/codex
    mkdir -p \"\$HOME/.config/systemd/user\"
    cp ops/systemd/ryanos-codex-bridge.service \"\$HOME/.config/systemd/user/\"
    systemctl --user daemon-reload
    systemctl --user restart ryanos-codex-bridge.service
    systemctl --user is-active --quiet ryanos-codex-bridge.service
    mkdir -p releases/android

    # Preserve the prior application image for a fast code rollback, then load
    # the exact image built and tested on the developer machine.
    ryanos_docker_preflight
    rollback_tag=\"ryanos-app:rollback-\$(date -u +%Y%m%dT%H%M%SZ)\"
    if ryanos_guarded_run 15 docker image inspect ryanos-app:server >/dev/null 2>&1; then
      ryanos_guarded_run 15 docker image tag ryanos-app:server "\$rollback_tag"
    else
      rollback_tag='none'
    fi
    chmod 0600 "\$remote_image_archive"
    gzip -dc "\$remote_image_archive" | ryanos_guarded_run 600 docker image load >/dev/null
  fi
  ryanos_guarded_run 15 docker image inspect 'ryanos-app:server-$DEPLOY_SHA' >/dev/null
  ryanos_guarded_run 15 docker image tag 'ryanos-app:server-$DEPLOY_SHA' ryanos-app:server

  ryanos_guarded_run 120 docker compose -f '$COMPOSE_FILE' up -d postgres
  ryanos_guarded_run 60 scripts/ensure-postgres-docker-auth.sh '$COMPOSE_FILE'

  # The database dump contains encrypted application fields. It and the key
  # copy are still personal data, so keep the deployment backup owner-only.
  umask 077
  backup_dir=\"backups/pre-deploy-$DEPLOY_SHA-\$(date -u +%Y%m%dT%H%M%SZ)\"
  mkdir -p "\$backup_dir"
  chmod 0700 "\$backup_dir"
  ryanos_guarded_run 300 docker compose -f '$COMPOSE_FILE' exec -T postgres sh -c \
    'exec pg_dump -Fc -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\"' \
    >"\$backup_dir/postgres.dump"
  test -s "\$backup_dir/postgres.dump"
  install -m 0600 secrets/master-key "\$backup_dir/master-key"

  ryanos_guarded_run 300 docker compose -f '$COMPOSE_FILE' run --rm migrate
  compose_profile_args=''
  compose_services='api web worker'
  if grep -Eq '^COMPOSE_PROFILES=([^#]*,)?telegram(,|$)' .env; then
    compose_profile_args='--profile telegram'
    compose_services=\"\$compose_services telegram-poller\"
  fi
  ryanos_guarded_run 180 docker compose -f '$COMPOSE_FILE' \$compose_profile_args up -d --no-build --remove-orphans \$compose_services
  ryanos_guarded_run 15 docker compose -f '$COMPOSE_FILE' ps
  health_url=\"http://127.0.0.1:\${WEB_PORT:-3100}/api/health\"
  for attempt in \$(seq 1 30); do
    ryanos_guard_is_clear
    if curl -fsS --max-time 5 \"\$health_url\" >/dev/null; then
      printf 'Deployment %s is healthy. Backup: %s. Rollback image: %s.\n' \
        '$DEPLOY_SHA' \"\$backup_dir\" \"\$rollback_tag\"
      exit 0
    fi
    sleep 2
  done
  echo \"Deployment health check failed. Data backup: \$backup_dir; prior image: \$rollback_tag\" >&2
  exit 1
"

if [ -n "$ANDROID_APK_PATH" ]; then
  ssh "${SSH_OPTS[@]}" "$REMOTE" "mkdir -p '$REMOTE_DIR/releases/android'"
  scp "${SSH_OPTS[@]}" "$ANDROID_APK_PATH" "$REMOTE:$REMOTE_DIR/releases/android/ryanos-latest.apk"
  scp "${SSH_OPTS[@]}" "$ANDROID_MANIFEST_PATH" "$REMOTE:$REMOTE_DIR/releases/android/manifest.json"
  ssh "${SSH_OPTS[@]}" "$REMOTE" "set -euo pipefail
    $remote_safety_functions
    cd '$REMOTE_DIR'
    ls -lh releases/android/ryanos-latest.apk releases/android/manifest.json
    ryanos_docker_preflight
    ryanos_guarded_run 120 docker compose -f '$COMPOSE_FILE' restart web
    for attempt in 1 2 3 4 5 6 7 8 9 10; do
      ryanos_guard_is_clear
      if curl -fsS --max-time 5 http://127.0.0.1:\${WEB_PORT:-3100}/downloads/android/manifest.json >/dev/null; then
        exit 0
      fi
      sleep 1
    done
    curl -fsS --max-time 5 http://127.0.0.1:\${WEB_PORT:-3100}/downloads/android/manifest.json >/dev/null
  "
fi

# Only retire release images after every requested deployment and APK health
# check has passed. An image still referenced by any container is retained.
if ! ssh "${SSH_OPTS[@]}" "$REMOTE" "set -euo pipefail
  $remote_safety_functions
  $remote_cleanup_functions
  ryanos_retire_images remote 'ryanos-app:server-$DEPLOY_SHA' apply
"; then
  echo 'Deployment succeeded, but Lenovo image cleanup needs review.' >&2
fi

if ! ryanos_retire_images local "ryanos-app:server-$DEPLOY_SHA" apply; then
  echo 'Deployment succeeded, but Mac image cleanup needs review.' >&2
fi
