# _upgrade_runtime_engine.ps1 - align the runtime's SDK+engine with the profile's plugin tree (rc.1)
param([string]$Version = "0.1.5-rc.1")
$rt = Join-Path $env:LOCALAPPDATA "MirachRuntime"
$sidecar = Join-Path $rt "agent-sidecar"
$npm = Join-Path $rt "node\npm.cmd"
$env:Path = (Join-Path $rt "node") + ";" + $env:Path

Write-Output ("before: " + (Get-Content (Join-Path $sidecar "node_modules\@deepseek-ai\dsh\package.json") -Raw | ConvertFrom-Json).version)
Write-Output ("installing @deepseek-ai/dsh-sdk-client@" + $Version + " ...")
& $npm install --prefix $sidecar --no-audit --no-fund --loglevel=warn ("@deepseek-ai/dsh-sdk-client@" + $Version) 2>&1 |
  Select-Object -Last 5 | ForEach-Object { "  " + $_.ToString().Trim() }
Write-Output ("npm exit=" + $LASTEXITCODE)
$dsh = Join-Path $sidecar "node_modules\@deepseek-ai\dsh\package.json"
$sdk = Join-Path $sidecar "node_modules\@deepseek-ai\dsh-sdk-client\package.json"
Write-Output ("after: engine=" + (Get-Content $dsh -Raw | ConvertFrom-Json).version + " sdk=" + (Get-Content $sdk -Raw | ConvertFrom-Json).version)
