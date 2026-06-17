#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
APK_PATH="${ANDROID_DIR}/app/build/outputs/apk/debug/app-debug.apk"

cd "${ANDROID_DIR}"

if [[ -x "./gradlew" ]]; then
  GRADLE_CMD=("./gradlew")
elif command -v gradle >/dev/null 2>&1; then
  GRADLE_CMD=("gradle")
else
  printf "Gradle is not available. Open apps/android in Android Studio or install Gradle 9.4.1+.\n" >&2
  exit 1
fi

"${GRADLE_CMD[@]}" :app:assembleDebug

if [[ ! -f "${APK_PATH}" ]]; then
  printf "Build finished, but expected APK was not found at %s\n" "${APK_PATH}" >&2
  exit 1
fi

printf "Debug APK: %s\n" "${APK_PATH}"
