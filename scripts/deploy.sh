#!/usr/bin/env bash
# Deploy My Sales Desk UAE to GitHub Pages (free) at https://<owner>.github.io/my-sales-desk-uae/
#
# REQUIRED BASE PATH: the app is served from the sub-path /my-sales-desk-uae/, so the
# production build MUST use Vite base '/my-sales-desk-uae/' (done below via --base).
# Manifest start_url/scope ('./'), the SW registration ('./sw.js', scope './') and icon
# paths are relative, so they resolve under the sub-path automatically.
#
# Prereqs: node + npm, gh CLI logged in (repo scope), git remote 'origin' -> GitHub repo.
# One-time setup (already done for tinyupgrade7860-cyber/my-sales-desk-uae):
#   gh repo create <owner>/my-sales-desk-uae --public --source=. --remote=origin --push
#   (after first gh-pages push)
#   gh api -X POST repos/<owner>/my-sales-desk-uae/pages -f 'source[branch]=gh-pages' -f 'source[path]=/'
set -euo pipefail
cd "$(dirname "$0")/.."
BASE="${BASE:-/my-sales-desk-uae/}"
REMOTE="${REMOTE:-origin}"
SRC_SHA="$(git rev-parse --short HEAD)"

[ -d node_modules ] || npm ci
npx tsc
npx vite build --base="$BASE"
touch dist/.nojekyll                       # stop Jekyll from touching files

# Optional: run the e2e suite against the sub-path build first
if [ "${RUN_TESTS:-0}" = "1" ]; then npx playwright test -c playwright.subpath.config.ts; fi

# Publish dist/ as a fresh single-commit gh-pages branch (no history bloat)
TMP="$(mktemp -d)"
cp -r dist/. "$TMP"/
git -C "$TMP" init -q -b gh-pages
git -C "$TMP" add -A
git -C "$TMP" -c user.name="$(git config user.name)" -c user.email="$(git config user.email)" \
  commit -q -m "Deploy $SRC_SHA ($(date -u +%Y-%m-%dT%H:%MZ))"
git -C "$TMP" push -f "$(git remote get-url "$REMOTE")" gh-pages:gh-pages
rm -rf "$TMP"
echo "Pushed gh-pages for $SRC_SHA. Pages rebuilds in ~1 min: check with"
echo "  gh api repos/<owner>/my-sales-desk-uae/pages/builds/latest -q .status"
