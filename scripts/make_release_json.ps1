# make_release_json.ps1 - write JSON bodies as UTF-8 files (curl --data-binary consumes them)
$ErrorActionPreference = "Stop"

# release POST body ([string] cast: ConvertTo-Json serializes ETS props on strings otherwise)
$bodyText = [string](Get-Content (Join-Path $PSScriptRoot "release-body.txt") -Raw -Encoding UTF8)
$rel = @{ tag_name = "v0.1.0"; target_commitish = "master"; name = "Mirach v0.1.0"; body = $bodyText; prerelease = $false } | ConvertTo-Json
[System.IO.File]::WriteAllBytes((Join-Path $PSScriptRoot "_release-body.json"), [Text.Encoding]::UTF8.GetBytes($rel))

# repo PATCH body
$desc = [string](Get-Content (Join-Path $PSScriptRoot "repo-desc.txt") -Raw -Encoding UTF8).Trim()
$rep = @{ name = "mirach"; description = $desc } | ConvertTo-Json
[System.IO.File]::WriteAllBytes((Join-Path $PSScriptRoot "_repo-desc.json"), [Text.Encoding]::UTF8.GetBytes($rep))
Write-Output "bodies written"