# _list_releases.ps1 - list Gitee releases and their assets (ASCII)
$token = (Get-Content (Join-Path $PSScriptRoot "_gitee_pat.txt") -Raw).Trim()
$json = & curl.exe -sS -H ("Authorization: token " + $token) "https://gitee.com/api/v5/repos/HANQINGZHOU/mirach/releases?per_page=10"
$rels = $json | ConvertFrom-Json
foreach ($r in $rels) {
  Write-Output ("== " + $r.tag_name + "  (" + $r.name + ")  created " + $r.created_at)
  if ($r.assets) {
    foreach ($a in $r.assets) { Write-Output ("   - " + $a.name) }
  } else {
    Write-Output "   (no assets)"
  }
}
