@echo off
rem _dev_with_runtime_engine.cmd - dev frontend + INSTALLED runtime (packaged sidecar + built engine)
rem Why: the repo-source engine (apps/cli/src/bin.ts) currently fails to boot with
rem "cannot create effect on inactive context", and mixing MIRACH_DSH_BIN with the SDK's
rem repo-relative internal patches breaks differently. Pointing MIRACH_RUNTIME_DIR at the
rem installed runtime makes the dev app use the same sidecar/engine as the packaged build
rem (so sidecar changes need `npm run build` in agent-sidecar to be picked up).
@echo off
set "MIRACH_RUNTIME_DIR=%LOCALAPPDATA%\MirachRuntime"
rem debug builds always pick <sidecar_dir>/src/index.ts + tsx; the installed runtime only has
rem dist -> pin the entry explicitly (also needs no tsx).
set "MIRACH_SIDECAR_ENTRY=%LOCALAPPDATA%\MirachRuntime\agent-sidecar\dist\index.js"
if not exist "%MIRACH_RUNTIME_DIR%\agent-sidecar\dist\index.js" (
  echo [dev] runtime sidecar dist not found under %MIRACH_RUNTIME_DIR%
  echo [dev] run: cd agent-sidecar ^&^& npm run build , or reinstall the app
  exit /b 1
)
set "MIRACH_DSH_BIN="
rem NODE_22_BIN wins over everything in node_bin(); this machine has it set (Machine scope)
rem to a bare D:\node.exe = Node 24, and the engine only boots on the runtime's Node 22
rem ("cannot create effect on inactive context" under 24). Pin the runtime node for dev.
set "NODE_22_BIN=%LOCALAPPDATA%\MirachRuntime\node\node.exe"
if not exist "%NODE_22_BIN%" set "NODE_22_BIN="
echo [dev] MIRACH_RUNTIME_DIR=%MIRACH_RUNTIME_DIR%
cd /d "%~dp0.."
call npm run tauri:debug
