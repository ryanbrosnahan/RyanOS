#!/bin/bash -p
set -Eeuo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
export HOME=/root LC_ALL=C
umask 077
cd /
(( EUID == 0 )) || exit 1
(( $# == 1 )) || exit 2

check_saturation() {
  local entries
  entries="$(timeout 20 journalctl --boot=0 --since '2 minutes ago' --no-pager -o cat)"
  if grep -Fq 'maximum number of pending replies' <<<"$entries"; then
    echo 'Recent D-Bus saturation: refusing to rearm.' >&2
    return 1
  fi
}

check_health() {
  local response
  response="$(curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3100/api/health)"
  python3 -I -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("status") == "ok" else 1)' <<<"$response"
}

case "$1" in
  status)
    date --iso-8601=seconds
    if [[ -e /run/docker-churn-guard.tripped ]]; then
      echo 'Guard: tripped'
    else
      echo 'Guard: clear'
    fi
    timeout 10 systemctl show NetworkManager.service tailscaled.service docker.service \
      docker.socket docker-churn-guard.timer -p Id -p ActiveState -p MainPID
    docker_pid="$(timeout 10 systemctl show -p MainPID --value docker.service)"
    if [[ "$docker_pid" =~ ^[1-9][0-9]*$ && -f "/proc/$docker_pid/status" ]]; then
      grep -E '^(Name|State):' "/proc/$docker_pid/status"
    fi
    timeout 10 nmcli -w 5 general status
    check_saturation
    check_health
    echo 'Network and application checks passed.'
    ;;
  diagnose)
    exec timeout --kill-after=5 90 /bin/bash /usr/local/lib/ryanos-server-admin/diagnose.sh
    ;;
  recover|recover-network)
    # A fixed unit name prevents concurrent queued recoveries. The helper also
    # holds a lock. Logs remain available via journalctl after completion.
    if [[ "$1" == recover-network ]]; then
      set -- --restart-networkmanager
    else
      set --
    fi
    timeout 15 systemd-run --unit=ryanos-admin-recovery --collect --no-block \
      --property=Type=oneshot --property=TimeoutStartSec=10min \
      /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/root LC_ALL=C \
      /bin/bash /usr/local/lib/ryanos-server-admin/recover.sh "$@"
    echo 'Detached recovery started. Read: journalctl -u ryanos-admin-recovery --no-pager'
    echo 'The trip marker is retained. Verify the result and external health before approved rearming.'
    ;;
  rearm)
    exec 9>/run/ryanos-docker-recovery.lock
    flock -n 9 || { echo 'Recovery is still running.' >&2; exit 1; }
    exec 8>/run/docker-churn-guard.lock
    flock -w 5 8 || { echo 'Guard is busy.' >&2; exit 1; }
    if [[ ! -e /run/docker-churn-guard.tripped ]]; then
      echo 'Guard is already clear; nothing changed.'
      exit 0
    fi
    # Failed validation must never clear the marker or leave an unhealthy
    # recovered daemon running. Existing containers survive this SIGSTOP.
    on_failure() {
      result=$?
      trap - EXIT
      if (( result != 0 )); then
        timeout 10 systemctl kill --kill-who=main --signal=SIGSTOP docker.service || \
          echo 'CRITICAL: Could not pause Docker; local intervention required.' >&2
        echo 'Rearm refused; trip marker retained. Follow the recovery runbook.' >&2
      fi
      exit "$result"
    }
    trap on_failure EXIT
    trap 'exit 143' TERM
    trap 'exit 130' INT
    expected_guard=5106a09d6cbb46413a2ec6b73ad53d12991267a659123d37b81d500f75e649ee
    actual_guard="$(sha256sum /usr/local/sbin/docker-churn-guard | cut -d ' ' -f 1)"
    [[ "$actual_guard" == "$expected_guard" ]] || { echo 'Unreviewed guard version.' >&2; exit 1; }
    for service in NetworkManager.service tailscaled.service docker.service docker.socket docker-churn-guard.timer; do
      timeout 10 systemctl is-active --quiet "$service"
    done
    docker_pid="$(timeout 10 systemctl show -p MainPID --value docker.service)"
    [[ "$docker_pid" =~ ^[1-9][0-9]*$ ]]
    process_state="$(awk '/^State:/ {print $2}' "/proc/$docker_pid/status")"
    [[ "$process_state" == S || "$process_state" == R || "$process_state" == D ]] || {
      echo 'Docker is paused or unavailable; run the recovery helper first.' >&2; exit 1;
    }
    timeout 15 nm-online -q --timeout=10
    timeout 8 nmcli -w 5 general status
    check_saturation
    timeout 15 docker info >/dev/null
    restart_loops="$(timeout 10 docker ps --filter status=restarting --format '{{.Names}}')"
    [[ -z "$restart_loops" ]] || { echo 'A container is restarting.' >&2; exit 1; }
    check_health
    check_saturation
    logger -p daemon.notice -t ryanos-server-admin 'Operator-approved guard rearm; network and application checks passed.'
    rm -- /run/docker-churn-guard.tripped
    trap - EXIT TERM INT
    echo 'Guard rearmed. Docker was not restarted or resumed by this command.'
    ;;
  *) echo 'Unknown operation.' >&2; exit 2 ;;
esac
