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
import argparse, importlib.util, json, pathlib, re, sys

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('bm', HERE / 'build_basemap.py')
bm = importlib.util.module_from_spec(spec)
sys.modules['bm'] = bm
spec.loader.exec_module(bm)

KEEP = {
    'wards':  ('id', 'thana_id', 'name_en', 'name_bn'),
    'thanas': ('id', 'name_en', 'name_bn'),
}

def short_label(layer, props):
    """What the MAP draws for this area.

    The map labels in English on purpose (see build_basemap.py: MapLibre cannot
    shape Bengali, and drawing labels as HTML put them a frame behind the
    canvas). The stored ward name is qualified for the panel and the search box
    — "Adabor, Ward No-43" — which is far too long to sit on a polygon, so the
    map gets "Ward 43" and the panel keeps the full name.
    """
    n = props.get('name_en') or ''
    if layer == 'wards':
        m = re.search(r'Ward No-0*(\d+)', n)
        if m:
            return f'Ward {m.group(1)}'
        # Union names (rural) carry no ward number; drop the thana prefix.
        return re.sub(r'\s*\[\d+\]$', '', n.split(', ', 1)[-1])
    return n


def disambiguate(rows):
    """Ward numbers are unique WITHIN a thana, not across the city.

    Dhaka has a Ward 98 in Cantonment and another in Biman Bandar; 24 short
    labels collide in total. Two identical labels a kilometre apart is worse
    than a longer label, so the ones that repeat get their thana back. Only
    the ones that repeat — "Ward 43" stays short where it is unambiguous.
    """
    counts = {}
    for props in rows:
        counts[props['label_en']] = counts.get(props['label_en'], 0) + 1

    # Second pass: qualify only the ones that repeat, and add an ordinal only
    # where the thana does not separate them either (a ward split into parts).
    pair_counts = {}
    for props in rows:
        if counts[props['label_en']] < 2:
            continue
        thana = (props.get('name_en') or '').split(', ')[0]
        key = (props['label_en'], thana)
        pair_counts[key] = pair_counts.get(key, 0) + 1

    seen = {}
    for props in rows:
        lbl = props['label_en']
        if counts[lbl] < 2:
            continue
        thana = (props.get('name_en') or '').split(', ')[0]
        key = (lbl, thana)
        out = f'{lbl} ({thana})' if thana else lbl
        if pair_counts.get(key, 0) > 1:
            seen[key] = seen.get(key, 0) + 1
            out = f'{out} {seen[key]}'
        props['label_en'] = out


def load(path, layer, minzoom):
    fc = json.loads(pathlib.Path(path).read_text(encoding='utf-8'))
    rows = []
    for f in fc['features']:
        p = f['properties']
        props = {k: p[k] for k in KEEP[layer] if p.get(k) is not None}
        lbl = short_label(layer, props)
        if lbl:
            props['label_en'] = lbl
        g = bm.project_poly(bm.shapely.geometry.shape(f['geometry']))
        # The ward/thana id doubles as the MVT feature id, so an area that spans
        # tiles is labelled once by the map engine, not once per tile.
        rows.append((minzoom, props, g, int(p['id'])))
    disambiguate([r[1] for r in rows if r[1].get('label_en')])
    return rows


def label_points(rows, layer):
    """One point per area, for the map to hang its label on.

    A polygon that spans four tiles gets labelled in each of them: MapLibre
    places symbols per tile and its cross-tile index only dedupes across zoom
    levels, not between siblings at the same zoom. That is why "Ward 98
    (Cantonment)" appeared twice a few hundred metres apart. Every serious tile
    pipeline solves this the same way — label a POINT, not the polygon — because
    a point lands in exactly one tile and can be labelled exactly once.

    The point is the polygon's representative point, which (unlike a centroid)
    is guaranteed to fall inside a concave or multi-part area.
    """
    out = []
    for minzoom, props, geom, fid in rows:
        if not props.get('label_en'):
            continue
        g = geom
        if g.geom_type == 'MultiPolygon':
            g = max(g.geoms, key=lambda x: x.area)     # label the main piece
        out.append((minzoom, {'id': props['id'], 'label_en': props['label_en']},
                    g.representative_point(), fid))
    return out


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

    thanas = load(src / 'dhaka_thanas.geojson', 'thanas', a.minzoom)
    # Wards only from z10: at z8-9 a 203-way split is unreadable and the tile
    # is all boundary and no signal.
    wards = load(src / 'dhaka_wards.geojson', 'wards', 10)
    features = {
        'thanas': thanas,
        'wards': wards,
        # Label anchors. Separate layers so the polygons stay pure geometry and
        # the labels are placed exactly once each.
        'thana_points': label_points(thanas, 'thanas'),
        'ward_points': label_points(wards, 'wards'),
    }
    for k, v in features.items():
        print(f"  {k}: {len(v)}")
    n = bm.build(features, a.out, bbox, a.minzoom, a.maxzoom,
                 'Nirapod Dhaka boundaries')
    import os
    print(f"wrote {a.out}: {n} tiles, {os.path.getsize(a.out)/1e6:.2f} MB")

if __name__ == '__main__':
    main()
