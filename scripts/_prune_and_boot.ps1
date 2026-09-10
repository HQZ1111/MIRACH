# _prune_and_boot.ps1 - sync pristine -> work, prune the given categories, boot-test, report
param(
  [Parameter(Mandatory = $true)][string]$Categories,
  [string]$Label = "test",
  [switch]$SkipSync
)
$ErrorActionPreference = "Continue"
$work = Join-Path $env:TEMP "_rt_bisect"
$pristine = Join-Path $env:TEMP "_rt_unpruned"

if (-not $SkipSync) {
  Write-Output ("sync pristine -> work (318 MB)")
  robocopy $pristine $work /MIR /NFL /NDL /NJH /NJS /NP /MT:8 | Out-Null
  Write-Output ("robocopy rc=" + $LASTEXITCODE)
}
& node (Join-Path $PSScriptRoot "_prune_apply.mjs") "--root=$work" ("--categories=" + $Categories)
$size = [math]::Round(((Get-ChildItem $work -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum / 1MB), 1)
Write-Output ("size: " + $size + " MB")
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "_boot_verdict.ps1") -Label $Label
