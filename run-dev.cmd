@echo off
setlocal
cd /d "%~dp0"

where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo npm.cmd was not found. Install Node.js from https://nodejs.org/
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing dependencies...
  call npm.cmd install
  if errorlevel 1 exit /b 1
)

echo Starting backend API at http://localhost:8080/
start "backend" cmd /c "npm.cmd run dev:backend"

echo Starting frontend dev server at http://localhost:8090/
call npm.cmd run dev:frontend
