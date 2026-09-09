<script>
  // BaseMap.svelte — real streets under the choropleth.
  //
  // MapLibre and the PMTiles protocol are imported lazily on mount, so a
  // visitor who never opens the map page never downloads the map library, and
  // the page still renders with JavaScript off.
  //
  // If either archive is missing — a static review upload without tiles, or a
  // checkout where build_basemap.py has not been run — this calls
  // onunavailable() and the page falls back to the inline SVG renderer. The
  // real map is an upgrade, never a dependency.
  //
  // Nothing here talks to a third party: no sprite URL, no glyph CDN, no
  // geolocation control. The site must never ask a reporter's browser where
  // they are.

  import { style } from '$lib/mapstyle.js';

  let {
    base = '/dhaka.pmtiles',
    admin = '/dhaka_admin.pmtiles',
    workerUrl = '/maplibre-gl-worker.mjs',
    // The map's own labels are English and live in the tiles (see mapstyle.js);
    // `lang` is kept because the rest of the UI still switches language, and a
    // future style may want it.
    lang = 'bn',
    level = 'ward',            // ward | thana — which layer is live
    colors = {},               // { [areaId]: cssColour | 'suppressed' }
    hazards = [],              // [{ id, lon, lat, state }]
    selected = null,
    hovered = $bindable(null),
    onpick = () => {},
    demo = false,
    demoText = 'DEMO',
    // The in-map watermark is OFF by default at Safi's request: at city zoom it
    // sits across the middle of the map and obstructs reading it. Turn it back
    // on (watermark={demo}) before sharing a link or a screenshot of demo data
    // with anyone outside the room — the red banner and the DEMO in <title>
    // survive a link preview, but neither survives a cropped screenshot.
    watermark = false,
    onunavailable = () => {},
    // --- pick mode -----------------------------------------------------------
    // Used by the report flow to say where a hazard is. The map answers the
    // ward question itself with queryRenderedFeatures against the tiles, so the
    // page no longer downloads ward geometry just to run a point-in-polygon.
    pick = false,
    pinAt = null,                  // [lon, lat] or null
    onpoint = () => {},            // ({ lon, lat, wardId }) => void
  } = $props();

  let container;
  let map = $state(null);
  let ready = $state(false);
  let lastHover = null;
  let prevSelected = null;
  let prevLevel = null;
  let coloured = new Set();   // ids we have set state on, so we can clear them

  const srcLayer = $derived(level === 'thana' ? 'thanas' : 'wards');
  const fillLayer = $derived(level === 'thana' ? 'thana-fill' : 'ward-fill');

  const LEVEL_LAYERS = {
    ward:  ['ward-fill', 'ward-suppressed', 'ward-line', 'ward-selected'],
    thana: ['thana-fill', 'thana-suppressed', 'thana-selected'],
  };

  function ref(id) { return { source: 'admin', sourceLayer: srcLayer, id: Number(id) }; }

  /**
   * An 8px diagonal hatch on a TRANSPARENT ground, drawn in a canvas so no
   * sprite sheet has to be fetched.
   *
   * Transparent matters: 164 of 203 wards are below threshold in a typical
   * period, so an opaque texture would cover most of the city and hide the
   * streets this map exists to show. The lines say "not published here"; the
   * map underneath still says where here is.
   */
  function hatchImage() {
    const n = 8, c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d');
    g.clearRect(0, 0, n, n);
    g.strokeStyle = 'rgba(150,162,174,0.55)';
    g.lineWidth = 1.25;
    g.beginPath();
    g.moveTo(-n, n); g.lineTo(n, -n);
    g.moveTo(0, 2 * n); g.lineTo(2 * n, 0);
    g.stroke();
    return { width: n, height: n, data: new Uint8Array(g.getImageData(0, 0, n, n).data) };
  }

  function applyColors() {
    if (!map || !ready) return;
    for (const id of coloured) {
      map.setFeatureState(ref(id), { color: null, suppressed: false });
    }
    coloured = new Set();
    for (const [id, colour] of Object.entries(colors)) {
      if (colour === 'suppressed') map.setFeatureState(ref(id), { suppressed: true });
      else if (colour) map.setFeatureState(ref(id), { color: colour });
      coloured.add(id);
    }
  }

  function applySelected(prev, next) {
    if (!map || !ready) return;
    if (prev != null) map.setFeatureState(ref(prev), { selected: false });
    if (next != null) map.setFeatureState(ref(next), { selected: true });
  }

  function applyLevel() {
    if (!map || !ready) return;
    for (const [lv, ids] of Object.entries(LEVEL_LAYERS)) {
      for (const id of ids) {
        map.setLayoutProperty(id, 'visibility', lv === level ? 'visible' : 'none');
      }
    }
    // The ward outline stays on under a thana choropleth: it is context, not data.
    map.setLayoutProperty('ward-line', 'visibility', 'visible');
  }

  function applyPin() {
    if (!map || !ready) return;
    map.getSource('pin')?.setData({
      type: 'FeatureCollection',
      features: pinAt
        ? [{ type: 'Feature', properties: {},
             geometry: { type: 'Point', coordinates: pinAt } }]
        : [],
    });
  }

  function applyHazards() {
    if (!map || !ready) return;
    map.getSource('hazards')?.setData({
      type: 'FeatureCollection',
      features: hazards.map(h => ({
        type: 'Feature', id: h.id,
        properties: { id: h.id, state: h.state },
        geometry: { type: 'Point', coordinates: [h.lon, h.lat] },
      })),
    });
  }

  $effect(() => { pinAt; applyPin(); });
  $effect(() => { colors; applyColors(); });
  $effect(() => { hazards; applyHazards(); });
  $effect(() => { if (level !== prevLevel) { prevLevel = level; applyLevel(); applyColors(); } });
  $effect(() => { applySelected(prevSelected, selected); prevSelected = selected; });

  async function reachable(url) {
    try {
      // A range request, not a full GET: proves the archive is there AND that
      // the host honours ranges, which is what PMTiles actually needs.
      const r = await fetch(url, { headers: { Range: 'bytes=0-15' } });
      // A host that ignores Range answers 200 with the whole archive; cancel
      // the body rather than downloading 40 MB to answer a yes/no question.
      r.body?.cancel?.();
      return r.ok;
    } catch { return false; }
  }

  const abs = (u) =>
    typeof window === 'undefined' ? u : new URL(u, window.location.href).href;

  $effect(() => {
    let cancelled = false;
    (async () => {
      if (!(await reachable(base)) || !(await reachable(admin))) { onunavailable(); return; }
      // Namespace import: maplibre-gl v5+ exports addProtocol as a named
      // export, not a property of the default export.
      const [maplibregl, pmtiles] = await Promise.all([
        import('maplibre-gl'), import('pmtiles'),
      ]);
      if (cancelled) return;
      // Without MapLibre's stylesheet the canvas is not absolutely positioned
      // and the container grows to the canvas height instead of holding its
      // aspect ratio. Loaded lazily with the library, not in the main bundle.
      await import('maplibre-gl/dist/maplibre-gl.css');

      // MapLibre v6 resolves its worker relative to its own module URL at
      // runtime, which Vite does not rewrite, so the worker 404s unless we
      // point at a copy we serve ourselves. static/maplibre-gl-worker.mjs is
      // that copy (kept in sync by scripts/vendor_map_worker.sh).
      maplibregl.setWorkerUrl(abs(workerUrl));

      const protocol = new pmtiles.Protocol();
      maplibregl.addProtocol('pmtiles', protocol.tile);

      // Two-phase style load. A fill-pattern layer asks for its image while
      // the style is parsing, which is before any event we can hook, so the
      // map starts empty, the hatch is registered, and only then does the real
      // style go in. Otherwise the suppressed areas render as solid black —
      // the exact thing the texture exists to avoid.
      map = new maplibregl.Map({
        container,
        style: { version: 8, sources: {}, layers: [] },
        center: [90.39, 23.78],
        zoom: 10.4,
        minZoom: 8,
        maxZoom: 16,
        maxBounds: [[90.05, 23.50], [90.65, 24.10]],
        dragRotate: false,
        pitchWithRotate: false,
        // Labels cross-fade over 300ms by default, which reads as "the names
        // arrive late" even though they are drawn in the same frame as the
        // roads. Short enough to feel immediate, long enough not to flicker.
        fadeDuration: 80,
        attributionControl: { compact: true },
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      map.on('error', (e) => {
        const msg = String(e?.error ?? e);
        if (/pmtiles|Failed to fetch/i.test(msg)) { onunavailable(); return; }
        // Anything else is a bug in our own style or data. Swallowing it is how
        // a blank map with a clean console happens, which is a bad half hour.
        console.error('[map]', msg);
      });

      map.on('styleimagemissing', (e) => {
        if (e.id === 'hatch' && !map.hasImage('hatch')) map.addImage('hatch', hatchImage());
      });

      map.once('load', () => {
        if (!map.hasImage('hatch')) map.addImage('hatch', hatchImage());
        map.setStyle(style({ base: abs(base), admin: abs(admin), lang }));
      });

      map.on('styledata', () => {
        if (ready || !map.getLayer('ward-fill')) return;
        ready = true;
        applyLevel();
        applyColors();
        applyHazards();
        applyPin();
        applySelected(null, selected);
      });

      for (const which of pick ? [] : ['ward-fill', 'thana-fill']) {
        map.on('mousemove', which, (e) => {
          const f = e.features?.[0];
          if (!f || which !== fillLayer) return;
          if (lastHover != null && lastHover !== f.id)
            map.setFeatureState(ref(lastHover), { hover: false });
          lastHover = f.id;
          map.setFeatureState(ref(f.id), { hover: true });
          hovered = f.id;
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', which, () => {
          if (lastHover != null) map.setFeatureState(ref(lastHover), { hover: false });
          lastHover = null; hovered = null;
          map.getCanvas().style.cursor = '';
        });
        map.on('click', which, (e) => {
          const f = e.features?.[0];
          if (f && which === fillLayer) onpick(f.id);
        });
      }
      if (pick) {
        map.getCanvas().style.cursor = 'crosshair';
        map.on('click', (e) => {
          // Ward polygons come from our own admin tiles, so the answer is
          // authoritative and needs no GeoJSON download. A tap outside every
          // ward does nothing, which is the same rule the old picker had:
          // Dhaka district only.
          const hit = map.queryRenderedFeatures(e.point, { layers: ['ward-fill'] })[0];
          if (!hit) return;
          onpoint({
            lon: Math.round(e.lngLat.lng * 1e5) / 1e5,
            lat: Math.round(e.lngLat.lat * 1e5) / 1e5,
            wardId: hit.properties?.id ?? hit.id,
          });
          // A pin dropped at city zoom is a guess. Zoom to the first tap so the
          // next one can be the actual manhole; after that leave the view alone,
          // because yanking the map on every correction is worse than imprecise.
          if (map.getZoom() < 14) map.easeTo({ center: e.lngLat, zoom: 15.5, duration: 600 });
        });
      }

      for (const which of ['hazard-dot', 'hazard-halo']) {
        map.on('click', which, (e) => {
          const f = e.features?.[0];
          if (f) onpick(f.properties.id);
        });
      }
    })();
    return () => { cancelled = true; map?.remove(); map = null; ready = false; };
  });
</script>

<div class="map" bind:this={container} role="application"
     aria-label={demo ? 'Dhaka map, demo data' : 'Dhaka map'}>
  {#if demo && watermark}
    <!-- Inside the map container on purpose: a screenshot of the map is a
         screenshot of the watermark. -->
    <div class="wm" aria-hidden="true">{demoText}</div>
  {/if}
</div>

<style>
  .map { position: relative; width: 100%; aspect-ratio: 900 / 620; background: #0f1113; }
  @media (max-width: 700px) { .map { aspect-ratio: 1 / 1; } }
  .wm {
    position: absolute; inset: 0; display: grid; place-items: center;
    font: 700 clamp(28px, 7vw, 64px)/1 system-ui, sans-serif;
    letter-spacing: .18em; color: rgba(226, 183, 20, .28);
    text-transform: uppercase; pointer-events: none; z-index: 2;
  }
</style>
