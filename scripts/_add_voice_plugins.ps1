# _add_voice_plugins.ps1 - install the realtime-voice peer + missing client runtime + upgrade the plugin
# via the OFFICIAL dsh CLI (same path mirach's plugin installer uses: `dsh plugin --profile mirach add X`)
$ErrorActionPreference = "Continue"
$rt = Join-Path $env:LOCALAPPDATA "MirachRuntime"
$env:DSH_HOME = Join-Path $env:USERPROFILE ".mirach"
$node = Join-Path $rt "node\node.exe"
$bin = Join-Path $rt "agent-sidecar\node_modules\@deepseek-ai\dsh\lib\bin.js"
if (-not (Test-Path $bin)) { throw "engine bin missing: $bin" }
$env:NODE_22_BIN = $node

$specs = @(
  "dsh-multi-model-provider@0.1.0-rc.19",
  "@deepseek-ai/dsh-client-runtime@0.1.5-rc.1",
  "dsh-realtime-voice@0.3.3"
)
foreach ($spec in $specs) {
  Write-Output ("=== add " + $spec)
  $out = & $node $bin plugin --profile mirach add $spec 2>&1
  $code = $LASTEXITCODE
  $out | Select-Object -Last 6 | ForEach-Object { "    " + $_.ToString().Trim() }
  Write-Output ("    exit=" + $code)
}
