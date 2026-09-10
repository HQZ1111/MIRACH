# mirach-install.ps1 - Mirach dependency installer payload (ASCII only)
#
# Drives the same stage protocol Hermes uses (apps/bootstrap-installer):
#   -Manifest                          -> one JSON line: {protocol_version, stages:[{name,title,category}]}
#   -Stage <name> -NonInteractive -Json -> one JSON line at the end of the stage:
#                                         {stage, ok, skipped, reason, duration_ms}
#   -Root <dir>                        -> install root (default %LOCALAPPDATA%\MirachRuntime)
#   -SdkVersion <ver>                  -> @deepseek-ai/dsh-sdk-client version to install
#   -AppVersion <ver>                  -> app version recorded in the completion marker
#   -SidecarSrc <dir>                  -> source of the app's agent-sidecar (dist+config)
#   -Check                             -> print {ready:bool, missing:[...]} and exit
#
# Everything the app needs lives under -Root: node\ , sidecar\ (code + node_modules).
param(
  [switch]$Manifest,
  [string]$Stage = "",
  [switch]$NonInteractive,
  [switch]$Json,
  [string]$Root = "",
  [string]$SdkVersion = "0.1.5-alpha.1",
  [string]$AppVersion = "",
  [string]$SidecarSrc = "",
  [switch]$Check
)
$ErrorActionPreference = "Stop"
$ProtocolVersion = 1
# Windows PowerShell 5.1 defaults to old TLS on some machines; nodejs.org/npm need 1.2+
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
# Force UTF-8 output: when stdout is redirected .NET encodes with
# [Console]::OutputEncoding, whose default is the OEM code page (GBK on a
# Chinese Windows) - the host reads UTF-8 and would get mojibake / dropped lines.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

# Emit a line and flush immediately: PowerShell buffers redirected stdout, otherwise
# the host only sees log lines in one burst when the process exits.
function Say {
  # Accepts both `Say "text"` and `"text" | Say` (pipeline input does not bind
  # to a plain positional parameter - without ValueFromPipeline `| Say` prints
  # an empty line).
  param([Parameter(ValueFromPipeline)][string]$Message)
  process {
    [Console]::Out.WriteLine($Message)
    [Console]::Out.Flush()
  }
}

# Strip the Windows extended-length prefix: PowerShell 5.1 Join-Path/Split-Path
# throw 'argument "drive" is null' on \\?\ paths (callers may pass them through).
function Normalize-Path([string]$Path) {
  if (-not $Path) { return $Path }
  if ($Path.StartsWith('\\?\UNC\')) { return '\\' + $Path.Substring(8) }
  if ($Path.StartsWith('\\?\')) { return $Path.Substring(4) }
  return $Path
}
$Root = Normalize-Path $Root
$SidecarSrc = Normalize-Path $SidecarSrc

$InstallRoot = if ($Root) { $Root } else { Join-Path $env:LOCALAPPDATA "MirachRuntime" }
$NodeDir = Join-Path $InstallRoot "node"
$NodeExe = Join-Path $NodeDir "node.exe"
$SidecarDir = Join-Path $InstallRoot "agent-sidecar"
$MarkerPath = Join-Path $InstallRoot ".mirach-bootstrap-complete"
$NodeMajor = 22

$Stages = @(
  @{ name = "node"; title = "Installing Node.js runtime"; category = "runtime" },
  @{ name = "deps"; title = "Installing engine packages"; category = "packages" },
  @{ name = "sidecar"; title = "Installing agent-sidecar"; category = "app" },
  @{ name = "marker"; title = "Finalizing installation"; category = "app" }
)

function Find-ExistingNode() {
  # reuse a usable node from PATH when it satisfies the major version.
  # Guard: the candidate must live in a real node install directory (node.exe +
  # npm.cmd, not a drive root) - a bare node.exe on some dev machine (e.g. D:\
  # node.exe) would otherwise make us copy an entire drive.
  $candidate = Get-Command node -ErrorAction SilentlyContinue
  if (-not $candidate) { return $null }
  $dir = Split-Path -Parent $candidate.Source
  if (-not (Test-NodeInstallDir $dir)) { return $null }
  try {
    $v = (& $candidate.Source --version) -replace '^v', ''
    if ([int]($v.Split('.')[0]) -ge $NodeMajor) { return $candidate.Source }
  } catch { }
  return $null
}

function Test-NodeInstallDir([string]$dir) {
  if (-not $dir) { return $false }
  if ($dir -match '^[A-Za-z]:[\\/]?$') { return $false }
  if (-not (Test-Path (Join-Path $dir "node.exe"))) { return $false }
  if (-not (Test-Path (Join-Path $dir "npm.cmd"))) { return $false }
  return $true
}

function Stage-Node() {
  New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
  if (Test-Path $NodeExe) {
    $v = (& $NodeExe --version) -replace '^v', ''
    if ([int]($v.Split('.')[0]) -ge $NodeMajor) { return @{ ok = $true; skipped = $true; reason = "node v$v present" } }
  }
  $existing = Find-ExistingNode
  if ($existing) {
    New-Item -ItemType Directory -Path $NodeDir -Force | Out-Null
    # copy the whole verified node install dir (node.exe + npm.cmd/npx.cmd + node_modules\npm)
    $existingDir = Split-Path -Parent $existing
    Say "reusing system node at $existing"
    Copy-Item (Join-Path $existingDir "*") $NodeDir -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path $NodeExe) { return @{ ok = $true; skipped = $true; reason = "reused system node" } }
    Remove-Item $NodeDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  # download the official zip (resolve the concrete version from dist\index.json;
  # the latest-vNN.x\ URL is an HTML directory listing, not parseable JSON)
  Say "resolving node v$NodeMajor dist index ..."
  $index = Invoke-RestMethod -UseBasicParsing "https://nodejs.org/dist/index.json"
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
  $entry = $index | Where-Object { $_.version -like "v$NodeMajor.*" -and $_.files -contains "win-$arch-zip" } | Select-Object -First 1
  if (-not $entry) { $entry = $index | Where-Object { $_.version -like "v$NodeMajor.*" } | Select-Object -First 1 }
  if (-not $entry) { throw "node v$NodeMajor win-$arch archive not found in dist index" }
  $file = "node-$($entry.version)-win-$arch.zip"
  $url = "https://nodejs.org/dist/$($entry.version)/$file"
  $tmp = Join-Path $env:TEMP $file
  Say "downloading $url"
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $tmp
  $extract = Join-Path $env:TEMP ("mirach-node-" + [guid]::NewGuid().ToString("N"))
  Say "extracting $($file.name) ..."
  # ZipFile is far faster than Expand-Archive in PowerShell 5.1
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory($tmp, $extract)
  $inner = Get-ChildItem $extract -Directory | Select-Object -First 1
  if (-not $inner) { throw "unexpected node archive layout" }
  if (Test-Path $NodeDir) { Remove-Item $NodeDir -Recurse -Force }
  Move-Item $inner.FullName $NodeDir
  Remove-Item $tmp, $extract -Recurse -Force -ErrorAction SilentlyContinue
  if (-not (Test-Path $NodeExe)) { throw "node.exe missing after extraction" }
  $v = (& $NodeExe --version)
  return @{ ok = $true; skipped = $false; reason = "installed $v" }
}

function Read-JsonFile([string]$Path) {
  # Read explicitly as UTF-8: PowerShell 5.1 reads BOM-less files as ANSI, which
  # corrupts non-ASCII content and breaks ConvertFrom-Json.
  return ([System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8) | ConvertFrom-Json)
}

function Resolve-Npm() {
  $local = Join-Path (Split-Path -Parent $NodeExe) "npm.cmd"
  if (Test-Path $local) { return $local }
  return "npm.cmd"
}

function Stage-Deps() {
  New-Item -ItemType Directory -Path $SidecarDir -Force | Out-Null
  $manifest = Join-Path $SidecarDir "package.json"
  if (-not (Test-Path $manifest)) {
    '{ "name": "mirach-sidecar", "private": true, "version": "0.0.0" }' | Set-Content -Path $manifest -Encoding ASCII
  }
  $installed = Join-Path $SidecarDir "node_modules\@deepseek-ai\dsh-sdk-client\package.json"
  if (Test-Path $installed) {
    $have = (Read-JsonFile $installed).version
    if ($have -eq $SdkVersion) { return @{ ok = $true; skipped = $true; reason = "sdk $have present" } }
  }
  $npm = Resolve-Npm
  $env:Path = "$(Split-Path -Parent $NodeExe);$env:Path"
  Say "npm install @deepseek-ai/dsh-sdk-client@$SdkVersion (this pulls the dsh engine and its plugins)"
  Say "first run downloads a few hundred MB and can take several minutes; the stage timer shows it is alive"
  & $npm install --prefix $SidecarDir --no-audit --no-fund --loglevel=notice "@deepseek-ai/dsh-sdk-client@$SdkVersion"
  if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE" }
  if (-not (Test-Path $installed)) { throw "sdk package missing after install" }
  Say "sdk installed into $SidecarDir\node_modules"
  return @{ ok = $true; skipped = $false; reason = "installed sdk $SdkVersion" }
}

function Stage-Sidecar() {
  New-Item -ItemType Directory -Path $SidecarDir -Force | Out-Null
  if (-not $SidecarSrc) {
    # fall back to the checkout layout next to this script (dev machines)
    $candidate = Join-Path (Split-Path -Parent $PSScriptRoot) "agent-sidecar"
    if (Test-Path (Join-Path $candidate "dist\index.js")) { $SidecarSrc = $candidate }
  }
  if (-not $SidecarSrc) { throw "sidecar source not given (-SidecarSrc) and no dist found" }
  $distSrc = Join-Path $SidecarSrc "dist"
  if (-not (Test-Path (Join-Path $distSrc "index.js"))) { throw "sidecar dist\index.js missing in $SidecarSrc" }
  foreach ($part in @("dist", "config")) {
    $from = Join-Path $SidecarSrc $part
    if (-not (Test-Path $from)) { continue }
    $to = Join-Path $SidecarDir $part
    if (Test-Path $to) { Remove-Item $to -Recurse -Force }
    Copy-Item $from $to -Recurse -Force
  }
  Copy-Item (Join-Path $SidecarSrc "package.json") (Join-Path $SidecarDir "package.json") -Force
  # Make sure package.json declares ESM - text-level check, no ConvertFrom-Json
  # (PowerShell 5.1 misreads BOM-less UTF-8 as ANSI; the Chinese description turns
  # into mojibake and breaks the parse).
  $pkgPath = Join-Path $SidecarDir "package.json"
  $raw = [System.IO.File]::ReadAllText($pkgPath, [System.Text.Encoding]::UTF8)
  if ($raw -notmatch '"type"\s*:\s*"module"') {
    $patched = $raw -replace '^\s*\{', "{`r`n  `"type`": `"module`","
    [System.IO.File]::WriteAllText($pkgPath, $patched, (New-Object System.Text.UTF8Encoding $false))
  }
  return @{ ok = $true; skipped = $false; reason = "sidecar code installed" }
}

function Stage-Marker() {
  New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
  $enginePkg = Join-Path $SidecarDir "node_modules\@deepseek-ai\dsh\package.json"
  $engineVersion = if (Test-Path $enginePkg) { (Read-JsonFile $enginePkg).version } else { "unknown" }
  $nodeVersion = if (Test-Path $NodeExe) { (& $NodeExe --version) } else { "unknown" }
  $marker = [ordered]@{
    schemaVersion       = 1
    completedAt         = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    nodeVersion         = $nodeVersion
    engineVersion       = $engineVersion
    sdkVersion          = $SdkVersion
    appVersion          = $AppVersion
    installRoot         = $InstallRoot
  }
  [System.IO.File]::WriteAllText($MarkerPath, ($marker | ConvertTo-Json), (New-Object System.Text.UTF8Encoding $false))
  return @{ ok = $true; skipped = $false; reason = "marker written" }
}

function Invoke-Stage([string]$Name) {
  $started = Get-Date
  $result = $null
  try {
    switch ($Name) {
      "node" { $result = Stage-Node }
      "deps" { $result = Stage-Deps }
      "sidecar" { $result = Stage-Sidecar }
      "marker" { $result = Stage-Marker }
      default { throw "unknown stage: $Name" }
    }
  } catch {
    $duration = [int]((Get-Date) - $started).TotalMilliseconds
    if ($Json) {
      (@{ stage = $Name; ok = $false; skipped = $false; reason = $_.Exception.Message; duration_ms = $duration } | ConvertTo-Json -Compress) | Say
    }
    throw
  }
  $duration = [int]((Get-Date) - $started).TotalMilliseconds
  if ($Json) {
    (@{
        stage       = $Name
        ok          = [bool]$result.ok
        skipped     = [bool]$result.skipped
        reason      = [string]$result.reason
        duration_ms = $duration
      } | ConvertTo-Json -Compress) | Say
  }
}

# ---- dispatch -------------------------------------------------------------

if ($Manifest) {
  (@{ protocol_version = $ProtocolVersion; stages = $Stages } | ConvertTo-Json -Depth 5 -Compress) | Say
  exit 0
}

if ($Check) {
  $missing = @()
  if (-not (Test-Path $NodeExe)) { $missing += "node" }
  if (-not (Test-Path (Join-Path $SidecarDir "node_modules\@deepseek-ai\dsh-sdk-client\package.json"))) { $missing += "deps" }
  if (-not (Test-Path (Join-Path $SidecarDir "dist\index.js"))) { $missing += "sidecar" }
  (@{ ready = ($missing.Count -eq 0); installRoot = $InstallRoot; missing = $missing } | ConvertTo-Json -Compress) | Say
  exit 0
}

if ($Stage) {
  Invoke-Stage $Stage
  exit 0
}

Say "mirach-install: nothing to do (pass -Manifest, -Stage <name> or -Check)"
exit 0
