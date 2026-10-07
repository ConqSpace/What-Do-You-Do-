@echo off
cd /d "%~dp0"
start "" http://localhost:8420
node server.mjs
pause
