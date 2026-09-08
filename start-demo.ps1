# start-demo.ps1 — run the elaka demo on Windows PowerShell.
#   Right-click > Run with PowerShell, or:  .\start-demo.ps1
# Stop it with Ctrl+C.

$ErrorActionPreference = 'Stop'
Set-Location -Path (Join-Path $PSScriptRoot 'server')

if (-not (Test-Path 'node_modules')) {
    Write-Host 'Installing dependencies (once)...' -ForegroundColor Cyan
    npm install --no-fund --no-audit
}

$env:DEMO = '1'          # synthetic data so the map is not blank
$env:BATCH_MS = '15000'  # production is 1800000 (30 minutes)

Write-Host ''
Write-Host 'public site      http://localhost:8787' -ForegroundColor Green
Write-Host 'moderation       http://localhost:8788/?token=demo-moderator-token' -ForegroundColor Green
Write-Host ''
node index.js
