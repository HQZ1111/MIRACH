# _run_bootstrap_stages.ps1 - drive the four install stages exactly like the Rust driver does
param([string]$Root = "$env:LOCALAPPDATA\mirach\runtime")
$ErrorActionPreference = "Continue"
$script = Join-Path (Split-Path -Parent $PSScriptRoot) "scripts\mirach-install.ps1"
$sidecar = Join-Path (Split-Path -Parent $PSScriptRoot) "agent-sidecar"
foreach ($stage in @("node", "deps", "sidecar", "marker")) {
  Write-Output "===== STAGE $stage ====="
  & powershell -NoProfile -ExecutionPolicy Bypass -File $script -Stage $stage -NonInteractive -Json -Root $Root -SidecarSrc $sidecar -SdkVersion "0.1.5-alpha.1"
  Write-Output "exit=$LASTEXITCODE"
}
Write-Output "===== CHECK ====="
& powershell -NoProfile -ExecutionPolicy Bypass -File $script -Check -Root $Root
Write-Output "done"
