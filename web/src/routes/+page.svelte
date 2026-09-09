<script>
  import { onMount } from 'svelte';
  import { ui } from '$lib/state.svelte.js';
  import PageHead from '$lib/PageHead.svelte';
  import { strings } from '$lib/i18n.js';
  import { labels } from '$lib/labels.js';
  import { CATEGORIES, HAZARDS, areaCrime, personDirected } from '$lib/taxonomy.js';
  import { num, pct } from '$lib/format.js';
  import { bounds, projector, toPath } from '$lib/geo.js';
  import BaseMap from '$lib/BaseMap.svelte';
  import { RAMP, NO_DATA, SUPPRESSED, buckets, colourFor, legendSteps,
           HAZARD, hazardState } from '$lib/scale.js';

  const t = $derived(strings[ui.lang]);
  const L = $derived(labels[ui.lang]);

  let wardGeo = $state(null), thanaGeo = $state(null);
  let agg = $state(null), press = $state(null), gap = $state(null),
      wards = $state(null), thanas = $state(null), hazards = $state(null),
      methods = $state(null), err = $state(null), demo = $state(false);
  // 'demo' | 'beta' | 'live'. In beta the map is genuinely empty; saying so
  // beats letting a tester conclude the site is broken and close the tab.
  let mode = $state(null);

  let layer = $state('crime');       // crime | hazard
  // 'any' is the default because per-category is where the coverage dies: a
  // ward's reports get split 12 ways before the threshold is applied.
  let category = $state('any');
  // The geography the reader asked for. Thana by default: 46 units instead of
  // 203, so the same reports clear the threshold in far more places. A
  // category's own rule can still force something coarser, never finer.
  let geo = $state('thana');
  let period = $state('all');        // all | day | night
  let view = $state('map');          // map | table
  // Start optimistic: BaseMap flips this off if the PMTiles archives are not
  // there, which is the normal case for a static review upload.
  let tiled = $state(true);
  let hovered = $state(null);        // preview on pointer
  let selected = $state(null);       // pinned by click / Enter — works on touch
  let query = $state('');
  let hazTypes = $state(new Set());  // empty = all
  let hazStatus = $state('all');
  const W = 900, H = 620;

  onMount(async () => {
    try {
      const j = async (u) => (await fetch(u)).json();
      // Ward and thana GeoJSON are NOT fetched here any more. They were 337 KB
      // on every visit, and the map has read its boundaries from the vector
      // tiles since the tiles existed. They are now loaded only if the SVG
      // fallback actually has to draw (see loadShapes below), which is the
      // no-tiles case and nothing else.
      [agg, press, gap, wards, thanas, hazards, methods] =
        await Promise.all([
          j('/data/aggregate.json'), j('/data/press.json'), j('/data/gap.json'),
          j('/data/wards.json'), j('/data/thanas.json'),
          j('/data/hazards.json'), j('/data/methods.json'),
        ]);
      demo = agg?.demo === true;
      mode = agg?.mode ?? (demo ? 'demo' : 'live');
      applyHash();   // after data, so a linked area resolves to a name
    } catch (e) { err = String(e); }
  });

  const DAY = ['morning', 'afternoon'];
  const NIGHT = ['evening', 'night'];

  const RANK = { ward: 0, thana: 1, district: 2 };
  const ruleLevel = $derived(
    category === 'any' ? 'ward' : (agg?.geo_levels?.[category] ?? 'ward'));
  // Never finer than the category's rule; otherwise honour the reader.
  const level = $derived(RANK[geo] > RANK[ruleLevel] ? geo : ruleLevel);
  const shapes = $derived(level === 'ward' ? wardGeo : level === 'thana' ? thanaGeo : null);

  /** Fetch the polygons, once, only when the SVG renderer needs to draw. */
  let loadingShapes = false;
  async function loadShapes() {
    if (loadingShapes || (wardGeo && thanaGeo)) return;
    loadingShapes = true;
    const j = async (u) => (await fetch(u)).json();
    [wardGeo, thanaGeo] = await Promise.all([
      j('/data/dhaka_wards.geojson'), j('/data/dhaka_thanas.geojson')]);
  }
  $effect(() => { if (!tiled) loadShapes(); });
  // Day/night comes from the sliced cells, which only exist at ward level.
  const canSplitTime = $derived(ruleLevel === 'ward' && level === 'ward' && category !== 'any');

  const byArea = $derived.by(() => {
    const m = new Map();
    if (!agg) return m;

    // The default path. `rollups` are totals over every month and time band,
    // each one threshold-checked in its own right by the database. Summing
    // published cells here instead would undercount, because a suppressed cell
    // arrives as null and its reports would silently vanish from the total.
    if (period === 'all') {
      for (const r of agg.rollups ?? []) {
        if (r.l !== level || r.c !== category) continue;
        m.set(r.a, { n: r.n, suppressed: r.s });
      }
      return m;
    }

    // Day/night: the sliced cells, which exist only per category at ward level.
    for (const c of agg.cells) {
      if (c.c !== category) continue;
      if (period === 'day' && !DAY.includes(c.t)) continue;
      if (period === 'night' && !NIGHT.includes(c.t)) continue;
      const cur = m.get(c.a) ?? { n: null, suppressed: false };
      if (c.n === null) cur.suppressed = true;
      else cur.n = (cur.n ?? 0) + c.n;
      m.set(c.a, cur);
    }
    return m;
  });

  // Quantile cuts over what is actually published, recomputed per category and
  // per time filter so the ramp always spends its range on the data on screen.
  const cuts = $derived(buckets([...byArea.values()].map(v => v.n)));
  const publishedValues = $derived([...byArea.values()].map(v => v.n).filter(n => n !== null));
  const legend = $derived(legendSteps(cuts,
    publishedValues.length ? Math.min(...publishedValues) : 1));

  const proj = $derived(shapes ? projector(bounds(shapes.features), W, H) : null);
  const hazardProj = $derived(wardGeo ? projector(bounds(wardGeo.features), W, H) : null);

  function fill(id) {
    const v = byArea.get(String(id));
    if (!v || (v.n === null && !v.suppressed)) return NO_DATA;
    if (v.n === null) return SUPPRESSED;
    return colourFor(v.n, cuts);
  }

  // What the tiled map needs: a plain id -> colour map, and hazards as points.
  // 'suppressed' is a sentinel, not a colour — the map draws it as texture,
  // because below-threshold is not a magnitude.
  // Built from the id lists, not from polygon geometry: the colour of an area
  // never depended on its shape, only on its id.
  const areaIds = $derived(
    level === 'ward' ? (wards?.wards ?? []).map(w => w.id)
    : level === 'thana' ? (thanas?.thanas ?? []).map(t => t.id)
    : []);
  const tileColors = $derived.by(() => {
    const o = {};
    if (layer !== 'crime') return o;
    if (level === 'district') {
      // One figure for the whole district. Painting every thana with it keeps
      // the map on screen and says plainly that this category is not broken
      // down further, instead of swapping the map for a one-row table.
      const v = [...byArea.values()][0];
      const c = !v ? null : v.n === null ? (v.suppressed ? 'suppressed' : null)
                                         : colourFor(v.n, cuts);
      for (const th of thanas?.thanas ?? []) o[th.id] = c;
      return o;
    }
    for (const id of areaIds) {
      const c = fill(id);
      o[id] = c === SUPPRESSED ? 'suppressed' : c === NO_DATA ? null : c;
    }
    return o;
  });

  const tileHazards = $derived.by(() =>
    layer === 'hazard'
      ? shownHazards.map(h => ({ id: h.id, lon: h.lon, lat: h.lat, state: hazardState(h) }))
      : []);

  // --- city-wide findings ----------------------------------------------------
  // GhushSite's headline is a money total. Ours cannot be: a report carries an
  // amount BAND, never an amount, so a taka figure would be invented. What we
  // have instead is the thing no official statistic publishes — what happened
  // to the people who did go to the police — and it is a stronger headline
  // because it is a finding rather than a volume.
  const summary = $derived(agg?.summary ?? []);
  const sumOf = (metric) => summary.filter(r => r.m === metric && r.n !== null)
                                   .sort((a, b) => b.n - a.n);
  const totalReports = $derived(summary.find(r => r.m === 'total' && r.b === 'all')?.n ?? null);
  const wentToPolice = $derived(
    summary.find(r => r.m === 'total' && r.b === 'reported_to_police')?.n ?? null);
  const outcomes = $derived(sumOf('police_outcome'));
  const whyNot = $derived(sumOf('why_not'));
  // Amount bands keep their natural order: they are an ordered scale, and
  // sorting them by size would destroy the only thing the order tells you.
  const amountOrder = ['under_1k', '1k_5k', '5k_25k', '25k_100k', 'over_100k'];
  const amounts = $derived(
    amountOrder
      .map(b => summary.find(r => r.m === 'amount_band' && r.b === b))
      .filter(r => r && r.n !== null));
  const areasWithData = $derived(
    new Set((agg?.rollups ?? [])
      .filter(r => r.l === level && r.n !== null).map(r => r.a)).size);
  const share = (r) => (r.of ? r.n / r.of : 0);

  const emptyBeta = $derived(mode === 'beta' && totals !== null && totals.crowd === 0);

  const totals = $derived.by(() => {
    if (!agg || !press) return null;
    const inScope = (c) => category === 'any' ? areaCrime().includes(c) : c === category;
    const crowd = agg.cells.filter(c => inScope(c.c)).reduce((s, c) => s + (c.n ?? 0), 0);
    const pr = press.cells.filter(c => inScope(c.c)).reduce((s, c) => s + c.n, 0);
    return { crowd, press: pr };
  });

  const wardOf = (id) => wards?.wards.find(x => String(x.id) === String(id)) ?? null;
  const thanaOf = (id) => thanas?.thanas.find(x => String(x.id) === String(id)) ?? null;

  // 'any' is a view, not a taxonomy entry, so it has no labels.js row.
  const catLabel = $derived(category === 'any' ? t.cat_any : L[category]);

  const areaName = (id) => {
    if (level === 'ward') {
      const w = wardOf(id);
      return w ? (ui.lang === 'bn' ? (w.name_bn ?? w.name_en) : w.name_en) : `#${id}`;
    }
    if (level === 'thana') {
      const th = thanaOf(id);
      return th ? (ui.lang === 'bn' ? (th.name_bn ?? th.name_en) : th.name_en) : `#${id}`;
    }
    return String(id);
  };

  const patternFor = (id) =>
    methods?.patterns.find(p => String(p.w) === String(id) && p.c === category) ?? null;

  function statsFor(areaId) {
    if (!agg) return null;
    const mine = agg.cells.filter(c =>
      c.c === category && String(c.a) === String(areaId) && c.n !== null);
    if (!mine.length) return null;
    const total = mine.reduce((s, c) => s + c.n, 0);
    const unrep = mine.reduce((s, c) => s + (c.u ?? 0), 0);
    const months = new Set(mine.map(c => c.m));
    let peak = null;
    if (level === 'ward' && period === 'all') {
      const byBand = {};
      for (const c of mine) byBand[c.t] = (byBand[c.t] ?? 0) + c.n;
      const top = Object.entries(byBand).sort((a, b) => b[1] - a[1])[0];
      if (top && top[0] !== 'unknown') peak = top[0];
    }
    const others = [...byArea.values()].map(v => v.n).filter(n => n !== null);
    const avg = others.length ? others.reduce((a, b) => a + b, 0) / others.length : null;
    const ratio = avg && avg > 0 ? total / avg : null;
    const anySuppressed = agg.cells.some(c =>
      c.c === category && String(c.a) === String(areaId) && c.n === null);
    const pressN = level === 'ward'
      ? (press?.cells ?? []).filter(c => String(c.w) === String(areaId) && c.c === category)
          .reduce((s, c) => s + c.n, 0)
      : 0;
    return { total, unrep, months: months.size, peak, ratio, anySuppressed, pressN };
  }

  /** Month-by-month totals for the sparkline. */
  function seriesFor(areaId) {
    if (!agg) return [];
    const by = new Map();
    for (const c of agg.cells) {
      if (c.c !== category || String(c.a) !== String(areaId) || c.n === null) continue;
      by.set(c.m, (by.get(c.m) ?? 0) + c.n);
    }
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([m, n]) => ({ m, n }));
  }

  const fill1 = (tpl, v) => String(tpl).replace('{n}', v).replace('{x}', v);
  const monthLabel = (iso) => {
    const d = new Date(iso + 'T00:00:00Z');
    const mo = ui.lang === 'bn'
      ? ['জানু','ফেব্রু','মার্চ','এপ্রিল','মে','জুন','জুলাই','আগস্ট','সেপ্ট','অক্টো','নভে','ডিসে']
      : ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return mo[d.getUTCMonth()];
  };

  // --- table view: every value reachable without hovering --------------------
  const rows = $derived.by(() => {
    const out = [];
    for (const [id, v] of byArea) {
      if (v.n === null) continue;
      const st = statsFor(id);
      out.push({ id, name: areaName(id), n: v.n, share: st ? st.unrep / st.total : null });
    }
    return out.sort((a, b) => b.n - a.n);
  });

  const matches = $derived(
    query.trim() ? rows.filter(r => r.name.toLowerCase().includes(query.trim().toLowerCase()))
                 : rows);
  const highlighted = $derived(new Set(query.trim() ? matches.map(r => String(r.id)) : []));

  // --- hazards ---------------------------------------------------------------
  const shownHazards = $derived.by(() => {
    let list = hazards?.hazards ?? [];
    if (hazTypes.size) list = list.filter(h => hazTypes.has(h.c));
    if (hazStatus !== 'all') list = list.filter(h => hazardState(h) === hazStatus);
    return list;
  });
  function toggleType(c) {
    const next = new Set(hazTypes);
    next.has(c) ? next.delete(c) : next.add(c);
    hazTypes = next;
  }

  // --- shareable state -------------------------------------------------------
  // The whole point of a local safety map is showing it to the person who lives
  // there. Without this, "look at Badda" is a screenshot; with it, it is a link.
  // Kept in the hash so it never reaches a server log — the URL of a page about
  // who is being extorted where should not sit in someone's access log.
  let copied = $state(false);

  function stateToHash() {
    const p = new URLSearchParams();
    if (layer !== 'crime') p.set('layer', layer);
    if (category !== 'any') p.set('c', category);
    if (geo !== 'thana') p.set('g', geo);
    if (period !== 'all') p.set('t', period);
    if (selected != null) p.set('a', String(selected));
    return p.toString();
  }

  function applyHash() {
    if (typeof location === 'undefined' || !location.hash) return;
    const p = new URLSearchParams(location.hash.slice(1));
    const l = p.get('layer'); if (l === 'hazard' || l === 'crime') layer = l;
    const c = p.get('c'); if (c) category = c;
    const g = p.get('g'); if (g === 'ward' || g === 'thana') geo = g;
    const tt = p.get('t'); if (tt) period = tt;
    const a = p.get('a'); if (a) selected = a;
  }

  // Selecting an area pushes a history entry, so the phone Back gesture closes
  // the panel instead of leaving the site. Changing a filter replaces, because
  // a back button that walks through every chip tap is worse than useless.
  let lastPushedArea = null;
  $effect(() => {
    const h = stateToHash();
    if (typeof history === 'undefined') return;
    const url = h ? `#${h}` : location.pathname;
    const areaChanged = String(selected) !== String(lastPushedArea);
    if (areaChanged && selected != null) history.pushState(null, '', url);
    else history.replaceState(null, '', url);
    lastPushedArea = selected;
  });

  // ...and Back has to actually put the state back.
  $effect(() => {
    if (typeof window === 'undefined') return;
    const onPop = () => { applyHash(); if (!location.hash) selected = null; };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  });

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(location.href);
      copied = true;
      setTimeout(() => (copied = false), 1600);
    } catch { /* clipboard blocked; the URL bar already shows the link */ }
  }

  // A time split that the current level cannot serve would silently show an
  // empty map, so it is dropped rather than left dangling.
  $effect(() => { if (!canSplitTime && period !== 'all') period = 'all'; });

  const detail = $derived(selected ?? hovered);
  function pick(id) { selected = String(selected) === String(id) ? null : id; }
</script>

<PageHead title={null} description={t.meta_map} />

<!-- The hero used to open with a percentage. A number is evidence, not an
     invitation: it tells a visitor what we found, not what they can do. So the
     first thing on the page is now the situation they are actually in, and the
     one action the site needs from them. The statistic stays, one screen down,
     as the reason to believe the rest. -->
<section class="hero">
  <h1 class="hook">{t.hook}<br /><span class="hook2">{t.hook_2}</span></h1>
  <div class="cta-row">
    <a class="cta big" href="/submit/">{t.hero_cta}</a>
    <span class="cta-sub">{t.hero_cta_sub}</span>
  </div>
</section>

{#if err}<p class="err">could not load data. Is the server running? ({err})</p>{/if}

{#if layer === 'crime' && gap?.districts?.length}
  {@const d = gap.districts[0]}
  <section class="headline">
    <div class="big">{pct(d.unreported_share, ui.lang)}</div>
    <div>
      <div>{t.headline_pre} <strong>{t.headline_post}</strong></div>
      <div class="dim">{t.why_top}: {L[d.top_reason] ?? d.top_reason} · n={num(d.total_n, ui.lang)}</div>
    </div>
  </section>
{/if}

<!-- The dark slab. The map is read at night on a phone, and a dark basemap
     lets the choropleth carry the only strong colour on screen. Everything
     inside inherits the dark token set from .on-dark without knowing it. -->
<div class="dash on-dark">
<!-- Filters in one row above the content they scope. -->
<div class="controls">
  <div class="seg">
    <button class:on={layer === 'crime'} onclick={() => { layer = 'crime'; selected = null; }}>{t.layer_crime}</button>
    <button class:on={layer === 'hazard'} onclick={() => { layer = 'hazard'; selected = null; }}>{t.layer_hazard}</button>
  </div>
  {#if layer === 'crime' && ruleLevel !== 'district'}
    <div class="seg">
      <button class:on={geo === 'thana'} onclick={() => { geo = 'thana'; selected = null; }}>{t.geo_thana}</button>
      <button class:on={geo === 'ward'} onclick={() => { geo = 'ward'; selected = null; }}>{t.geo_ward}</button>
    </div>
  {/if}
  {#if layer === 'crime' && canSplitTime}
    <div class="seg">
      <button class:on={period === 'all'} onclick={() => (period = 'all')}>{t.all_time}</button>
      <button class:on={period === 'day'} onclick={() => (period = 'day')}>☀ {t.day}</button>
      <button class:on={period === 'night'} onclick={() => (period = 'night')}>☾ {t.night}</button>
    </div>
  {/if}
  {#if layer === 'hazard'}
    <div class="seg">
      {#each [['all', t.status_all], ['recent', t.status_open], ['overdue', t.status_overdue], ['fixed', t.status_fixed]] as [k, lbl]}
        <button class:on={hazStatus === k} onclick={() => (hazStatus = k)}>{lbl}</button>
      {/each}
    </div>
  {/if}
  <div class="seg right">
    <button class:on={view === 'map'} onclick={() => (view = 'map')}>{t.view_map}</button>
    <button class:on={view === 'table'} onclick={() => (view = 'table')}>{t.view_table}</button>
  </div>
</div>

{#if layer === 'crime'}
  <div class="cats">
    <button class="chip any" class:on={category === 'any'}
      onclick={() => { category = 'any'; selected = null; }}>{t.cat_any}</button>
    {#each areaCrime() as c}
      <button class="chip" class:on={category === c}
        onclick={() => { category = c; selected = null; }}>{L[c]}</button>
    {/each}
    <span class="divider"></span>
    {#each personDirected() as c}
      <button class="chip pd" class:on={category === c}
        onclick={() => { category = c; selected = null; }}>{L[c]}</button>
    {/each}
  </div>

  <!-- Only when the CATEGORY forces a coarser view. Thana-by-choice is not a
       privacy constraint and saying so here made the notice meaningless. -->
  {#if ruleLevel !== 'ward'}<p class="note">{t.coarse_note}</p>{/if}
  {#if level === 'district'}<p class="note">{t.district_note}</p>{/if}

  {#if totals}
    <div class="counters">
      <div class="counter"><span class="n">{num(totals.crowd, ui.lang)}</span>
        <span class="lbl">{t.crowd} <em class="unv">{t.unverified}</em></span>
        <span class="scope">{t.scope_cat.replace('{c}', catLabel)}</span></div>
      <div class="counter"><span class="n">{num(totals.press, ui.lang)}</span>
        <span class="lbl">{t.press}</span></div>
    </div>
  {/if}
{:else}
  <div class="cats">
    {#each Object.keys(HAZARDS) as c}
      <button class="chip" class:on={hazTypes.has(c)} onclick={() => toggleType(c)}>{L[c]}</button>
    {/each}
    {#if hazTypes.size}
      <button class="chip clear" onclick={() => (hazTypes = new Set())}>{t.reset}</button>
    {/if}
  </div>
  <p class="dim small">{t.showing_of
    .replace('{n}', num(shownHazards.length, ui.lang))
    .replace('{total}', num(hazards?.hazards.length ?? 0, ui.lang))}</p>
{/if}

{#if view === 'table' && layer === 'crime'}
  <input class="search" bind:value={query} placeholder={t.search_area} />
  <table class="listing">
    <thead><tr><th>{t.area_col}</th><th class="r">{t.reports_col}</th><th class="r">{t.unreported_col}</th></tr></thead>
    <tbody>
      {#each matches as r}
        <tr class:sel={String(selected) === String(r.id)}>
          <td><button class="linkish" onclick={() => pick(r.id)}>{r.name}</button></td>
          <td class="r">{num(r.n, ui.lang)}</td>
          <td class="r">{r.share === null ? '' : pct(r.share, ui.lang)}</td>
        </tr>
      {:else}
        <tr><td colspan="3" class="dim">{t.no_match}</td></tr>
      {/each}
    </tbody>
  </table>
{:else}
  {#if emptyBeta}
    <div class="betanote">
      <strong>{t.beta_empty_title}</strong>
      <p>{t.beta_empty_body}</p>
    </div>
  {/if}

  <div class="maptools">
    <input class="search" bind:value={query} placeholder={t.search_area}
           aria-label={t.search_area} />
    {#if query.trim() && matches.length}
      <ul class="hits">
        {#each matches.slice(0, 6) as r}
          <li><button onclick={() => { pick(r.id); query = ''; }}>{r.name}</button></li>
        {/each}
      </ul>
    {/if}
  </div>

  <div class="layout">
    <div class="mapwrap">
      {#if tiled}
        <BaseMap
          level={layer === 'hazard' ? 'ward' : level === 'district' ? 'thana' : level}
          colors={tileColors}
          hazards={tileHazards}
          {selected}
          bind:hovered
          onpick={pick}
          {demo}
          lang={ui.lang}
          demoText={t.demo_watermark}
          onunavailable={() => (tiled = false)} />
      {:else if (layer === 'hazard' ? wardGeo : shapes) && proj}
        <svg viewBox="0 0 {W} {H}" role="img" aria-label="Dhaka">
          <defs>
            <pattern id="hatch" width="6" height="6" patternTransform="rotate(45)"
                     patternUnits="userSpaceOnUse">
              <rect width="6" height="6" fill="#1b1f23"/>
              <line x1="0" y1="0" x2="0" y2="6" stroke="#3a4149" stroke-width="2"/>
            </pattern>
          </defs>

          {#if layer === 'crime'}
            {#each shapes.features as f (f.properties.id)}
              <path d={toPath(f.geometry, proj)} fill={fill(f.properties.id)}
                    stroke={highlighted.has(String(f.properties.id)) ? 'var(--accent)' : '#0f1113'}
                    stroke-width={highlighted.has(String(f.properties.id)) ? 1.6 : 0.6}
                    role="button" tabindex="0"
                    aria-label={areaName(f.properties.id)}
                    onmouseenter={() => (hovered = f.properties.id)}
                    onfocus={() => (hovered = f.properties.id)}
                    onmouseleave={() => (hovered = null)}
                    onblur={() => (hovered = null)}
                    onclick={() => pick(f.properties.id)}
                    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(f.properties.id); } }}
                    class:hi={String(hovered) === String(f.properties.id)}
                    class:sel={String(selected) === String(f.properties.id)} />
            {/each}
          {:else}
            {#each wardGeo.features as f (f.properties.id)}
              <path d={toPath(f.geometry, proj)} fill={NO_DATA} stroke="#0f1113" stroke-width="0.6" />
            {/each}
            {#each shownHazards as h (h.id)}
              {@const st = HAZARD[hazardState(h)]}
              {@const [x, y] = hazardProj([h.lon, h.lat])}
              <!-- A 24px transparent hit area: an 8px dot is a pinpoint nobody
                   hits, least of all with a thumb. -->
              <circle class="hit" cx={x} cy={y} r="12" fill="transparent"
                      role="button" tabindex="0" aria-label={L[h.s]}
                      onmouseenter={() => (hovered = h.id)}
                      onfocus={() => (hovered = h.id)}
                      onmouseleave={() => (hovered = null)}
                      onblur={() => (hovered = null)}
                      onclick={() => pick(h.id)}
                      onkeydown={(e) => { if (e.key === 'Enter') pick(h.id); }} />
              <circle cx={x} cy={y} r={st.r} fill={st.fill} stroke={st.stroke}
                      stroke-width={st.ring ? 1.6 : 0.7} pointer-events="none"
                      class:selmark={String(selected) === String(h.id)} />
            {/each}
          {/if}

          {#if demo}
            <text class="wm" x={W / 2} y={H * 0.5} text-anchor="middle">{t.demo_watermark}</text>
            <text class="wm small" x={W / 2} y={H * 0.5 + 32} text-anchor="middle">
              {ui.lang === 'bn' ? 'প্রকৃত কোনো তথ্য নয়' : 'not real data'}</text>
          {/if}
        </svg>
      {:else if layer === 'crime' && level === 'district'}
        <div class="districtwrap">
          <h2 class="dhead">{L[category]}: {ui.lang === 'bn' ? 'জেলাভিত্তিক' : 'by district'}</h2>
          <table class="listing">
            <tbody>
              {#each [...byArea.entries()] as [name, v]}
                <tr><td>{name}</td>
                  <td class="r">{v.n === null ? t.insufficient : num(v.n, ui.lang)}</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <p class="dim">…</p>
      {/if}
    </div>

    <!-- Detail panel. Hover previews it; a tap pins it. Without the pin the
         whole panel is unreachable on a phone, which has no hover at all. -->
    <aside class="panel" class:pinned={selected != null}>
      {#if detail == null}
        <p class="dim hint">{t.tap_area}</p>
      {:else if layer === 'hazard'}
        {@const h = shownHazards.find(x => String(x.id) === String(detail))}
        {#if h}
          <div class="pname">{L[h.s]}</div>
          <div class="psub">{L[h.c]}</div>
          <div class="pbig">
            {#if h.done}{t.resolved}
            {:else}{num(h.age, ui.lang)}<span class="unit"> {t.open_since}</span>{/if}
          </div>
          {#if h.conf > 0}
            <div class="pstat">{num(h.conf, ui.lang)} {t.confirmations}</div>
          {/if}
          <div class="pfoot">{wardOf(h.w) ? areaName(h.w) : ''}</div>
        {/if}
      {:else}
        {@const v = byArea.get(String(detail))}
        {@const st = statsFor(detail)}
        {@const pat = patternFor(detail)}
        {@const ser = seriesFor(detail)}
        {@const w = level === 'ward' ? wardOf(detail) : null}
        <div class="phead">
          <div>
            <div class="pname">{areaName(detail)}</div>
            {#if w?.upazila}<div class="psub">{t.thana_label}: {w.upazila}</div>{/if}
          </div>
          {#if selected != null}
            <div class="pactions">
              <button class="linkbtn" onclick={copyLink}>{copied ? t.link_copied : t.copy_link}</button>
              <button class="x" onclick={() => (selected = null)} aria-label={t.close}>×</button>
            </div>
          {/if}
        </div>

        {#if !v || (v.n === null && !v.suppressed)}
          <!-- "0" told the reader nothing and read as "this place is safe",
               which is not what an empty cell means. Say what is true and give
               them the one action that changes it. -->
          <div class="pbig muted">{t.no_reports_yet}</div>
          <div class="psub">{catLabel}</div>
          <a class="cta wide" href="/submit/">{t.be_first}</a>
        {:else if v.n === null}
          <div class="pbig muted">{t.insufficient}</div>
          <div class="psub">{catLabel}</div>
        {:else}
          <div class="pbig">{num(v.n, ui.lang)}<span class="unit">{t.reports_unit}</span></div>
          <div class="psub">{catLabel}
            {#if st}· {st.months <= 1 ? t.in_one_month : fill1(t.in_last_months, num(st.months, ui.lang))}{/if}
          </div>

          {#if ser.length > 1}
            {@const max = Math.max(...ser.map(p => p.n))}
            <div class="spark">
              <div class="ptitle">{t.monthly}</div>
              <svg viewBox="0 0 220 56" role="img"
                   aria-label={ser.map(p => `${monthLabel(p.m)} ${p.n}`).join(', ')}>
                <polyline fill="none" stroke="var(--accent)" stroke-width="2"
                          stroke-linejoin="round" stroke-linecap="round"
                          points={ser.map((p, i) =>
                            `${10 + i * (200 / (ser.length - 1))},${48 - (p.n / max) * 38}`).join(' ')} />
                {#each ser as p, i}
                  <circle cx={10 + i * (200 / (ser.length - 1))} cy={48 - (p.n / max) * 38}
                          r="4" fill="var(--accent)" stroke="var(--panel)" stroke-width="2" />
                {/each}
              </svg>
              <div class="sparkx">
                {#each ser as p}<span>{monthLabel(p.m)}</span>{/each}
              </div>
            </div>
          {/if}

          {#if st}
            <div class="pstats">
              {#if st.total > 0}
                <div><b>{pct(st.unrep / st.total, ui.lang)}</b> {t.not_reported_share}</div>
              {/if}
              {#if st.peak}<div>{t.busiest}: <b>{L[st.peak]}</b></div>{/if}
              {#if st.ratio}
                <div>{st.ratio >= 1.15
                  ? fill1(t.vs_average, num(Math.round(st.ratio * 10) / 10, ui.lang))
                  : st.ratio <= 0.85 ? t.vs_average_below : ''}</div>
              {/if}
              {#if st.pressN > 0}<div class="muted">{t.press_here}: {num(st.pressN, ui.lang)}</div>{/if}
              {#if st.anySuppressed}<div class="muted">{t.also_suppressed}</div>{/if}
            </div>
          {/if}

          {#if pat}
            <div class="pattern">
              <div class="ptitle">{t.pattern_title}</div>
              <div>{t.pattern_count}: <b>{L[pat.count] ?? L.unknown}</b></div>
              <div>{t.pattern_vehicle}: <b>{L[pat.vehicle] ?? L.unknown}</b></div>
              <div>{t.pattern_weapon}: <b>{L[pat.weapon] ?? L.unknown}</b></div>
              <div>{t.pattern_approach}: <b>{L[pat.approach] ?? L.unknown}</b></div>
            </div>
          {/if}
          <div class="pfoot warn">{t.unverified}</div>
        {/if}
      {/if}
    </aside>
  </div>
{/if}

<div class="legend">
  {#if layer === 'crime' && level !== 'district'}
    <span class="lgroup">{t.legend_reports}:</span>
    <span><i style="background:{NO_DATA};border:1px solid var(--line)"></i> {t.legend_none}</span>
    {#each legend as s}
      <span><i style="background:{s.colour}"></i>
        {num(s.lo, ui.lang)}{s.hi ? '–' + num(s.hi, ui.lang) : '+'}</span>
    {/each}
    <span><i class="hatchswatch"></i> {t.insufficient}</span>
  {:else if layer === 'hazard'}
    <span><i class="dot" style="background:{HAZARD.recent.fill}"></i> {t.status_open}</span>
    <span><i class="dot big" style="background:{HAZARD.overdue.fill}"></i> {t.status_overdue}</span>
    <span><i class="dot hollow"></i> {t.status_fixed}</span>
  {/if}
</div>

<p class="note">
  {#if layer === 'crime'}
    {ui.lang === 'bn'
      ? 'পাঁচটির কম রিপোর্ট থাকলে সংখ্যা দেখানো হয় না, শূন্যও নয়। কম সংখ্যা প্রকাশ করলে ভুক্তভোগীকে শনাক্ত করা যেতে পারে।'
      : 'Cells with fewer than five reports show no number, and not a zero either. Publishing a small count can identify the person who reported it.'}
  {:else}
    {ui.lang === 'bn'
      ? 'রাস্তার ঝুঁকিতে কোনো ভুক্তভোগী নেই, তাই এগুলো ঠিক জায়গায় এবং সঙ্গে সঙ্গে দেখানো হয়। যত দিন ঠিক না হয়, ঘড়ি চলতে থাকে।'
      : 'A hazard has no victim, so it is shown at its exact spot with no threshold. The clock keeps running until it is fixed.'}
  {/if}
</p>
</div>

<!-- What happens to a report, in three steps, before anyone has to trust us.
     This is the whole privacy design in the only place most visitors will read
     it: the page they landed on. -->
{#if layer === 'crime' && summary.length}
  <section class="findings">
    <h2 class="fhead">{t.findings_title}</h2>
    <!-- These are city-wide across every category, while the counters above
         follow the current filter. Two totals on one page need to say which
         is which, or a careful reader concludes the numbers are broken. -->
    <p class="fscope">{t.scope_city}{#if demo} <span class="warn">· {t.demo_findings}</span>{/if}</p>

    <div class="ftiles">
      <div class="ftile">
        <div class="fbig">{num(totalReports, ui.lang)}</div>
        <div class="flbl">{t.total_reports} <em class="unv">{t.unverified}</em></div>
      </div>
      <div class="ftile">
        <div class="fbig">{num(areasWithData, ui.lang)}</div>
        <div class="flbl">{t.areas_covered}</div>
      </div>
    </div>

    <!-- One bar per outcome, one hue. These are shares of the same whole, not
         separate series, so colour carries no extra meaning and every bar is
         labelled with its own value. -->
    {#if outcomes.length}
      <div class="chart">
        <h3 class="ctitle">{t.went_title}</h3>
        <p class="csub">{fill1(t.went_sub, num(wentToPolice, ui.lang))}</p>
        {#each outcomes as r (r.b)}
          <div class="row">
            <span class="rlbl">{L[r.b] ?? r.b}</span>
            <span class="track" aria-hidden="true">
              <span class="fill" style="width:{(share(r) * 100).toFixed(1)}%"></span>
            </span>
            <span class="rval">{pct(share(r), ui.lang)}
              <span class="rn">{num(r.n, ui.lang)}</span></span>
          </div>
        {/each}
      </div>
    {/if}

    {#if amounts.length}
      <div class="chart">
        <h3 class="ctitle">{t.amount_title}</h3>
        <p class="csub">{t.amount_sub}</p>
        {#each amounts as r, i (r.b)}
          <div class="row">
            <span class="rlbl">{L[r.b] ?? r.b}</span>
            <span class="track" aria-hidden="true">
              <!-- Ordered bands take the ordered ramp from scale.js, the same
                   one the map uses: one hue, monotone lightness, validated
                   against this surface. -->
              <span class="fill" style="width:{(share(r) * 100).toFixed(1)}%;
                background:{RAMP[i]}"></span>
            </span>
            <span class="rval">{pct(share(r), ui.lang)}
              <span class="rn">{num(r.n, ui.lang)}</span></span>
          </div>
        {/each}
      </div>
    {/if}

    {#if whyNot.length}
      <div class="chart">
        <h3 class="ctitle">{t.whynot_title}</h3>
        {#each whyNot.slice(0, 5) as r (r.b)}
          <div class="row">
            <span class="rlbl">{L[r.b] ?? r.b}</span>
            <span class="track" aria-hidden="true">
              <span class="fill" style="width:{(share(r) * 100).toFixed(1)}%"></span>
            </span>
            <span class="rval">{pct(share(r), ui.lang)}
              <span class="rn">{num(r.n, ui.lang)}</span></span>
          </div>
        {/each}
      </div>
    {/if}
  </section>
{/if}

<section class="how">
  {#each [[t.how_1_t, t.how_1_b], [t.how_2_t, t.how_2_b], [t.how_3_t, t.how_3_b]] as [title, body], i}
    <div class="step">
      <div class="stepnum">{num(i + 1, ui.lang)}</div>
      <div>
        <div class="stept">{title}</div>
        <div class="stepb">{body}</div>
      </div>
    </div>
  {/each}
</section>

<p class="pattern">{t.pattern_line}</p>

<style>
  .dash {
    padding: 1.25rem clamp(1rem, 4vw, 3.5rem) 2rem;
    border-block: 1px solid var(--line);
  }
  .err { color: var(--warn); }
  .small { font-size: .82rem; }
  .headline { display: flex; gap: 1rem; align-items: center; background: var(--panel);
    border: 1px solid var(--line); border-radius: 12px; padding: 1rem; margin: 1rem 0; }
  .big { font-size: 2.6rem; font-weight: 700; color: var(--accent); line-height: 1;
    font-variant-numeric: tabular-nums; }
  .dim { color: var(--dim); font-size: .88rem; }

  .controls { display: flex; gap: .6rem; flex-wrap: wrap; margin: 1rem 0 .6rem; align-items: center; }
  .seg { display: flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
  .seg.right { margin-left: auto; }
  .seg button { background: transparent; border: 0; color: var(--dim); padding: .45rem .8rem;
    cursor: pointer; font: inherit; font-size: .88rem; transition: background .15s, color .15s; }
  .seg button:hover { color: var(--ink); background: var(--raise); }
  .seg button.on { background: var(--accent); color: var(--on-accent); font-weight: 600; }

  .cats { display: flex; flex-wrap: wrap; gap: .35rem; align-items: center; margin-bottom: .8rem; }
  .chip { background: none; border: 1px solid var(--line-strong); color: var(--dim);
    border-radius: 999px; padding: .3rem .75rem; font: inherit; font-size: .82rem;
    cursor: pointer; transition: border-color .15s, color .15s, background .15s; }
  .chip:hover { color: var(--ink); border-color: var(--dim); }
  .chip.on { background: var(--accent); border-color: var(--accent); color: var(--on-accent); font-weight: 600; }
  .chip.pd { border-style: dashed; }
  .chip.clear { border-style: dotted; }
  .divider { width: 1px; height: 20px; background: var(--line); margin: 0 .3rem; }

  .counters { display: flex; gap: .8rem; flex-wrap: wrap; margin: .4rem 0 1rem; }
  .counter { flex: 1 1 180px; background: var(--panel); border: 1px solid var(--line);
    border-radius: 12px; padding: .7rem .9rem; }
  .counter .n { font-size: 1.7rem; font-weight: 700; display: block; font-variant-numeric: tabular-nums; }
  .counter .lbl { color: var(--dim); font-size: .85rem; }
  .unv {
    /* The most legally important word on the page was also the least readable:
       #c9564b at 11.2px measures 4.09:1 against this panel, under the 4.5 floor.
       A lighter step of the same warning hue measures 7.03:1, and the type is
       up to 12px. Nothing else about it changes. */
    color: var(--warn); border: 1px solid var(--warn); border-radius: 4px;
    padding: .05rem .35rem; font-size: .75rem; font-style: normal;
    margin-left: .3rem; white-space: nowrap; }

  .hero { margin: .6rem 0 1.4rem; }
  .hook { font-size: clamp(1.35rem, 4.2vw, 2.1rem); line-height: 1.25; margin: 0 0 .9rem;
          max-width: 30ch; }
  .hook2 { color: var(--dim); font-weight: 600; }
  .cta-row { display: flex; align-items: center; gap: .8rem; flex-wrap: wrap; }
  .cta.big { font-size: 1rem; padding: .6rem 1.4rem; }
  .cta-sub { color: var(--dim); font-size: .86rem; }

  .how { display: grid; grid-template-columns: repeat(3, 1fr); gap: .8rem; margin-bottom: 1.4rem; }
  @media (max-width: 760px) { .how { grid-template-columns: 1fr; } }
  .step { display: flex; gap: .7rem; background: var(--panel); border: 1px solid var(--line);
          border-radius: 12px; padding: .8rem .9rem; }
  .stepnum { flex: none; width: 1.7rem; height: 1.7rem; border-radius: 999px;
             display: grid; place-items: center; font-weight: 700; font-size: .85rem;
             background: var(--line); color: var(--ink); }
  .stept { font-weight: 700; margin-bottom: .15rem; }
  .stepb { color: var(--dim); font-size: .86rem; line-height: 1.45; }
  .betanote {
    background: var(--panel); border: 1px solid var(--accent);
    border-radius: 12px; padding: .8rem 1rem; margin-bottom: .8rem;
  }
  .betanote p { color: var(--dim); font-size: .88rem; margin: .25rem 0 0; }
  .findings { margin: 1.6rem 0 1.2rem; }
  .fscope { color: var(--dim); font-size: .82rem; margin: -.4rem 0 .8rem; }
  .fscope .warn { color: var(--warn); margin-left: .4rem; }
  .counter .scope { display: block; color: var(--dim); font-size: .75rem; margin-top: .15rem; }
  .fhead { font-size: 1.05rem; margin: 0 0 .7rem; }
  .ftiles { display: flex; gap: .8rem; flex-wrap: wrap; margin-bottom: 1rem; }
  .ftile { flex: 1 1 12rem; background: var(--panel); border: 1px solid var(--line);
           border-radius: 12px; padding: .8rem .9rem; }
  .fbig { font-size: 1.7rem; font-weight: 700; line-height: 1.1; }
  .flbl { color: var(--dim); font-size: .84rem; margin-top: .2rem; }
  .chart { background: var(--panel); border: 1px solid var(--line);
           border-radius: 12px; padding: .9rem 1rem; margin-bottom: .8rem; }
  .ctitle { font-size: .95rem; margin: 0 0 .15rem; }
  .csub { color: var(--dim); font-size: .82rem; margin: 0 0 .7rem; }
  /* label | bar | value. The bar is the only thing that scales, so the labels
     stay left-aligned and the numbers stay readable at any width. */
  .row { display: grid; grid-template-columns: minmax(6.5rem, 11rem) 1fr auto;
         align-items: center; gap: .7rem; margin: .35rem 0; }
  .rlbl { color: var(--ink); font-size: .85rem; }
  .track { height: 10px; background: var(--raise-2); border-radius: 999px; overflow: hidden; }
  .fill { display: block; height: 100%; background: var(--accent);
          border-radius: 999px; min-width: 3px; }
  .rval { font-variant-numeric: tabular-nums; font-size: .85rem; white-space: nowrap; }
  .rn { color: var(--dim); font-size: .78rem; margin-left: .35rem; }
  @media (max-width: 560px) {
    .row { grid-template-columns: 1fr auto; row-gap: .2rem; }
    .track { grid-column: 1 / -1; }
  }

  .pattern { color: var(--dim); font-size: .9rem; border-left: 2px solid var(--accent);
             padding-left: .8rem; margin: -.4rem 0 1.2rem; max-width: 52rem; }

  /* Map and panel side by side on a wide screen; stacked on a phone. */
  .layout { display: grid; grid-template-columns: minmax(0, 1fr) 19rem; gap: .8rem; align-items: stretch; }
  @media (max-width: 820px) { .layout { grid-template-columns: 1fr; } }

  .mapwrap { position: relative; background: var(--panel); border: 1px solid var(--line);
    border-radius: 12px; overflow: hidden; }

  /* Search and the report button sit directly above the map, because those are
     the two things a visitor does here: find their area, or add to it. */
  .maptools { position: relative; display: flex; gap: .5rem; margin: .1rem 0 .5rem; }
  .maptools .search { flex: 1; min-width: 0; }
  .maptools .hits {
    position: absolute; top: 100%; left: 0; right: 0; z-index: 5;
    margin: .25rem 0 0; padding: .25rem; list-style: none;
    background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0,0,0,.45);
  }
  .maptools .hits button {
    display: block; width: 100%; text-align: left; padding: .4rem .5rem;
    background: none; border: 0; color: var(--ink); cursor: pointer;
    border-radius: 7px; font: inherit;
  }
  .maptools .hits button:hover { background: var(--line); }
  .cta {
    display: inline-flex; align-items: center; white-space: nowrap;
    padding: .45rem .8rem; border-radius: 999px; text-decoration: none;
    background: var(--accent); color: var(--on-accent); font-weight: 700;
  }
  .cta.wide { display: flex; justify-content: center; margin-top: .6rem; }
  .chip.any { border-style: solid; font-weight: 700; }
  .pactions { display: flex; align-items: center; gap: .25rem; }
  .linkbtn {
    background: none; border: 1px solid var(--line); color: var(--dim);
    border-radius: 999px; padding: .15rem .5rem; font-size: .72rem; cursor: pointer;
  }
  .linkbtn:hover { color: var(--ink); }
  svg { width: 100%; height: auto; display: block; }
  path { cursor: pointer; transition: fill .25s ease, stroke-width .12s; }
  path:focus-visible { outline: none; stroke: var(--accent); stroke-width: 2; }
  path.hi { stroke: var(--ink); stroke-width: 1.4; }
  path.sel { stroke: var(--accent); stroke-width: 2.2; }
  circle.hit { cursor: pointer; }
  circle.hit:focus-visible { outline: none; stroke: var(--accent); stroke-width: 2; }
  .selmark { stroke: var(--accent) !important; stroke-width: 2.4 !important; }
  .wm { fill: #fff; opacity: .13; font-size: 62px; font-weight: 800; letter-spacing: .06em;
    pointer-events: none; user-select: none; }
  .wm.small { font-size: 21px; font-weight: 600; opacity: .16; letter-spacing: .1em; }
  .districtwrap { padding: 1rem; }
  .dhead { font-size: 1rem; margin: 0 0 .5rem; }

  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
    padding: .85rem .9rem; min-height: 12rem; }
  .panel.pinned { border-color: var(--accent); }
  .hint { margin: 0; }
  .phead { display: flex; justify-content: space-between; align-items: flex-start; gap: .5rem; }
  .pname { font-weight: 700; }
  .psub { color: var(--dim); font-size: .8rem; }
  .pbig { font-size: 1.9rem; font-weight: 700; margin-top: .35rem; line-height: 1.05;
    font-variant-numeric: tabular-nums; }
  .pbig .unit { font-size: .8rem; font-weight: 400; color: var(--dim); }
  .pbig.muted { font-size: 1.05rem; color: var(--dim); font-weight: 600; }
  .x { background: none; border: 0; color: var(--dim); font-size: 1.3rem; line-height: 1;
    cursor: pointer; padding: 0 .2rem; }
  .x:hover { color: var(--ink); }
  .pstats { margin-top: .55rem; font-size: .85rem; display: grid; gap: .15rem; }
  .pstat { margin-top: .4rem; font-size: .85rem; }
  .muted { color: var(--dim); }
  .pattern { margin-top: .6rem; padding-top: .5rem; border-top: 1px solid var(--line);
    font-size: .82rem; display: grid; gap: .12rem; }
  .ptitle { color: var(--dim); margin-bottom: .25rem; }
  .pfoot { margin-top: .6rem; padding-top: .45rem; border-top: 1px solid var(--line);
    font-size: .72rem; color: var(--dim); }
  .pfoot.warn { color: var(--warn); text-transform: uppercase; letter-spacing: .04em; }

  .spark { margin-top: .7rem; }
  .spark svg { width: 100%; height: auto; }
  .sparkx { display: flex; justify-content: space-between; color: var(--dim); font-size: .7rem;
    padding: 0 .2rem; }

  .search { width: 100%; padding: .55rem .8rem; border-radius: 8px; border: 1px solid var(--line-strong);
    background: var(--field); color: var(--ink); font: inherit; margin-bottom: .6rem; }
  .listing { width: 100%; border-collapse: collapse; font-size: .9rem; }
  .listing th, .listing td { text-align: left; padding: .45rem .6rem; border-bottom: 1px solid var(--line); }
  .listing th { color: var(--dim); font-weight: 500; font-size: .8rem; }
  .listing td.r, .listing th.r { text-align: right; font-variant-numeric: tabular-nums; }
  .listing tr.sel { background: var(--raise); }
  .linkish { background: none; border: 0; color: var(--ink); font: inherit; cursor: pointer;
    padding: 0; text-align: left; }
  .linkish:hover { color: var(--accent); }

  .legend { display: flex; gap: .9rem; color: var(--dim); font-size: .78rem; margin: .7rem 0;
    flex-wrap: wrap; align-items: center; }
  .lgroup { color: var(--ink); }
  .legend i { display: inline-block; width: 14px; height: 12px; border-radius: 3px;
    vertical-align: -1px; margin-right: .3rem; }
  .legend i.dot { border-radius: 50%; width: 9px; height: 9px; }
  .legend i.dot.big { width: 12px; height: 12px; }
  .legend i.dot.hollow { background: none; border: 2px solid var(--dim); width: 9px; height: 9px; }
  .hatchswatch { background: repeating-linear-gradient(45deg,#1b1f23,#1b1f23 3px,#3a4149 3px,#3a4149 5px); }

  .note { color: var(--dim); font-size: .85rem; border-left: 2px solid var(--line); padding-left: .8rem; }

  /* On a phone the map is the product, and it was being pushed below four rows
     of chrome. The category list becomes one horizontally scrolling strip
     instead of wrapping to four lines, and the counters sit side by side. */
  @media (max-width: 560px) {
    /* The sticky header already carries the site name; repeating it here costs
       a screen-height of the thing people came for. */
    /* The old h1 was the site name, already in the header, and the tagline
       sat under it; both are gone from this page now. The h1 is the hook,
       which is the one thing a phone visitor must read. */
    .hook { font-size: 1.25rem; margin-bottom: .7rem; }
    .hero { margin: .2rem 0 1rem; }
    .headline { padding: .7rem .8rem; gap: .7rem; margin-top: .2rem; }
    .big { font-size: 2rem; }
    /* A horizontal scroller for 13 chips: wrapping them would eat half the
       screen. The mask fades the right edge so it is visibly scrollable
       instead of just looking cut off. */
    .cats { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none;
      -webkit-overflow-scrolling: touch; padding-bottom: .2rem;
      scroll-snap-type: x proximity;
      -webkit-mask-image: linear-gradient(to right, #000 88%, transparent 100%);
      mask-image: linear-gradient(to right, #000 88%, transparent 100%); }
    .cats::-webkit-scrollbar { display: none; }
    .chip { flex: 0 0 auto; scroll-snap-align: start; }
    .divider { flex: 0 0 1px; }
    .counters { gap: .5rem; }
    .counter { flex: 1 1 0; min-width: 0; padding: .55rem .7rem; }
    .counter .n { font-size: 1.35rem; }
    .counter .lbl { font-size: .75rem; }
    .unv { display: inline-block; margin: .2rem 0 0; }
    .controls { gap: .4rem; }
    .seg.right { margin-left: 0; }
    .seg button { padding: .4rem .7rem; font-size: .82rem; }
    .panel { min-height: 0; }
  }

  @media (prefers-reduced-motion: reduce) {
    path, .seg button, .chip { transition: none; }
  }
</style>
