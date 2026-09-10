# _finish_voice_plugins.ps1 - finish P1 engine-side install:
#   1) add the missing peer @deepseek-ai/dsh-client-runtime (only 0.1.1-rc.2 exists -> @next)
#   2) put dsh-multi-model-provider into the profile bundles list (official CLI only maintains deps)
$ErrorActionPreference = "Continue"
$rt = Join-Path $env:LOCALAPPDATA "MirachRuntime"
$env:DSH_HOME = Join-Path $env:USERPROFILE ".mirach"
$node = Join-Path $rt "node\node.exe"
$bin = Join-Path $rt "agent-sidecar\node_modules\@deepseek-ai\dsh\lib\bin.js"
$env:NODE_22_BIN = $node

Write-Output "=== add @deepseek-ai/dsh-client-runtime@next"
& $node $bin plugin --profile mirach add "@deepseek-ai/dsh-client-runtime@next" 2>&1 | Select-Object -Last 5 | ForEach-Object { "    " + $_.ToString().Trim() }
Write-Output ("    exit=" + $LASTEXITCODE)

# bundles: add the provider (peer) so the engine composes it; keep existing order
$pkgPath = Join-Path $env:USERPROFILE ".mirach\profiles\mirach\package.json"
$json = Get-Content $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
$bundles = @($json.dsh.profile.bundles)
foreach ($name in @("dsh-multi-model-provider")) {
  if ($bundles -notcontains $name) { $bundles += $name; Write-Output ("bundles += " + $name) }
}
$json.dsh.profile.bundles = $bundles
$out = $json | ConvertTo-Json -Depth 12
[System.IO.File]::WriteAllText($pkgPath, $out, (New-Object System.Text.UTF8Encoding $false))
Write-Output "bundles now:"
($bundles | ForEach-Object { "    " + $_ })
Write-Output "=== deps now:"
(($json.dependencies.PSObject.Properties | ForEach-Object { "    " + $_.Name + " = " + $_.Value }))
