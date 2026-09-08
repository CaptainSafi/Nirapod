#!/usr/bin/env python3
"""
prepare_geo.py — build ward and thana seed files for elaka.site.

Source: geoBoundaries gbOpen BGD (ADM2 district, ADM3 thana, ADM4 ward/union),
        simplified releases. CC-BY 4.0. Attribution is required on the
        methodology page.

Ward names in the source are generic ("Ward No-01", repeated in every thana,
sometimes split as "(Part)"). A ward is only identifiable once joined to its
parent thana, so that join happens here, at ingest, not in the frontend.

Outputs:
  db/seeds/dhaka_thanas.geojson
  db/seeds/dhaka_wards.geojson

NOT produced here, and deliberately left NULL in the database:
  * name_bn  — no Bangla names in this source. Ward numbers are transliterated
               mechanically (digits only); every other Bangla name must come
               from a BBS/census file and be human-checked before display.
  * population — not in this source. Required for per-capita normalisation
               (spec §4.3). Until it is loaded the map shows raw counts only.
"""
import json, sys, pathlib
from shapely.geometry import shape, mapping
from shapely.prepared import prep

SRC = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
OUT = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else ".")
DISTRICT = "Dhaka"

BN_DIGITS = str.maketrans("0123456789", "০১২৩৪৫৬৭৮৯")

def load(level):
    return json.loads((SRC / f"bgd_{level}.geojson").read_text())

def ward_name_bn(name_en):
    """Only ward NUMBERS are transliterated — that is mechanical and safe.
    Any other name returns None and must be sourced properly."""
    import re
    m = re.match(r"^Ward No-(\d+)", name_en)
    if not m:
        return None
    return "ওয়ার্ড " + str(int(m.group(1))).translate(BN_DIGITS)

def main():
    adm2, adm3, adm4 = load("ADM2"), load("ADM3"), load("ADM4")

    district = next(f for f in adm2["features"]
                    if f["properties"]["shapeName"] == DISTRICT)
    dgeom = prep(shape(district["geometry"]))

    thanas = []
    for f in adm3["features"]:
        g = shape(f["geometry"])
        if not dgeom.contains(g.representative_point()):
            continue
        thanas.append({
            "name_en": f["properties"]["shapeName"],
            "shape_id": f["properties"]["shapeID"],
            "geom": g,
        })
    thanas.sort(key=lambda t: t["name_en"])
    for i, t in enumerate(thanas, start=1):
        t["id"] = i
        t["prepared"] = prep(t["geom"])

    wards, orphans = [], []
    for f in adm4["features"]:
        g = shape(f["geometry"])
        pt = g.representative_point()
        if not dgeom.contains(pt):
            continue
        parent = next((t for t in thanas if t["prepared"].contains(pt)), None)
        raw = f["properties"]["shapeName"]
        if parent is None:
            orphans.append(raw)
            continue
        wards.append({
            "name_en_raw": raw,
            "thana_id": parent["id"],
            "thana_name": parent["name_en"],
            "shape_id": f["properties"]["shapeID"],
            "geom": g,
        })

    # Disambiguate: "Ward No-01" alone is not a name. "Ramna Ward No-01" is.
    for w in wards:
        w["name_en"] = f'{w["thana_name"]}, {w["name_en_raw"]}'
    seen = {}
    for w in sorted(wards, key=lambda w: (w["thana_name"], w["name_en_raw"])):
        n = seen.get(w["name_en"], 0) + 1
        seen[w["name_en"]] = n
        if n > 1:                      # "(Part)" splits share a name
            w["name_en"] = f'{w["name_en"]} [{n}]'
    wards.sort(key=lambda w: w["name_en"])
    for i, w in enumerate(wards, start=1):
        w["id"] = i

    def fc(rows, props):
        return {"type": "FeatureCollection",
                "features": [{"type": "Feature",
                              "properties": props(r),
                              "geometry": mapping(r["geom"])} for r in rows]}

    (OUT / "dhaka_thanas.geojson").write_text(json.dumps(fc(thanas, lambda t: {
        "id": t["id"], "name_en": t["name_en"], "name_bn": None,
        "division": "Dhaka", "district": DISTRICT,
        "source": "geoBoundaries gbOpen BGD ADM3", "source_id": t["shape_id"],
    }), ensure_ascii=False))

    (OUT / "dhaka_wards.geojson").write_text(json.dumps(fc(wards, lambda w: {
        "id": w["id"], "thana_id": w["thana_id"], "name_en": w["name_en"],
        "name_bn": ward_name_bn(w["name_en_raw"]),
        "name_bn_verified": False,
        "division": "Dhaka", "district": DISTRICT, "upazila": w["thana_name"],
        "population": None,
        "source": "geoBoundaries gbOpen BGD ADM4", "source_id": w["shape_id"],
    }), ensure_ascii=False))

    print(f"thanas: {len(thanas)}")
    print(f"wards:  {len(wards)}")
    print(f"wards with a Bangla name: "
          f"{sum(1 for w in wards if ward_name_bn(w['name_en_raw']))}")
    if orphans:
        print(f"unassigned to any thana (dropped): {len(orphans)}")

if __name__ == "__main__":
    main()
