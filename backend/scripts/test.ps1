$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

$nodeExe = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeExe) {
  Write-Error "Node.js is not installed or not in PATH. Install from https://nodejs.org/"
}

$fixturePdf = Join-Path $projectRoot "tests\fixtures\bob-502.pdf"
$testFile = Join-Path $projectRoot "tests\bob-502.test.mjs"

if (-not (Test-Path $fixturePdf)) {
  Write-Error "Missing test fixture: tests\fixtures\bob-502.pdf"
}

if (-not (Test-Path $testFile)) {
  Write-Error "Missing test file: tests\bob-502.test.mjs"
}

Write-Host "Running Bank of Baroda regression tests..."
& $nodeExe.Source --test $testFile

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Write-Host "All tests passed."
