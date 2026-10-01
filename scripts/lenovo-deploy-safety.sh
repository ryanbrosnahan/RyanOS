#!/usr/bin/env bash
# Sourced locally; these functions are sent to the remote deployment shell.
ryanos_guard_is_clear() {
  if [[ -e /run/docker-churn-guard.tripped ]]; then
    echo 'Docker churn guard is tripped; deployment stopped. Follow HOME_SERVER_RECOVERY.md before retrying.' >&2
    return 1
  fi
}

ryanos_guarded_run() (
  set -euo pipefail
  local seconds="$1"
  shift
  ryanos_guard_is_clear || exit 1
  local command_pid=''
  cleanup_guarded_command() {
    if [[ -n "$command_pid" ]] && kill -0 "$command_pid" 2>/dev/null; then
      # GNU timeout forwards TERM to its command group, then enforces kill-after.
      # Cancel this client only; never resume or restart the Docker daemon here.
      kill -TERM "$command_pid" 2>/dev/null || true
      wait "$command_pid" 2>/dev/null || true
    fi
  }
  trap cleanup_guarded_command EXIT
  trap 'exit 143' TERM HUP
  trap 'exit 130' INT
  # Preserve stdin for streamed image imports and database commands.
  timeout --kill-after=5 "$seconds" "$@" <&0 &
  command_pid=$!
  while kill -0 "$command_pid" 2>/dev/null; do
    ryanos_guard_is_clear || exit 1
    sleep 2
  done
  if wait "$command_pid"; then
    ryanos_guard_is_clear
  else
    result=$?
    echo "Deployment command failed or timed out (status $result); inspect the host before retrying." >&2
    exit "$result"
  fi
)

ryanos_docker_preflight() {
  ryanos_guard_is_clear || return 1
  systemctl is-active --quiet docker.service || {
    echo 'Docker is not active on Lenovo.' >&2
    return 1
  }
  ryanos_guarded_run 15 docker info >/dev/null
}
