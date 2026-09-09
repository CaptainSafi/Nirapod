# Map tiles

The map reads two PMTiles archives from `web/static/`:

| file | what | size | rebuild when |
|---|---|---|---|
| `dhaka.pmtiles` | OSM basemap: water, landuse, roads, buildings, places | ~50 MB | the OSM extract is refreshed |
| `dhaka_admin.pmtiles` | ward and thana polygons + label points | ~0.7 MB | boundaries or labels change |

**They are not in git.** They are build artifacts: reproducible from the OSM
extract and the boundary seeds, and each rebuild is a fresh 50 MB binary. Three
rebuilds in one day took `.git` to 130 MB, and a blob in git history is there
forever. `.gitignore` excludes `web/static/*.pmtiles`.

If they are missing the site still works: `BaseMap.svelte` detects the missing
archives and falls back to the inline SVG choropleth. You get suppression,
colours and clicking, without streets.

## Getting them

### Option 1: copy them
They are the same for everyone. Copy the two files from another checkout, a
release asset, or your own backup into `web/static/`. Nothing else to do.

### Option 2: rebuild them

**Boundaries only** (seconds, no download):

    python3 scripts/build_admin_tiles.py db/seeds/full_precision \
        web/static/dhaka_admin.pmtiles \
        --bbox 90.10,23.55,90.60,24.05 --minzoom 8 --maxzoom 14

**The basemap** (about 22 minutes, needs a 42 MB OSM extract):

1. Get a Dhaka extract as `.osm.pbf`. Every ready-made basemap host
   (maps.protomaps.com, Geofabrik, download.openstreetmap.fr) is blocked from
   the build sandbox, so this step is done in a browser:
   open <https://slice.openstreetmap.us>, paste the bbox
   `90.10,23.55,90.60,24.05`, press Load, name it, Generate Slice, then
   Download `.osm.pbf`.
2. Build:

        pip install --user pyosmium shapely mapbox_vector_tile pmtiles
        python3 scripts/build_basemap.py dhaka.osm.pbf web/static/dhaka.pmtiles \
            --bbox 90.10,23.55,90.60,24.05 --minzoom 8 --maxzoom 15

Do NOT run the basemap build inside a short-lived shell: the OSM pass alone is
several minutes and the whole thing is ~22 on two cores.

## Why a hand-written tiler

None of the three standard tile builders run in this project's environment:
Planetiler needs Java 21, tilemaker ships no binary, tippecanoe needs
`libsqlite3-dev` and root. `scripts/build_basemap.py` is the replacement:
`.osm.pbf` → pyosmium → shapely → MVT → PMTiles, pure Python, pip-installable.

If you ever get a machine with root, tippecanoe would do this in about a minute
and would be worth switching to for monthly refreshes.

## Labels

Map labels are English and live in the tiles. That is deliberate and the
reasoning is in the header comments of `scripts/build_basemap.py` and
`web/src/lib/mapstyle.js`: MapLibre cannot shape Bengali, and drawing labels as
HTML instead put them a frame behind the map. Bangla is unaffected everywhere
the browser renders it — panel, search, table, the whole interface.

## Deploying

`web/build/` gets the tiles because Vite copies `web/static/`. The host must
support HTTP range requests, which Cloudflare Pages, Netlify and GitHub Pages
all do. Nothing else is required: no tile server, no CDN, no third-party
request at run time.
