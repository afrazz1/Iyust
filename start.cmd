@echo off
cd /d "%~dp0"
node server.cjs --open
if errorlevel 1 pause
