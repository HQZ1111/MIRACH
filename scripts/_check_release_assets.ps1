# _check_release_assets.ps1 - list assets of a Gitee release (ASCII)
param([string]$Tag = "v0.1.1")
$token = (Get-Content (Join-Path $PSScriptRoot "_gitee_pat.txt") -Raw).Trim()
$url = "https://gitee.com/api/v5/repos/HANQINGZHOU/mirach/releases/tags/$Tag"
$json = & curl.exe -sS -H ("Authorization: token " + $token) $url
$rel = $json | ConvertFrom-Json
Write-Output ("release: " + $rel.tag_name + " / " + $rel.name)
if ($rel.assets) {
  $rel.assets | ForEach-Object { Write-Output ("  asset: " + $_.name + "  " + [math]::Round($_.size / 1MB, 2) + " MB  " + $_.browser_download_url) }
} else {
  Write-Output "  (no assets)"
}
