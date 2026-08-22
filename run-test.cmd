@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed or not in PATH.
  echo Install Node.js from https://nodejs.org/ and restart PowerShell.
  exit /b 1
)

if not exist "backend\tests\fixtures\bob-502.pdf" (
  echo Missing test fixture: backend\tests\fixtures\bob-502.pdf
  exit /b 1
)

echo Running Bank of Baroda regression tests...
node --test backend\tests\bob-502.test.mjs
set EXIT_CODE=%ERRORLEVEL%

if not "%EXIT_CODE%"=="0" (
  echo Tests failed with exit code %EXIT_CODE%.
  exit /b %EXIT_CODE%
)

echo All tests passed.
exit /b 0
