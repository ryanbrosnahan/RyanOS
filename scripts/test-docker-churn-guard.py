#!/usr/bin/env python3
"""Exercise the guard's real detection block without any production side effects."""

import os
from pathlib import Path
import subprocess
import unittest


GUARD = Path(__file__).with_name("docker-churn-guard.sh").read_text()
# Stop before evidence collection or service actions; only detection is executed.
DETECTION = GUARD[GUARD.index('recent="$('):GUARD.index('timestamp="$(')]
SATURATION = "dbus-daemon: The maximum number of pending replies has been reached\n"
VETH = "NetworkManager: manager: (veth123): new Veth device\n"
JOIN = "dockerd: sbJoin: endpoint\n"
FAILURE = "dockerd: session healthcheck failed fatally\n"
KERNEL_VETH = "kernel: device veth123 entered promiscuous mode\n"


def detect(previous="", current="", detection=DETECTION):
    # Model a recent reboot: both boots' entries are inside the two-minute window.
    # The journal stub honors the boot filter passed by the production code.
    harness = r'''
set -euo pipefail
window='2 minutes ago'
journalctl() {
  local current_boot=0 saw_window=0
  while (( $# )); do
    case "$1" in
      --boot=0) current_boot=1 ;;
      --since)
        shift
        [[ "$1" == '2 minutes ago' ]] || exit 91
        saw_window=1
        ;;
    esac
    shift
  done
  (( saw_window )) || exit 92
  if (( ! current_boot )); then printf '%s' "$PREVIOUS_EVENTS"; fi
  printf '%s' "$CURRENT_EVENTS"
}
'''
    result = subprocess.run(
        ["bash", "-c", harness + detection + "\nprintf '%s' \"$reason\"\n"],
        env={**os.environ, "PREVIOUS_EVENTS": previous, "CURRENT_EVENTS": current},
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout


class GuardBootScopeTests(unittest.TestCase):
    def test_previous_boot_saturation_does_not_trip(self):
        self.assertEqual(detect(previous=SATURATION), "")

    def test_regression_fixture_reproduces_original_bug(self):
        original = DETECTION.replace("journalctl --boot=0 ", "journalctl ")
        self.assertEqual(
            detect(previous=SATURATION, detection=original),
            "D-Bus/NetworkManager pending-reply saturation",
        )

    def test_current_boot_saturation_still_trips(self):
        self.assertEqual(
            detect(current=SATURATION), "D-Bus/NetworkManager pending-reply saturation"
        )

    def test_previous_boot_churn_does_not_trip(self):
        self.assertEqual(detect(previous=VETH * 18 + JOIN * 10 + FAILURE * 2 + KERNEL_VETH * 25), "")

    def test_current_boot_networkmanager_churn_still_trips(self):
        self.assertEqual(
            detect(current=VETH * 18 + FAILURE),
            "BuildKit session failure plus high NetworkManager veth churn",
        )

    def test_current_boot_bridge_churn_still_trips(self):
        self.assertEqual(
            detect(current=JOIN * 10 + FAILURE * 2),
            "BuildKit session failures plus high Docker bridge churn",
        )

    def test_current_boot_kernel_churn_still_trips(self):
        self.assertEqual(detect(current=KERNEL_VETH * 25), "extreme Docker veth churn")

    def test_counts_are_not_combined_across_boots(self):
        self.assertEqual(detect(previous=KERNEL_VETH * 24, current=KERNEL_VETH), "")

    def test_below_threshold_churn_does_not_trip(self):
        self.assertEqual(detect(current=VETH * 17 + JOIN * 9 + FAILURE + KERNEL_VETH * 24), "")

    def test_quiet_boot_does_not_trip(self):
        self.assertEqual(detect(), "")


if __name__ == "__main__":
    unittest.main()
