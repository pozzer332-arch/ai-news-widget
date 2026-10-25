@echo off
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Electron не установлен. Выполняю npm install...
  call npm.cmd install --no-fund --no-audit
  node node_modules\electron\install.js
)
start "" "node_modules\electron\dist\electron.exe" .
