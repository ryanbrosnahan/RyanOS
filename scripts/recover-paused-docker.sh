#!/usr/bin/env bash
# Operator-approved recovery after a guard trip.
# Run via a detached systemd unit. Leave the marker for external verification.
set -Eeuo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
export LC_ALL=C

restart_networkmanager=0
if [[ "${1:-}" == --restart-networkmanager && $# == 1 ]]; then
  restart_networkmanager=1
elif (( $# != 0 )); then
  echo 'Usage: recover-paused-docker.sh [--restart-networkmanager]' >&2
  exit 2
fi

if (( EUID != 0 )); then
  echo 'Run with sudo through systemd-run on Lenovo.' >&2
  exit 1
fi

exec 9>/run/ryanos-docker-recovery.lock
flock -n 9 || { echo 'Another recovery is running.' >&2; exit 1; }

resumed=0
on_exit() {
  local result=$?
  trap - EXIT
  if (( result != 0 )); then
    if (( resumed )); then
      if systemctl kill --kill-who=main --signal=SIGSTOP docker.service; then
        echo 'Validation failed: Docker paused again; trip marker retained.' >&2
      else
        echo 'CRITICAL: Could not pause Docker after validation failed; local intervention required.' >&2
      fi
    else
      echo 'Precheck failed: Docker state and trip marker unchanged.' >&2
    fi
  fi
  exit "$result"
}
trap on_exit EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

check_network() {
  systemctl is-active --quiet NetworkManager.service
  systemctl is-active --quiet tailscaled.service
  timeout 70 nm-online -q --timeout=60
  timeout 8 nmcli -w 5 general status
}

check_saturation() {
  local entries
  # Capture before matching so pipefail cannot hide matches behind SIGPIPE.
  entries="$(timeout 20 journalctl --boot=0 --since "$1" --no-pager -o cat)"
  if grep -Fq 'maximum number of pending replies' <<<"$entries"; then
    echo 'Current-boot D-Bus saturation detected.' >&2
    return 1
  fi
}

check_health() {
  local response
  response="$(curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3100/api/health)"
  python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("status") == "ok" else 1)' <<<"$response"
  echo 'RyanOS local health: ok'
}

expected_guard=5106a09d6cbb46413a2ec6b73ad53d12991267a659123d37b81d500f75e649ee
actual_guard="$(sha256sum /usr/local/sbin/docker-churn-guard | cut -d ' ' -f 1)"
[[ "$actual_guard" == "$expected_guard" ]] || { echo 'Reviewed guard fix is not installed.' >&2; exit 1; }
[[ -f /run/docker-churn-guard.tripped ]] || { echo 'No guard trip marker; refusing an unnecessary recovery.' >&2; exit 1; }
systemctl is-active --quiet docker.service
systemctl is-active --quiet docker.socket
systemctl is-active --quiet docker-churn-guard.timer
docker_pid="$(systemctl show -p MainPID --value docker.service)"
grep -Eq '^State:[[:space:]]+T' "/proc/$docker_pid/status" || { echo 'Docker is not paused; inspect before recovery.' >&2; exit 1; }

# Epoch timestamps are accepted by the host's journalctl (systemd 249);
# date --iso-8601=seconds produces a T/offset format that it rejects.
observation_start="@$(date +%s)"
if (( restart_networkmanager )); then
  echo 'Restarting NetworkManager with operator approval; Docker remains paused.'
  timeout --kill-after=5 90 systemctl restart NetworkManager.service
else
  check_saturation '2 minutes ago'
fi
echo 'Checking healthy networking while Docker remains paused.'
check_network
check_saturation "$observation_start"
sleep 60
check_network
check_saturation "$observation_start"

echo 'Resuming Docker; retaining the trip marker during validation.'
resumed=1
systemctl kill --kill-who=main --signal=SIGCONT docker.service
timeout 30 docker info >/dev/null

for check in 1 2 3; do
  sleep 20
  check_network
  check_saturation "$observation_start"
done
timeout 10 docker info >/dev/null
check_health
timeout 10 docker ps --format '{{.Names}} {{.Status}}'
restart_loops="$(timeout 10 docker ps --filter status=restarting --format '{{.Names}}')"
[[ -z "$restart_loops" ]] || { echo 'Container restart loop detected; leaving Docker paused.' >&2; exit 1; }
check_saturation "$observation_start"
echo 'Recovery checks passed. Docker is running; trip marker remains for external health verification and approved rearming.'
