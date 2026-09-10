# _test_bundle_extract.ps1 - verify the bundled runtime archive: extract it the way the
# installer does, then smoke-test node + the dsh engine + the sidecar entry from that copy.
$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent $PSScriptRoot
$archive = Join-Path $repo "src-tauri\resources\mirach-runtime.7z"
$sevenZip = Join-Path $repo "src-tauri\resources\7z.exe"
$dest = Join-Path $env:TEMP ("mirach-extract-test-" + [guid]::NewGuid().ToString("N"))

if (-not (Test-Path $archive)) { throw "archive missing: $archive" }
New-Item -ItemType Directory -Force -Path $dest | Out-Null
$sw = [System.Diagnostics.Stopwatch]::StartNew()
& $sevenZip x $archive "-o$dest" -y -bsp1 | Out-Null
$sw.Stop()
"extract: exit=$LASTEXITCODE, $([math]::Round($sw.Elapsed.TotalSeconds,1)) s"

$node = Join-Path $dest "node\node.exe"
$engine = Join-Path $dest "agent-sidecar\node_modules\@deepseek-ai\dsh\lib\bin.js"
$sidecar = Join-Path $dest "agent-sidecar\dist\index.js"
"node.exe    : " + (Test-Path $node)
"engine bin  : " + (Test-Path $engine)
"sidecar dist: " + (Test-Path $sidecar)
"marker      : " + (Test-Path (Join-Path $dest ".mirach-bootstrap-complete"))

if (Test-Path $node) { "node version: " + (& $node --version) }
if (Test-Path $engine) {
  $out = & $node $engine --help 2>&1 | Select-Object -First 6
  "engine --help: " + ($out -join " / ")
}
# sidecar boot smoke test: give it 12s and see whether it stays alive / logs anything
if (Test-Path $sidecar) {
  $p = Start-Process -FilePath $node -ArgumentList $sidecar -PassThru -NoNewWindow `
    -RedirectStandardOutput (Join-Path $dest "sc-out.txt") -RedirectStandardError (Join-Path $dest "sc-err.txt")
  Start-Sleep -Seconds 12
  $alive = -not $p.HasExited
  if ($alive) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
  "sidecar alive after 12s: $alive"
  "sidecar stderr (first 3):"
  Get-Content (Join-Path $dest "sc-err.txt") -ErrorAction SilentlyContinue | Select-Object -First 3 | ForEach-Object { "  $_" }
}
"SIZE: " + [math]::Round(((Get-ChildItem $dest -Recurse -Force -File | Measure-Object Length -Sum).Sum / 1MB), 1) + " MB extracted"
"dest: $dest"
