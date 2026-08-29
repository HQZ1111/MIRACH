# push_volumes.ps1 - push the 4 portable volumes to a releases-bin branch
# (no PAT needed: git push goes through GCM OAuth; download via raw URLs)
$ErrorActionPreference = "Stop"
$dir = Join-Path $PSScriptRoot "..\dist-portable"
Set-Location $dir

$vols = Get-ChildItem . -Filter "Mirach-portable.7z.*" | Sort-Object Name
if ($vols.Count -eq 0) { throw "no volumes found in $dir" }

# build tree via a temp spec file (pipeline-to-exe mangling broke mktree before)
$spec = Join-Path $env:TEMP ("mktree-" + [guid]::NewGuid().ToString("N") + ".txt")
$lines = foreach ($v in $vols) {
  $hash = & git hash-object -w $v.FullName
  "100644 blob $hash$([char]9)$($v.Name)"
}
$lines | Out-File $spec -Encoding ascii
$tree = (& cmd /c "git mktree < `"$spec`"" | Out-String).Trim()
Remove-Item $spec -Force
if (-not $tree) { throw "mktree failed" }
Write-Output ("tree: " + $tree)

$commit = (& git commit-tree $tree -m "Mirach v0.1.0 portable volumes" | Out-String).Trim()
if (-not $commit) { throw "commit-tree failed" }
Write-Output ("commit: " + $commit)

& git push origin ($commit + ":refs/heads/releases-bin")
if ($LASTEXITCODE -ne 0) { throw "push failed" }
Write-Output "pushed. raw download URLs:"
foreach ($v in $vols) {
  Write-Output ("https://gitee.com/HANQINGZHOU/dshzhuomianban/raw/releases-bin/" + $v.Name)
}