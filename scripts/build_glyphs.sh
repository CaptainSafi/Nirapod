#!/usr/bin/env bash
# build_glyphs.sh — generate the label glyphs the map serves itself.
#
# MapLibre cannot draw a single label without PBF glyph ranges. The usual
# answer is a font CDN, which would hand a third party the visitor list for a
# site about who is being extorted in which mohalla. So we build our own and
# serve them from web/static/fonts/.
#
# The face is Noto Sans Bengali plus its Latin and Latin-Ext subsets merged
# into ONE font, so a single fontstack renders both scripts and a label never
# falls back to tofu when a Bangla name sits beside "Road 27".
#
# Output: web/static/fonts/Nirapod Sans Regular/<start>-<end>.pbf, 256 files,
# ~1.2 MB total. A browser fetches only the two or three ranges on screen.
#
# Needs node and python3 with fonttools + brotli. Run it again only when the
# font changes; the output is committed.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"

npm pack @fontsource/noto-sans-bengali >/dev/null
tar xzf fontsource-noto-sans-bengali-*.tgz
python3 -m pip install --quiet --user fonttools brotli

python3 - <<'PY'
from fontTools.ttLib import TTFont
from fontTools.merge import Merger
import os
os.makedirs('ttf', exist_ok=True)
subs = ['bengali', 'latin', 'latin-ext']
for s in subs:
    f = TTFont(f'package/files/noto-sans-bengali-{s}-400-normal.woff2')
    f.flavor = None
    f.save(f'ttf/{s}.ttf')
    f.close()
m = Merger()
f = m.merge([f'ttf/{s}.ttf' for s in subs])
f['name'].setName('Nirapod Sans', 1, 3, 1, 0x409)
f['name'].setName('Regular', 2, 3, 1, 0x409)
f['name'].setName('Nirapod Sans Regular', 4, 3, 1, 0x409)
f.save('ttf/nirapod-sans.ttf')
PY

npm install fontnik --no-fund --no-audit >/dev/null
cat > gen.js <<'JS'
const fontnik = require('fontnik'), fs = require('fs'), path = require('path');
const font = fs.readFileSync(process.argv[2]), out = process.argv[3];
fs.mkdirSync(out, { recursive: true });
let i = 0;
(function next() {
  if (i > 65535) return console.log('glyphs written to', out);
  const start = i, end = i + 255; i += 256;
  fontnik.range({ font, start, end }, (err, res) => {
    if (!err) fs.writeFileSync(path.join(out, `${start}-${end}.pbf`), res);
    next();
  });
})();
JS
node gen.js ttf/nirapod-sans.ttf "$HERE/web/static/fonts/Nirapod Sans Regular"

echo "Noto Sans Bengali is SIL Open Font License 1.1 — keep the licence with it."
