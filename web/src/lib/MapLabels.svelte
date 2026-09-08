<script>
  // MapLabels.svelte — Bangla place and ward labels, drawn as HTML.
  //
  // WHY NOT LET THE MAP DRAW THEM. MapLibre renders one SDF glyph per codepoint
  // with no complex-script shaping. Bengali needs three things it does not do:
  // pre-base vowels (ে, ি, ৈ) must move in front of their consonant, conjuncts
  // must form across হসন্ত, and reph must ride the following consonant. Without
  // that, 'লেক' comes out as 'লেকে' and 'সোহরাওয়ার্দী' worse. The browser has a
  // real text shaper, so the labels that matter are drawn as DOM nodes on top
  // of the canvas. Road names, which have to bend along a line, stay with the
  // map engine and are limited to Latin names in the style.
  //
  // Cost of doing it this way: no label collision with the map's own labels,
  // so we do our own — importance-ranked, greedy, box-based. Cheap at these
  // counts (tens of labels), and it only recomputes when the map settles.

  let { map = null, ready = false, lang = 'bn', max = 40 } = $props();

  let labels = $state([]);
  let raf = 0;

  const KIND_RANK = { city: 0, town: 1, suburb: 2, quarter: 3, village: 4, neighbourhood: 5, hamlet: 6 };
  const KIND_SIZE = { city: 20, town: 16, suburb: 14, quarter: 13, village: 13, neighbourhood: 12, hamlet: 12 };

  function nameOf(p) {
    return lang === 'bn'
      ? (p.name_bn || p.name || '')
      : (p.name || p.name_bn || '');
  }

  /** Rough on-screen box for a label, used only for collision. */
  function box(x, y, text, size) {
    const w = text.length * size * 0.62, h = size * 1.25;
    return [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
  }
  const hits = (a, b) =>
    a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

  function collect() {
    if (!map || !ready) return;
    const z = map.getZoom();
    const canvas = map.getCanvas();
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const found = [];

    const places = map.querySourceFeatures('base', { sourceLayer: 'places' });
    for (const f of places) {
      const text = nameOf(f.properties);
      if (!text) continue;
      const kind = f.properties.kind;
      const c = f.geometry?.coordinates;
      if (!c) continue;
      found.push({
        key: `p:${kind}:${text}`, text, lon: c[0], lat: c[1],
        size: KIND_SIZE[kind] ?? 12,
        rank: (KIND_RANK[kind] ?? 7) - (f.properties.population ? 0.5 : 0),
        cls: 'place',
      });
    }

    // Ward numbers only once they are legible; below z12 they stack into mush.
    if (z >= 12) {
      const wards = map.querySourceFeatures('admin', { sourceLayer: 'wards' });
      for (const f of wards) {
        const text = nameOf(f.properties);
        if (!text) continue;
        const p = centroid(f.geometry);
        if (!p) continue;
        found.push({
          key: `w:${f.properties.id}`, text, lon: p[0], lat: p[1],
          size: 12, rank: 8, cls: 'ward',
        });
      }
    }

    // One label per name, then importance order, then greedy collision.
    const seen = new Map();
    for (const l of found) if (!seen.has(l.key)) seen.set(l.key, l);
    const ordered = [...seen.values()].sort((a, b) => a.rank - b.rank);

    const placed = [], boxes = [];
    for (const l of ordered) {
      if (placed.length >= max) break;
      const pt = map.project([l.lon, l.lat]);
      if (pt.x < 0 || pt.y < 0 || pt.x > W || pt.y > H) continue;
      const b = box(pt.x, pt.y, l.text, l.size);
      if (boxes.some(o => hits(o, b))) continue;
      boxes.push(b);
      placed.push({ ...l, x: pt.x, y: pt.y });
    }
    labels = placed;
  }

  /** Centroid of the largest ring — good enough to hang a ward number on. */
  function centroid(g) {
    if (!g) return null;
    const rings = g.type === 'Polygon' ? g.coordinates
      : g.type === 'MultiPolygon' ? g.coordinates.flat() : null;
    if (!rings?.length) return null;
    let best = rings[0], bestLen = 0;
    for (const r of rings) if (r.length > bestLen) { best = r; bestLen = r.length; }
    let x = 0, y = 0;
    for (const [lon, lat] of best) { x += lon; y += lat; }
    return [x / best.length, y / best.length];
  }

  function reposition() {
    if (!map || !labels.length) return;
    labels = labels.map(l => {
      const p = map.project([l.lon, l.lat]);
      return { ...l, x: p.x, y: p.y };
    });
  }

  $effect(() => {
    if (!map || !ready) { labels = []; return; }
    const onMove = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(reposition);
    };
    const onSettle = () => collect();
    map.on('move', onMove);
    map.on('idle', onSettle);
    map.on('sourcedata', onSettle);
    collect();
    return () => {
      cancelAnimationFrame(raf);
      map.off('move', onMove);
      map.off('idle', onSettle);
      map.off('sourcedata', onSettle);
    };
  });

  // Language switch changes every string, so recollect rather than reposition.
  $effect(() => { lang; collect(); });
</script>

<div class="labels" aria-hidden="true">
  {#each labels as l (l.key)}
    <span class="lbl {l.cls}"
          style="left:{l.x}px; top:{l.y}px; font-size:{l.size}px">{l.text}</span>
  {/each}
</div>

<style>
  .labels { position: absolute; inset: 0; pointer-events: none; z-index: 1; }
  .lbl {
    position: absolute;
    transform: translate(-50%, -50%);
    white-space: nowrap;
    font-weight: 600;
    line-height: 1.15;
    /* A halo the cheap way: four offset shadows read as an outline at every
       label size and cost nothing to render. */
    text-shadow:
      0 0 3px #0b0d0f, 1px 0 2px #0b0d0f, -1px 0 2px #0b0d0f,
      0 1px 2px #0b0d0f, 0 -1px 2px #0b0d0f;
  }
  .place { color: #d7dee5; }
  .ward  { color: #e8d9a8; font-weight: 500; }
</style>
