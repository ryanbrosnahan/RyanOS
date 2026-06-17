#!/usr/bin/env bash
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
API_BASE_URL="${1:-}"
FAILURES=0

ok() {
  printf "OK    %s\n" "$1"
}

warn() {
  printf "WARN  %s\n" "$1"
}

fail() {
  printf "FAIL  %s\n" "$1"
  FAILURES=$((FAILURES + 1))
}

has_command() {
  command -v "$1" >/dev/null 2>&1
}

printf "RyanOS Android widget doctor\n\n"

if [[ -f "${ANDROID_DIR}/settings.gradle.kts" && -f "${ANDROID_DIR}/app/build.gradle.kts" ]]; then
  ok "Android Gradle project found at ${ANDROID_DIR}"
else
  fail "Run this script from the RyanOS checkout; Android Gradle files are missing."
fi

if has_command java && JAVA_VERSION="$(java -version 2>&1)"; then
  JAVA_VERSION="$(printf "%s\n" "${JAVA_VERSION}" | head -n 1)"
  ok "Java runtime found: ${JAVA_VERSION}"
else
  fail "Java runtime not found. Install Android Studio or put a JDK 17+ on PATH."
fi

if [[ -x "${ANDROID_DIR}/gradlew" ]]; then
  ok "Gradle wrapper found: ${ANDROID_DIR}/gradlew"
elif has_command gradle; then
  GRADLE_VERSION="$(gradle --version 2>/dev/null | sed -n '3p' | xargs)"
  ok "Gradle found on PATH: ${GRADLE_VERSION:-gradle}"
else
  fail "Gradle not found. Use Android Studio sync, add a Gradle wrapper, or install Gradle 9.4.1+."
fi

SDK_ROOT="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [[ -n "${SDK_ROOT}" && -d "${SDK_ROOT}" ]]; then
  ok "Android SDK root found: ${SDK_ROOT}"
else
  warn "ANDROID_HOME or ANDROID_SDK_ROOT is not set. Android Studio can still build if its SDK is configured."
fi

if has_command adb; then
  ok "adb found on PATH"
  printf "\nConnected adb devices:\n"
  adb devices | sed 's/^/  /'
else
  warn "adb not found on PATH. Android Studio can install, or add platform-tools to PATH for scripts/install-debug-apk.sh."
fi

if has_command curl; then
  ok "curl found on PATH"
else
  warn "curl not found; API URL checks are skipped."
fi

if [[ -n "${API_BASE_URL}" ]]; then
  NORMALIZED_URL="${API_BASE_URL%/}"
  if [[ "${NORMALIZED_URL}" != https://* ]]; then
    warn "API base URL is not HTTPS. The Android app currently disables cleartext HTTP."
  fi
  if has_command curl; then
    printf "\nChecking API base URL: %s\n" "${NORMALIZED_URL}"
    if curl -fsS "${NORMALIZED_URL}/health" >/dev/null 2>&1; then
      ok "Health endpoint responded at ${NORMALIZED_URL}/health"
    else
      warn "No response from ${NORMALIZED_URL}/health. If this is a web proxy, try a base URL ending in /api."
    fi
    if curl -fsS "${NORMALIZED_URL}/v1/mobile/widget-items?userId=local-owner&limit=1" >/dev/null 2>&1; then
      ok "Widget endpoint responded at ${NORMALIZED_URL}/v1/mobile/widget-items"
    else
      warn "No response from ${NORMALIZED_URL}/v1/mobile/widget-items."
    fi
  fi
else
  warn "No API base URL provided. To check the phone URL, run: scripts/doctor.sh https://your-tailnet-host/api"
fi

printf "\n"
if [[ "${FAILURES}" -gt 0 ]]; then
  fail "Doctor found ${FAILURES} blocking issue(s) for command-line build/install."
  exit 1
fi

ok "No blocking command-line issues found."
