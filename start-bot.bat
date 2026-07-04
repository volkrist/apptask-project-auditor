@echo off
setlocal EnableDelayedExpansion
cd /d %~dp0
if not exist logs mkdir logs

set "LOCK=logs\bot.pid"
if exist "%LOCK%" (
  set "STORED_PID="
  set /p STORED_PID=<"%LOCK%"
  for /f "tokens=* delims= " %%a in ("!STORED_PID!") do set "STORED_PID=%%a"
  if defined STORED_PID (
    tasklist /FI "PID eq !STORED_PID!" 2>nul | find /I "!STORED_PID!" >nul
    if not errorlevel 1 (
      echo [start-bot] bot already running, pid=!STORED_PID!
      exit /b 0
    )
  )
  echo [start-bot] stale lock found, deleting logs\bot.pid
  del /f /q "%LOCK%" 2>nul
)

for /f "tokens=1-3 delims=/ " %%a in ("%date%") do set "DS=%%c-%%b-%%a"
for /f "tokens=1-3 delims=:.," %%a in ("%time%") do set "TS=%%a:%%b:%%c"
echo [%DS% %TS%] [start-bot] spawning bot detached >> logs\bot.log
start "" /MIN cmd /c "cd /d %~dp0 && npm run discord:bot >> logs\bot.log 2>&1"
exit /b 0
