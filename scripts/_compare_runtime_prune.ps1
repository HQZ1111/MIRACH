# _compare_runtime_prune.ps1 - install an UNPRUNED runtime next to the bundled (pruned) one and
# check whether the engine boots there. Decides whether _pack_runtime.ps1's pruning broke it.
$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent $PSScriptRoot
$appDir = Join-Path $env:LOCALAPPDATA "Mirach"
# prefer the installed copy; fall back to the repo (the app may not be installed right now)
$script = Join-Path $appDir "_up_\scripts\mirach-install.ps1"
$sidecarSrc = Join-Path $appDir "_up_\agent-sidecar"
if (-not (Test-Path $script)) {
  $script = Join-Path $repo "scripts\mirach-install.ps1"
  $sidecarSrc = Join-Path $repo "agent-sidecar"
}
$altRoot = Join-Path $env:TEMP "_rt_unpruned"

if (-not (Test-Path $script)) { throw "installer script missing: $script" }
Remove-Item $altRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $altRoot | Out-Null
Write-Output ("alt root: " + $altRoot)

foreach ($stage in @("node", "deps", "sidecar", "marker")) {
  Write-Output ("--- stage " + $stage)
  & powershell -NoProfile -ExecutionPolicy Bypass -File $script -Stage $stage -NonInteractive -Json -Root $altRoot -SidecarSrc $sidecarSrc -SdkVersion "0.1.5-alpha.1" -AppVersion "0.1.2" 2>&1 |
    Select-Object -Last 2 | ForEach-Object { "    " + $_ }
}

# compare sizes: pruned runtime vs fresh (unpruned) one
function Get-SizeMb([string]$p) {
  if (-not (Test-Path $p)) { return 0 }
  return [math]::Round(((Get-ChildItem $p -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum / 1MB), 1)
}
$pruned = Join-Path $env:LOCALAPPDATA "MirachRuntime"
Write-Output ("pruned runtime  : " + (Get-SizeMb $pruned) + " MB")
Write-Output ("unpruned runtime: " + (Get-SizeMb $altRoot) + " MB")

# now boot the sidecar against the UNPRUNED runtime and see whether the engine comes up
$env:DSH_HOME = Join-Path $env:USERPROFILE ".mirach"
$env:MIRACH_RUNTIME_DIR = $altRoot
$env:MIRACH_DSH_BIN = Join-Path $altRoot "agent-sidecar\node_modules\@deepseek-ai\dsh\lib\bin.js"
$env:DSH_NODE_BIN = Join-Path $altRoot "node\node.exe"
$env:NODE_22_BIN = $env:DSH_NODE_BIN
$env:MIRACH_WEB_PORT = "3212"
$env:MIRACH_WEB_HOST = "127.0.0.1"
$env:SIDECAR_LOG_LEVEL = "debug"
$node = Join-Path $altRoot "node\node.exe"
$entry = Join-Path $altRoot "agent-sidecar\dist\index.js"
$out = Join-Path $env:TEMP "_alt_sidecar_out.txt"
$err = Join-Path $env:TEMP "_alt_sidecar_err.txt"
Remove-Item $out, $err -Force -ErrorAction SilentlyContinue
$p = Start-Process -FilePath $node -ArgumentList @($entry) -WorkingDirectory (Join-Path $altRoot "agent-sidecar") -PassThru -NoNewWindow -RedirectStandardOutput $out -RedirectStandardError $err
Start-Sleep -Seconds 55
$alive = -not $p.HasExited
$listening = $false
try { $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:3212/" -TimeoutSec 4; $listening = $true } catch { if ($_.Exception.Response) { $listening = $true } }
Write-Output ("[unpruned] sidecar alive=" + $alive + " engine listening=" + $listening)
if ($alive) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
Get-Content $err -ErrorAction SilentlyContinue | Select-Object -First 12 | ForEach-Object { "    " + $_ }
