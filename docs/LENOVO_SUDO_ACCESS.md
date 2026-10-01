# Scoped Lenovo administration

RyanOS does not store the sudo password in an environment file. An operator can
install five fixed commands for the existing `ryan` SSH account. Sudo permits
only the exact operation names; it does not permit arbitrary shells, script
paths, arguments, service commands, or changes to this policy.

| Operation | Effect |
| --- | --- |
| `status` | Bounded service, process, network, recent saturation, and application checks. |
| `diagnose` | The existing passive D-Bus metadata diagnostic; private evidence under `/var/tmp`. |
| `recover` | Detached recovery with a clean 60-second network observation before resuming Docker. |
| `recover-network` | Same recovery, including a NetworkManager restart first. |
| `rearm` | Checks networking, logs, running Docker, containers, and application health before clearing the marker. |

**Passwordless execution does not grant standing approval.** Follow
`AGENTS.md` and [the recovery runbook](HOME_SERVER_RECOVERY.md). Obtain explicit
operator approval immediately before `recover-network` or `rearm`. Verify the
external application URL before requesting approval to rearm. No Tailscale
restart, host reboot, or general Docker administration is included.

The entry point starts with a clean environment and `/` as its working
directory. All installed code is root-owned and not writable by `ryan`.
Recovery is detached as `ryanos-admin-recovery.service` and retains the guard
marker. Failed rearm validation retains the marker and pauses Docker again;
it never resumes Docker. A missing marker is a no-op.

## One-time installation

Review and stage these files together in a directory on Lenovo:

- `scripts/install-ryanos-server-admin.sh`
- `scripts/ryanos-server-admin.sh`
- `scripts/ryanos-server-admin-dispatch.sh`
- `scripts/recover-paused-docker.sh`
- `scripts/diagnose-network-flood.sh`

Then run the installer with sudo, entering the password only in the terminal:

```bash
ssh -t lenovo 'sudo /bin/bash /home/ryan/ryanos-admin-setup/install-ryanos-server-admin.sh'
```

The installer checks the hostname, directory ownership, shell syntax, and
sudoers syntax. It refuses an existing installation. It installs root-owned
copies under `/usr/local/lib/ryanos-server-admin`, the entry point at
`/usr/local/sbin/ryanos-server-admin`, and the exact-command policy at
`/etc/sudoers.d/ryanos-server-admin`. It does not restart services, resume
Docker, or reset the guard. Updating installed code requires another
password-authenticated, reviewed installation.

Verify without a password prompt:

```bash
ssh lenovo 'sudo -n /usr/local/sbin/ryanos-server-admin status'
ssh lenovo 'sudo -n -l /usr/local/sbin/ryanos-server-admin status'
```

Other approved operations use the same prefix. Read detached recovery logs
with `journalctl -u ryanos-admin-recovery --since '15 minutes ago' --no-pager`.
The journal records the final outcome after the transient unit is collected.
Never interpret “Detached recovery started” as successful recovery.

## Revoke access

The operator can remove the rule using ordinary password-authenticated sudo:

```bash
sudo rm -- /etc/sudoers.d/ryanos-server-admin
sudo visudo -c
```

The root-owned scripts can remain for manual use. This policy does not narrow
other permissions already held by the `ryan` account, including its existing
sudo and Docker-group memberships. Any process with access to that account
can invoke these five operations, so keep its SSH credentials protected.
