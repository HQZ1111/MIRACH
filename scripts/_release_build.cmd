@echo off
rem _release_build.cmd - signed NSIS release build (ASCII only)
rem Usage: scripts\_release_build.cmd   (output goes to %TEMP%\mirach_release_build.log)
rem Signing key + password live in src-tauri\.tauri-keys\ (gitignored).
setlocal
set "KEYS=%~dp0..\src-tauri\.tauri-keys"
if not exist "%KEYS%\mirach.key" (
  echo [release] signing key missing: %KEYS%\mirach.key
  echo [release] generate with: npx tauri signer generate -w src-tauri/.tauri-keys/mirach.key
  exit /b 1
)
if not exist "%KEYS%\password.txt" (
  echo [release] signing password missing: %KEYS%\password.txt
  exit /b 1
)
set /p TAURI_SIGNING_PRIVATE_KEY_PASSWORD=<"%KEYS%\password.txt"
set "TAURI_SIGNING_PRIVATE_KEY=%KEYS%\mirach.key"
set "TAURI_SIGNING_PRIVATE_KEY_PATH=%KEYS%\mirach.key"
cd /d "%~dp0.."
echo [release] key=%KEYS%\mirach.key
rem agent-sidecar dist is a bundle resource: always rebuild so the packaged
rem sidecar matches the source (the tauri build only rebuilds the frontend).
pushd "%~dp0..\agent-sidecar"
call npm run build
if errorlevel 1 (
  echo [release] agent-sidecar build failed
  popd
  exit /b 1
)
popd
if not exist "%~dp0..\agent-sidecar\dist\index.js" (
  echo [release] agent-sidecar\dist\index.js missing after build
  exit /b 1
)
rem Install-path scripts must stay pure ASCII: PowerShell 5.1 reads BOM-less files as
rem ANSI, so any non-ASCII byte can break parsing on a zh-CN machine (seen twice: a
rem Chinese comment made the manifest stage die with a parse error).
powershell -NoProfile -Command "$files=@('mirach-install.ps1','_pack_runtime.ps1','_prep_fresh_install_test.ps1','_cleanup_install_test.ps1','_test_bundle_extract.ps1'); $bad=@(); foreach ($f in $files) { $p=Join-Path '%~dp0' $f; if ((Test-Path $p) -and ([System.IO.File]::ReadAllBytes($p) | Where-Object { $_ -gt 127 })) { $bad += $f } }; if ($bad.Count) { Write-Host ('[release] non-ASCII install-path script(s): ' + ($bad -join ', ')); exit 1 }"
if errorlevel 1 exit /b 1
rem The runtime that ships inside the installer (dsh + Node + sidecar) is packed from a
rem verified in-app install (%LOCALAPPDATA%\MirachRuntime). Release machines must have
rem one - run the app once (first-run install) or skip packing to ship a shell-only build.
if exist "%~dp0..\src-tauri\resources\mirach-runtime.7z" (
  echo [release] reusing existing src-tauri\resources\mirach-runtime.7z
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0_pack_runtime.ps1"
  if errorlevel 1 (
    echo [release] runtime packing failed - run the app first, or delete resources\mirach-runtime.7z expectations
    exit /b 1
  )
)
call npx tauri build --bundles nsis
echo [release] exit=%errorlevel%
endlocal
