# check_release.ps1 - inspect existing release and fix description
$ErrorActionPreference = "Stop"
$repo = "HANQINGZHOU/mirach"
$token = (Get-Content (Join-Path $PSScriptRoot "_gitee_pat.txt") -Raw).Trim()
$headers = @{ Authorization = "token $token" }

# list releases
$rels = Invoke-RestMethod -Uri "https://gitee.com/api/v5/repos/$repo/releases?access_token=$token&per_page=20" -TimeoutSec 30
Write-Output ("releases count: " + @($rels).Count)
@($rels) | ForEach-Object { Write-Output ("  id=" + $_.id + " tag=" + $_.tag_name + " name=" + $_.name + " assets=" + @($_.assets).Count) }