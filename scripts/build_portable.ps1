# build_portable.ps1 v4 - Assemble Mirach portable package (ASCII only)
# Steps: exe -> portable node -> agent-sidecar -> engine source (no node_modules,
# /XJ no junctions) -> pnpm --prod hoisted -> rebuild workspace root links ->
# drop private scoped links -> prune circular nesting -> zip (GitHub, single) +
# 7z 95MB volumes (Gitee attachment cap).
param([string]$OutDir = "dist-portable")
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$sevenZip = "C:\Program Files\7-Zip\7z.exe"

function Clear-LongPathDir([string]$dir) {
  if (-not (Test-Path $dir)) { return }
  $empty = Join-Path $env:TEMP ("empty-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $empty -Force | Out-Null
  robocopy $empty $dir /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
  Remove-Item $empty -Force -ErrorAction SilentlyContinue
  Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
}

$pkg = Join-Path $repo "$OutDir\Mirach"
$rt = Join-Path $pkg "runtime"
Clear-LongPathDir (Join-Path $repo $OutDir)
New-Item -ItemType Directory -Path $rt -Force | Out-Null

# 1) release exe
$exe = Join-Path $repo "src-tauri\target\release\Mirach.exe"
if (-not (Test-Path $exe)) { $exe = Join-Path $repo "src-tauri\target\release\mirach.exe" }
Copy-Item $exe (Join-Path $pkg "Mirach.exe") -Force
Write-Output "exe copied"

# 2) portable node (v24 single exe)
New-Item -ItemType Directory -Path (Join-Path $rt "node") -Force | Out-Null
Copy-Item "D:\node.exe" (Join-Path $rt "node\node.exe") -Force
Write-Output "node copied"

# 3) agent-sidecar (src + deps)
robocopy (Join-Path $repo "agent-sidecar\src") (Join-Path $rt "agent-sidecar\src") /E /NFL /NDL /NJH /NJS /NP | Out-Null
Copy-Item (Join-Path $repo "agent-sidecar\package.json") (Join-Path $rt "agent-sidecar\package.json") -Force
Copy-Item (Join-Path $repo "agent-sidecar\tsconfig.json") (Join-Path $rt "agent-sidecar\tsconfig.json") -Force -ErrorAction SilentlyContinue
robocopy (Join-Path $repo "agent-sidecar\node_modules") (Join-Path $rt "agent-sidecar\node_modules") /E /XJ /NFL /NDL /NJH /NJS /NP | Out-Null
Write-Output "agent-sidecar copied"

# 4a) engine source WITHOUT node_modules and WITHOUT following junctions (/XJ)
$engDir = Join-Path $rt "deepseek-harness"
robocopy "D:\deepseek-harness-master" $engDir /E /XJ /NFL /NDL /NJH /NJS /NP /XD node_modules .sessions .git .turbo coverage dist-cache .github python website /MT:8 > (Join-Path $repo "scripts\_robo-engine.log")
$rc = $LASTEXITCODE
if ($rc -ge 8) { throw "engine robocopy failed with exit code $rc (see scripts\_robo-engine.log)" }
Write-Output ("engine source copied (robocopy rc=$rc)")

# 4b) prod-only hoisted node_modules (real files; CI=true silences purge prompt)
$env:CI = "true"
Push-Location $engDir
& pnpm install --prod --prefer-offline --node-linker=hoisted --ignore-scripts 2>&1 | Select-Object -Last 3
$pnpmExit = $LASTEXITCODE
Pop-Location
if ($pnpmExit -ne 0) { throw "pnpm install failed with exit code $pnpmExit" }
Write-Output "engine node_modules (prod hoisted) done"

# 4c) workspace packages are NOT installed by pnpm --prod: junction all
#     @deepseek-ai/* sources into engine-root node_modules (tsx runs TS sources)
& node (Join-Path $repo "scripts\rebuild_root_links.mjs") $engDir
# 4d) remove private scoped links left inside workspace projects (resolution must
#     fall through to root copies)
& node (Join-Path $repo "scripts\drop_private_links.mjs") $engDir
# 4e) prune circular-dep nesting (pnpm hoisted duplicates @deepseek-ai/* recursively)
& powershell -ExecutionPolicy Bypass -File (Join-Path $repo "scripts\prune_nested.ps1") -EngineRoot $engDir | Select-Object -Last 2
Write-Output "engine links rebuilt + pruned"

# 5) readme (pre-encoded UTF-8 file from repo)
Copy-Item (Join-Path $PSScriptRoot "portable-readme.txt") (Join-Path $pkg "readme-first.txt") -Force

# 6a) single zip for GitHub Release (Windows-native extraction, no 7z needed)
$vols = Join-Path $repo $OutDir
Write-Output "zipping (single zip for GitHub)..."
& $sevenZip a -tzip -mx=7 (Join-Path $vols "Mirach-portable.zip") $pkg | Select-Object -Last 3
if ($LASTEXITCODE -ne 0) { throw "zip failed with exit code $LASTEXITCODE" }
Get-ChildItem $vols -Filter "Mirach-portable.zip" | ForEach-Object { "{0}  {1:N1} MB" -f $_.Name, ($_.Length / 1MB) }

# 6b) 7z 95MB volumes for Gitee (attachment cap 100MB)
Write-Output "compressing 7z volumes (Gitee)..."
& $sevenZip a -t7z -mx=9 "-m0=LZMA2:d=32m:fb=128" -ms=on -mmt=1 "-v95m" (Join-Path $vols "Mirach-portable.7z") $pkg | Select-Object -Last 3
if ($LASTEXITCODE -ne 0) { throw "7z failed with exit code $LASTEXITCODE" }
Get-ChildItem $vols -Filter "Mirach-portable.7z.*" | ForEach-Object { "{0}  {1:N1} MB" -f $_.Name, ($_.Length / 1MB) }
Write-Output "DONE"