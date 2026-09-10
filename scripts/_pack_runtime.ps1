# _pack_runtime.ps1 - bundle the verified runtime into the installer (dsh ships inside the setup exe)
#
# Input : a clean, verified in-app install (default %LOCALAPPDATA%\MirachRuntime, produced by
#         the first-run installer; versions = the SDK/app versions in this checkout).
# Steps : safe prune (.map/.pdb/.md/tests/non-x64 prebuilds) -> 7z archive ->
#         src-tauri\resources\mirach-runtime.7z + .sha256, plus the bundled 7za.exe.
# Result: the NSIS installer carries it (tauri.conf.json resources); a fresh machine just
#         extracts it - no npm, no network.
param(
  [string]$Source = "$env:LOCALAPPDATA\MirachRuntime",
  [string]$OutDir = "",
  [switch]$NoPrune
)
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
if (-not $OutDir) { $OutDir = Join-Path $repo "src-tauri\resources" }
$sevenZip = "C:\Program Files\7-Zip\7z.exe"
if (-not (Test-Path $sevenZip)) { throw "7-Zip not found: $sevenZip (build requirement)" }

# 1) the source runtime must be complete (node + sidecar + engine + marker)
$need = @(
  (Join-Path $Source "node\node.exe"),
  (Join-Path $Source "agent-sidecar\dist\index.js"),
  (Join-Path $Source "agent-sidecar\node_modules\@deepseek-ai\dsh\lib\bin.js"),
  (Join-Path $Source "agent-sidecar\node_modules\@deepseek-ai\dsh-sdk-client\package.json"),
  (Join-Path $Source ".mirach-bootstrap-complete")
)
foreach ($p in $need) { if (-not (Test-Path $p)) { throw "runtime incomplete, missing: $p" } }
$marker = Get-Content (Join-Path $Source ".mirach-bootstrap-complete") -Raw | ConvertFrom-Json
Write-Output "source runtime: node $($marker.nodeVersion), engine $($marker.engineVersion), app $($marker.appVersion)"

# 2) stage a copy and prune it (the real runtime is left untouched)
$stage = Join-Path $env:TEMP ("mirach-runtime-stage-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Write-Output "staging to $stage ..."
robocopy $Source $stage /E /NFL /NDL /NJH /NJS /NP /MT:8 | Out-Null
$rc = $LASTEXITCODE
if ($rc -ge 8) { throw "robocopy failed: $rc" }

if (-not $NoPrune) {
  $nm = Join-Path $stage "agent-sidecar\node_modules"
  $before = (Get-ChildItem $nm -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
  # not needed at runtime: source maps, debug symbols, docs, test fixtures, foreign-arch prebuilds
  Get-ChildItem $nm -Recurse -Force -File -Include *.map,*.pdb,*.md,*.markdown,*.tsbuildinfo -ErrorAction SilentlyContinue |
    Remove-Item -Force -ErrorAction SilentlyContinue
  Get-ChildItem $nm -Recurse -Force -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -in @("test", "tests", "__tests__", "spec", "docs", "examples", "example") } |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  Get-ChildItem (Join-Path $nm "node-pty\prebuilds"), (Join-Path $nm "@img") -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notmatch 'win32-x64' } |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  $after = (Get-ChildItem $nm -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
  Write-Output ("pruned node_modules: {0:N1} MB -> {1:N1} MB" -f ($before / 1MB), ($after / 1MB))
}

# 3) pack (LZMA2 solid; -mmt for the 25k files)
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$archive = Join-Path $OutDir "mirach-runtime.7z"
Remove-Item $archive -Force -ErrorAction SilentlyContinue
Write-Output "packing $archive ..."
& $sevenZip a -t7z -mx=7 -mmt=on -ms=on $archive (Join-Path $stage "*") | Select-Object -Last 3
if ($LASTEXITCODE -ne 0) { throw "7z packing failed: $LASTEXITCODE" }
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue

$size = (Get-Item $archive).Length
$hash = (Get-FileHash $archive -Algorithm SHA256).Hash.ToLower()
[System.IO.File]::WriteAllText("$archive.sha256", $hash, (New-Object System.Text.UTF8Encoding $false))
Write-Output ("archive: {0} MB, sha256 {1}" -f [math]::Round($size / 1MB, 1), $hash)

# 4) extractor for user machines: 7z.exe + 7z.dll + license travel with the app resources
#    (7-Zip does not ship a standalone 7za.exe any more; 7z.exe only needs 7z.dll beside it)
$extractors = @("7z.exe", "7z.dll")
$missing = @($extractors | Where-Object { -not (Test-Path (Join-Path "C:\Program Files\7-Zip" $_)) })
if ($missing.Count -eq 0) {
  foreach ($f in $extractors) { Copy-Item (Join-Path "C:\Program Files\7-Zip" $f) (Join-Path $OutDir $f) -Force }
  $lic = "C:\Program Files\7-Zip\License.txt"
  if (Test-Path $lic) { Copy-Item $lic (Join-Path $OutDir "7z-license.txt") -Force }
  $kb = [math]::Round(((Get-Item (Join-Path $OutDir "7z.exe")).Length + (Get-Item (Join-Path $OutDir "7z.dll")).Length) / 1KB)
  Write-Output "bundled extractor: 7z.exe + 7z.dll ($kb KB)"
} else {
  Write-Output "WARNING: 7-Zip extractor missing in C:\Program Files\7-Zip ($($missing -join ', ')) - the bundled runtime cannot be extracted on user machines"
}
