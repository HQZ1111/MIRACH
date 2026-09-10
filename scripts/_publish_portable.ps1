# _publish_portable.ps1 - recreate the Gitee release and upload the portable package (ASCII)
#
# The GitHub-style zip is for GitHub; the 7z volumes are for Gitee (attachment cap 100MB).
# Recreating the release clears stale/duplicate assets from earlier publish runs.
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts\_publish_portable.ps1 -Version 0.1.1 [-NotesFile path] [-KeepInstaller]
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$NotesFile = "",
  [switch]$KeepInstaller
)
$ErrorActionPreference = "Stop"
$repoSlug = "HANQINGZHOU/mirach"
$api = "https://gitee.com/api/v5/repos/$repoSlug"
$tag = "v$Version"
$token = (Get-Content (Join-Path $PSScriptRoot "_gitee_pat.txt") -Raw).Trim()
$vols = Join-Path $PSScriptRoot "..\dist-portable"
$installer = Join-Path $PSScriptRoot "..\src-tauri\target\release\bundle\nsis\Mirach_${Version}_x64-setup.exe"

$sevenZVolumes = Get-ChildItem $vols -Filter "Mirach-portable.7z.*" -ErrorAction SilentlyContinue | Sort-Object Name
if ($sevenZVolumes.Count -eq 0) { throw "no 7z volumes found in $vols (run build_portable.ps1 first)" }
Write-Output ("volumes: " + ($sevenZVolumes | ForEach-Object { $_.Name }) -join ", ")

# 1) drop the existing release (clears duplicate/stale assets), then recreate
$tmp = Join-Path $env:TEMP "_rel.json"
& curl.exe -sS -H ("Authorization: token " + $token) ($api + "/releases/tags/" + $tag) -o $tmp
$relText = Get-Content $tmp -Raw -ErrorAction SilentlyContinue
if ($relText -match '"id"\s*:\s*(\d+)' -and $relText -notmatch '"message"') {
  $oldId = $Matches[1]
  & curl.exe -sS -X DELETE -H ("Authorization: token " + $token) ($api + "/releases/" + $oldId) -o $tmp
  Write-Output "deleted old release id=$oldId"
}

$notes = if ($NotesFile -and (Test-Path $NotesFile)) { [System.IO.File]::ReadAllText($NotesFile, [System.Text.Encoding]::UTF8).Trim() } else { "Mirach $Version" }
$body = [ordered]@{ tag_name = $tag; target_commitish = "master"; name = "Mirach $Version"; body = $notes; prerelease = $false } | ConvertTo-Json
$bodyPath = Join-Path $env:TEMP "mirach-release-body.json"
[System.IO.File]::WriteAllText($bodyPath, $body, (New-Object System.Text.UTF8Encoding $false))
& curl.exe -sS --fail -X POST -H ("Authorization: token " + $token) -H "Content-Type: application/json; charset=utf-8" --data-binary "@$bodyPath" ($api + "/releases") -o $tmp
if ($LASTEXITCODE -ne 0) { Get-Content $tmp -ErrorAction SilentlyContinue; throw "release create failed" }
$relText = Get-Content $tmp -Raw
if ($relText -match '"id"\s*:\s*(\d+)') { $relId = $Matches[1] } else { throw "no id in create response" }
Write-Output "release created id=$relId ($tag)"

function Send-Asset([string]$path_, [string]$name) {
  Write-Output ("uploading " + $name + " (" + [math]::Round((Get-Item $path_).Length / 1MB, 1) + " MB) ...")
  $resp = Join-Path $env:TEMP "_resp.json"
  & curl.exe -sS -X POST -H ("Authorization: token " + $token) -F ("file=@" + $path_) ($api + "/releases/" + $relId + "/attach_files") -o $resp
  $text = Get-Content $resp -Raw -ErrorAction SilentlyContinue
  if ($text -match '"message"') { Write-Output ("  response: " + ($text -replace "\s+", " ").Substring(0, 160)) } else { Write-Output "  ok" }
}

foreach ($v in $sevenZVolumes) { Send-Asset $v.FullName $v.Name }
if ($KeepInstaller -and (Test-Path $installer)) { Send-Asset $installer "Mirach_${Version}_x64-setup.exe" }
Write-Output ("page: https://gitee.com/$repoSlug/releases/tag/$tag")
