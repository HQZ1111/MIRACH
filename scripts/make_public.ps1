# make_public.ps1 - set repo visibility public via PAT (curl, body via temp file)
$ErrorActionPreference = "Stop"
$api = "https://gitee.com/api/v5/repos/HANQINGZHOU/mirach"
$token = (Get-Content (Join-Path $PSScriptRoot "_gitee_pat.txt") -Raw).Trim()
$tmp = $PSScriptRoot

[System.IO.File]::WriteAllText((Join-Path $tmp "_vis.json"), '{"private": false}', [System.Text.Encoding]::UTF8)
& curl.exe -sS --fail -X PATCH -H ("Authorization: token " + $token) -H "Content-Type: application/json; charset=utf-8" --data-binary "@$tmp\_vis.json" $api -o "$tmp\_resp.json"
if ($LASTEXITCODE -ne 0) { Get-Content "$tmp\_resp.json" -ErrorAction SilentlyContinue; throw "visibility patch failed" }
$r = Get-Content "$tmp\_resp.json" -Raw | ConvertFrom-Json
Write-Output ("private flag now: " + $r.private)