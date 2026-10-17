#!/usr/bin/env bash
#
# Publish Shuttle Sticks at https://stickman.urbancare.ge (the urbancare VM,
# 46.62.171.19). The game is static, so there is no build and no process to
# restart: nginx serves the files straight from disk.
#
#   ~/stickman                       the git checkout (branch main)
#   ~/stickman-site/releases/<sha>   one copy of the public files per deploy
#   ~/stickman-site/current          symlink nginx serves (ops/nginx/stickman.conf)
#
# Run it FROM the checkout after it has been synced to main; the VM's
# watch-deploy.sh does that on every push. The checkout itself is never served,
# so .git and ops/ stay private. Every file except dotfiles, ops/ and README.md
# is published, so a new asset folder needs no change here.
#
# Rollback: point `current` at an older release, e.g.
#   ln -sfn ~/stickman-site/releases/<sha> ~/stickman-site/current
set -euo pipefail

SITE=${STICKMAN_SITE:-$HOME/stickman-site}
URL=https://stickman.urbancare.ge/
KEEP=5

REPO_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

cd "$REPO_DIR"
SHA=$(git rev-parse --short HEAD)
log "publishing $SHA ($(git log -1 --pretty=%s))"

mkdir -p "$SITE/releases"
release="$SITE/releases/$SHA"
if [ -d "$release" ]; then
  # Same commit again (a manual re-run): the files are identical, and replacing
  # the folder `current` may point at would 404 for a moment.
  log "release $SHA already on disk, reusing it"
else
  rm -rf "$release.tmp"
  rsync -a --exclude='.*' --exclude='/ops' --exclude='/README.md' ./ "$release.tmp/"
  [ -f "$release.tmp/index.html" ] || { log "no index.html in $SHA - not published"; rm -rf "$release.tmp"; exit 1; }
  chmod -R a+rX "$release.tmp"
  mv "$release.tmp" "$release"
fi

previous=$(readlink "$SITE/current" 2>/dev/null || true)
# Atomic switch: a new symlink renamed over the old one, so nginx never sees a gap.
ln -sfn "$release" "$SITE/current.new"
mv -T "$SITE/current.new" "$SITE/current"

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 --resolve stickman.urbancare.ge:443:127.0.0.1 "$URL" || true)
if [ "$code" != 200 ]; then
  log "HEALTH CHECK FAILED ($URL answered ${code:-nothing})"
  if [ -n "$previous" ] && [ "$previous" != "$release" ]; then
    ln -sfn "$previous" "$SITE/current.new" && mv -T "$SITE/current.new" "$SITE/current"
    log "switched back to $(basename "$previous")"
  fi
  exit 1
fi
log "live: $URL serves $SHA"

# Keep the newest few releases (by modification time) for rollback.
ls -1dt "$SITE"/releases/*/ 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
  [ "${old%/}" = "$(readlink "$SITE/current")" ] || rm -rf "$old"
done
