# probe_gitee_auth.ps1 - figure out which auth mode works with Gitee API v5
$ErrorActionPreference = "Continue"
$cred = Get-Content (Join-Path $PSScriptRoot "_cred.txt") | git credential fill
$user = ($cred | Select-String "^username=(.+)$").Matches[0].Groups[1].Value
$pass = ($cred | Select-String "^password=(.+)$").Matches[0].Groups[1].Value
Write-Output ("user=" + $user + " passLen=" + $pass.Length)

$pair = $user + ":" + $pass
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($pair))

try {
  $r = Invoke-RestMethod -Uri "https://gitee.com/api/v5/user" -Headers @{ Authorization = "Basic $b64" } -TimeoutSec 15
  Write-Output ("BASIC OK, login: " + $r.login)
} catch { Write-Output ("BASIC failed: " + $_.Exception.Message) }

try {
  $r = Invoke-RestMethod -Uri ("https://gitee.com/api/v5/user?access_token=" + $pass) -TimeoutSec 15
  Write-Output ("QUERY OK, login: " + $r.login)
} catch { Write-Output ("QUERY failed: " + $_.Exception.Message) }

try {
  $r = Invoke-RestMethod -Uri "https://gitee.com/api/v5/user" -Headers @{ Authorization = "Bearer $pass" } -TimeoutSec 15
  Write-Output ("BEARER OK, login: " + $r.login)
} catch { Write-Output ("BEARER failed: " + $_.Exception.Message) }