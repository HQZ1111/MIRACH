# upload_release.ps1 - create release + upload volumes via curl (header auth only)
$ErrorActionPreference = "Stop"
$repo = "HANQINGZHOU/mirach"
$api = "https://gitee.com/api/v5/repos/" + $repo
$token = (Get-Content (Join-Path $PSScriptRoot "_gitee_pat.txt") -Raw).Trim()
$dir = Join-Path $PSScriptRoot "..\dist-portable"
$tmp = $PSScriptRoot

# 0) regenerate JSON bodies
& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "make_release_json.ps1") | Out-Null

# 1) fix repo description (PATCH via curl)
& curl.exe -sS --fail -X PATCH -H ("Authorization: token " + $token) -H "Content-Type: application/json; charset=utf-8" --data-binary "@$tmp\_repo-desc.json" $api -o "$tmp\_resp.json"
if ($LASTEXITCODE -ne 0) { Get-Content "$tmp\_resp.json" -ErrorAction SilentlyContinue; throw "desc patch failed" }
Write-Output "description patched"

# 2) find or create release
& curl.exe -sS -H ("Authorization: token " + $token) ($api + "/releases/tags/v0.1.0") -o "$tmp\_rel.json"
$findText = Get-Content "$tmp\_rel.json" -Raw -ErrorAction SilentlyContinue
if ($findText -match '"id"\s*:\s*(\d+)' -and $findText -notmatch '"message"') {
  $relId = $Matches[1]
  Write-Output ("existing release id: " + $relId)
} else {
  & curl.exe -sS --fail -X POST -H ("Authorization: token " + $token) -H "Content-Type: application/json; charset=utf-8" --data-binary "@$tmp\_release-body.json" ($api + "/releases") -o "$tmp\_rel.json"
  if ($LASTEXITCODE -ne 0) { Get-Content "$tmp\_rel.json" -ErrorAction SilentlyContinue; throw "release create failed" }
  $relText = Get-Content "$tmp\_rel.json" -Raw
  if ($relText -match '"id"\s*:\s*(\d+)') { $relId = $Matches[1] } else { throw "no id in create response" }
  Write-Output ("release created id: " + $relId)
}

# 3) upload volumes
$vols = Get-ChildItem $dir -Filter "Mirach-portable.7z.*" | Sort-Object Name
foreach ($v in $vols) {
  Write-Output ("uploading " + $v.Name + " (" + [math]::Round($v.Length / 1MB, 1) + " MB) ...")
  & curl.exe -sS --fail -X POST -H ("Authorization: token " + $token) -F ("file=@" + $v.FullName) ($api + "/releases/" + $relId + "/attach_files") -o "$tmp\_resp.json"
  if ($LASTEXITCODE -ne 0) { Get-Content "$tmp\_resp.json" -ErrorAction SilentlyContinue; throw ("upload failed: " + $v.Name) }
  Write-Output "  ok"
}
Write-Output "all uploaded"
Write-Output ("download page: https://gitee.com/" + $repo + "/releases/tag/v0.1.0")