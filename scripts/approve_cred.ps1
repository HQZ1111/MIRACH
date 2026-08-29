# approve_cred.ps1 - store the PAT in git credential manager for gitee push
$cred = "protocol=https`nhost=gitee.com`nusername=HANQINGZHOU`npassword=" + (Get-Content (Join-Path $PSScriptRoot "_gitee_pat.txt") -Raw).Trim() + "`n`n"
$cred | & git credential approve
Write-Output "credential stored"