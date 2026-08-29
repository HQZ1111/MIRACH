# _patch_paths.ps1 - rename .hermes data paths to .mirach in sidecar sources
$ErrorActionPreference = "Stop"
$base = "G:\deepseek-harness-master\apps\mirach"

$f = Join-Path $base "agent-sidecar\src\runtime.ts"
$c = [System.IO.File]::ReadAllText($f)
$c = $c.Replace('"'.ToUpper(), '"')
$c = $c.Replace('.hermes", "dsh-sessions"', '.mirach", "dsh-sessions"')
$c = $c.Replace('.hermes","dsh-sessions"', '.mirach","dsh-sessions"')
$c = $c.Replace('join(process.env.USERPROFILE ?? harnessRoot, ".hermes", "dsh-sessions")', 'join(process.env.USERPROFILE ?? harnessRoot, ".mirach", "dsh-sessions")')
[System.IO.File]::WriteAllText($f, $c, [System.Text.Encoding]::UTF8)

$f2 = Join-Path $base "agent-sidecar\src\dsh.ts"
$c2 = [System.IO.File]::ReadAllText($f2)
$c2 = $c2.Replace('.hermes\dsh-plugins', '.mirach\dsh-plugins')
[System.IO.File]::WriteAllText($f2, $c2, [System.Text.Encoding]::UTF8)

Write-Output "patched"
Select-String -Path $f -Pattern "\.mirach" | ForEach-Object { $_.Line.Trim() }
Select-String -Path $f2 -Pattern "\.mirach" | ForEach-Object { $_.Line.Trim() }