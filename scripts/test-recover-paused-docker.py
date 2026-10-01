#!/usr/bin/env python3
"""Test recovery ordering and fail-closed behavior using mocked host commands."""
import os
from pathlib import Path
import subprocess
import unittest


SOURCE = Path(__file__).with_name("recover-paused-docker.sh").read_text()
# Exercise the real functions, exit trap, and recovery sequence. Privileged
# installation/state prerequisites are excluded; no host commands are executed.
LOGIC = SOURCE[SOURCE.index("restart_networkmanager=0"):SOURCE.index("if (( EUID")]
LOGIC += SOURCE[SOURCE.index("resumed=0"):SOURCE.index("expected_guard=")]
LOGIC += SOURCE[SOURCE.index("# Epoch timestamps"):]
STUBS = r'''
set -Eeuo pipefail
systemctl() {
  printf 'systemctl %s\n' "$*"
  if [[ "$SCENARIO" == restart_failure && "$1" == restart ]]; then return 1; fi
}
timeout() { if [[ "$1" == --kill-after=* ]]; then shift; fi; shift; "$@"; }
sleep() { :; }
nm-online() { :; }
nmcli() {
  if [[ "$SCENARIO" == post_network_failure && "$resumed" == 1 ]]; then return 1; fi
  echo connected
}
journalctl() {
  local since=''
  while (( $# )); do
    if [[ "$1" == --since ]]; then shift; since="$1"; fi
    shift
  done
  # Reproduce the older journalctl parser: ISO T/offset timestamps are invalid.
  if [[ "$since" != '2 minutes ago' && ! "$since" =~ ^@[0-9]+$ ]]; then
    echo 'Invalid journal timestamp' >&2
    return 1
  fi
  if [[ "$SCENARIO" == journal_failure ]]; then return 1; fi
  if [[ "$SCENARIO" == pre_saturation || ( "$SCENARIO" == post_saturation && "$resumed" == 1 ) ]]; then
    echo 'The maximum number of pending replies has been reached'
  fi
}
docker() {
  if [[ "$SCENARIO" == docker_failure && "$1" == info ]]; then return 1; fi
  if [[ "$SCENARIO" == restart_loop && "$*" == *status=restarting* ]]; then
    echo restarting-test-container
  fi
}
curl() {
  if [[ "$SCENARIO" == health_failure ]]; then return 22; fi
  if [[ "$SCENARIO" == unhealthy_json ]]; then
    echo '{"status":"error"}'
  else
    echo '{"status":"ok"}'
  fi
}
'''


def run_recovery(scenario, *args):
    return subprocess.run(
        ["bash", "-c", STUBS + LOGIC, "recovery-test", *args],
        env={**os.environ, "SCENARIO": scenario},
        capture_output=True,
        text=True,
    )


class RecoveryTests(unittest.TestCase):
    def test_healthy_recovery_resumes_without_resetting_guard(self):
        result = run_recovery("healthy")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("--signal=SIGCONT", result.stdout)
        self.assertNotIn("--signal=SIGSTOP", result.stdout)
        self.assertIn("Recovery checks passed.", result.stdout)
        self.assertNotIn("docker-churn-guard-reset", LOGIC)
        self.assertNotIn("systemctl restart", result.stdout)

    def test_approved_restart_precedes_resume(self):
        result = run_recovery("healthy", "--restart-networkmanager")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertLess(result.stdout.index("systemctl restart NetworkManager.service"),
                        result.stdout.index("--signal=SIGCONT"))
        self.assertNotIn("restart tailscaled", result.stdout)

    def test_restart_failure_does_not_resume(self):
        result = run_recovery("restart_failure", "--restart-networkmanager")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("--signal=SIGCONT", result.stdout)

    def test_restarted_network_still_requires_clean_observation(self):
        result = run_recovery("pre_saturation", "--restart-networkmanager")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("--signal=SIGCONT", result.stdout)

    def test_unknown_options_do_not_touch_services(self):
        result = run_recovery("healthy", "--reset")
        self.assertEqual(result.returncode, 2)
        self.assertNotIn("systemctl", result.stdout)

    def test_precheck_failures_do_not_resume(self):
        for scenario in ("pre_saturation", "journal_failure"):
            with self.subTest(scenario=scenario):
                result = run_recovery(scenario)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn("--signal=SIGCONT", result.stdout)
                self.assertIn("Precheck failed", result.stderr)

    def test_post_resume_failures_pause_again(self):
        for scenario in ("post_saturation", "post_network_failure", "docker_failure",
                         "health_failure", "unhealthy_json", "restart_loop"):
            with self.subTest(scenario=scenario):
                result = run_recovery(scenario)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("--signal=SIGCONT", result.stdout)
                self.assertIn("--signal=SIGSTOP", result.stdout)
                self.assertIn("Validation failed", result.stderr)


if __name__ == "__main__":
    unittest.main()
