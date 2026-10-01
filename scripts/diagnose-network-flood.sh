#!/usr/bin/env bash
set -uo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
export LC_ALL=C
(( EUID == 0 )) || { echo 'Run this read-only diagnostic with sudo.'; exit 1; }
umask 077
report_dir=$(mktemp -d /var/tmp/ryanos-network-evidence.XXXXXX)
exec > >(tee "$report_dir/summary.txt") 2>&1
printf 'Evidence directory: %s\n' "$report_dir"
date --iso-8601=seconds
printf '\nLatest guard evidence\n'
for bundle in $(ls -1d /var/lib/server-crash-evidence/guard/* | sort | tail -2); do
  printf '%s\n' "$bundle"
  cat "$bundle/summary.env"
done
printf '\nNetworkManager connection stats\n'
timeout 10 busctl --system call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus.Debug.Stats GetConnectionStats s org.freedesktop.NetworkManager
printf '\nSystem bus connections\n'
timeout 10 busctl --system list --no-pager > "$report_dir/bus-connections.txt"
awk 'NR == 1 || $3 == "cinnamon" || $3 == "nm-applet" || $3 == "polkitd" || $3 == "NetworkManager"' "$report_dir/bus-connections.txt"
printf '\nNetworkManager current state\n'
timeout 10 nmcli -w 5 general status
timeout 10 nmcli -f DEVICE,TYPE,STATE device status
systemctl show NetworkManager -p MainPID -p ActiveEnterTimestamp
printf '\nD-Bus traffic headers only (12-second passive sample)\n'
# Profile mode records message metadata, not method arguments or secrets.
nm_connection=$(busctl --system list --no-pager | awk '$1 == "org.freedesktop.NetworkManager" {print $5}')
if [[ "$nm_connection" == :* ]]; then
  timeout 12 dbus-monitor --system --profile "sender='$nm_connection'" "destination='$nm_connection'" > "$report_dir/dbus-profile.txt" 2>&1 || true
  head -45 "$report_dir/dbus-profile.txt"
  printf '\nMethod-call counts (sender, destination, member)\n'
  awk -F '\t' '$1 == "mc" {count[$4 " " $5 " " $8]++} END {for (key in count) print count[key], key}' "$report_dir/dbus-profile.txt" | sort -nr | head -20
fi
printf '\nRecent non-repetitive service logs\n'
journalctl --boot=0 --since '15 minutes ago' -u NetworkManager -u systemd-resolved -u docker --no-pager -o short-iso > "$report_dir/services.log"
tail -35 "$report_dir/services.log"
printf '\nEvidence saved to %s\n' "$report_dir"
