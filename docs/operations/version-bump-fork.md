# Bumping the version on this fork

This fork (`joelachankeng/JPA-T3Code`) cuts its releases by hand on the Windows
host. The workflow in [release.md](./release.md) does not apply: its
`publish_cli` job publishes to upstream's npm scope and the GitHub Release job
depends on it, so dispatching it from the fork publishes nothing.

A version bump has five parts, in this order: bump the version, build the
desktop installer, build the CLI archives, publish the GitHub release, then
upgrade the remotes. Do not stop after the installer.

## Why the release is not optional

The desktop app installs the server on every SSH remote itself, and pins it to
its own version: `apps/desktop/src/main.ts` passes `archiveVersion:
environment.appVersion`, and the remote script in `packages/ssh/src/tunnel.ts`
only accepts a runtime in `~/.t3/runtime/versions/<that version>`. An older
runtime already on the remote is ignored.

So once the desktop app is on a new version, every SSH remote fails until the
fork has a release with that exact tag:

```
Could not prepare the SSH environment: ... SshCommandError: curl: (22) The requested URL returned error: 404
```

Remotes reached over HTTP or T3 Connect run a server someone started by hand.
They keep their own version and keep working as long as
`ORCHESTRATION_PROTOCOL_VERSION` in `packages/contracts/src/environment.ts` is
unchanged.

The download origin comes from `T3CODE_RELEASE_BASE_URL` on the **host**, set
once at User scope to
`https://github.com/joelachankeng/JPA-T3Code/releases/download`. Nothing is set
on an SSH remote.

## Rules for whoever runs this

These three have gone wrong on more than one release.

1. **Never run `nvm`.** From a non-interactive shell, nvm-windows shows a modal
   dialog on the desktop and returns nothing. List installed versions with
   `Get-ChildItem "$env:APPDATA\nvm" -Directory` instead.
2. **Publish with `gh` inside WSL.** There is no `gh` on Windows. WSL has it at
   `~/.local/bin/gh`, already signed in with `repo` scope, so no token is ever
   handled.
3. **Give every build a timeout of about five minutes and read its output.** A
   failed build and a silent one look the same from outside. Confirm the success
   line named in each step below; do not trust a quiet process or an exit code
   alone.

## 1. Bump the version

The version lives in four files, changed together in one
`chore(release): <version>` commit:

- `apps/desktop/package.json`
- `apps/server/package.json`
- `apps/web/package.json`
- `packages/contracts/package.json`

Commit and push to `origin/main` before building. The release tag points at
this commit.

## 2. Shell setup for the builds

The Windows single-executable build is a cross-target build (`--target win-x64`):
it needs a Node 25.7 or newer host and downloads the exact Node from the root
`package.json` `engines` (26.12.1 for 0.0.49) to embed. nvm on the host stops at
24.x, so download a standalone build into a scratch directory instead of
installing it:

```powershell
$dir = "$env:LOCALAPPDATA\Temp\t3-build-node25"
New-Item -ItemType Directory -Force $dir | Out-Null
curl.exe -fsSL "https://nodejs.org/dist/v25.9.0/node-v25.9.0-win-x64.zip" -o "$dir\node.zip"
curl.exe -fsSL "https://nodejs.org/dist/v25.9.0/SHASUMS256.txt" -o "$dir\SHASUMS256.txt"
# Compare (Get-FileHash "$dir\node.zip").Hash with the line for node-v25.9.0-win-x64.zip.
Expand-Archive "$dir\node.zip" $dir -Force
```

Every build shell then needs that Node and the repository's `vp` on `PATH`.
Without the second entry, anything that spawns `vp` dies with `spawn vp ENOENT`,
in PowerShell as well as Git Bash.

```powershell
$env:PATH = "$env:LOCALAPPDATA\Temp\t3-build-node25\node-v25.9.0-win-x64;C:\Repo\JPA\JPA-T3Code\node_modules\.bin;$env:PATH"
```

## 3. Build the desktop installer

```powershell
node scripts/build-desktop-artifact.ts --platform win --target nsis --arch x64
```

The installer lands in `release\T3-Code-<version>-x64.exe`. This build also
refreshes `apps/server/dist` and `apps/server/dist/client`, which the CLI
archives reuse.

Quit T3 Code completely before running the installer. If the app is open, the
installer can finish without replacing the locked executable. Afterwards check
the installed version rather than assuming:

```powershell
(Get-Item "$env:LOCALAPPDATA\Programs\t3code\T3 Code (JPA).exe").VersionInfo.ProductVersion
```

## 4. Build the CLI archives

Build one target, archive it, then build the next. `vp pack` empties
`apps/server/dist-exe` on every run, so building both targets first loses the
first one.

The resource monitor is a Rust binary that rarely changes. If `git log` shows no
commits under `native/resource-monitor/` since the last release, reuse the
previous binaries:

- **Windows:** `%LOCALAPPDATA%\Programs\t3code\resources\resource-monitor`,
  which holds `t3-resource-monitor.exe` directly.
- **Linux:** extract `resource-monitor/` from the previous
  `t3-<old>-linux-x64.tar.gz`. The directory passed to the script must contain
  `linux-x64/t3-resource-monitor`.

### Windows archive, from PowerShell

Target names follow nodejs.org (`win-x64`), although the archive file is named
`win32-x64`.

```powershell
cd apps\server; node scripts/cli.ts build-exe --target win-x64; cd ..\..
node scripts/build-cli-archive.ts --platform win --arch x64 --version <version> `
  --resource-monitor-dir "$env:LOCALAPPDATA\Programs\t3code\resources\resource-monitor"
```

Success line: `Wrote release-cli\t3-<version>-win32-x64.zip`. The message
`Windows signing disabled (missing Azure Trusted Signing)` is expected.

### Linux archive, inside WSL

Build the Linux archive on Linux, in WSL (Ubuntu 22.04). Since 0.0.49 the
archive step bundles `libatomic.so.1` with `ldd`, `dpkg-query` and `patchelf`,
which do not exist in Git Bash. Building natively also gives the archive real
executable bits, which NTFS cannot store.

WSL holds a clone of this repository at `~/t3-build` (its `origin` is
`/mnt/c/Repo/JPA/JPA-T3Code`) and the tools in `~/t3-tools`:

- `node-v26.12.1-linux-x64/`: the exact Node from the root `package.json`
  `engines`, which a native `build-exe` requires. Download it from nodejs.org
  and check it against `SHASUMS256.txt` when `engines` changes.
- `patchelf/`: unpacked without sudo (sudo in WSL asks for a password) by
  `apt-get download patchelf && dpkg -x patchelf_*.deb patchelf`.

Run each step as a script file through `wsl.exe -- bash -l <script>` rather than
inline, because PowerShell mangles quoting in a nested `bash -c`.

```sh
export PATH="$HOME/t3-tools/node-v26.12.1-linux-x64/bin:$HOME/t3-tools/patchelf/usr/bin:$HOME/t3-build/node_modules/.bin:$PATH"
cd ~/t3-build
git fetch origin && git checkout --detach <release commit sha>
npx -y pnpm@<packageManager version> install --frozen-lockfile   # once per release
# Reuse the server bundle and client the desktop build just made on Windows.
rm -rf apps/server/dist && cp -r /mnt/c/Repo/JPA/JPA-T3Code/apps/server/dist apps/server/dist
find apps/server/dist -type d -exec chmod 755 {} + && find apps/server/dist -type f -exec chmod 644 {} +
(cd apps/server && node scripts/cli.ts build-exe)
node scripts/build-cli-archive.ts --platform linux --arch x64 --version <version> \
  --resource-monitor-dir <dir containing linux-x64/t3-resource-monitor>
cp release-cli/t3-<version>-linux-x64.tar.gz /mnt/c/Repo/JPA/JPA-T3Code/release-cli/
```

Success lines: `Bundled /lib/x86_64-linux-gnu/libatomic.so.1 as lib/libatomic.so.1`
and `Wrote release-cli/t3-<version>-linux-x64.tar.gz`. The `chmod` matters: files
copied from `/mnt/c` all read as executable, and without it every client asset
ships as mode 777.

Check the archive before publishing. `t3` and the resource monitor must be
`-rwxr-xr-x`, `lib/libatomic.so.1` must be present, and the extracted `t3` must
print the new version:

```sh
tar -tvzf release-cli/t3-<version>-linux-x64.tar.gz | grep -E "/t3$|t3-resource-monitor$|libatomic"
tar -tvzf release-cli/t3-<version>-linux-x64.tar.gz | grep "^-rwx" | awk '{print $NF}'
```

For 0.0.49 the executable entries were `t3`, the resource monitor, `rg` and
`cursorsandbox` under `@cursor/sdk-linux-x64/bin`, and playwright-core's scripts.
Native `.node` files are 644, as a Linux install leaves them; they are loaded,
not executed.

### Checksums

Write `SHA256SUMS` only after the archives are final, in text-mode format (two
spaces, no asterisk):

```sh
cd release-cli
sha256sum t3-<version>-linux-x64.tar.gz t3-<version>-win32-x64.zip | sed 's/ \*/  /' > SHA256SUMS
sha256sum -c SHA256SUMS
```

## 5. Publish the release

Put the notes in a file. Backticks inside a nested `bash -lc '...'` string are
run as commands and blank out the arguments around them, which once produced an
untagged draft with one asset.

```sh
wsl.exe -- bash -lc 'cd /mnt/c/Repo/JPA/JPA-T3Code/release-cli && gh release create v<version> --repo joelachankeng/JPA-T3Code --target <full commit sha> --title "v<version> (fork build)" --notes-file /mnt/c/path/to/notes.md t3-<version>-linux-x64.tar.gz t3-<version>-win32-x64.zip SHA256SUMS'
```

Then fetch the URL the remotes use and confirm it returns the checksums:

```sh
curl -fsSL https://github.com/joelachankeng/JPA-T3Code/releases/download/v<version>/SHA256SUMS
```

## 6. Upgrade the remotes

This PC's remotes are all local Hyper-V VMs. Upgrade them with the script in
[remote-vm-updates.md](../JPA/remote-vm-updates.md), which does the steps below
for each one. The rest of this section is what it does, and how to upgrade a
remote that is not one of those VMs.

**SSH remotes** need no manual step. Turn the environment off and on in
Settings → Connections, or restart the desktop app. It downloads the new
archive and starts it.

**A remote running `t3 serve` by hand** is upgraded on that machine. On
Windows:

```powershell
$env:T3CODE_RELEASE_BASE_URL = "https://github.com/joelachankeng/JPA-T3Code/releases/download"
$env:T3CODE_VERSION = "<version>"
irm https://raw.githubusercontent.com/joelachankeng/JPA-T3Code/main/scripts/install.ps1 | iex
```

Then stop the running server and start it again; the installer only unpacks the
new version and repoints the `t3` command.

Always set `T3CODE_VERSION`. Do not use the update button in the app or
`t3 update` on a fork environment. Version lookup is hardcoded to upstream in
`packages/shared/src/cliRelease.ts` and the install scripts, so both find an
upstream version and then try to download it from the fork.

Finish by checking that each environment in Settings → Connections is connected
and shows the version you expect.

## What the fork does not build

There is no macOS archive and no arm64 archive. An SSH remote on either fails
with the same 404 until one is built. SSH provisioning supports Linux and macOS
only; a Windows remote always needs the manual install above.
