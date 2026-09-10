# _publish_update.ps1 - publish a signed updater release (ASCII only)
#
# Flow:
#   1) scripts\_release_build.cmd  -> signed NSIS installer + .sig
#   2) this script:
#      - uploads Mirach_<ver>_x64-setup.exe to the Gitee release for tag v<ver>
#      - writes docs\latest.json (the updater endpoint payload, served by Gitee raw)
#   3) commit + push docs\latest.json so the endpoint is live
#
# Requires scripts\_gitee_pat.txt (gitignored).
# Usage: powershell -ExecutionPolicy Bypass -File scripts\_publish_update.ps1 -Version 0.1.1 [-NotesFile path]
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$Notes = "",
  [string]$NotesFile = "",
  [switch]$SkipUpload
)
$ErrorActionPreference = "Stop"
$repoSlug = "HANQINGZHOU/mirach"
$api = "https://gitee.com/api/v5/repos/$repoSlug"
$tag = "v$Version"
$tmp = $PSScriptRoot
$patFile = Join-Path $PSScriptRoot "_gitee_pat.txt"
if (-not (Test-Path $patFile)) { throw "Gitee PAT not found: $patFile" }
$token = (Get-Content $patFile -Raw).Trim()

$bundle = Join-Path $PSScriptRoot "..\src-tauri\target\release\bundle\nsis"
$exe = Join-Path $bundle "Mirach_${Version}_x64-setup.exe"
$sig = "$exe.sig"
if (-not (Test-Path $exe)) { throw "installer not found: $exe" }
if (-not (Test-Path $sig)) { throw "signature not found: $sig (need createUpdaterArtifacts + signing key)" }
$sigText = (Get-Content $sig -Raw).Trim()
Write-Output ("installer: " + [math]::Round((Get-Item $exe).Length / 1MB, 1) + " MB, signature " + $sigText.Length + " chars")

# docs\latest.json = updater endpoint payload (served through Gitee raw)
$downloadUrl = "https://gitee.com/$repoSlug/releases/download/$tag/Mirach_${Version}_x64-setup.exe"
if ($NotesFile -and (Test-Path $NotesFile)) { $Notes = [System.IO.File]::ReadAllText($NotesFile, [System.Text.Encoding]::UTF8).Trim() }
if (-not $Notes) { $Notes = "Mirach $Version" }
$latest = [ordered]@{
  version   = $Version
  notes     = $Notes
  pub_date  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  platforms = [ordered]@{
    "windows-x86_64" = [ordered]@{ signature = $sigText; url = $downloadUrl }
  }
}
$latestPath = Join-Path (Join-Path $PSScriptRoot "..") "docs\latest.json"
[System.IO.File]::WriteAllText($latestPath, ($latest | ConvertTo-Json -Depth 6), (New-Object System.Text.UTF8Encoding $false))
Write-Output "docs\latest.json written"

if ($SkipUpload) { Write-Output "skip upload (dry run)"; exit 0 }

# find or create the release
$relJson = Join-Path $env:TEMP "_rel.json"
& curl.exe -sS -H ("Authorization: token " + $token) ($api + "/releases/tags/" + $tag) -o $relJson
$relText = Get-Content $relJson -Raw -ErrorAction SilentlyContinue
if ($relText -match '"id"\s*:\s*(\d+)' -and $relText -notmatch '"message"') {
  $relId = $Matches[1]
  Write-Output "existing release id: $relId"
} else {
  $body = [ordered]@{ tag_name = $tag; target_commitish = "master"; name = "Mirach $Version"; body = $Notes; prerelease = $false } | ConvertTo-Json
  $bodyPath = Join-Path $env:TEMP "mirach-release-body.json"
  [System.IO.File]::WriteAllText($bodyPath, $body, (New-Object System.Text.UTF8Encoding $false))
  & curl.exe -sS --fail -X POST -H ("Authorization: token " + $token) -H "Content-Type: application/json; charset=utf-8" --data-binary "@$bodyPath" ($api + "/releases") -o $relJson
  if ($LASTEXITCODE -ne 0) { Get-Content $relJson -ErrorAction SilentlyContinue; throw "release create failed" }
  $relText = Get-Content $relJson -Raw
  if ($relText -match '"id"\s*:\s*(\d+)') { $relId = $Matches[1] } else { throw "no id in create response" }
  Write-Output "release created id: $relId"
}

# upload the installer unless that exact asset already exists
# 注意：必须匹配 assets[].name 字段，不能在整个响应里找文件名 —— release 正文里
# 有下载 URL，正文含 `...Mirach_<ver>_x64-setup.exe` 会造成"已存在"的假阳性（漏传）。
$existing = & curl.exe -sS -H ("Authorization: token " + $token) ($api + "/releases/tags/" + $tag)
$assetName = "Mirach_${Version}_x64-setup.exe"
$assetNamePattern = '"name"\s*:\s*"' + [regex]::Escape($assetName) + '"'
if ($existing -match $assetNamePattern) {
  Write-Output "asset already present, skipping: $assetName"
} else {
  Write-Output "uploading $assetName ..."
  $resp = Join-Path $env:TEMP "_resp.json"
  & curl.exe -sS -X POST -H ("Authorization: token " + $token) -F ("file=@" + $exe) ($api + "/releases/" + $relId + "/attach_files") -o $resp
  $text = Get-Content $resp -Raw -ErrorAction SilentlyContinue
  if ($text -match '"message"') { Write-Output ("  response: " + ($text -replace "\s+", " ")) } else { Write-Output "  ok" }
}
Write-Output ("endpoint: https://gitee.com/$repoSlug/raw/master/docs/latest.json")
Write-Output ("installer: $downloadUrl")
Write-Output "next: git add docs/latest.json && git commit && git push  (endpoint goes live)"
