@echo off
cd /d %~dp0
npm run audit:turboweave >> logs\turboweave.log 2>&1
