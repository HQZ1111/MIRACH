# _toggle_peer_bundle.ps1 - add/remove dsh-multi-model-provider from the profile bundles list
param([Parameter(Mandatory = $true)][ValidateSet("on", "off")][string]$Mode)
$pkgPath = Join-Path $env:USERPROFILE ".mirach\profiles\mirach\package.json"
$json = Get-Content $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
$bundles = @($json.dsh.profile.bundles)
$name = "dsh-multi-model-provider"
if ($Mode -eq "on") {
  if ($bundles -notcontains $name) { $bundles += $name }
} else {
  $bundles = @($bundles | Where-Object { $_ -ne $name })
}
$json.dsh.profile.bundles = $bundles
[System.IO.File]::WriteAllText($pkgPath, ($json | ConvertTo-Json -Depth 12), (New-Object System.Text.UTF8Encoding $false))
Write-Output ("bundles (" + $Mode + "): " + ($bundles -join ", "))
