@echo off
cd /d "%~dp0"
start "" http://localhost:8080/
node tools\serve.mjs 8080
pause
