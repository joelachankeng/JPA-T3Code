# Upgrades the T3 Code server on the Hyper-V VMs this PC hosts to one fork
# release. See docs/JPA/remote-vm-updates.md.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\jpa\update-remote-vms.ps1 [-Version 0.0.49] [-ForceRestart]
#
# Needs: the release already published, this account in "Hyper-V
# Administrators" (fresh sign-in after joining), the SSH key for web-dev, and
# the Windows VM login saved by the doc's setup step.
param(
  [string] $Version,
  [string[]] $WindowsVms = @("VM-Windows-Sandbox", "VM-Windows-Sandbox-2"),
  [string] $SshHost = "web-dev.mshome.net",
  [string] $CredentialPath = "$env:USERPROFILE\.t3-vms\win-admin.clixml",
  # Restart the Windows servers even when they already run the target version.
  [switch] $ForceRestart
)
$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$baseUrl = "https://github.com/joelachankeng/JPA-T3Code/releases/download"

if (-not $Version) {
  $Version = (Get-Content (Join-Path $repoRoot "apps\desktop\package.json") -Raw | ConvertFrom-Json).version
}
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Not an exact version: $Version" }
Write-Host "Target version: $Version"

try {
  Invoke-WebRequest -Uri "$baseUrl/v$Version/SHA256SUMS" -UseBasicParsing | Out-Null
} catch {
  throw "Release v$Version is not published on the fork yet. Publish it first (docs/operations/version-bump-fork.md)."
}

$results = [ordered]@{}

# --- Linux VM over SSH -------------------------------------------------------
# The desktop starts this server itself, pinned to its own version, so only
# stage the runtime here; the desktop switches to it on its next connect.
Write-Host "`n=== $SshHost (SSH)"
$stage = @'
set -eu
V="$1"; BASE="$2"
DIR="$HOME/.t3/runtime/versions/$V"
if [ -x "$DIR/t3" ] && [ "$(cat "$DIR/.install-complete" 2>/dev/null)" = "$V" ]; then
  echo "already staged"; "$DIR/t3" --version; exit 0
fi
mkdir -p "$HOME/.t3/runtime/versions"
S="$(mktemp -d "$HOME/.t3/runtime/versions/.staging-XXXXXX")"
trap 'rm -rf "$S"' EXIT
A="t3-$V-linux-x64.tar.gz"
curl -fsSL --connect-timeout 30 "$BASE/v$V/SHA256SUMS" -o "$S/SHA256SUMS"
curl -fsSL --connect-timeout 30 "$BASE/v$V/$A" -o "$S/$A"
E="$(grep " \*\{0,1\}$A$" "$S/SHA256SUMS" | cut -d' ' -f1)"
[ -n "$E" ] && [ "$(sha256sum "$S/$A" | cut -d' ' -f1)" = "$E" ] || { echo "checksum mismatch" >&2; exit 1; }
tar -xzf "$S/$A" -C "$S" --strip-components=1
rm -f "$S/$A" "$S/SHA256SUMS"
"$S/t3" --version
printf '%s\n' "$V" > "$S/.install-complete"
rm -rf "$DIR"; mv "$S" "$DIR"; trap - EXIT
echo "staged"
'@
# Base64 because PowerShell 5.1 prepends a BOM when piping text to a native command.
$encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($stage -replace "`r`n", "`n")))
$ErrorActionPreference = "Continue"
& ssh.exe -o BatchMode=yes -o ConnectTimeout=10 $SshHost "echo $encoded | base64 -d | bash -s -- $Version $baseUrl" 2>&1 |
  ForEach-Object { Write-Host "  $_" }
$ErrorActionPreference = "Stop"
$results[$SshHost] = if ($LASTEXITCODE -eq 0) { "staged $Version (desktop switches on reconnect)" } else { "FAILED" }

# --- Windows VMs over PowerShell Direct --------------------------------------
if (-not (Test-Path $CredentialPath)) {
  throw "Missing $CredentialPath. Create it with the setup step in docs/JPA/remote-vm-updates.md."
}
$cred = Import-Clixml $CredentialPath
$installer = Get-Content (Join-Path $repoRoot "scripts\install.ps1") -Raw

foreach ($vm in $WindowsVms) {
  Write-Host "`n=== $vm (PowerShell Direct)"
  if ((Get-VM -Name $vm).State -ne "Running") {
    $results[$vm] = "SKIPPED: VM is not running"
    Write-Host "  not running"
    continue
  }
  try {
    $report = Invoke-Command -VMName $vm -Credential $cred -ArgumentList $Version, $baseUrl, $installer, $ForceRestart.IsPresent -ScriptBlock {
      param($Version, $BaseUrl, $Installer, $ForceRestart)
      $ErrorActionPreference = "Stop"
      $versions = Join-Path $HOME ".t3\runtime\versions"
      $newExe = Join-Path $versions "$Version\t3.exe"

      $tmp = Join-Path $env:TEMP "t3-install.ps1"
      Set-Content -Path $tmp -Value $Installer -Encoding UTF8
      $env:T3CODE_RELEASE_BASE_URL = $BaseUrl
      $env:T3CODE_VERSION = $Version
      # The installer reports progress on stderr, which "Stop" would turn into a failure.
      $ErrorActionPreference = "Continue"
      $log = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $tmp 2>&1 | ForEach-Object { "$_" }
      $ErrorActionPreference = "Stop"
      if ($LASTEXITCODE -ne 0) { throw "install.ps1 failed: $($log -join ' | ')" }

      $serverProcs = {
        Get-CimInstance Win32_Process | Where-Object {
          $_.ExecutablePath -and $_.ExecutablePath.StartsWith($versions, [StringComparison]::OrdinalIgnoreCase)
        }
      }
      $running = & $serverProcs | Where-Object { $_.Name -eq "t3.exe" }
      if (-not $ForceRestart -and $running -and @($running | Where-Object { $_.ExecutablePath -ne $newExe }).Count -eq 0) {
        return "already serving $Version"
      }

      $task = Get-ScheduledTask -TaskName "T3 Code server"
      Stop-ScheduledTask -InputObject $task
      # Stopping the task ends cmd.exe; the runtime it spawned can outlive it.
      & $serverProcs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
      Start-Sleep -Seconds 2
      Start-ScheduledTask -InputObject $task

      for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Seconds 1
        $up = & $serverProcs | Where-Object { $_.ExecutablePath -eq $newExe }
        $listening = Get-NetTCPConnection -State Listen -LocalPort 3773 -ErrorAction SilentlyContinue
        if ($up -and $listening) { return "serving $Version (pid $($up[0].ProcessId))" }
      }
      $state = (Get-ScheduledTask -TaskName "T3 Code server").State
      throw "server did not come back on port 3773 within 60s (task state: $state; it only runs while Admin is signed in)"
    }
    $results[$vm] = $report
    Write-Host "  $report"
  } catch {
    $results[$vm] = "FAILED: $($_.Exception.Message)"
    Write-Host "  FAILED: $($_.Exception.Message)"
  }
}

Write-Host "`n=== Summary"
$results.GetEnumerator() | ForEach-Object { Write-Host ("  {0,-22} {1}" -f $_.Key, $_.Value) }
if ($results.Values | Where-Object { $_ -match '^FAILED' }) { exit 1 }
