# Full-precision boundaries

Same 46 thanas and 203 wards as `db/seeds/*.geojson`, same `id` and `name_en`
values (verified: zero id/name mismatches), but built from the **full-precision**
geoBoundaries gbOpen BGD release instead of the simplified one.

| file | vertices | bytes |
|---|---|---|
| simplified wards (in use) | 4,637 | 265 KB |
| full-precision wards (here) | 103,509 | 4.3 MB |
| simplified thanas (in use) | ~1.6k | 80 KB |
| full-precision thanas (here) | 39,040 | 1.6 MB |

## Why these are not wired up yet
4.3 MB of ward geometry cannot ship as a JSON payload to the browser. These are
for the MapLibre vector layer, which is blocked on the basemap tiles. Until then
the app keeps using the simplified files and the inline SVG renderer.

## How they were made
1. Download `geoBoundaries-BGD-ADM{2,3,4}.topojson` from the geoBoundaries repo
   via `media.githubusercontent.com` (the plain `raw.` URL returns a Git LFS
   pointer, not the file).
2. `python3 scripts/topojson_to_geojson.py` in the download directory.
3. `python3 scripts/prepare_geo.py <src> <out>` unchanged.

Source: geoBoundaries gbOpen BGD ADM3/ADM4, CC-BY 4.0. Attribution required on
the methodology page.
