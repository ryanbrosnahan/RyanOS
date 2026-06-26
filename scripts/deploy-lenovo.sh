#!/usr/bin/env bash
set -euo pipefail

REMOTE="${RYANOS_DEPLOY_REMOTE:-lenovo}"
REMOTE_DIR="${RYANOS_DEPLOY_DIR:-/opt/ryanos}"
BRANCH="${RYANOS_DEPLOY_BRANCH:-main}"
COMPOSE_FILE="${RYANOS_DEPLOY_COMPOSE_FILE:-docker-compose.server.yml}"
SSH_OPTS=(-o BatchMode=yes -o IdentitiesOnly=yes)
ANDROID_APK_PATH=""
ANDROID_MANIFEST_PATH=""
ANDROID_STUDIO_JBR="/Applications/Android Studio.app/Contents/jbr/Contents/Home"

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd -- "$script_dir/.." && pwd)"

cd "$repo_dir"

cleanup() {
  if [ -n "${ANDROID_MANIFEST_PATH:-}" ]; then
    rm -f "$ANDROID_MANIFEST_PATH"
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

pnpm test
pnpm typecheck
BETTER_AUTH_URL="${BETTER_AUTH_URL:-https://ryanos.localhost.invalid}" \
BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-local-compose-config-placeholder-secret}" \
RYANOS_INVITE_CODES="${RYANOS_INVITE_CODES:-local-compose-config-placeholder}" \
docker compose -f "$COMPOSE_FILE" config >/dev/null

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
  mkdir -p releases/android
  docker compose -f '$COMPOSE_FILE' build
  docker compose -f '$COMPOSE_FILE' up -d postgres
  scripts/ensure-postgres-docker-auth.sh '$COMPOSE_FILE'
  docker compose -f '$COMPOSE_FILE' run --rm migrate
  compose_profile_args=''
  compose_services='api web worker'
  if grep -Eq '^COMPOSE_PROFILES=([^#]*,)?telegram(,|$)' .env; then
    compose_profile_args='--profile telegram'
    compose_services=\"\$compose_services telegram-poller\"
  fi
  docker compose -f '$COMPOSE_FILE' \$compose_profile_args up -d --remove-orphans \$compose_services
  docker compose -f '$COMPOSE_FILE' ps
  curl -fsS http://127.0.0.1:\${WEB_PORT:-3100}/api/health
"

if [ -n "$ANDROID_APK_PATH" ]; then
  ssh "${SSH_OPTS[@]}" "$REMOTE" "mkdir -p '$REMOTE_DIR/releases/android'"
  scp "${SSH_OPTS[@]}" "$ANDROID_APK_PATH" "$REMOTE:$REMOTE_DIR/releases/android/ryanos-latest.apk"
  scp "${SSH_OPTS[@]}" "$ANDROID_MANIFEST_PATH" "$REMOTE:$REMOTE_DIR/releases/android/manifest.json"
  ssh "${SSH_OPTS[@]}" "$REMOTE" "set -euo pipefail
    cd '$REMOTE_DIR'
    ls -lh releases/android/ryanos-latest.apk releases/android/manifest.json
    docker compose -f '$COMPOSE_FILE' restart web
    for attempt in 1 2 3 4 5 6 7 8 9 10; do
      if curl -fsS http://127.0.0.1:\${WEB_PORT:-3100}/downloads/android/manifest.json >/dev/null; then
        exit 0
      fi
      sleep 1
    done
    curl -fsS http://127.0.0.1:\${WEB_PORT:-3100}/downloads/android/manifest.json >/dev/null
  "
fi
