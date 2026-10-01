#!/usr/bin/env bash
# Install the reviewed current-boot fix without resetting the guard or services.
set -Eeuo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin

if (( EUID != 0 )); then
  echo 'Run this installer with sudo on Lenovo.' >&2
  exit 1
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source_file="$script_dir/docker-churn-guard.sh"
target=/usr/local/sbin/docker-churn-guard
baseline_sha256=8a4140275e9af7ffc37d7a7783f251eb31dfa7d5dd145c29a2b5155dae3b448f

bash -n "$source_file"
exec 9>/run/docker-churn-guard.lock
flock -w 30 9

if cmp -s "$source_file" "$target"; then
  echo 'The current-boot guard fix is already installed. Docker state is unchanged.'
  exit 0
fi

actual_sha256="$(sha256sum "$target" | cut -d ' ' -f 1)"
if [[ "$actual_sha256" != "$baseline_sha256" ]]; then
  echo 'Installed guard differs from the reviewed version; no changes made.' >&2
  exit 1
fi

backup="$(mktemp /usr/local/sbin/docker-churn-guard.backup.XXXXXX)"
cp -p "$target" "$backup"
candidate="$(mktemp /usr/local/sbin/.docker-churn-guard.XXXXXX)"
trap 'rm -f -- "$candidate"' EXIT
install -o root -g root -m 0755 "$source_file" "$candidate"
bash -n "$candidate"
mv -f -- "$candidate" "$target"
cmp -s "$source_file" "$target"

echo 'Installed: guard now reads only current-boot events. Thresholds are unchanged.'
printf 'Previous guard saved at: %s\n' "$backup"
echo 'No services restarted; Docker and the existing trip marker are unchanged.'
