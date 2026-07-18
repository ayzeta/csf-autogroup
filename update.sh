#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# CSF Auto-Group — quick update.  Run as root:  bash update.sh
# Pulls ONLY if the GitHub remote is ahead, then redeploys with your
# saved settings (no prompts; config.env thresholds/lang preserved).
# ═══════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(cd "$(dirname "$0")" && pwd)"

[ "$(id -u)" -eq 0 ] || { echo "ERROR: run as root (install step needs cron)."; exit 1; }
[ -d .git ] || { echo "ERROR: not a git checkout — 'git clone' the repo and run from it."; exit 1; }

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
echo "Checking for updates on '$BRANCH'…"
git fetch --quiet origin "$BRANCH"

LOCAL="$(git rev-parse @)"
REMOTE="$(git rev-parse "origin/$BRANCH")"
BASE="$(git merge-base @ "origin/$BRANCH")"

if [ "$LOCAL" = "$REMOTE" ]; then
  echo "Already up to date ($(git rev-parse --short @))."
  exit 0
fi
if [ "$LOCAL" != "$BASE" ]; then
  echo "Local branch has diverged from origin/$BRANCH (local commits present)."
  echo "Resolve manually:  git status   /   git log --oneline @{u}..@"
  exit 1
fi

echo "Update available: $(git rev-parse --short @) → $(git rev-parse --short "origin/$BRANCH")"
git log --oneline "@..origin/$BRANCH" | sed 's/^/  /'
git merge --ff-only "origin/$BRANCH"

echo
bash install.sh --yes
echo
echo "Updated to commit $(git rev-parse --short @) (git revision; VERSION shows on the script's first log line)."
