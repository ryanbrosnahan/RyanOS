#!/usr/bin/env python3
"""Exercise sudo dispatch and fail-closed rearming without touching the host."""
import json
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parent
ENTRY = (SCRIPTS / "ryanos-server-admin.sh").read_text()
DISPATCH = (SCRIPTS / "ryanos-server-admin-dispatch.sh").read_text()
GUARD_HASH = "5106a09d6cbb46413a2ec6b73ad53d12991267a659123d37b81d500f75e649ee"

STUB = r'''#!/usr/bin/env python3
import json, os, pathlib, subprocess, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
root = pathlib.Path(os.environ['TEST_ROOT'])
scenario = os.environ.get('SCENARIO', 'healthy')
with (root / 'calls').open('a') as f:
    f.write(json.dumps([name, *args]) + '\n')
if name == 'timeout':
    if args[0].startswith('--kill-after='): args.pop(0)
    args.pop(0)
    sys.exit(subprocess.call(args))
if name == 'systemctl':
    if args[0] == 'show': print('4242')
    if args[0] == 'is-active' and scenario == 'inactive': sys.exit(1)
elif name == 'flock':
    if scenario == 'locked': sys.exit(1)
elif name == 'sha256sum':
    print(('bad' if scenario == 'guard_changed' else os.environ['GUARD_HASH']) + ' guard')
elif name == 'journalctl':
    if scenario == 'journal_failed': sys.exit(1)
    count = sum(json.loads(line)[0] == 'journalctl' for line in (root/'calls').read_text().splitlines())
    if scenario == 'saturation' or (scenario == 'late_saturation' and count > 1):
        print('The maximum number of pending replies has been reached')
elif name in ('nmcli', 'nm-online'):
    if scenario == 'network_failed': sys.exit(1)
elif name == 'docker':
    if scenario == 'docker_failed': sys.exit(1)
    if args[0] == 'ps' and scenario == 'restart_loop': print('looping-container')
elif name == 'curl':
    if scenario == 'curl_failed': sys.exit(22)
    print('invalid' if scenario == 'bad_json' else json.dumps({'status': 'error' if scenario == 'unhealthy' else 'ok'}))
elif name == 'logger':
    if scenario == 'log_failed': sys.exit(1)
elif name == 'systemd-run':
    if scenario == 'unit_busy': sys.exit(1)
'''


class AdminTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        for cmd in ("timeout", "systemctl", "systemd-run", "flock", "sha256sum",
                    "journalctl", "nmcli", "nm-online", "docker", "curl", "logger"):
            path = self.bin / cmd
            path.write_text(STUB)
            path.chmod(0o755)
        (self.root / "run").mkdir()
        (self.root / "proc/4242").mkdir(parents=True)
        self.marker = self.root / "run/docker-churn-guard.tripped"
        self.marker.write_text("test trip")
        (self.root / "proc/4242/status").write_text("Name:\tdockerd\nState:\tS (sleeping)\n")
        # Substitute ONLY the privilege gate, command search path, and host
        # files in a disposable copy. Production has no test-mode switches.
        logic = DISPATCH.replace("(( EUID == 0 )) || exit 1", ":")
        logic = logic.replace("export PATH=/usr/sbin:/usr/bin:/sbin:/bin",
                              "export PATH=" + shlex.quote(str(self.bin) + ":" + os.environ["PATH"]))
        logic = logic.replace("/run/", str(self.root / "run") + "/")
        logic = logic.replace("/proc/", str(self.root / "proc") + "/")
        self.script = self.root / "dispatch.sh"
        self.script.write_text(logic)

    def run_dispatch(self, *args, scenario="healthy"):
        result = subprocess.run(["/bin/bash", str(self.script), *args], text=True,
                                capture_output=True, timeout=20,
                                env={**os.environ, "TEST_ROOT": str(self.root),
                                     "SCENARIO": scenario, "GUARD_HASH": GUARD_HASH})
        calls = self.root / "calls"
        self.calls = [json.loads(line) for line in calls.read_text().splitlines()] if calls.exists() else []
        return result

    def test_rearm_clears_only_after_checks_without_resuming(self):
        result = self.run_dispatch("rearm")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.marker.exists())
        self.assertEqual(sum(c[0] == "journalctl" for c in self.calls), 2)
        self.assertFalse(any(c[0] == "systemctl" and c[1] in ("kill", "start", "restart") for c in self.calls))

    def test_rearm_validation_failures_retain_marker_and_pause(self):
        for scenario in ("inactive", "guard_changed", "journal_failed", "saturation",
                         "late_saturation", "network_failed", "docker_failed", "restart_loop",
                         "curl_failed", "bad_json", "unhealthy", "log_failed"):
            with self.subTest(scenario=scenario):
                (self.root / "calls").write_text("")
                result = self.run_dispatch("rearm", scenario=scenario)
                self.assertNotEqual(result.returncode, 0)
                self.assertTrue(self.marker.exists())
                self.assertIn(["systemctl", "kill", "--kill-who=main", "--signal=SIGSTOP", "docker.service"], self.calls)
                self.assertNotIn("SIGCONT", json.dumps(self.calls))

    def test_paused_docker_cannot_be_rearmed(self):
        (self.root / "proc/4242/status").write_text("State:\tT (stopped)\n")
        result = self.run_dispatch("rearm")
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(self.marker.exists())
        self.assertFalse(any(c[0] == "docker" for c in self.calls))

    def test_no_marker_is_noop(self):
        self.marker.unlink()
        result = self.run_dispatch("rearm")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(all(c[0] == "flock" for c in self.calls))

    def test_concurrent_recovery_prevents_rearm(self):
        result = self.run_dispatch("rearm", scenario="locked")
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(self.marker.exists())
        self.assertTrue(all(c[0] == "flock" for c in self.calls))

    def test_recover_dispatch_is_fixed_and_detached(self):
        for operation in ("recover", "recover-network"):
            with self.subTest(operation=operation):
                (self.root / "calls").write_text("")
                result = self.run_dispatch(operation)
                self.assertEqual(result.returncode, 0, result.stderr)
                call = next(c for c in self.calls if c[0] == "systemd-run")
                self.assertIn("--no-block", call)
                self.assertIn("--property=TimeoutStartSec=10min", call)
                self.assertIn("/usr/local/lib/ryanos-server-admin/recover.sh", call)
                self.assertEqual("--restart-networkmanager" in call, operation == "recover-network")
                self.assertTrue(self.marker.exists())

    def test_failed_dispatch_is_not_reported_as_started(self):
        result = self.run_dispatch("recover", scenario="unit_busy")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("Detached recovery started", result.stdout)

    def test_unknown_and_extra_arguments_do_nothing(self):
        for args in ((), ("shell",), ("status", "extra"), ("recover-network; reboot",)):
            with self.subTest(args=args):
                result = self.run_dispatch(*args)
                self.assertEqual(result.returncode, 2)
                self.assertEqual(self.calls, [])

    def test_entry_cleans_environment_and_working_directory(self):
        sink = self.root / "sink.sh"
        sink.write_text('printf "%s\\n" "$PWD" "$HOME" "${DOCKER_HOST-unset}" "${PYTHONPATH-unset}" "${BASH_ENV-unset}" "$#" "$1"\n')
        entry = ENTRY.replace("(( EUID == 0 ))", "true")
        entry = entry.replace("/usr/local/lib/ryanos-server-admin/dispatch.sh", shlex.quote(str(sink)))
        path = self.root / "entry.sh"
        path.write_text(entry)
        startup = self.root / "evil-startup"
        startup.write_text("echo injected; exit 99\n")
        result = subprocess.run(["/bin/bash", "-p", str(path), "status"], text=True,
                                capture_output=True, cwd=self.root,
                                env={**os.environ, "DOCKER_HOST": "bad", "PYTHONPATH": str(self.root), "BASH_ENV": str(startup)})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.splitlines(), ["/", "/root", "unset", "unset", "unset", "1", "status"])
        for args in ((), ("status", "extra"), ("shell",)):
            result = subprocess.run(["/bin/bash", "-p", str(path), *args], capture_output=True)
            self.assertEqual(result.returncode, 2)


if __name__ == "__main__":
    unittest.main()
