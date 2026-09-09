<script>
  // One question per screen, no account, under two minutes. Nothing is saved
  // between screens on the server: there is no draft, no session, and no
  // back-navigation state to recover. Closing the tab loses the report, which
  // is correct — the alternative is a server-side record of a half-finished one.
  import { onMount } from 'svelte';
  import { ui } from '$lib/state.svelte.js';
  import PageHead from '$lib/PageHead.svelte';
  import { strings } from '$lib/i18n.js';
  import { labels } from '$lib/labels.js';
  import { CATEGORIES, HAZARDS, METHOD, WHY_NOT, OUTCOMES, AMOUNT_BANDS,
           TIME_BANDS, areaCrime, personDirected, subsOf,
           SUPPORT_RESOURCE_CATEGORIES } from '$lib/taxonomy.js';
  import { num, recentWeeks, weekLabel } from '$lib/format.js';
  import { bounds, projector, unprojector, toPath, featureAt } from '$lib/geo.js';
  import BaseMap from '$lib/BaseMap.svelte';

  const t = $derived(strings[ui.lang]);
  const L = $derived(labels[ui.lang]);

  let kind = $state(null);            // 'incident' | 'hazard'
  let step = $state(0);
  let sending = $state(false), done = $state(null), error = $state(null);
  // The same build is served two ways: by the API server, where submitting
  // works, and as plain static files on a review host, where there is no write
  // path at all. Rather than shipping a form that fails with a network error,
  // detect it once and say plainly that this is a preview.
  let reviewMode = $state(false);
  let wards = $state([]), thanas = $state([]), wardGeo = $state(null), q = $state('');

  let f = $state({
    category: null, subcategory: null, ward_id: null, thana_id: null,
    occurred_week: null, time_band: null, reported_to_police: null,
    why_not_reported: null, police_outcome: null, amount_band: null,
    offender_count: null, offender_vehicle: null, weapon: null, approach: null,
  });
  let hz = $state({ category: null, subcategory: null, lon: null, lat: null, ward_id: null });

  onMount(async () => {
    const j = async (u) => (await fetch(u)).json();
    // The ward polygons are only needed by the SVG fallback picker, which only
    // runs when the map tiles are missing. 259 KB is not worth downloading on
    // the chance that happens.
    const [w, th] = await Promise.all([
      j('/data/wards.json'), j('/data/thanas.json')]);
    wards = w.wards; thanas = th.thanas;

    try {
      const r = await fetch('/api/pow', { cache: 'no-store' });
      reviewMode = !r.ok;
    } catch { reviewMode = true; }
  });

  const matches = $derived(
    q.trim().length < 1 ? wards.slice(0, 40)
      : wards.filter(w => (w.name_en + ' ' + (w.name_bn ?? '') + ' ' + (w.upazila ?? ''))
          .toLowerCase().includes(q.toLowerCase())).slice(0, 60));
  const wardLabel = (w) => ui.lang === 'bn'
    ? (w.name_bn ? `${w.name_bn} · ${w.upazila}` : w.name_en) : w.name_en;

  const rule = $derived(f.category ? CATEGORIES[f.category] : null);
  const needsThana = $derived(rule?.thana === true);
  const needsAmount = $derived(rule?.amount === true);
  const isPersonDirected = $derived(rule?.class === 'person_directed');

  // Proof of work, in the browser, in the open. About a second of arithmetic:
  // free for one honest person, expensive for ten thousand fake submissions.
  // It replaces a captcha, which would mean a third party watching this page.
  async function solve(challenge, bits) {
    const enc = new TextEncoder();
    for (let n = 0; ; n++) {
      const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`${challenge}:${n}`)));
      let z = 0;
      for (const b of d) { if (b === 0) { z += 8; continue; } z += Math.clz32(b) - 24; break; }
      if (z >= bits) return String(n);
    }
  }

  async function post(path, payload) {
    const { challenge, bits } = await (await fetch('/api/pow')).json();
    const nonce = await solve(challenge, bits);
    const body = { ...payload, challenge, nonce };
    for (const k of Object.keys(body)) if (body[k] === null) delete body[k];
    const r = await fetch(path, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.errors?.join(', ') ?? j.error ?? 'rejected');
    return j;
  }

  async function send() {
    sending = true; error = null;
    try {
      done = kind === 'hazard'
        ? await post('/api/hazard', hz)
        : await post('/api/submit', needsThana ? f : { ...f, thana_id: f.thana_id });
    } catch (e) { error = String(e.message ?? e); }
    finally { sending = false; }
  }

  // --- hazard map ----------------------------------------------------------
  const MW = 900, MH = 560;
  const hb = $derived(wardGeo ? bounds(wardGeo.features) : null);
  const hproj = $derived(hb ? projector(hb, MW, MH) : null);
  const hunproj = $derived(hb ? unprojector(hb, MW, MH) : null);
  let pin = $state(null);
  // The real map answers "which ward is this point in" from its own tiles.
  // The SVG picker below is kept for the case where the tile archives are not
  // deployed: a reporter must always be able to say where, even on a static
  // review host with no map.
  let tiled = $state(true);
  $effect(() => {
    if (tiled || wardGeo) return;
    fetch('/data/dhaka_wards.geojson').then(r => r.json()).then(g => (wardGeo = g));
  });
  let pinLngLat = $state(null);

  function dropPin({ lon, lat, wardId }) {
    pinLngLat = [lon, lat];
    hz.lon = lon;
    hz.lat = lat;
    hz.ward_id = wardId;
  }

  function tapMap(e) {
    const svg = e.currentTarget;
    const r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * MW;
    const y = ((e.clientY - r.top) / r.height) * MH;
    const [lon, lat] = hunproj([x, y]);
    const feat = featureAt(wardGeo.features, [lon, lat]);
    if (!feat) return;                       // taps outside any ward do nothing
    pin = [x, y];
    hz.lon = Math.round(lon * 1e5) / 1e5;
    hz.lat = Math.round(lat * 1e5) / 1e5;
    hz.ward_id = feat.properties.id;
  }

  const INCIDENT_TITLES = $derived([t.q_what, t.q_where, t.q_when, t.q_how, t.q_reported, t.q_review]);
  const HAZARD_TITLES = $derived([t.q_hazard_what, t.q_hazard_where, t.q_review]);
  const titles = $derived(kind === 'hazard' ? HAZARD_TITLES : INCIDENT_TITLES);

  const canNext = $derived.by(() => {
    if (kind === 'hazard') {
      if (step === 0) return !!hz.subcategory;
      if (step === 1) return hz.ward_id != null;
      return true;
    }
    if (step === 0) return !!f.subcategory;
    if (step === 1) return !!f.ward_id && (!needsThana || !!f.thana_id);
    if (step === 2) return !!f.occurred_week && !!f.time_band;
    if (step === 3) return true;                      // "how" is optional
    if (step === 4) return f.reported_to_police === true ? true : !!f.why_not_reported;
    return true;
  });

  function chooseCategory(c) { f.category = c; f.subcategory = null; }
  function chooseHazard(cat, sub) { hz.category = cat; hz.subcategory = sub; }
</script>

<PageHead title={t.nav_submit} description={t.meta_submit} />

{#if done}
  <section class="card done">
    <h1>{t.thanks}</h1>
    <p>{t.no_receipt}</p>
    <p class="dim">
      {ui.lang === 'bn'
        ? `আপনার রিপোর্ট ${done.queued ? 'যাচাইয়ের জন্য সারিতে আছে' : 'পরবর্তী প্রকাশে যুক্ত হবে'}।`
        : done.queued ? 'It is in the review queue. Nothing publishes instantly.'
                      : 'It will appear at the next batch publish.'}
    </p>
    {#if kind === 'incident' && SUPPORT_RESOURCE_CATEGORIES.includes(f.category)}
      <!-- For person-directed reports a thank-you is not enough on its own. -->
      <div class="support">
        <strong>{t.support_title}</strong>
        <p>{t.support_body}</p>
        <a href="/gd/">{t.nav_gd}</a>
      </div>
    {/if}
    <a class="btn" href="/">{t.nav_map}</a>
  </section>

{:else if !kind}
  <h1>{t.what_report}</h1>
  <!-- Detected on load, so say it on the screen a reviewer actually starts on.
       It used to appear only at step 5, after six screens of answering. -->
  {#if reviewMode}<p class="reviewnote">{t.review_notice_early}</p>{/if}
  <div class="kinds">
    <button class="kind" onclick={() => { kind = 'incident'; step = 0; }}>
      <strong>{t.kind_incident}</strong><span>{t.kind_incident_sub}</span></button>
    <button class="kind" onclick={() => { kind = 'hazard'; step = 0; }}>
      <strong>{t.kind_hazard}</strong><span>{t.kind_hazard_sub}</span></button>
  </div>

{:else}
  <div class="steps">{#each titles as _, i}<i class:on={i <= step}></i>{/each}</div>
  <h1>{titles[step]}</h1>

  <section class="card">
    {#if kind === 'hazard'}
      {#if step === 0}
        {#each Object.entries(HAZARDS) as [cat, subs]}
          <div class="group">
            <div class="gtitle">{L[cat]}</div>
            <div class="grid">
              {#each subs as s}
                <button class="opt" class:on={hz.subcategory === s}
                  onclick={() => chooseHazard(cat, s)}>{L[s]}</button>
              {/each}
            </div>
          </div>
        {/each}
      {:else if step === 1}
        <p class="dim">{t.tap_map}</p>
        {#if tiled}<p class="dim small">{t.tap_map_zoom}</p>{/if}
        {#if tiled}
          <!-- The same map as the front page, in pick mode: real streets, so a
               reporter can find the actual manhole rather than guessing at a
               shape. Zoom and pan are the point here, which the flat SVG could
               never offer. -->
          <div class="pickwrap">
            <BaseMap pick pinAt={pinLngLat} onpoint={dropPin}
                     lang={ui.lang} onunavailable={() => (tiled = false)} />
          </div>
        {:else if wardGeo && hproj}
          <svg class="pickmap" viewBox="0 0 {MW} {MH}" onclick={tapMap} role="presentation">
            {#each wardGeo.features as ft}
              <path d={toPath(ft.geometry, hproj)} fill="#1b1f23" stroke="#0f1113" stroke-width="0.6"/>
            {/each}
            {#if pin}<circle cx={pin[0]} cy={pin[1]} r="6" fill="var(--accent)" stroke="#0f1113"/>{/if}
          </svg>
        {/if}
        {#if hz.ward_id}
          <p class="dim">{wards.find(w => w.id === hz.ward_id)
            ? wardLabel(wards.find(w => w.id === hz.ward_id)) : ''}</p>
        {/if}
      {:else}
        <ul class="review">
          <li><span>{t.q_hazard_what}</span> {L[hz.subcategory]}</li>
          <li><span>{t.q_hazard_where}</span> {wards.find(w => w.id === hz.ward_id)
            ? wardLabel(wards.find(w => w.id === hz.ward_id)) : L.unknown}</li>
        </ul>
        <p class="dim">{ui.lang === 'bn'
          ? 'শুধু জায়গা ও সমস্যার ধরন পাঠানো হবে। আপনার সম্পর্কে কিছুই নয়।'
          : 'Only the spot and the type of problem are sent. Nothing about you.'}</p>
        {#if reviewMode}
          <div class="review-note">
            <strong>{t.review_title}</strong>
            <p>{t.review_body}</p>
          </div>
        {/if}
        {#if error}<p class="err">{error}</p>{/if}
        <button class="btn wide" disabled={sending || reviewMode} onclick={send}>
          {reviewMode ? t.review_badge : sending ? t.working : t.submit}
        </button>
      {/if}

    {:else if step === 0}
      <div class="cats">
        {#each areaCrime() as c}
          <button class="chip" class:on={f.category === c} onclick={() => chooseCategory(c)}>{L[c]}</button>
        {/each}
      </div>
      <div class="cats pd">
        {#each personDirected() as c}
          <button class="chip pdc" class:on={f.category === c} onclick={() => chooseCategory(c)}>{L[c]}</button>
        {/each}
      </div>
      {#if f.category}
        <div class="grid sub">
          {#each subsOf(f.category) as s}
            <button class="opt" class:on={f.subcategory === s} onclick={() => (f.subcategory = s)}>{L[s]}</button>
          {/each}
        </div>
      {/if}
      {#if isPersonDirected}
        <p class="note">{t.coarse_note}</p>
      {/if}

    {:else if step === 1}
      <!-- Searchable ward list. There is no "use my location" button, and the
           page never asks the browser for GPS: an exact coordinate is the one
           thing that cannot be un-learned once collected. -->
      <input class="search" bind:value={q} placeholder={t.searching} />
      <div class="list">
        {#each matches as w}
          <button class="row" class:on={f.ward_id === w.id}
            onclick={() => { f.ward_id = w.id; f.thana_id = w.thana_id; }}>
            {wardLabel(w)}<span class="dim"> · {w.upazila}</span>
          </button>
        {/each}
      </div>

    {:else if step === 2}
      <div class="grid">
        {#each recentWeeks(8) as wk}
          <button class="opt" class:on={f.occurred_week === wk}
            onclick={() => (f.occurred_week = wk)}>{weekLabel(wk, ui.lang)}</button>
        {/each}
      </div>
      <p class="dim">{ui.lang === 'bn'
        ? 'আমরা শুধু সপ্তাহ নিই, নির্দিষ্ট তারিখ নয়।'
        : 'We take the week only, never the exact date.'}</p>
      <div class="grid sub">
        {#each TIME_BANDS as b}
          <button class="opt" class:on={f.time_band === b} onclick={() => (f.time_band = b)}>{L[b]}</button>
        {/each}
      </div>

    {:else if step === 3}
      <!-- "How it happened", as closed options. This is the part that makes the
           site useful tonight (two on a motorcycle, from behind, after dark)
           without a free-text box. Every field is optional. -->
      <p class="dim">{t.q_how_opt}</p>
      {#each Object.entries(METHOD) as [field, options]}
        <div class="group">
          <div class="gtitle">{t['pattern_' + field.replace('offender_', '')] ?? field}</div>
          <div class="grid">
            {#each options as o}
              <button class="opt" class:on={f[field] === o}
                onclick={() => (f[field] = f[field] === o ? null : o)}>{L[o]}</button>
            {/each}
          </div>
        </div>
      {/each}

    {:else if step === 4}
      <div class="grid">
        <button class="opt" class:on={f.reported_to_police === true}
          onclick={() => { f.reported_to_police = true; f.why_not_reported = null; }}>{t.yes}</button>
        <button class="opt" class:on={f.reported_to_police === false}
          onclick={() => { f.reported_to_police = false; f.police_outcome = null; }}>{t.no}</button>
      </div>
      {#if f.reported_to_police === true}
        <div class="grid sub">
          {#each OUTCOMES as o}
            <button class="opt" class:on={f.police_outcome === o} onclick={() => (f.police_outcome = o)}>{L[o]}</button>
          {/each}
        </div>
      {:else if f.reported_to_police === false}
        <div class="grid sub one">
          {#each WHY_NOT as w}
            <button class="opt" class:on={f.why_not_reported === w} onclick={() => (f.why_not_reported = w)}>{L[w]}</button>
          {/each}
        </div>
      {/if}
      {#if needsAmount}
        <div class="grid sub">
          {#each AMOUNT_BANDS as a}
            <button class="opt" class:on={f.amount_band === a} onclick={() => (f.amount_band = a)}>{L[a]}</button>
          {/each}
        </div>
      {/if}

    {:else}
      <ul class="review">
        <li><span>{t.q_what}</span> {L[f.category]} · {L[f.subcategory]}</li>
        <li><span>{t.q_where}</span> {wards.find(w => w.id === f.ward_id)
          ? wardLabel(wards.find(w => w.id === f.ward_id)) : L.unknown}</li>
        <li><span>{t.q_when}</span> {weekLabel(f.occurred_week, ui.lang)} · {L[f.time_band]}</li>
        {#if f.offender_count || f.offender_vehicle || f.weapon || f.approach}
          <li><span>{t.q_how}</span>
            {[f.offender_count, f.offender_vehicle, f.weapon, f.approach]
              .filter(Boolean).map(v => L[v]).join(' · ')}</li>
        {/if}
        <li><span>{t.q_reported}</span>
          {f.reported_to_police ? `${t.yes}${f.police_outcome ? ' · ' + L[f.police_outcome] : ''}`
                                : `${t.no} · ${L[f.why_not_reported]}`}</li>
        {#if f.amount_band}<li><span>৳</span> {L[f.amount_band]}</li>{/if}
      </ul>
      <p class="dim">{ui.lang === 'bn'
        ? 'উপরের তথ্যটুকুই পাঠানো হবে। নাম, ফোন নম্বর বা অবস্থান কিছুই নেওয়া হয় না।'
        : 'Only the above is sent. No name, no phone number, no location.'}</p>
      {#if reviewMode}
        <div class="review-note">
          <strong>{t.review_title}</strong>
          <p>{t.review_body}</p>
        </div>
      {/if}
      {#if error}<p class="err">{error}</p>{/if}
      <button class="btn wide" disabled={sending || reviewMode} onclick={send}>
        {reviewMode ? t.review_badge : sending ? t.working : t.submit}
      </button>
    {/if}
  </section>

  <div class="nav">
    <button class="btn ghost" onclick={() => { if (step === 0) kind = null; else step--; }}>{t.back}</button>
    {#if step < titles.length - 1}
      <button class="btn" disabled={!canNext} onclick={() => step++}>{t.next}</button>
    {/if}
  </div>
{/if}

<style>
  .steps { display: flex; gap: .3rem; margin: .5rem 0 1rem; }
  .steps i { flex: 1; height: 4px; border-radius: 2px; background: var(--line); }
  .steps i.on { background: var(--accent); }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 1rem; }
  .reviewnote {
    background: #2a2216; border: 1px solid var(--accent); color: var(--ink);
    border-radius: 10px; padding: .6rem .8rem; font-size: .88rem; margin: 0 0 1rem;
  }
  .kinds { display: flex; flex-direction: column; gap: .7rem; }
  .kind { display: flex; flex-direction: column; gap: .2rem; text-align: left;
    background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
    padding: 1rem; color: var(--ink); font: inherit; cursor: pointer; }
  .kind span { color: var(--dim); font-size: .85rem; }
  .kind:hover { border-color: var(--accent); }
  .grid { display: flex; flex-wrap: wrap; gap: .5rem; }
  .grid.sub { margin-top: .9rem; padding-top: .9rem; border-top: 1px solid var(--line); }
  .grid.one { flex-direction: column; }
  .group { margin-bottom: 1rem; }
  .gtitle { color: var(--dim); font-size: .8rem; margin-bottom: .35rem; }
  .cats { display: flex; flex-wrap: wrap; gap: .35rem; }
  .cats.pd { margin-top: .5rem; padding-top: .5rem; border-top: 1px dashed var(--line); }
  .chip { background: none; border: 1px solid var(--line); color: var(--ink);
    border-radius: 999px; padding: .35rem .8rem; font: inherit; font-size: .85rem; cursor: pointer; }
  .chip.on { background: var(--accent); border-color: var(--accent); color: #16120c; font-weight: 600; }
  .chip.pdc { border-style: dashed; }
  .opt { background: none; border: 1px solid var(--line); color: var(--ink);
    border-radius: 8px; padding: .6rem .9rem; cursor: pointer; font: inherit; text-align: left; }
  .opt.on { background: var(--accent); color: #16120c; border-color: var(--accent); font-weight: 600; }
  .search { width: 100%; padding: .6rem .8rem; border-radius: 8px; border: 1px solid var(--line);
    background: #101315; color: var(--ink); font: inherit; }
  .list { max-height: 320px; overflow: auto; margin-top: .6rem; display: flex; flex-direction: column; gap: .25rem; }
  .row { text-align: left; background: none; border: 1px solid transparent; color: var(--ink);
    padding: .5rem .6rem; border-radius: 6px; cursor: pointer; font: inherit; }
  .row:hover { border-color: var(--line); }
  .row.on { background: var(--accent); color: #16120c; }
  .pickwrap { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
  .pickmap { width: 100%; height: auto; background: #101315; border-radius: 8px;
    border: 1px solid var(--line); cursor: crosshair; }
  .review { list-style: none; padding: 0; margin: 0 0 .8rem; }
  .review li { display: flex; gap: .6rem; padding: .4rem 0; border-bottom: 1px solid var(--line); }
  .review span { color: var(--dim); min-width: 9rem; }
  .btn { background: var(--accent); color: #16120c; border: 0; border-radius: 8px;
    padding: .6rem 1.1rem; font: inherit; font-weight: 600; cursor: pointer;
    text-decoration: none; display: inline-block; }
  .btn.ghost { background: none; border: 1px solid var(--line); color: var(--ink); }
  .btn.wide { width: 100%; margin-top: .5rem; }
  .btn:disabled { opacity: .4; cursor: not-allowed; }
  .nav { display: flex; justify-content: space-between; margin-top: 1rem; }
  .dim { color: var(--dim); font-size: .85rem; }
  .err { color: var(--warn); }
  .done { text-align: center; }
  .review-note { border: 1px solid var(--warn); border-radius: 8px; padding: .7rem .8rem;
    margin: .6rem 0; }
  .review-note strong { color: var(--warn); }
  .review-note p { color: var(--dim); font-size: .85rem; margin: .3rem 0 0; }
  .support { border: 1px solid var(--line); border-radius: 8px; padding: .8rem;
    margin: 1rem 0; text-align: left; }
  .support p { color: var(--dim); font-size: .9rem; margin: .4rem 0; }
  .support a { color: var(--accent); }
  .note { color: var(--dim); font-size: .82rem; border-left: 2px solid var(--line);
    padding-left: .7rem; margin-top: .9rem; }
</style>
