#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
APK_PATH="${ANDROID_DIR}/app/build/outputs/apk/debug/app-debug.apk"
SKIP_BUILD="false"

if [[ "${1:-}" == "--skip-build" ]]; then
  SKIP_BUILD="true"
fi

sdk_root() {
  if [[ -n "${ANDROID_HOME:-}" && -d "${ANDROID_HOME}" ]]; then
    printf "%s\n" "${ANDROID_HOME}"
  elif [[ -n "${ANDROID_SDK_ROOT:-}" && -d "${ANDROID_SDK_ROOT}" ]]; then
    printf "%s\n" "${ANDROID_SDK_ROOT}"
  elif [[ -f "${ANDROID_DIR}/local.properties" ]]; then
    sed -n 's/^sdk.dir=//p' "${ANDROID_DIR}/local.properties" | head -n 1
  fi
}

SDK_ROOT="$(sdk_root)"
if command -v adb >/dev/null 2>&1; then
  ADB_CMD="$(command -v adb)"
elif [[ -n "${SDK_ROOT}" && -x "${SDK_ROOT}/platform-tools/adb" ]]; then
  ADB_CMD="${SDK_ROOT}/platform-tools/adb"
else
  printf "adb is not available. Install Android SDK Platform Tools or use Android Studio's Run button.\n" >&2
  exit 1
fi

if [[ "${SKIP_BUILD}" != "true" || ! -f "${APK_PATH}" ]]; then
  "${SCRIPT_DIR}/build-debug-apk.sh"
fi

printf "Installing %s\n" "${APK_PATH}"
"${ADB_CMD}" install -r "${APK_PATH}"

printf "Launching RyanOS\n"
"${ADB_CMD}" shell am start -n com.ryanos.android/.MainActivity >/dev/null
