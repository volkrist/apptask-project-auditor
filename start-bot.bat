@echo off
cd /d %~dp0
if not exist logs mkdir logs
if exist logs\bot.pid (
  echo [start-bot] lock exists: logs\bot.pid — if bot is not running, delete this file and retry.
)
npm run discord:bot >> logs\bot.log 2>&1
