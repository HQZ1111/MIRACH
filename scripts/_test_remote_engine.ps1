# _test_remote_engine.ps1 - remote engine (SSH) integration test (ASCII only)
#
# Mode "fake" (default): uses the fake ssh.exe built from _fake-ssh.cs to take over the
# remote branch without an SSH server - exercises config -> ssh args -> child process ->
# JSONL -> remote sidecar -> engine ready.
# Mode "real": uses the real ssh client against -Host (e.g. 127.0.0.1 with Windows
# OpenSSH Server installed) - additionally exercises the actual SSH transport.
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts\_test_remote_engine.ps1 [-Mode real] [-Host 127.0.0.1]
param(
  [string]$Exe = "src-tauri\target\debug\Mirach.exe",
  [int]$WaitSec = 150,
  [ValidateSet("fake", "real")][string]$Mode = "fake",
  [Alias("Host")][string]$SshHost = "127.0.0.1"
)
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $repo $Exe
if (-not (Test-Path $exe)) { throw "exe not found: $exe (run cargo build first)" }

# 1) build fake ssh (fake mode only); real mode relies on the system ssh client
$binDir = Join-Path $env:TEMP "mirach-fakebin"
if ($Mode -eq "fake") {
  New-Item -ItemType Directory -Path $binDir -Force | Out-Null
  $csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
  if (-not (Test-Path $csc)) { throw "csc.exe not found: $csc" }
  & $csc /nologo /out:"$binDir\ssh.exe" (Join-Path $PSScriptRoot "_fake-ssh.cs") | Out-Null
  if (-not (Test-Path "$binDir\ssh.exe")) { throw "fake ssh build failed" }
  Write-Output "mode=fake, ssh shim: $binDir\ssh.exe"
} else {
  Write-Output "mode=real, host=$SshHost (system ssh client)"
  $probe = & ssh -T -o BatchMode=yes -o ConnectTimeout=8 $SshHost "D:\node.exe --version" 2>&1
  Write-Output ("ssh probe => " + ($probe -join " | "))
}

# 2) backup + rewrite config.json
$cfgDir = Join-Path $env:APPDATA "my-hermes-rs"
$cfgPath = Join-Path $cfgDir "config.json"
New-Item -ItemType Directory -Path $cfgDir -Force | Out-Null
$backup = $null
if (Test-Path $cfgPath) { $backup = Get-Content $cfgPath -Raw }
$cfg = if ($backup) { $backup | ConvertFrom-Json } else { New-Object psobject }
$cfg | Add-Member -Force -NotePropertyName remoteEnabled -NotePropertyValue $true
$cfg | Add-Member -Force -NotePropertyName remoteHost -NotePropertyValue $SshHost
$cfg | Add-Member -Force -NotePropertyName remotePort -NotePropertyValue ""
$cfg | Add-Member -Force -NotePropertyName remoteNode -NotePropertyValue "D:\node.exe"
$cfg | Add-Member -Force -NotePropertyName remoteSidecar -NotePropertyValue (Join-Path $repo "agent-sidecar\dist\index.js")
$cfg | Add-Member -Force -NotePropertyName remoteIdentity -NotePropertyValue ""
$json = $cfg | ConvertTo-Json -Depth 6
# no-BOM UTF-8: PowerShell 5.1 -Encoding UTF8 writes a BOM that serde_json rejects
[System.IO.File]::WriteAllText($cfgPath, $json, (New-Object System.Text.UTF8Encoding $false))
Write-Output "config.json: remoteEnabled=true host=$SshHost"
# 3) prepend fake ssh dir to PATH, launch app
$log = Join-Path $env:TEMP "remote_engine_test.log"
$logErr = Join-Path $env:TEMP "remote_engine_test.err.log"
Remove-Item $log -ErrorAction SilentlyContinue
Remove-Item $logErr -ErrorAction SilentlyContinue
$oldPath = $env:PATH
if ($Mode -eq "fake") { $env:PATH = "$binDir;$env:PATH" }
$p = Start-Process -FilePath $exe -PassThru -RedirectStandardOutput $log -RedirectStandardError $logErr
$env:PATH = $oldPath
Write-Output "launched pid=$($p.Id), waiting up to $WaitSec s"

function Read-All([string]$a, [string]$b) {
  $t = ""
  if (Test-Path $a) { $t += (Get-Content $a -Raw -ErrorAction SilentlyContinue) }
  if (Test-Path $b) { $t += (Get-Content $b -Raw -ErrorAction SilentlyContinue) }
  return $t
}

$ok = $false
for ($i = 0; $i -lt $WaitSec; $i += 5) {
  Start-Sleep -Seconds 5
  $text = Read-All $log $logErr
  if ($text -match "engine prewarmed") { $ok = $true; break }
  if ($text -match "remote sidecar: ssh") { Write-Output "remote branch taken, waiting for engine ($i s)" }
}

$text = Read-All $log $logErr
Write-Output "---- evidence ----"
$text -split "`r?`n" | Where-Object { $_ -match "remote sidecar|fake-ssh|runtime ready|engine prewarmed|dsh runtime|ERROR" } | Select-Object -First 20 | ForEach-Object { $_ }
$verdict = if ($ok) { "PASS" } else { "FAIL" }
Write-Output "---- result: $verdict ----"

# 4) cleanup: kill app, restore config
Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
Get-Process mirach -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
if ($backup) { [System.IO.File]::WriteAllText($cfgPath, $backup, (New-Object System.Text.UTF8Encoding $false)) } else { Remove-Item $cfgPath -ErrorAction SilentlyContinue }
Write-Output "config.json restored"
if (-not $ok) { exit 1 }
