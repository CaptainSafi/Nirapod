import json, sys
def convert(path, out):
    t = json.load(open(path))
    tr = t.get("transform")
    sx, sy = (tr["scale"] if tr else (1,1))
    tx, ty = (tr["translate"] if tr else (0,0))
    arcs = []
    for arc in t["arcs"]:
        pts, x, y = [], 0, 0
        for dx, dy in arc:
            if tr:
                x += dx; y += dy
                pts.append([x*sx+tx, y*sy+ty])
            else:
                pts.append([dx, dy])
        arcs.append(pts)
    def ring(idxs):
        out = []
        for i in idxs:
            a = arcs[~i][::-1] if i < 0 else arcs[i]
            out.extend(a if not out else a[1:])
        return out
    feats = []
    for obj in t["objects"].values():
        for g in obj["geometries"]:
            ty_ = g["type"]
            if ty_ == "Polygon":
                coords = [ring(r) for r in g["arcs"]]
            elif ty_ == "MultiPolygon":
                coords = [[ring(r) for r in poly] for poly in g["arcs"]]
            else:
                continue
            feats.append({"type":"Feature","properties":g.get("properties",{}),
                          "geometry":{"type":ty_,"coordinates":coords}})
    json.dump({"type":"FeatureCollection","features":feats}, open(out,"w"))
    n=[0]
    def c(x):
        if isinstance(x[0],(int,float)): n[0]+=1
        else:
            for y in x: c(y)
    for f in feats: c(f["geometry"]["coordinates"])
    print(out, "features", len(feats), "vertices", n[0])
for a in ["ADM2","ADM3","ADM4"]:
    convert(f"bgd_{a}.topojson", f"bgd_{a}.geojson")
