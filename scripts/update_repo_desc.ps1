# update_repo_desc.ps1 - set Gitee repo description (UTF-8 bytes to survive PS5.1)
$ErrorActionPreference = "Stop"
$repo = "HANQINGZHOU/mirach"
$token = (Get-Content (Join-Path $PSScriptRoot "_gitee_pat.txt") -Raw).Trim()
$headers = @{ Authorization = "token $token" }

# description from UTF-8 file; PATCH requires name
$desc = (Get-Content (Join-Path $PSScriptRoot "repo-desc.txt") -Raw -Encoding UTF8).Trim()
$body = @{ name = "mirach"; description = $desc } | ConvertTo-Json
$bytes = [Text.Encoding]::UTF8.GetBytes($body)
$r = Invoke-RestMethod -Method Patch -Uri "https://gitee.com/api/v5/repos/$repo" -Headers $headers -ContentType "application/json; charset=utf-8" -Body $bytes -TimeoutSec 30
Write-Output ("description now: " + $r.description)