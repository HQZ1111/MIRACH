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
rem The installer payload must stay pure ASCII: PowerShell 5.1 reads BOM-less
rem files as ANSI, so any non-ASCII byte can break parsing on a zh-CN machine
rem (seen once: a Chinese comment made the manifest stage die with a parse error).
powershell -NoProfile -Command "$b=[System.IO.File]::ReadAllBytes('%~dp0..\scripts\mirach-install.ps1'); if ($b | Where-Object { $_ -gt 127 }) { Write-Host '[release] mirach-install.ps1 contains non-ASCII bytes'; exit 1 }"
if errorlevel 1 exit /b 1
call npx tauri build --bundles nsis
echo [release] exit=%errorlevel%
endlocal
