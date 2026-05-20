@echo off
cd /d %~dp0
npm run discord:bot >> logs\bot.log 2>&1
