# check_gitee_token.ps1 — 探测 Git 凭据管理器里的 Gitee token，并验证 API 可用性
$out = "protocol=https`nhost=gitee.com`n`n" | & git credential fill 2>$null
$user = ($out | Select-String "^username=(.+)$").Matches[0].Groups[1].Value
$pass = ($out | Select-String "^password=(.+)$").Matches[0].Groups[1].Value
Write-Output ("user: " + $user)
Write-Output ("token prefix: " + $pass.Substring(0, [Math]::Min(6, $pass.Length)) + "...")
$headers = @{ Authorization = "token $pass" }
try {
  $r = Invoke-RestMethod -Uri "https://gitee.com/api/v5/user" -Headers $headers -TimeoutSec 15
  Write-Output ("api ok, login: " + $r.login)
} catch {
  Write-Output ("api failed: " + $_.Exception.Message)
}