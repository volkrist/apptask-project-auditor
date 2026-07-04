@echo off
cd /d %~dp0
powershell -ExecutionPolicy Bypass -File infra\windows\setup-machine.ps1 %*
