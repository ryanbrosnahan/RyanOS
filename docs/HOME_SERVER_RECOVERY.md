# Home Server Recovery

This runbook covers a RyanOS outage where the Lenovo host remains reachable but
the web client or API hangs because the Docker churn guard paused the Docker
daemon after detecting NetworkManager/D-Bus saturation.

## Safety rules

- Run read-only checks before changing host state.
- Keep Docker paused while NetworkManager/D-Bus is unhealthy.
- Run remote network recovery through a detached systemd unit. Restarting
  NetworkManager can disconnect SSH even when recovery succeeds.
- Require operator approval before restarting NetworkManager or Tailscale,
  rebooting the host, or resetting the churn guard.
- Never repeatedly resume Docker into active D-Bus saturation.
- Never build production images on the Lenovo host.

## Recognize the incident

From the development machine:

```bash
curl -fsS --max-time 10 \
  https://ryan-lenovo-desktop.taile89fa5.ts.net/api/health
ssh lenovo 'systemctl is-active NetworkManager tailscaled docker.service docker.socket'
ssh lenovo 'cat /run/docker-churn-guard.tripped 2>/dev/null || true'
ssh lenovo 'journalctl --since "5 minutes ago" --no-pager | tail -n 200'
```

The characteristic saturation message is:

```text
maximum number of pending replies
```

`systemctl` may report Docker as active while its main process is stopped with
`SIGSTOP`. Confirm process state without calling a potentially blocked Docker
client:

```bash
ssh lenovo 'pid="$(systemctl show -p MainPID --value docker.service)"; grep -E "^(Name|State):" "/proc/$pid/status"'
```

`State: T (stopped)` means the guard paused the daemon intentionally.

## Remote recovery

After receiving operator approval, paste this into an SSH session on Lenovo.
The recovery probes NetworkManager before resuming Docker and probes it again
afterward. If the post-resume probe fails, the unit pauses Docker again:

```bash
recovery_unit="ryanos-safe-recovery-$(date +%Y%m%d-%H%M%S)"
sudo systemd-run --unit="$recovery_unit" --no-block /bin/bash -lc '
set -euo pipefail
echo "Restarting NetworkManager while Docker remains paused"
systemctl restart NetworkManager
nm-online -q --timeout=60
systemctl restart tailscaled

precheck_since="$(date --iso-8601=seconds)"
nmcli general status >/dev/null
sleep 20

if journalctl --since "$precheck_since" --no-pager | grep -Fq "maximum number of pending replies"; then
  echo "D-Bus saturation persists before Docker resume; leaving Docker paused"
  exit 1
fi

echo "Network is healthy; resuming Docker"
systemctl kill --kill-who=main --signal=SIGCONT docker.service
systemctl start docker.socket
timeout 30 docker info >/dev/null

postcheck_since="$(date --iso-8601=seconds)"
sleep 60
nmcli general status >/dev/null
sleep 10
if journalctl --since "$postcheck_since" --no-pager | grep -Fq "maximum number of pending replies"; then
  echo "D-Bus saturation returned after Docker resume; pausing Docker again"
  systemctl kill --kill-who=main --signal=SIGSTOP docker.service
  exit 1
fi

echo "Recovery completed successfully"
'
echo "Recovery logs: sudo journalctl -u $recovery_unit -n 100 --no-pager"
```

The SSH session may disconnect. The recovery continues under systemd. After
reconnecting, inspect its result:

```bash
sudo journalctl -u <recovery-unit-from-command-output> -n 100 --no-pager
```

If recovery does not end with `Recovery completed successfully`, do not rerun
it repeatedly. Inspect the evidence under
`/var/lib/server-crash-evidence/guard/` and use the local console. If the host
cannot be recovered safely, obtain approval and perform a controlled reboot.
If a container is in a confirmed restart loop, disable its restart policy and
stop it before rebooting. For the Telegram poller, use:

```bash
docker update --restart=no ryanos-telegram-poller
docker stop --time 10 ryanos-telegram-poller
sudo reboot
```

Do not disable a healthy container speculatively. After reboot, fix the failing
service before restoring its restart policy.

## Validate RyanOS

Do not reset the guard until all checks pass:

```bash
systemctl is-active NetworkManager tailscaled docker.service docker.socket
nmcli general status
timeout 10 docker info >/dev/null
curl -fsS --max-time 10 http://127.0.0.1:3100/api/health
journalctl --since "1 minute ago" --no-pager | \
  grep -F "maximum number of pending replies" || true
```

Expected results:

- NetworkManager, Tailscale, Docker, and `docker.socket` are active.
- `docker info` completes instead of hanging.
- RyanOS health returns JSON with `"status":"ok"`.
- No new pending-reply saturation is logged.

Verify the Tailscale URL from another machine as well:

```bash
curl -fsS --max-time 10 \
  https://ryan-lenovo-desktop.taile89fa5.ts.net/api/health
```

## Rearm the guard

The recovery command resumes Docker but intentionally leaves
`/run/docker-churn-guard.tripped` in place. This prevents an immediate retrip
while validation is in progress and blocks deployments during review.

After validation passes and the operator approves rearming, run:

```bash
sudo docker-churn-guard-reset
test ! -e /run/docker-churn-guard.tripped
systemctl is-active docker-churn-guard.timer
```

Recheck RyanOS health after the reset. Do not delete the marker by hand; the
reset command also normalizes Docker state and records the operator action.

## Evidence and follow-up

Preserve the newest evidence bundle and review the trigger before deploying:

```bash
sudo ls -lt /var/lib/server-crash-evidence/guard
sudo cat /var/lib/server-crash-evidence/guard/<timestamp>/summary.env
```

Check for container restart loops and recent network churn:

```bash
docker ps --format '{{.Names}} {{.Status}}'
docker inspect --format '{{.Name}} restart={{.RestartCount}}' $(docker ps -aq)
journalctl -u docker.service --since "24 hours ago" --no-pager | \
  grep -E 'sbJoin|restart|healthcheck failed|session healthcheck failed' || true
```

Fix a restart loop before rearming the guard or deploying. Record the trigger,
recovery result, and any remediation in the incident or change notes.
