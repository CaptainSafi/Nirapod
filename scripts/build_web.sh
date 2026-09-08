#!/usr/bin/env bash
# Build the static frontend.
#
# node_modules is installed OUTSIDE the repo on purpose: installing thousands
# of small files onto a mounted/synced drive is slow and can be left corrupted
# if the install is interrupted. Source stays in the repo; only the built
# output is copied back.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
DEPS="${WEB_DEPS:-$HOME/webdeps}"

mkdir -p "$DEPS"
cp "$HERE/web/package.json" "$HERE/web/svelte.config.js" "$HERE/web/vite.config.js" "$DEPS/"
rm -rf "$DEPS/src" && cp -r "$HERE/web/src" "$DEPS/src"
# static/ carries robots.txt and _headers; an empty stub here would silently
# ship a review build with no protection on it.
rm -rf "$DEPS/static" && cp -r "$HERE/web/static" "$DEPS/static"

cd "$DEPS"
[ -d node_modules ] || npm install --no-fund --no-audit
npm run build

rm -rf "$HERE/web/build"
cp -r "$DEPS/build" "$HERE/web/build"
echo "built -> web/build"
