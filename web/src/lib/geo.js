// geo.js — polygon rendering without a map library.
//
// The demo draws ward polygons as inline SVG: no tile server, no map CDN, no
// third party that could observe who is looking at this site. Production
// swaps in MapLibre GL with SELF-HOSTED Protomaps tiles for the same reason —
// never Google Maps, which bills per load and would see every visitor.

export function bounds(features) {
  let minX = 180, minY = 90, maxX = -180, maxY = -90;
  const visit = (c) => {
    if (typeof c[0] === 'number') {
      if (c[0] < minX) minX = c[0]; if (c[0] > maxX) maxX = c[0];
      if (c[1] < minY) minY = c[1]; if (c[1] > maxY) maxY = c[1];
    } else c.forEach(visit);
  };
  features.forEach(f => visit(f.geometry.coordinates));
  return { minX, minY, maxX, maxY };
}

/** Equirectangular with a cos(lat) correction — fine at city scale. */
export function projector(b, width, height, pad = 8) {
  const k = Math.cos(((b.minY + b.maxY) / 2) * Math.PI / 180);
  const w = (b.maxX - b.minX) * k, h = b.maxY - b.minY;
  const s = Math.min((width - 2 * pad) / w, (height - 2 * pad) / h);
  const ox = pad + ((width - 2 * pad) - w * s) / 2;
  const oy = pad + ((height - 2 * pad) - h * s) / 2;
  return ([lon, lat]) => [
    ox + (lon - b.minX) * k * s,
    oy + (b.maxY - lat) * s,
  ];
}

export function toPath(geometry, project) {
  const rings = geometry.type === 'Polygon'
    ? geometry.coordinates
    : geometry.coordinates.flat();
  let d = '';
  for (const ring of rings) {
    ring.forEach((pt, i) => {
      const [x, y] = project(pt);
      d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    });
    d += 'Z';
  }
  return d;
}

/** Inverse of projector(): SVG coordinates back to [lon, lat]. */
export function unprojector(b, width, height, pad = 8) {
  const k = Math.cos(((b.minY + b.maxY) / 2) * Math.PI / 180);
  const w = (b.maxX - b.minX) * k, h = b.maxY - b.minY;
  const s = Math.min((width - 2 * pad) / w, (height - 2 * pad) / h);
  const ox = pad + ((width - 2 * pad) - w * s) / 2;
  const oy = pad + ((height - 2 * pad) - h * s) / 2;
  return ([x, y]) => [
    b.minX + (x - ox) / (k * s),
    b.maxY - (y - oy) / s,
  ];
}

function inRing(ring, x, y) {
  let inside = false;
  for (let i = 0, k = ring.length - 1; i < ring.length; k = i++) {
    const [xi, yi] = ring[i], [xk, yk] = ring[k];
    if ((yi > y) !== (yk > y) && x < ((xk - xi) * (y - yi)) / (yk - yi) + xi)
      inside = !inside;
  }
  return inside;
}

/**
 * Which feature contains this point. Used to turn a tap on the hazard map into
 * a ward id — client-side, so the coordinate is resolved before it is sent and
 * the server is never asked "which ward is this person standing in".
 */
export function featureAt(features, [lon, lat]) {
  for (const f of features) {
    const g = f.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const poly of polys) if (inRing(poly[0], lon, lat)) return f;
  }
  return null;
}
