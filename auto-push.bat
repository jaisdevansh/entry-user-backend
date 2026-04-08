@echo off
REM Auto-push script for entry-user-backend (Windows)
REM This script automatically commits and pushes all changes to GitHub

echo 🔄 Auto-push to GitHub starting...

REM Add all changes
git add -A

REM Check if there are changes to commit
git diff --staged --quiet
if %errorlevel% equ 0 (
    echo ✅ No changes to commit
    exit /b 0
)

REM Get current timestamp
for /f "tokens=2-4 delims=/ " %%a in ('date /t') do (set mydate=%%c-%%a-%%b)
for /f "tokens=1-2 delims=/:" %%a in ('time /t') do (set mytime=%%a:%%b)

REM Commit with timestamp
git commit -m "auto: update backend - %mydate% %mytime%"

REM Push to GitHub
git push origin main

echo ✅ Successfully pushed to GitHub!
