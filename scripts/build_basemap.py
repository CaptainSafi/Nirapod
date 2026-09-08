#!/usr/bin/env python3
"""
build_basemap.py - build a self-hosted PMTiles basemap from an OSM extract.

Why this exists: every ready-made basemap route is unreachable from the build
environment (maps.protomaps.com, Geofabrik, osmdata, naciscdn are all refused),
and the three standard tile builders do not run here (Planetiler needs Java 21,
tilemaker ships no binary, tippecanoe needs libsqlite3-dev and root). So the
pipeline is pure Python over pip-installable parts:

    .osm.pbf -> pyosmium -> shapely -> MVT -> .pmtiles

No tile server, no CDN, no third party that could observe who looks at the site.
That is the same reason the SVG renderer exists; this replaces it with real
streets without giving that property up.

Usage:
    python3 build_basemap.py dhaka.osm.pbf web/static/dhaka.pmtiles \
        --bbox 90.10,23.55,90.60,24.05 --minzoom 8 --maxzoom 15

Layers (Protomaps-ish names so the MapLibre style stays conventional):
    water, waterway, landuse, roads, buildings, places
Every layer carries `name` and, where OSM has it, `name_bn` from name:bn.

Data: (c) OpenStreetMap contributors, ODbL. Attribution is required on the map.
"""
import argparse, gzip, json, math, sys
from collections import defaultdict

import osmium
import shapely
from shapely.geometry import box
from shapely import wkb as shapely_wkb
import mapbox_vector_tile
from pmtiles.writer import Writer
from pmtiles.tile import (Compression, TileType, zxy_to_tileid)

R = 6378137.0
EXTENT = 4096

def merc(lon, lat):
    x = R * math.radians(lon)
    y = R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
    return x, y

def tile_bounds(z, x, y):
    n = 2 ** z
    span = 2 * math.pi * R / n
    minx = -math.pi * R + x * span
    maxy = math.pi * R - y * span
    return (minx, maxy - span, minx + span, maxy)

def lonlat_to_tile(lon, lat, z):
    n = 2 ** z
    xt = int((lon + 180.0) / 360.0 * n)
    lat = max(min(lat, 85.05112), -85.05112)
    yt = int((1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n)
    return min(max(xt, 0), n - 1), min(max(yt, 0), n - 1)

# ---------------------------------------------------------------- classification

ROAD_MINZOOM = {
    'motorway': 8, 'trunk': 8, 'primary': 9, 'secondary': 11,
    'tertiary': 12, 'unclassified': 13, 'residential': 13,
    'living_street': 14, 'service': 15, 'pedestrian': 14,
    'footway': 15, 'path': 15, 'track': 14, 'cycleway': 15,
}
ROAD_KIND = {
    'motorway': 'highway', 'motorway_link': 'highway',
    'trunk': 'highway', 'trunk_link': 'highway',
    'primary': 'major_road', 'primary_link': 'major_road',
    'secondary': 'major_road', 'secondary_link': 'major_road',
    'tertiary': 'medium_road', 'tertiary_link': 'medium_road',
    'unclassified': 'minor_road', 'residential': 'minor_road',
    'living_street': 'minor_road', 'service': 'minor_road',
    'pedestrian': 'path', 'footway': 'path', 'path': 'path',
    'track': 'path', 'cycleway': 'path', 'steps': 'path',
}
LANDUSE_KIND = {
    'park': 'park', 'garden': 'park', 'playground': 'park',
    'pitch': 'park', 'golf_course': 'park', 'recreation_ground': 'park',
    'forest': 'forest', 'wood': 'forest', 'grass': 'grass',
    'meadow': 'grass', 'farmland': 'farmland', 'cemetery': 'cemetery',
    'industrial': 'industrial', 'residential': 'residential',
    'commercial': 'commercial', 'retail': 'commercial',
    'school': 'school', 'college': 'school', 'university': 'school',
    'hospital': 'hospital', 'military': 'military',
}
PLACE_MINZOOM = {
    'city': 8, 'town': 10, 'suburb': 11, 'village': 12,
    'neighbourhood': 13, 'quarter': 12, 'hamlet': 13,
}

def names(tags):
    out = {}
    if tags.get('name'):
        out['name'] = tags['name']
    if tags.get('name:bn'):
        out['name_bn'] = tags['name:bn']
    return out

# ---------------------------------------------------------------- extraction

class Collector(osmium.SimpleHandler):
    """One pass over the extract. Dhaka-sized input fits in memory comfortably."""

    def __init__(self, clip):
        super().__init__()
        self.wkbfab = osmium.geom.WKBFactory()
        self.clip = clip
        self.features = defaultdict(list)   # layer -> [(minzoom, props, geom)]
        self.skipped = 0

    def _add(self, layer, minzoom, props, geom):
        if geom is None or geom.is_empty:
            return
        if not geom.is_valid:
            geom = geom.buffer(0)
            if geom.is_empty:
                return
        if not self.clip.intersects(geom):
            return
        self.features[layer].append((minzoom, props, geom))

    def node(self, n):
        t = dict(n.tags)
        place = t.get('place')
        if not place or place not in PLACE_MINZOOM or not t.get('name'):
            return
        x, y = merc(n.location.lon, n.location.lat)
        props = {'kind': place, **names(t)}
        if t.get('population', '').isdigit():
            props['population'] = int(t['population'])
        self._add('places', PLACE_MINZOOM[place], props,
                  shapely.Point(x, y))

    def way(self, w):
        t = dict(w.tags)
        hw = t.get('highway')
        wat = t.get('waterway')
        if not hw and not wat:
            return
        if w.is_closed() and (t.get('area') == 'yes'):
            return
        try:
            geom = shapely_wkb.loads(self.wkbfab.create_linestring(w), hex=True)
        except Exception:
            self.skipped += 1
            return
        geom = project_line(geom)
        if hw:
            if hw not in ROAD_KIND:
                return
            props = {'kind': ROAD_KIND[hw], 'highway': hw, **names(t)}
            if t.get('bridge') in ('yes', 'viaduct'):
                props['bridge'] = 1
            if t.get('tunnel') == 'yes':
                props['tunnel'] = 1
            base = hw[:-5] if hw.endswith('_link') else hw
            self._add('roads', ROAD_MINZOOM.get(base, 14), props, geom)
        else:
            if wat not in ('river', 'stream', 'canal', 'drain', 'ditch'):
                return
            mz = {'river': 9, 'canal': 12, 'stream': 13,
                  'drain': 14, 'ditch': 15}[wat]
            self._add('waterway', mz, {'kind': wat, **names(t)}, geom)

    def area(self, a):
        t = dict(a.tags)
        try:
            geom = shapely_wkb.loads(self.wkbfab.create_multipolygon(a), hex=True)
        except Exception:
            self.skipped += 1
            return
        geom = project_poly(geom)
        if t.get('natural') == 'water' or t.get('landuse') == 'reservoir' \
                or t.get('waterway') == 'riverbank' or t.get('natural') == 'wetland':
            kind = t.get('water') or t.get('natural') or 'water'
            self._add('water', 8, {'kind': kind, **names(t)}, geom)
            return
        if t.get('building'):
            self._add('buildings', 14,
                      {'kind': 'building', **names(t)}, geom)
            return
        for key in ('leisure', 'landuse', 'amenity', 'natural', 'aeroway'):
            v = t.get(key)
            if v and v in LANDUSE_KIND:
                mz = 10 if LANDUSE_KIND[v] in ('park', 'forest', 'military',
                                               'farmland') else 12
                self._add('landuse', mz,
                          {'kind': LANDUSE_KIND[v], **names(t)}, geom)
                return

def project_line(geom):
    return shapely.LineString([merc(x, y) for x, y in geom.coords]) \
        if geom.geom_type == 'LineString' else None

def _ring(coords):
    return [merc(x, y) for x, y in coords]

def project_poly(geom):
    polys = geom.geoms if geom.geom_type == 'MultiPolygon' else [geom]
    out = []
    for p in polys:
        out.append(shapely.Polygon(_ring(p.exterior.coords),
                                   [_ring(r.coords) for r in p.interiors]))
    return shapely.MultiPolygon(out) if len(out) > 1 else out[0]

# ---------------------------------------------------------------- tiling

def build(features, out_path, bbox, minzoom, maxzoom, name):
    lon0, lat0, lon1, lat1 = bbox
    tiles = {}
    for z in range(minzoom, maxzoom + 1):
        x0, y1 = lonlat_to_tile(lon0, lat0, z)
        x1, y0 = lonlat_to_tile(lon1, lat1, z)
        span = 2 * math.pi * R / (2 ** z)
        tol = span / EXTENT * 1.5
        # bucket features into tiles by their own bbox, so each tile only
        # intersects candidates that can actually touch it
        by_tile = defaultdict(lambda: defaultdict(list))
        for layer, rows in features.items():
            for mz, props, geom in rows:
                if mz > z:
                    continue
                gminx, gminy, gmaxx, gmaxy = geom.bounds
                tx0 = max(x0, int((gminx + math.pi * R) / span))
                tx1 = min(x1, int((gmaxx + math.pi * R) / span))
                ty0 = max(y0, int((math.pi * R - gmaxy) / span))
                ty1 = min(y1, int((math.pi * R - gminy) / span))
                for tx in range(tx0, tx1 + 1):
                    for ty in range(ty0, ty1 + 1):
                        by_tile[(tx, ty)][layer].append((props, geom))
        for (tx, ty), layers in by_tile.items():
            bminx, bminy, bmaxx, bmaxy = tile_bounds(z, tx, ty)
            pad = span * (64 / EXTENT)
            clip = box(bminx - pad, bminy - pad, bmaxx + pad, bmaxy + pad)
            enc = []
            for layer, rows in layers.items():
                feats = []
                for props, geom in rows:
                    g = geom if clip.contains(geom) else clip.intersection(geom)
                    if g.is_empty:
                        continue
                    if g.geom_type not in ('Point', 'MultiPoint'):
                        g = g.simplify(tol, preserve_topology=True)
                        if g.is_empty:
                            continue
                    feats.append({'geometry': g, 'properties': props})
                if feats:
                    enc.append({'name': layer, 'features': feats})
            if not enc:
                continue
            data = mapbox_vector_tile.encode(
                enc, quantize_bounds=(bminx, bminy, bmaxx, bmaxy),
                extents=EXTENT, on_invalid_geometry=lambda g: None)
            if data:
                tiles[zxy_to_tileid(z, tx, ty)] = gzip.compress(data, 6)
        print(f"  z{z}: {len(by_tile)} tiles", flush=True)

    layer_names = sorted(features.keys())
    with open(out_path, 'wb') as f:
        w = Writer(f)
        for tid in sorted(tiles):
            w.write_tile(tid, tiles[tid])
        w.finalize({
            'tile_type': TileType.MVT,
            'tile_compression': Compression.GZIP,
            'min_zoom': minzoom, 'max_zoom': maxzoom,
            'min_lon_e7': int(lon0 * 1e7), 'min_lat_e7': int(lat0 * 1e7),
            'max_lon_e7': int(lon1 * 1e7), 'max_lat_e7': int(lat1 * 1e7),
            'center_zoom': minzoom + 3,
            'center_lon_e7': int((lon0 + lon1) / 2 * 1e7),
            'center_lat_e7': int((lat0 + lat1) / 2 * 1e7),
        }, {
            'name': name,
            'attribution': '© OpenStreetMap contributors (ODbL)',
            'vector_layers': [{'id': n, 'fields': {}} for n in layer_names],
        })
    return len(tiles)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pbf')
    ap.add_argument('out')
    ap.add_argument('--bbox', required=True)
    ap.add_argument('--minzoom', type=int, default=8)
    ap.add_argument('--maxzoom', type=int, default=15)
    ap.add_argument('--name', default='Nirapod Dhaka basemap')
    a = ap.parse_args()
    bbox = tuple(float(v) for v in a.bbox.split(','))

    lo = merc(bbox[0], bbox[1]); hi = merc(bbox[2], bbox[3])
    clip = box(lo[0], lo[1], hi[0], hi[1])

    print('reading', a.pbf, flush=True)
    c = Collector(clip)
    c.apply_file(a.pbf, locations=True, idx='flex_mem')
    for layer, rows in sorted(c.features.items()):
        print(f"  {layer}: {len(rows)}", flush=True)
    if c.skipped:
        print(f"  (geometry failures skipped: {c.skipped})", flush=True)

    print('tiling', flush=True)
    n = build(c.features, a.out, bbox, a.minzoom, a.maxzoom, a.name)
    import os
    print(f"wrote {a.out}: {n} tiles, {os.path.getsize(a.out)/1e6:.1f} MB")

if __name__ == '__main__':
    main()
