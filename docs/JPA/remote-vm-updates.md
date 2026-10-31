# Updating the remote VMs

Every remote connection on this PC is a Hyper-V VM on this PC. After each fork release
(step 5 of [the version bump](../operations/version-bump-fork.md)), upgrade them all with
one script from the host:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\jpa\update-remote-vms.ps1
```

It defaults to the version in `apps/desktop/package.json`; pass `-Version <x.y.z>` for
another. It stops early if that release is not on the fork yet, then prints one summary
line per VM and exits non-zero if any VM failed. Run it from the host, not through a T3
remote: it reaches the VMs without their T3 servers, so it works when they are down or
incompatible.

## The VMs

| Hyper-V name           | Hostname / tailnet | OS      | Reached by                                   | Server                                     |
| ---------------------- | ------------------ | ------- | -------------------------------------------- | ------------------------------------------ |
| `VM-Web-Dev`           | `vm-web-dev`       | Linux   | SSH to `web-dev.mshome.net`, user `web-dev`  | Started by the desktop app over SSH        |
| `VM-Windows-Sandbox`   | `vm-win-1`         | Windows | PowerShell Direct (`Invoke-Command -VMName`) | Scheduled task `T3 Code server`, port 3773 |
| `VM-Windows-Sandbox-2` | `vm-win-2`         | Windows | PowerShell Direct                            | Scheduled task `T3 Code server`, port 3773 |

What the script does to each:

- **Linux (`web-dev`):** downloads and verifies the Linux archive into
  `~/.t3/runtime/versions/<version>` with the same layout and `.install-complete` marker the
  desktop's SSH provisioning uses. It does not restart anything: the desktop launches this
  server pinned to its own version, so it switches to the staged runtime on its next
  connect (toggle the environment in Settings → Connections, or restart the app).
- **Windows:** copies this checkout's `scripts/install.ps1` into the VM and runs it with
  `T3CODE_RELEASE_BASE_URL` pointing at the fork and `T3CODE_VERSION` set, which unpacks the
  release and repoints `C:\Users\Admin\.local\bin\t3.cmd`. The task runs that shim, so it
  then stops the task, ends any leftover process running from `.t3\runtime\versions`
  (stopping the task ends `cmd.exe`, not always `t3.exe`), starts the task again, and waits
  until the new `t3.exe` listens on 3773. A VM already serving the version is left alone;
  `-ForceRestart` restarts it anyway.

Restarting a Windows server ends any agent turn running on it. Check the VM is idle first if
that matters.

## One-time host setup

Already done on this PC. Redo it only if it is lost.

1. **Hyper-V Administrators.** In an elevated PowerShell:
   `Add-LocalGroupMember -Group "Hyper-V Administrators" -Member "$env:USERDOMAIN\$env:USERNAME"`,
   then sign out of Windows and back in. Until a fresh sign-in, `Get-VM` fails with "You do
   not have the required permission", even though the group lists the account.
2. **Windows VM login.** Both Windows VMs use the local account `Admin`. The password is
   kept out of this public repository; ask the user if it is not at hand. Save it once,
   encrypted to this Windows account (DPAPI), where the script reads it:

   ```powershell
   New-Item -ItemType Directory -Force "$env:USERPROFILE\.t3-vms" | Out-Null
   Get-Credential -UserName Admin | Export-Clixml "$env:USERPROFILE\.t3-vms\win-admin.clixml"
   ```

   An agent without a prompt can build the credential with
   `New-Object PSCredential("Admin", (ConvertTo-SecureString "<password>" -AsPlainText -Force))`
   instead of `Get-Credential`.

3. **SSH key for web-dev.** `~/.ssh/web-dev_ed25519` is authorized on the VM, and
   `~/.ssh/config` maps `web-dev.mshome.net` to user `web-dev` with that key. Check with
   `ssh -o BatchMode=yes web-dev.mshome.net hostname`. `vm-web-dev` (the tailnet name) does
   not match that config entry and asks for a password.

## When it fails

- **`SKIPPED: VM is not running`:** start it in Hyper-V Manager, or with `Start-VM <name>`,
  wait for it to boot, and rerun.
- **`server did not come back on port 3773`:** the task's logon type is Interactive, so it
  only runs while `Admin` has a session on the VM. A disconnected session counts; a
  signed-out one does not. Sign in on the VM console and rerun.
- **`install.ps1 failed`:** usually the release is missing its Windows zip. Check the
  release assets.
- **An SSH error:** confirm the key check from step 3. The VM's `mshome.net` address
  changes between host reboots; the name follows it.
