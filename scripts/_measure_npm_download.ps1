# _measure_npm_download.ps1 - 测"走 npm 装一次引擎依赖"到底下载多少字节（私有缓存，不影响全局）
$ErrorActionPreference = "Continue"
$base = Join-Path $env:TEMP "_npmtest"
Remove-Item $base -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path (Join-Path $base "pkg") | Out-Null
Set-Content -Path (Join-Path $base "pkg\package.json") -Value '{"name":"t","private":true}' -Encoding ASCII

$npm = Join-Path $env:LOCALAPPDATA "MirachRuntime\node\npm.cmd"
$sw = [System.Diagnostics.Stopwatch]::StartNew()
& $npm install --prefix (Join-Path $base "pkg") --cache (Join-Path $base "cache") --no-audit --no-fund --loglevel=error "@deepseek-ai/dsh-sdk-client@0.1.5-alpha.1"
$sw.Stop()

function Get-MB([string]$p) {
  if (-not (Test-Path $p)) { return 0 }
  return [math]::Round(((Get-ChildItem $p -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum / 1MB), 1)
}
$tree = Get-MB (Join-Path $base "pkg\node_modules")
$cache = Get-MB (Join-Path $base "cache")
$files = (Get-ChildItem (Join-Path $base "pkg\node_modules") -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object).Count

"npm install 用时     : $([math]::Round($sw.Elapsed.TotalSeconds,1)) s"
"装出来的 node_modules: $tree MB / $files 文件"
"npm 下载并缓存的内容 : $cache MB  (= 实际网络下载量)"
