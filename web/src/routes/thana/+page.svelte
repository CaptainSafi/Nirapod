<script>
  import { onMount } from 'svelte';
  import { ui } from '$lib/state.svelte.js';
  import PageHead from '$lib/PageHead.svelte';
  import { strings } from '$lib/i18n.js';
  import { num, pct } from '$lib/format.js';
  const t = $derived(strings[ui.lang]);

  let data = $state(null);
  let sort = $state({ key: 'reports_n', dir: 'desc' });
  let query = $state('');

  onMount(async () => { data = await (await fetch('/data/thanas.json')).json(); });

  const all = $derived((data?.thanas ?? []).map(th => ({
    id: th.id,
    name: ui.lang === 'bn' ? (th.name_bn ?? th.name_en) : th.name_en,
    sc: th.scorecard && !th.scorecard.suppressed ? th.scorecard : null,
  })));

  // 33 of 46 rows said "insufficient data", which reads as a broken page. The
  // threshold is not the problem — it is deliberately higher here, because an
  // accusation against a named public body needs a higher bar than area risk.
  // So the page stops presenting 33 empty rows as if they were data, and says
  // what is actually true: these thanas have not reached ten reports yet.
  let showWaiting = $state(false);

  const rows = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const list = q ? all.filter(r => r.name.toLowerCase().includes(q)) : [...all];
    const val = (r) => {
      if (!r.sc) return -1;                       // suppressed rows sort last
      const v = r.sc[sort.key];
      return v === null || v === undefined ? -1 : Number(v);
    };
    list.sort((a, b) => {
      if (sort.key === 'name') {
        return sort.dir === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
      }
      const d = val(b) - val(a);
      return sort.dir === 'desc' ? d : -d;
    });
    return list;
  });
  const published = $derived(rows.filter(r => r.sc));
  const waiting = $derived(rows.filter(r => !r.sc));

  function by(key) {
    sort = sort.key === key
      ? { key, dir: sort.dir === 'desc' ? 'asc' : 'desc' }
      : { key, dir: key === 'name' ? 'asc' : 'desc' };
  }
  const arrow = (key) => sort.key !== key ? '' : (sort.dir === 'desc' ? ' ↓' : ' ↑');

  // The largest published rate, so the inline bars share one scale. A bar drawn
  // against its own maximum would make every thana look equally bad.
  const maxRate = $derived(Math.max(0.0001,
    ...all.filter(r => r.sc).flatMap(r => [Number(r.sc.gd_refused_rate ?? 0),
                                           Number(r.sc.no_action_rate ?? 0)])));
</script>

<PageHead title={t.nav_areas} description={t.meta_thana} />

<h1>{t.nav_areas}</h1>
<p class="lede">
  {ui.lang === 'bn'
    ? 'এখানে প্রতিষ্ঠানের নাম প্রকাশ করা হয়, কোনো ব্যক্তির নাম নয়। একটি থানার নাম উল্লেখ করা একটি সরকারি প্রতিষ্ঠান নিয়ে ন্যায্য মন্তব্য।'
    : 'Institutions are named here. People never are. Naming a police station is fair comment on a public body, and that is what keeps this citable.'}
</p>

<p class="lede dim">
  {ui.lang === 'bn'
    ? 'এই সংখ্যাগুলো যারা রিপোর্ট করেছেন তাঁদের অভিজ্ঞতা থেকে: কতজন বলেছেন জিডি নিতে অস্বীকার করা হয়েছে, কতজন বলেছেন কোনো ব্যবস্থা নেওয়া হয়নি। এগুলো পুলিশের নিজস্ব পরিসংখ্যান নয়, এবং যেখানে রিপোর্ট কম সেখানে কিছুই দেখানো হয় না।'
    : 'These come from what reporters said happened next: how many were refused a GD, and how many saw no action. They are not police statistics, and where reports are few, nothing is shown at all.'}
</p>

<p class="lede dim">{t.sc_what}</p>

<input class="search" bind:value={query} placeholder={t.search_area} />

<h2 class="sect">{t.sc_published}</h2>

<div class="scroll">
  <table>
    <thead>
      <tr>
        <th><button onclick={() => by('name')}>{ui.lang === 'bn' ? 'থানা' : 'Thana'}{arrow('name')}</button></th>
        <th class="r"><button onclick={() => by('reports_n')}>{t.reports_recv}{arrow('reports_n')}</button></th>
        <th class="r"><button onclick={() => by('gd_refused_rate')}>{t.gd_refused_share}{arrow('gd_refused_rate')}</button></th>
        <th class="r"><button onclick={() => by('no_action_rate')}>{t.no_action_share}{arrow('no_action_rate')}</button></th>
      </tr>
    </thead>
    <tbody>
      {#each published as r (r.id)}
        <tr>
          <td>{r.name}</td>
          {#if r.sc}
            <td class="r">{num(r.sc.reports_n, ui.lang)}</td>
            <td class="r bar">
              <span class="fill" style="width:calc({(Number(r.sc.gd_refused_rate) / maxRate) * 100}% - 3rem)"></span>
              <span class="v">{pct(r.sc.gd_refused_rate, ui.lang)}</span>
            </td>
            <td class="r bar">
              <span class="fill" style="width:calc({(Number(r.sc.no_action_rate) / maxRate) * 100}% - 3rem)"></span>
              <span class="v">{pct(r.sc.no_action_rate, ui.lang)}</span>
            </td>
          {/if}
        </tr>
      {:else}
        <tr><td colspan="4" class="dim">{t.no_match}</td></tr>
      {/each}
    </tbody>
  </table>
</div>

{#if waiting.length}
  <div class="waiting">
    <button class="wtoggle" onclick={() => (showWaiting = !showWaiting)}
            aria-expanded={showWaiting}>
      {t.sc_waiting} · {showWaiting ? t.sc_hide : t.sc_show}
    </button>
    <p class="dim small">{t.sc_waiting_n.replace('{n}', num(waiting.length, ui.lang))}</p>
    {#if showWaiting}
      <p class="names">{waiting.map(r => r.name).join(' · ')}</p>
    {/if}
  </div>
{/if}

<p class="note">
  {ui.lang === 'bn'
    ? 'পুলিশি অনিয়মের ক্ষেত্রে সীমা বেশি রাখা হয়েছে, কারণ নির্দিষ্ট একটি থানার সঙ্গে যাঁদের এমন অভিজ্ঞতা হয়েছে তাঁদের সংখ্যা অনেক কম।'
    : 'The threshold for police misconduct is higher than for area risk: the population who had that specific interaction with that specific thana is much smaller.'}
</p>
<p class="note">
  {ui.lang === 'bn'
    ? 'কোনো থানা এই তথ্যে ভুল দেখলে সংশোধনের অনুরোধ জানাতে পারে। পদ্ধতি পাতায় বিস্তারিত।'
    : 'Any institution named here can dispute a figure. The route is on the methodology page.'}
</p>

<style>
  .lede { color: var(--dim); }
  .sect { font-size: .95rem; margin: 1.2rem 0 .4rem; }
  .waiting { margin-top: 1.2rem; border-top: 1px solid var(--line); padding-top: .9rem; }
  .wtoggle { background: none; border: 1px solid var(--line); color: var(--ink);
    border-radius: 999px; padding: .3rem .9rem; font: inherit; font-size: .85rem;
    cursor: pointer; }
  .wtoggle:hover { border-color: var(--dim); }
  .small { font-size: .82rem; }
  .names { color: var(--dim); font-size: .85rem; line-height: 1.7; }
  .search { width: 100%; padding: .55rem .8rem; border-radius: 8px; border: 1px solid var(--line-strong);
    background: var(--field); color: var(--ink); font: inherit; margin-bottom: .7rem; }
  .scroll { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: .92rem; min-width: 30rem; }
  th, td { text-align: left; padding: .5rem .6rem; border-bottom: 1px solid var(--line); }
  th { color: var(--dim); font-weight: 500; font-size: .8rem; }
  th button { background: none; border: 0; color: inherit; font: inherit; cursor: pointer;
    padding: 0; white-space: nowrap; }
  th button:hover { color: var(--ink); }
  td.r, th.r { text-align: right; font-variant-numeric: tabular-nums; }
  /* A thin bar behind the number: the ranking is visible without reading every
     row, and the number is still there for anyone who needs the value. */
  td.bar { position: relative; }
  /* Anchored to the right so each bar ends where its number is: the eye follows
     one edge down the column instead of two. Kept thin and low-contrast so the
     value stays the thing you read. */
  td.bar .fill { position: absolute; right: .6rem; top: 50%; transform: translateY(-50%);
    height: 45%; background: var(--accent); opacity: .16; border-radius: 3px 0 0 3px; }
  td.bar .v { position: relative; }
  .dim { color: var(--dim); font-style: italic; }
  .note { color: var(--dim); font-size: .85rem; border-left: 2px solid var(--line); padding-left: .8rem; }
</style>
