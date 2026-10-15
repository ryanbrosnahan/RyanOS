#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p bin
swiftc -O -module-cache-path "${TMPDIR:-/tmp}/ryanos-swift-module-cache" keychain.swift -o bin/ryanos-task-keychain
# Pure in-memory test. Does not call Keychain or generate a credential.
bin/ryanos-task-keychain self-test
