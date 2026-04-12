# Auto-Push to GitHub

This folder contains scripts to automatically commit and push changes to GitHub.

## Available Scripts

### Windows (PowerShell) - RECOMMENDED
```powershell
powershell -ExecutionPolicy Bypass -File auto-push.ps1
```

### Windows (Batch)
```cmd
auto-push.bat
```

### Linux/Mac (Bash)
```bash
chmod +x auto-push.sh
./auto-push.sh
```

## What It Does

1. Adds all changes (`git add -A`)
2. Checks if there are changes to commit
3. Commits with timestamp: `auto: update backend - YYYY-MM-DD HH:MM:SS`
4. Pushes to GitHub (`git push origin main`)

## Usage

### One-Time Push
Just run the script whenever you want to push changes:
```powershell
powershell -ExecutionPolicy Bypass -File auto-push.ps1
```

### Quick Command (Add to your workflow)
You can create an alias or shortcut:

**PowerShell Profile:**
```powershell
# Add to: $PROFILE
function Push-Backend {
    Set-Location "C:\Users\devan\Downloads\stitch_curated_discovery\codebase\backend-user"
    powershell -ExecutionPolicy Bypass -File auto-push.ps1
}
Set-Alias push Push-Backend
```

Then just type: `push`

## Repository
- **URL**: https://github.com/jaisdevansh/entry-user-backend.git
- **Branch**: main
- **Auto-Deploy**: If Render is connected, changes will auto-deploy

## Notes

- The script will skip if there are no changes
- All files (including untracked) will be committed
- Commit messages include timestamp for tracking
- Script exits with error code if push fails

## Example Output

```
Auto-push to GitHub starting...
Committing changes...
[main 0b7e26f] auto: update backend - 2026-04-08 14:32:59
 5 files changed, 185 insertions(+)
Pushing to GitHub...
Successfully pushed to GitHub!
```

## Troubleshooting

### Permission Denied
```powershell
# Run PowerShell as Administrator, then:
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Authentication Failed
Make sure you're logged into Git:
```bash
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

### Push Rejected
If someone else pushed changes:
```bash
git pull origin main
# Then run auto-push again
```
