#!/usr/bin/env bash
# Uses a fake Docker inventory. Never contacts either Docker daemon.
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/ryanos-image-retention.sh"

test_dir="$(mktemp -d)"
trap 'rm -r -- "$test_dir"' EXIT
removed="$test_dir/removed"
touch "$removed"

ryanos_docker_preflight() { :; }
ryanos_guarded_run() { shift; "$@"; }
curl() { printf 'OK'; }
docker() {
  case "$1 $2" in
    'context show') echo desktop-linux ;;
    'image ls')
      printf '%s\n' \
        ryanos-app:server \
        ryanos-app:server-aaaaaaaaaaaa \
        ryanos-app:rollback-20261001T033957Z \
        ryanos-app:server-bbbbbbbbbbbb \
        ryanos-app:rollback-20260814T175010Z \
        ryanos-app:server-cccccccccccc \
        unrelated:latest
      ;;
    'image inspect')
      case "${!#}" in
        ryanos-app:server|ryanos-app:server-aaaaaaaaaaaa) echo 'sha256:current' ;;
        ryanos-app:rollback-20261001T033957Z|ryanos-app:server-bbbbbbbbbbbb) echo 'sha256:rollback' ;;
        ryanos-app:rollback-20260814T175010Z) echo 'sha256:stale' ;;
        ryanos-app:server-cccccccccccc) echo 'sha256:in-use' ;;
        *) return 1 ;;
      esac
      ;;
    'ps -aq') echo old-container ;;
    'inspect --format')
      case "${!#}" in
        ryanos-api|ryanos-web|ryanos-worker) echo 'sha256:current' ;;
        old-container) echo 'sha256:in-use' ;;
        *) return 1 ;;
      esac
      ;;
    'image rm') printf '%s\n' "$3" >> "$removed" ;;
    *) echo "Unexpected Docker call: $*" >&2; return 1 ;;
  esac
}

output="$(ryanos_retire_images remote ryanos-app:server-aaaaaaaaaaaa dry-run)"
[[ ! -s "$removed" && "$output" == *'Would remove ryanos-app:rollback-20260814T175010Z'* ]] || exit 1

ryanos_retire_images remote ryanos-app:server-aaaaaaaaaaaa apply > /dev/null
[[ "$(wc -l < "$removed" | tr -d ' ')" == 2 ]] || exit 1
rg -q '^ryanos-app:server-bbbbbbbbbbbb$' "$removed"
rg -q '^ryanos-app:rollback-20260814T175010Z$' "$removed"
! rg -q 'server-aaaaaaaaaaaa|rollback-20261001T033957Z|server-cccccccccccc|unrelated' "$removed"

: > "$removed"
ryanos_retire_images local ryanos-app:server-aaaaaaaaaaaa apply > /dev/null
[[ "$(wc -l < "$removed" | tr -d ' ')" == 5 ]] || exit 1
! rg -q 'server-cccccccccccc|unrelated' "$removed"
echo 'PASS: only unreferenced RyanOS tags are retired; current and rollback stay on Lenovo.'
