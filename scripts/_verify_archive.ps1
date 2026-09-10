# _verify_archive.ps1 - extract the shipped runtime archive and boot-test the engine from it
$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent $PSScriptRoot
$archive = Join-Path $repo "src-tauri\resources\mirach-runtime.7z"
$sevenZip = Join-Path $repo "src-tauri\resources\7z.exe"
$dest = Join-Path $env:TEMP "_rt_verify"

Remove-Item $dest -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $dest | Out-Null
$sw = [System.Diagnostics.Stopwatch]::StartNew()
& $sevenZip x $archive "-o$dest" -y | Out-Null
$sw.Stop()
Write-Output ("extracted in " + [math]::Round($sw.Elapsed.TotalSeconds, 1) + " s (exit=" + $LASTEXITCODE + ")")
Write-Output ("node.exe     : " + (Test-Path (Join-Path $dest "node\node.exe")))
Write-Output ("engine bin   : " + (Test-Path (Join-Path $dest "agent-sidecar\node_modules\@deepseek-ai\dsh\lib\bin.js")))
Write-Output ("sharp wasm   : " + (Test-Path (Join-Path $dest "agent-sidecar\node_modules\@img")))
$img = Get-ChildItem (Join-Path $dest "agent-sidecar\node_modules\@img") -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name
Write-Output ("@img dirs    : " + ($img -join ", "))
$size = [math]::Round(((Get-ChildItem $dest -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum / 1MB), 1)
Write-Output ("extracted    : " + $size + " MB")
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "_boot_verdict.ps1") -Root $dest -Label "archive"
