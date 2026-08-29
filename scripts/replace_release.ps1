# replace_release.ps1 - delete old volume attachments, upload slimmed ones
$ErrorActionPreference = "Stop"
$repo = "HANQINGZHOU/mirach"
$api = "https://gitee.com/api/v5/repos/" + $repo
$token = (Get-Content (Join-Path $PSScriptRoot "_gitee_pat.txt") -Raw).Trim()
$dir = Join-Path $PSScriptRoot "..\dist-portable"
$tmp = $PSScriptRoot
$relId = 944583

# 1) list attachments with ids (header auth; earlier attempt mixed query+header)
& curl.exe -sS -H ("Authorization: token " + $token) ($api + "/releases/" + $relId + "/attach_files") -o "$tmp\_atts2.json"
$atts = Get-Content "$tmp\_atts2.json" -Raw -Encoding UTF8 | ConvertFrom-Json

# 2) delete every old volume attachment
foreach ($a in @($atts)) {
  Write-Output ("deleting: " + $a.name + " (id " + $a.id + ")")
  & curl.exe -sS --fail -X DELETE -H ("Authorization: token " + $token) ($api + "/releases/" + $relId + "/attach_files/" + $a.id) -o "$tmp\_resp.json"
  if ($LASTEXITCODE -ne 0) { Write-Output ("  delete failed (continuing): " + $a.name) }
}

# 3) upload new volumes
$vols = Get-ChildItem $dir -Filter "Mirach-portable.7z.*" | Sort-Object Name
foreach ($v in $vols) {
  Write-Output ("uploading " + $v.Name + " (" + [math]::Round($v.Length / 1MB, 1) + " MB) ...")
  & curl.exe -sS --fail -X POST -H ("Authorization: token " + $token) -F ("file=@" + $v.FullName) ($api + "/releases/" + $relId + "/attach_files") -o "$tmp\_resp.json"
  if ($LASTEXITCODE -ne 0) { Get-Content "$tmp\_resp.json" -ErrorAction SilentlyContinue; throw ("upload failed: " + $v.Name) }
  Write-Output "  ok"
}
Write-Output "release attachments replaced"