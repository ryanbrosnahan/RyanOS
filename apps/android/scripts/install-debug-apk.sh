#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
APK_PATH="${ANDROID_DIR}/app/build/outputs/apk/debug/app-debug.apk"
SKIP_BUILD="false"

if [[ "${1:-}" == "--skip-build" ]]; then
  SKIP_BUILD="true"
fi

if ! command -v adb >/dev/null 2>&1; then
  printf "adb is not available. Install Android SDK Platform Tools or use Android Studio's Run button.\n" >&2
  exit 1
fi

if [[ "${SKIP_BUILD}" != "true" || ! -f "${APK_PATH}" ]]; then
  "${SCRIPT_DIR}/build-debug-apk.sh"
fi

printf "Installing %s\n" "${APK_PATH}"
adb install -r "${APK_PATH}"

printf "Launching RyanOS\n"
adb shell am start -n com.ryanos.android/.MainActivity >/dev/null
