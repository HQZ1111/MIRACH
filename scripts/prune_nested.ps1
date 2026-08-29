# prune_nested.ps1 - remove circular-dep nesting under @deepseek-ai (param: engine root)
param([string]$EngineRoot = ".")
$ErrorActionPreference = "Continue"
Set-Location $EngineRoot

function Prune-Nested([string]$base) {
  $pkgsDir = Join-Path $base "@deepseek-ai"
  if (-not (Test-Path $pkgsDir)) { return }
  Get-ChildItem $pkgsDir -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $inner = Join-Path $_.FullName "node_modules"
    if (Test-Path $inner) {
      $empty = Join-Path $env:TEMP ("e" + [guid]::NewGuid().ToString("N"))
      New-Item -ItemType Directory -Path $empty -Force | Out-Null
      robocopy $empty $inner /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
      Remove-Item $empty -Force -ErrorAction SilentlyContinue
      Remove-Item $inner -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

Get-ChildItem . -Directory | Where-Object { Test-Path (Join-Path $_.FullName "node_modules") } | ForEach-Object {
  Prune-Nested (Join-Path $_.FullName "node_modules")
}
Prune-Nested (Join-Path (Get-Location).Path "node_modules")
Write-Output "pruned"
$s = (Get-ChildItem node_modules -Recurse -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum / 1MB
Write-Output ("node_modules now: {0:N0} MB" -f $s)