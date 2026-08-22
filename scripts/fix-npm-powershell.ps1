# Fixes "npm cannot be loaded because running scripts is disabled" in PowerShell.
# Run once as:
#   powershell -ExecutionPolicy Bypass -File scripts\fix-npm-powershell.ps1

$ErrorActionPreference = "Stop"

Write-Host "Current execution policies:"
Get-ExecutionPolicy -List | Format-Table -AutoSize

$currentUserPolicy = Get-ExecutionPolicy -Scope CurrentUser
if ($currentUserPolicy -eq "Restricted") {
  Write-Host "Setting CurrentUser execution policy to RemoteSigned..."
  Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force
  Write-Host "Done. Close and reopen PowerShell, then run: npm test"
} else {
  Write-Host "CurrentUser policy is already '$currentUserPolicy'."
  Write-Host "If npm still fails, use npm.cmd instead of npm, for example:"
  Write-Host "  npm.cmd install"
  Write-Host "  npm.cmd run dev"
  Write-Host "Or run project scripts:"
  Write-Host "  .\install.cmd"
  Write-Host "  .\run-dev.cmd"
  Write-Host "  .\run-test.cmd"
}
