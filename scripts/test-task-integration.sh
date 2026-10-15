#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Uses an already available official image. No production env, mounts or data.
unset DATABASE_URL
container_id="$(docker run --detach --rm --pull never --publish 127.0.0.1::5432 \
  --env POSTGRES_PASSWORD=synthetic-test-only --env POSTGRES_DB=ryanos_integration_test postgres:16-alpine)"
trap 'docker stop "$container_id" >/dev/null' EXIT
for attempt in {1..30}; do
  if docker exec "$container_id" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
port="$(docker port "$container_id" 5432/tcp)"
port="${port##*:}"
export TEST_TASK_INTEGRATION_DATABASE_URL="postgres://postgres:synthetic-test-only@127.0.0.1:${port}/ryanos_integration_test"
pnpm -r --filter './packages/*' build
pnpm --filter @ryanos/api exec vitest run test/task-integration.test.ts
