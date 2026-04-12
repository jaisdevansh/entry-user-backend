#!/bin/bash

# Auto-push script for entry-user-backend
# This script automatically commits and pushes all changes to GitHub

echo "🔄 Auto-push to GitHub starting..."

# Add all changes
git add -A

# Check if there are changes to commit
if git diff --staged --quiet; then
  echo "✅ No changes to commit"
  exit 0
fi

# Get current timestamp
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Commit with timestamp
git commit -m "auto: update backend - $TIMESTAMP"

# Push to GitHub
git push origin main

echo "✅ Successfully pushed to GitHub!"
