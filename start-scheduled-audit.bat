@echo off
cd /d %~dp0
npm run audit:scheduled >> logs\scheduled.log 2>&1
