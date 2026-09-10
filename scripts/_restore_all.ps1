# _restore_all.ps1 - put the stale plugin copy back, restore the known-good bundle list, verify boot
$old = Join-Path $env:USERPROFILE ".mirach\dsh-plugins\node_modules\dsh-realtime-voice"
$bak = Join-Path $env:USERPROFILE ".mirach\dsh-plugins\node_modules\dsh-realtime-voice.bak"
if ((Test-Path $bak) -and (-not (Test-Path $old))) {
  Move-Item $bak $old -Force
  Write-Output "restored dsh-realtime-voice (stale copy back in dsh-plugins)"
}
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "_restore_bundles.ps1")
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "_boot_verdict.ps1") -Root (Join-Path $env:LOCALAPPDATA "MirachRuntime") -Label "final-restored"
