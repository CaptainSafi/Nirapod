#!/usr/bin/env python3
"""
build_admin_tiles.py — tile the ward and thana boundaries into PMTiles.

Why separate from the basemap: boundaries change when a new BBS file lands or a
ward is corrected, and rebuilding them should not mean a 20-minute re-pass over
the OSM extract. Two archives, two lifecycles.

Why tiles at all, rather than shipping the GeoJSON: the full-precision ward file
is 4.3 MB (103,509 vertices). As a tiled source the browser fetches only the
tiles in view, and the choropleth colour is pushed per feature with
setFeatureState, so recolouring never refetches anything.

Usage:
    python3 build_admin_tiles.py db/seeds/full_precision web/static/dhaka_admin.pmtiles \
        --bbox 90.10,23.55,90.60,24.05 --minzoom 8 --maxzoom 14

Source: geoBoundaries gbOpen BGD ADM3/ADM4, CC-BY 4.0.
"""
import argparse, importlib.util, json, pathlib, sys

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('bm', HERE / 'build_basemap.py')
bm = importlib.util.module_from_spec(spec)
sys.modules['bm'] = bm
spec.loader.exec_module(bm)

KEEP = {
    'wards':  ('id', 'thana_id', 'name_en', 'name_bn'),
    'thanas': ('id', 'name_en', 'name_bn'),
}

def load(path, layer, minzoom):
    fc = json.loads(pathlib.Path(path).read_text(encoding='utf-8'))
    rows = []
    for f in fc['features']:
        p = f['properties']
        props = {k: p[k] for k in KEEP[layer] if p.get(k) is not None}
        g = bm.project_poly(bm.shapely.geometry.shape(f['geometry']))
        rows.append((minzoom, props, g))
    return rows

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src', help='directory holding dhaka_wards/thanas.geojson')
    ap.add_argument('out')
    ap.add_argument('--bbox', required=True)
    ap.add_argument('--minzoom', type=int, default=8)
    ap.add_argument('--maxzoom', type=int, default=14)
    a = ap.parse_args()
    bbox = tuple(float(v) for v in a.bbox.split(','))
    src = pathlib.Path(a.src)

    features = {
        'thanas': load(src / 'dhaka_thanas.geojson', 'thanas', a.minzoom),
        # Wards only from z10: at z8-9 a 203-way split is unreadable and the
        # tile is all boundary and no signal.
        'wards':  load(src / 'dhaka_wards.geojson', 'wards', 10),
    }
    for k, v in features.items():
        print(f"  {k}: {len(v)}")
    n = bm.build(features, a.out, bbox, a.minzoom, a.maxzoom,
                 'Nirapod Dhaka boundaries')
    import os
    print(f"wrote {a.out}: {n} tiles, {os.path.getsize(a.out)/1e6:.2f} MB")

if __name__ == '__main__':
    main()
