@echo off
setlocal
cd /d "%~dp0"

where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo npm.cmd was not found. Install Node.js from https://nodejs.org/
  exit /b 1
)

echo Installing project dependencies...
call npm.cmd install
exit /b %ERRORLEVEL%
