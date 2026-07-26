#!/usr/bin/env bash
# Pull-and-redeploy: run by hangul-hero-deploy.timer every 2 minutes (and by hand with
# --force). Does nothing unless origin/main has moved. Only swaps the site in after a
# successful build, so a broken push leaves the running game untouched.
#
# Deliberately the same shape as the shabani and mr-porker deploy scripts already on this
# machine. Two differences, both earning their keep:
#
#   git lfs pull   the pronunciation pack is one 68MB LFS object. Without this a reset
#                  leaves a text pointer file where the audio should be, and the game
#                  silently loses every clip rather than failing loudly.
#
#   dist-next      vite empties its output directory before it starts writing. Building
#                  straight into the live one means a failed build takes the site down
#                  until someone fixes it. Build beside it, swap only on success.
set -euo pipefail
cd /home/pi/hangul-hero

git fetch origin main --quiet
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [[ "$LOCAL" == "$REMOTE" && "${1:-}" != "--force" ]]; then
  exit 0
fi

echo "deploying $(git rev-parse --short "$REMOTE") (was $(git rev-parse --short "$LOCAL"))"
git reset --hard origin/main --quiet
git lfs pull

if [[ ! -d node_modules ]] || ! git diff --quiet "$LOCAL" "$REMOTE" -- package-lock.json 2>/dev/null; then
  npm ci --no-audit --no-fund
fi

npm run build:next
rm -rf web/dist
mv web/dist-next web/dist

sudo /usr/bin/systemctl restart hangul-hero

# Confirm it actually came back, rather than assuming a restart means a working site.
for i in $(seq 1 10); do
  sleep 1
  if curl -fsS --max-time 3 http://localhost:8790/api/health >/dev/null 2>&1; then
    echo "deployed $(git rev-parse --short HEAD), healthy after ${i}s"
    exit 0
  fi
done

echo "WARNING: deployed $(git rev-parse --short HEAD) but /api/health did not answer within 10s" >&2
exit 1
