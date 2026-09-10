# _prep_fresh_install_test.ps1 - clean first-run environment:
#   uninstall the old app -> clear the runtime + test state -> hide the repo sidecar
#   (so the first-run gate triggers) -> silently install the new setup exe.
$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent $PSScriptRoot
$setup = Join-Path $repo "src-tauri\target\release\bundle\nsis\Mirach_0.1.2_x64-setup.exe"
$appDir = Join-Path $env:LOCALAPPDATA "Mirach"
$runtime = Join-Path $env:LOCALAPPDATA "MirachRuntime"

Get-Process mirach -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

if (Test-Path (Join-Path $appDir "uninstall.exe")) {
  Start-Process -FilePath (Join-Path $appDir "uninstall.exe") -ArgumentList "/S" -Wait
  Start-Sleep -Seconds 5
}
"old app removed: " + (-not (Test-Path (Join-Path $appDir "Mirach.exe")))

Remove-Item $runtime -Recurse -Force -ErrorAction SilentlyContinue
"runtime cleared: " + (-not (Test-Path $runtime))

$dist = Join-Path $repo "agent-sidecar\dist"
$bak = Join-Path $repo "agent-sidecar\_dist.bak"
if (Test-Path $dist) { Move-Item $dist $bak -Force }
"repo sidecar hidden: " + (-not (Test-Path (Join-Path $dist "index.js")))

Start-Process -FilePath $setup -ArgumentList "/S" -Wait
Start-Sleep -Seconds 6
"installed: " + (Test-Path (Join-Path $appDir "Mirach.exe"))
"exe-adjacent runtime (must be False): " + (Test-Path (Join-Path $appDir "runtime"))
"resources: " + (Test-Path (Join-Path $appDir "_up_\scripts\mirach-install.ps1"))
"bundled runtime: " + (Test-Path (Join-Path $appDir "resources\mirach-runtime.7z"))
