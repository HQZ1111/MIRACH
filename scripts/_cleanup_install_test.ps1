# _cleanup_install_test.ps1 - test teardown: uninstall the test install, keep the runtime,
# restore the repo sidecar, remove the scratch dir, clear the dev-only NODE_22_BIN override.
$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent $PSScriptRoot
Get-Process mirach -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

$bak = Join-Path $repo "agent-sidecar\_dist.bak"
$dist = Join-Path $repo "agent-sidecar\dist"
if (Test-Path $bak) { Move-Item $bak $dist -Force }
"repo dist restored: " + (Test-Path (Join-Path $dist "index.js"))

$appDir = Join-Path $env:LOCALAPPDATA "Mirach"
if (Test-Path (Join-Path $appDir "uninstall.exe")) {
  Start-Process -FilePath (Join-Path $appDir "uninstall.exe") -ArgumentList "/S" -Wait
  Start-Sleep -Seconds 5
}
"app uninstalled: " + (-not (Test-Path (Join-Path $appDir "Mirach.exe")))
"runtime kept: " + (Test-Path (Join-Path $env:LOCALAPPDATA "MirachRuntime\.mirach-bootstrap-complete"))
Remove-Item "G:\_setup-test" -Recurse -Force -ErrorAction SilentlyContinue
"test dir removed: " + (-not (Test-Path "G:\_setup-test"))
[Environment]::SetEnvironmentVariable("NODE_22_BIN", $null, "User")
"user NODE_22_BIN cleared"
