#!/bin/bash -p
# The only passwordless sudo entry point. Never accept paths or extra arguments.
set -euo pipefail
(( EUID == 0 )) || { echo 'Run this command with sudo.' >&2; exit 1; }
if (( $# != 1 )); then
  echo 'Usage: ryanos-server-admin {status|diagnose|recover|recover-network|rearm}' >&2
  exit 2
fi
case "$1" in
  status|diagnose|recover|recover-network|rearm) ;;
  *) echo 'Unknown operation.' >&2; exit 2 ;;
esac
# Ignore caller-controlled Docker configuration, Python paths, shell startup
# files, working directories, and other environment-based command overrides.
cd /
exec /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/root LC_ALL=C \
  /bin/bash --noprofile --norc /usr/local/lib/ryanos-server-admin/dispatch.sh "$1"
