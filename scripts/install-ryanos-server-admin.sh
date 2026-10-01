#!/bin/bash -p
# One-time, operator-run installation. This installer is NOT passwordless.
set -Eeuo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin LC_ALL=C
umask 077
(( EUID == 0 )) || { echo 'Run this installer once with sudo.' >&2; exit 1; }
(( $# == 0 )) || { echo 'This installer takes no arguments.' >&2; exit 2; }
[[ "$(hostname)" == Ryan-Lenovo-Desktop ]] || { echo 'This policy is only for Lenovo.' >&2; exit 1; }
id ryan >/dev/null
visudo -c >/dev/null
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd /
entry=/usr/local/sbin/ryanos-server-admin
library=/usr/local/lib/ryanos-server-admin
policy=/etc/sudoers.d/ryanos-server-admin

# Refuse existing installations; updating privileged code is a separate,
# password-authenticated review, never something the dispatcher can perform.
for target in "$entry" "$library" "$policy"; do
  [[ ! -e "$target" && ! -L "$target" ]] || { echo "Already exists: $target" >&2; exit 1; }
done
for parent in /usr /usr/local /usr/local/sbin /usr/local/lib /etc /etc/sudoers.d; do
  [[ -d "$parent" && ! -L "$parent" && "$(stat -c %u "$parent")" == 0 ]] || {
    echo "Unsafe installation directory: $parent" >&2; exit 1;
  }
  mode="$(stat -c %a "$parent")"
  (( (8#$mode & 0022) == 0 )) || { echo "Writable installation directory: $parent" >&2; exit 1; }
done
stage="$(mktemp -d /usr/local/lib/.ryanos-server-admin.XXXXXX)"
policy_stage=''
installed_library=0
installed_entry=0
installed_policy=0
complete=0
cleanup() {
  result=$?
  trap - EXIT
  if (( ! complete )); then
    (( ! installed_policy )) || rm -- "$policy"
    (( ! installed_entry )) || rm -- "$entry"
    if (( installed_library )); then
      for name in dispatch.sh recover.sh diagnose.sh; do
        [[ ! -f "$library/$name" ]] || rm -- "$library/$name"
      done
      rmdir -- "$library"
    fi
  fi
  [[ -z "$policy_stage" || ! -f "$policy_stage" ]] || rm -- "$policy_stage"
  if [[ -d "$stage" ]]; then
    find "$stage" -maxdepth 1 -type f -delete
    rmdir -- "$stage"
  fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
install -o root -g root -m 0755 "$source_dir/ryanos-server-admin.sh" "$stage/entry"
install -o root -g root -m 0755 "$source_dir/ryanos-server-admin-dispatch.sh" "$stage/dispatch.sh"
install -o root -g root -m 0755 "$source_dir/recover-paused-docker.sh" "$stage/recover.sh"
install -o root -g root -m 0755 "$source_dir/diagnose-network-flood.sh" "$stage/diagnose.sh"
for script in "$stage"/*; do /bin/bash -n "$script"; done
policy_stage="$(mktemp /etc/sudoers.d/.ryanos-server-admin.XXXXXX)"
cat >"$policy_stage" <<'SUDOERS'
# Exact arguments only. No shells, arbitrary paths, or general systemctl access.
ryan ALL=(root) NOPASSWD: NOSETENV: /usr/local/sbin/ryanos-server-admin status, /usr/local/sbin/ryanos-server-admin diagnose, /usr/local/sbin/ryanos-server-admin recover, /usr/local/sbin/ryanos-server-admin recover-network, /usr/local/sbin/ryanos-server-admin rearm
SUDOERS
chmod 0440 "$policy_stage"
visudo -cf "$policy_stage"
install -d -o root -g root -m 0755 "$library"
installed_library=1
install -o root -g root -m 0755 "$stage/dispatch.sh" "$stage/recover.sh" "$stage/diagnose.sh" "$library/"
install -o root -g root -m 0755 "$stage/entry" "$entry"
installed_entry=1
# The validated policy is enabled only after all root-owned code is in place.
mv -- "$policy_stage" "$policy"
installed_policy=1
visudo -c
complete=1
echo 'Installed five fixed operations for ryan; no password was stored.'
echo 'Network restarts and guard rearming still require immediate operator approval.'
echo 'Verify: sudo -n /usr/local/sbin/ryanos-server-admin status'
