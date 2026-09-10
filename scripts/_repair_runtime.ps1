# _repair_runtime.ps1 - rebuild the installed runtime from the shipped archive (fixes the @img prune damage)
$rt = Join-Path $env:LOCALAPPDATA "MirachRuntime"
$repo = Split-Path -Parent $PSScriptRoot
$archive = Join-Path $repo "src-tauri\resources\mirach-runtime.7z"
$sevenZip = Join-Path $repo "src-tauri\resources\7z.exe"

Get-ChildItem $rt -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne ".mirach-runtime-from-bundle" } |
  ForEach-Object { Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
Write-Output ("cleared: " + (-not (Test-Path (Join-Path $rt "agent-sidecar"))))
& $sevenZip x $archive "-o$rt" -y | Out-Null
Write-Output ("extract exit=" + $LASTEXITCODE)
Write-Output ("sidecar dist: " + (Test-Path (Join-Path $rt "agent-sidecar\dist\index.js")))
Write-Output ("sharp-wasm32: " + (Test-Path (Join-Path $rt "agent-sidecar\node_modules\@img\sharp-wasm32")))
Write-Output ("engine bin  : " + (Test-Path (Join-Path $rt "agent-sidecar\node_modules\@deepseek-ai\dsh\lib\bin.js")))
