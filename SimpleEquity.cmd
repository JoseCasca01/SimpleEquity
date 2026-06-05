@echo off
setlocal
cd /d "%~dp0"

if exist "%~dp0work\launch_portfolio_usd_hidden.ps1" (
  start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0work\launch_portfolio_usd_hidden.ps1"
  exit /b 0
)

set "NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"

"%NODE_EXE%" "%~dp0work\portfolio_desktop_app.mjs"

endlocal
