# _prep_first_run_test.ps1 - mirror the packaged resource layout next to the release exe
# and hide the repo sidecar so the first-run gate triggers.
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$rel = Join-Path $repo "src-tauri\target\release"

New-Item -ItemType Directory -Force -Path (Join-Path $rel "scripts") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $rel "agent-sidecar") | Out-Null
Copy-Item (Join-Path $repo "scripts\mirach-install.ps1") (Join-Path $rel "scripts\mirach-install.ps1") -Force
Copy-Item (Join-Path $repo "agent-sidecar\dist") (Join-Path $rel "agent-sidecar\dist") -Recurse -Force
Copy-Item (Join-Path $repo "agent-sidecar\config") (Join-Path $rel "agent-sidecar\config") -Recurse -Force
Copy-Item (Join-Path $repo "agent-sidecar\package.json") (Join-Path $rel "agent-sidecar\package.json") -Force
New-Item -ItemType Directory -Force -Path "G:\_setup-test\local" | Out-Null
Move-Item (Join-Path $repo "agent-sidecar\dist") (Join-Path $repo "agent-sidecar\_dist.bak") -Force

"resource mirror dist: " + (Test-Path (Join-Path $rel "agent-sidecar\dist\index.js"))
"resource mirror script: " + (Test-Path (Join-Path $rel "scripts\mirach-install.ps1"))
"repo dist hidden: " + (-not (Test-Path (Join-Path $repo "agent-sidecar\dist\index.js")))
