#!/usr/bin/env bash
# vendor_map_runtime.sh — copy MapLibre's runtime .mjs files into web/static/.
#
# MapLibre v6 spawns its worker with `new URL('./maplibre-gl-worker.mjs',
# import.meta.url)`, resolved at RUNTIME against its own module URL. Vite does
# not rewrite that, so the bundled build asks for a file that was never
# emitted, the worker 404s, and the map renders nothing. The fix is to serve
# the worker (and the shared chunk it imports) ourselves and point MapLibre at
# it with setWorkerUrl(), which BaseMap.svelte does.
#
# Run after bumping maplibre-gl. WEB_DEPS defaults to the same out-of-repo
# node_modules that build_web.sh uses.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
DEPS="${WEB_DEPS:-$HOME/webdeps}"
SRC="$DEPS/node_modules/maplibre-gl/dist"
[ -d "$SRC" ] || { echo "no maplibre-gl in $DEPS — run scripts/build_web.sh first" >&2; exit 1; }
cp "$SRC/maplibre-gl-worker.mjs" "$SRC/maplibre-gl-shared.mjs" "$HERE/web/static/"
echo "vendored worker + shared chunk -> web/static/"
