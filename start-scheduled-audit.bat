@echo off
cd /d %~dp0
npm run audit:turboweave >> logs\scheduled.log 2>&1
