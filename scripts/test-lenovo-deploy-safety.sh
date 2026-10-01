#!/usr/bin/env bash
# Runs dummy commands only. Requires Linux/GNU timeout; does not contact Docker.
set -euo pipefail
command -v timeout >/dev/null
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
test_dir="$(mktemp -d)"
trap 'rm -r -- "$test_dir"' EXIT
source <(sed "s#/run/docker-churn-guard.tripped#$test_dir/guard#g" "$script_dir/lenovo-deploy-safety.sh")

fail() { echo "FAIL: $*" >&2; exit 1; }
expect_failure() {
  local expected="$1" result
  shift
  if "$@"; then fail 'command unexpectedly succeeded'; else result=$?; fi
  [[ "$result" == "$expected" ]] || fail "expected $expected, got $result"
}

output="$(printf 'streamed image stand-in' | ryanos_guarded_run 3 cat)"
[[ "$output" == 'streamed image stand-in' ]] || fail 'stdin was lost'
echo 'PASS: successful command preserves streamed stdin'

expect_failure 7 ryanos_guarded_run 3 bash -c 'exit 7'
echo 'PASS: command failure propagates even in a conditional'

touch "$test_dir/guard"
expect_failure 1 ryanos_guarded_run 3 touch "$test_dir/should-not-run"
[[ ! -e "$test_dir/should-not-run" ]] || fail 'tripped guard allowed a command'
rm "$test_dir/guard"
echo 'PASS: existing guard trip prevents commands'

expect_failure 124 ryanos_guarded_run 0.2 sleep 30
echo 'PASS: an unresponsive command is bounded'

# A trip after starting a long-running client must cancel that client.
expect_failure 1 ryanos_guarded_run 20 bash -c '
  trap '\''touch "$1/cancelled"; exit 143'\'' TERM
  sleep 0.2
  touch "$1/guard"
  sleep 30 &
  wait
' safety-test "$test_dir"
[[ -e "$test_dir/cancelled" ]] || fail 'guard trip left the client running'
rm "$test_dir/guard"
echo 'PASS: a new trip cancels a running client'

# An inactive daemon must be rejected before contacting the client.
systemctl() { return 1; }
docker() { touch "$test_dir/should-not-run"; }
expect_failure 1 ryanos_docker_preflight
[[ ! -e "$test_dir/should-not-run" ]] || fail 'inactive daemon allowed a client'
echo 'PASS: inactive Docker fails preflight'

(
  release=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  source_sha="$release"
  image='sha256:new-image'
  rollback='sha256:old-image'
  running="$rollback"
  dirty=0
  git() {
    if [[ "$1" == rev-parse ]]; then echo "$source_sha"; else return "$dirty"; fi
  }
  ryanos_guarded_run() {
    case "${!#}" in
      ryanos-app:server-*) [[ "$image" != missing ]] || return 1; echo "$image" ;;
      ryanos-app:rollback-*) echo "$rollback" ;;
      ryanos-api) echo "$running" ;;
      *) fail 'unexpected command during release validation' ;;
    esac
  }
  validate() { ryanos_validate_loaded_release "$release" 'sha256:new-image' ryanos-app:rollback-20261001T033957Z; }
  validate
  echo 'PASS: matching interrupted release is accepted'
  source_sha=wrong
  expect_failure 1 validate
  source_sha="$release"
  dirty=1
  expect_failure 1 validate
  dirty=0
  image=wrong
  expect_failure 1 validate
  image=missing
  expect_failure 1 validate
  image='sha256:new-image'
  rollback=wrong
  expect_failure 1 validate
  rollback="$image"
  running="$image"
  expect_failure 1 validate
  echo 'PASS: changed source, dirty source, mismatched/missing image, and invalid rollback are rejected'
)

echo 'All deployment safety tests passed.'
