@echo off
REM start-demo.cmd — run the elaka demo. Double-click, or run from cmd.
cd /d "%~dp0server"
if not exist node_modules (
  echo Installing dependencies ^(once^)...
  call npm install --no-fund --no-audit
)
set DEMO=1
set BATCH_MS=15000
echo.
echo public site   http://localhost:8787
echo moderation    http://localhost:8788/?token=demo-moderator-token
echo.
node index.js
