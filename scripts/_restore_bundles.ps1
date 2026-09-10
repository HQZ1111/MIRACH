# _restore_bundles.ps1 - restore the known-good bundle list (no pocket, no multi-model-provider)
$pkgPath = Join-Path $env:USERPROFILE ".mirach\profiles\mirach\package.json"
$desired = @(
  "@deepseek-ai/dsh-base",
  "@deepseek-ai/dsh-sdk-app",
  "@deepseek-ai/dsh-web-app",
  "dsh-tavern",
  "dsh-muv-engine",
  "dsh-muv-table",
  "dsh-workgroup",
  "dsh-realtime-voice",
  "@deepseek-ai/dsh-subagent-codex",
  "@deepseek-ai/dsh-subagent-claude-code"
)
$json = Get-Content $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
$json.dsh.profile.bundles = $desired
[System.IO.File]::WriteAllText($pkgPath, ($json | ConvertTo-Json -Depth 12), (New-Object System.Text.UTF8Encoding $false))
Write-Output ("bundles restored (" + $desired.Count + " entries, pocket/multi-model off)")
