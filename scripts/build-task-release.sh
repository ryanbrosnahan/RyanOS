#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mode="${1:-release}"
[[ "$mode" == release || "$mode" == review ]] || { echo 'Use release or review' >&2; exit 1; }
sha=$(git rev-parse HEAD)
if [[ "$mode" == release && -n "$(git status --porcelain)" ]]; then echo 'Commit only reviewed changes before release build.' >&2; exit 1; fi
image="ryanos-app:task-${mode}-${sha:0:12}"
docker build --platform linux/amd64 --file docker/app.Dockerfile \
  --label "org.opencontainers.image.revision=$sha" --label "io.ryanos.tree-status=$mode" \
  --tag "$image" .
[[ "$(docker image inspect --format '{{.Architecture}}' "$image")" == amd64 ]]
echo "Built $image"
