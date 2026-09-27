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
# Aynı anda tek güncelleme (panelde çift tıklama, iki yönetici). Kilit .git içinde: depoda iz bırakmaz.
if command -v flock >/dev/null 2>&1; then
  exec 7>.git/csf_autogroup_update.lock
  flock -n 7 || { echo "Another update is already running."; exit 3; }
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
echo "Checking for updates on '$BRANCH'…"
GIT_TERMINAL_PROMPT=0 timeout 60 git fetch --quiet origin "$BRANCH"

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
echo "Updated to commit $(git rev-parse --short @)."
