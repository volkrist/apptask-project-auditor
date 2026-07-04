@echo off
setlocal EnableDelayedExpansion
cd /d %~dp0
if not exist logs mkdir logs

set "LOG=logs\watchdog.log"
for /f "tokens=1-3 delims=/ " %%a in ("%date%") do set "DS=%%c-%%b-%%a"
for /f "tokens=1-3 delims=:.," %%a in ("%time%") do set "TS=%%a:%%b:%%c"
echo [%DS% %TS%] watchdog check >> "%LOG%"

call "%~dp0start-bot.bat" >> "%LOG%" 2>&1
set "RC=!ERRORLEVEL!"
echo [%DS% %TS%] start-bot exit=!RC! >> "%LOG%"
exit /b !RC!
