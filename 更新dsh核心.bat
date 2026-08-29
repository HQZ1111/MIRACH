@echo off
rem ============================================================
rem Update the vendored dsh engine (official upstream) in place.
rem Mirach keeps engine needs on a local branch "mirach-patches"
rem (question bridge + session/fork + remote dispatch). Update =
rem rebase that branch onto the new official master. Conflicts are
rem rare: our patch touches packages/sdk/server only.
rem ============================================================
setlocal
cd /d "%~dp0" || exit /b 1
if not exist "vendor\deepseek-harness\.git" (
  echo [ERROR] vendor\deepseek-harness not found or not a git checkout.
  echo Setup once with: git clone https://github.com/deepseek-ai/deepseek-harness.git vendor\deepseek-harness
  exit /b 1
)
pushd vendor\deepseek-harness
echo === dsh engine: fetching official updates ===
git fetch origin master || goto :fail
git switch mirach-patches 2>nul || git switch -c mirach-patches origin/master || goto :fail
echo === rebasing mirach-patches onto origin/master ===
git rebase origin/master || goto :fail
echo === engine updated to: ===
git log --oneline -2
popd
echo Done. Restart the app so the sidecar picks up the new runtime.
pause
exit /b 0

:fail
popd
echo Update FAILED - nothing was broken. If rebase has conflicts:
echo   cd vendor\deepseek-harness ^&^& git rebase --abort
pause
exit /b 1
