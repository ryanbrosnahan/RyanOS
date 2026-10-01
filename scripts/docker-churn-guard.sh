#!/usr/bin/env bash
# Pause Docker before repeated BuildKit network churn can wedge the host.
set -Eeuo pipefail

PATH=/usr/sbin:/usr/bin:/sbin:/bin
state_file=/run/docker-churn-guard.tripped
lock_file=/run/docker-churn-guard.lock
evidence_root=/var/lib/server-crash-evidence/guard
window='2 minutes ago'

exec 9>"$lock_file"
flock -n 9 || exit 0

if [[ -e "$state_file" ]]; then
  exit 0
fi

# Persistent journals retain pre-reboot errors inside this rolling window.
# Only the current boot can provide evidence for pausing the current daemon.
recent="$(journalctl --boot=0 --since "$window" --no-pager -o short-iso 2>/dev/null || true)"

count() {
  local pattern=$1
  printf '%s\n' "$recent" | grep -E -c "$pattern" || true
}

nm_veth="$(count 'NetworkManager.*manager: \(veth.*\): new Veth device')"
kernel_veth="$(count 'kernel: device veth.* entered promiscuous mode')"
bridge_joins="$(count 'dockerd.*sbJoin:')"
build_failures="$(count '(healthcheck failed.*only one connection allowed|session healthcheck failed fatally)')"
dbus_saturation="$(count 'maximum number of pending replies')"

reason=''
if (( dbus_saturation >= 1 )); then
  reason='D-Bus/NetworkManager pending-reply saturation'
elif (( nm_veth >= 18 && build_failures >= 1 )); then
  reason='BuildKit session failure plus high NetworkManager veth churn'
elif (( bridge_joins >= 10 && build_failures >= 2 )); then
  reason='BuildKit session failures plus high Docker bridge churn'
elif (( kernel_veth >= 25 )); then
  reason='extreme Docker veth churn'
fi

[[ -n "$reason" ]] || exit 0

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
bundle="$evidence_root/$timestamp"
install -d -m 0700 "$bundle"

{
  printf 'reason=%s\n' "$reason"
  printf 'window_start=%s\n' "$window"
  printf 'networkmanager_veth_events=%s\n' "$nm_veth"
  printf 'kernel_veth_events=%s\n' "$kernel_veth"
  printf 'docker_bridge_joins=%s\n' "$bridge_joins"
  printf 'buildkit_session_failures=%s\n' "$build_failures"
  printf 'dbus_saturation_events=%s\n' "$dbus_saturation"
} >"$bundle/summary.env"
printf '%s\n' "$recent" >"$bundle/journal-last-2-minutes.log"
ip -details link show >"$bundle/ip-link.txt" 2>&1 || true
ip route show table all >"$bundle/ip-route.txt" 2>&1 || true
ss -s >"$bundle/socket-summary.txt" 2>&1 || true
ps -eo pid,ppid,stat,etimes,%cpu,%mem,comm,args --sort=-%cpu >"$bundle/processes.txt" 2>&1 || true
cat /proc/interrupts >"$bundle/interrupts.txt" 2>&1 || true
cat /proc/softirqs >"$bundle/softirqs.txt" 2>&1 || true
systemctl status docker.service docker.socket --no-pager --full >"$bundle/docker-systemd-status.txt" 2>&1 || true

printf '%s\n' "$reason" >"$state_file"
logger -p daemon.alert -t docker-churn-guard "TRIPPED: $reason; pausing Docker daemon without stopping containers; evidence=$bundle"

# Never stop docker.socket or docker.service here. On this host docker.service
# requires docker.socket, so stopping the socket propagates a full daemon and
# container shutdown. SIGSTOP only the daemon: existing containers keep
# running, while new Docker operations block until an operator reviews the
# evidence and runs docker-churn-guard-reset.
if ! systemctl kill --kill-who=main --signal=SIGSTOP docker.service; then
  logger -p daemon.err -t docker-churn-guard 'trip detected, but Docker daemon could not be paused'
fi
