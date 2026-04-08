# Auto-push script for entry-user-backend (PowerShell)
# This script automatically commits and pushes all changes to GitHub

Write-Host "Auto-push to GitHub starting..." -ForegroundColor Cyan

# Add all changes
git add -A

# Check if there are changes to commit
$status = git status --porcelain
if ([string]::IsNullOrWhiteSpace($status)) {
    Write-Host "No changes to commit" -ForegroundColor Green
    exit 0
}

# Get current timestamp
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

# Commit with timestamp
Write-Host "Committing changes..." -ForegroundColor Yellow
git commit -m "auto: update backend - $timestamp"

# Push to GitHub
Write-Host "Pushing to GitHub..." -ForegroundColor Yellow
git push origin main

if ($LASTEXITCODE -eq 0) {
    Write-Host "Successfully pushed to GitHub!" -ForegroundColor Green
} else {
    Write-Host "Failed to push to GitHub" -ForegroundColor Red
    exit 1
}
