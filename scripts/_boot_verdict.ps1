# _boot_verdict.ps1 - boot the sidecar from a given runtime root and report the engine verdict
param([string]$Root = "", [string]$Label = "test")
$ErrorActionPreference = "Continue"
if (-not $Root) { $Root = Join-Path $env:TEMP "_rt_bisect" }
$env:DSH_HOME = Join-Path $env:USERPROFILE ".mirach"
$env:MIRACH_RUNTIME_DIR = $Root
$env:MIRACH_DSH_BIN = Join-Path $Root "agent-sidecar\node_modules\@deepseek-ai\dsh\lib\bin.js"
$node = Join-Path $Root "node\node.exe"
$env:DSH_NODE_BIN = $node
$env:NODE_22_BIN = $node
$env:MIRACH_WEB_PORT = "3212"
$env:SIDECAR_LOG_LEVEL = "debug"
$entry = Join-Path $Root "agent-sidecar\dist\index.js"
$err = Join-Path $env:TEMP ("_boot_" + $Label + ".err")
Remove-Item $err -Force -ErrorAction SilentlyContinue
$p = Start-Process -FilePath $node -ArgumentList @($entry) -WorkingDirectory (Join-Path $Root "agent-sidecar") -PassThru -NoNewWindow -RedirectStandardOutput ($err + ".out") -RedirectStandardError $err
Start-Sleep -Seconds 50
$ready = $false
$failed = ""
foreach ($l in (Get-Content $err -ErrorAction SilentlyContinue)) {
  if ($l -like "*runtime ready*") { $ready = $true }
  if ($l -like "*runtime start failed*") { $failed = $l.Trim() }
}
if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
[Console]::Out.WriteLine("VERDICT [" + $Label + "]: " + $(if ($ready) { "BOOT OK" } elseif ($failed) { "BOOT FAIL" } else { "NO VERDICT" }))
if ($failed) { [Console]::Out.WriteLine("  " + $failed) }
