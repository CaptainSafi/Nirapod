<script>
  // Calendar.svelte — pick the day it happened.
  //
  // The old control was eight buttons labelled with week-start dates, which
  // asked people to do calendar arithmetic in their head about the worst day of
  // their year. Nobody remembers "the week of 24 August". They remember a day.
  //
  // WHAT IS ACTUALLY STORED IS STILL THE WEEK. An exact date, next to a ward and
  // a category, is enough to pick one incident and therefore one person out of a
  // published table, which is the whole reason the suppression rules exist. So
  // this collects a day and hands back its Monday, and it SHOWS that: the row
  // you land in lights up as a whole, so the coarsening is visible rather than a
  // sentence underneath that nobody reads.
  import { num } from '$lib/format.js';
  import { mondayOf } from '$lib/format.js';

  let { value = null, onpick = () => {}, lang = 'bn', monthsBack = 6 } = $props();

  const MONTHS = {
    bn: ['জানুয়ারি','ফেব্রুয়ারি','মার্চ','এপ্রিল','মে','জুন','জুলাই','আগস্ট','সেপ্টেম্বর','অক্টোবর','নভেম্বর','ডিসেম্বর'],
    en: ['January','February','March','April','May','June','July','August','September','October','November','December'],
  };
  // Monday first, because the stored unit is a Monday-anchored week and the grid
  // should make that row obvious.
  const DOW = {
    bn: ['সোম','মঙ্গল','বুধ','বৃহ','শুক্র','শনি','রবি'],
    en: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],
  };

  const today = new Date();
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const earliest = startOfDay(new Date(today.getFullYear(), today.getMonth() - monthsBack, 1));
  const latest = startOfDay(today);

  let view = $state(new Date(today.getFullYear(), today.getMonth(), 1));

  const selected = $derived(value ? startOfDay(new Date(value + 'T00:00:00')) : null);
  const selectedWeek = $derived(selected ? mondayOf(selected) : null);

  const canBack = $derived(new Date(view.getFullYear(), view.getMonth() - 1, 1) >= new Date(earliest.getFullYear(), earliest.getMonth(), 1));
  const canFwd = $derived(new Date(view.getFullYear(), view.getMonth() + 1, 1) <= new Date(latest.getFullYear(), latest.getMonth(), 1));

  // Six rows of seven, always, so the grid does not change height as you page
  // through months and move the buttons under the reader's thumb.
  const cells = $derived.by(() => {
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;          // Monday = 0
    const start = new Date(first);
    start.setDate(first.getDate() - offset);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return {
        d,
        key: iso(d),
        day: d.getDate(),
        outside: d.getMonth() !== view.getMonth(),
        future: d > latest,
        tooOld: d < earliest,
        week: mondayOf(d),
      };
    });
  });

  function pick(c) {
    if (c.future || c.tooOld) return;
    onpick(iso(c.d), c.week);
  }
</script>

<div class="cal">
  <div class="head">
    <button type="button" class="nav" disabled={!canBack} aria-label={lang === 'bn' ? 'আগের মাস' : 'Previous month'}
      onclick={() => (view = new Date(view.getFullYear(), view.getMonth() - 1, 1))}>‹</button>
    <span class="month">{MONTHS[lang][view.getMonth()]} {num(view.getFullYear(), lang)}</span>
    <button type="button" class="nav" disabled={!canFwd} aria-label={lang === 'bn' ? 'পরের মাস' : 'Next month'}
      onclick={() => (view = new Date(view.getFullYear(), view.getMonth() + 1, 1))}>›</button>
  </div>

  <div class="dow" aria-hidden="true">
    {#each DOW[lang] as d}<span>{d}</span>{/each}
  </div>

  <div class="grid" role="grid">
    {#each cells as c (c.key)}
      <button type="button" class="day"
        class:outside={c.outside}
        class:inweek={selectedWeek === c.week && !c.future && !c.tooOld}
        class:on={selected && iso(selected) === c.key}
        disabled={c.future || c.tooOld}
        aria-pressed={selected && iso(selected) === c.key}
        onclick={() => pick(c)}>{num(c.day, lang)}</button>
    {/each}
  </div>
</div>

<style>
  .cal { border: 1px solid var(--line); border-radius: 12px; padding: .8rem; background: var(--panel); }
  .head { display: flex; align-items: center; justify-content: space-between; gap: .5rem; margin-bottom: .6rem; }
  .month { font-weight: 600; }
  .nav {
    background: none; border: 1px solid var(--line-strong); color: var(--ink);
    width: 2rem; height: 2rem; border-radius: 999px; cursor: pointer; font-size: 1.1rem; line-height: 1;
  }
  .nav:disabled { opacity: .35; cursor: default; }
  .dow, .grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: .2rem; }
  .dow span { text-align: center; font-size: .7rem; color: var(--dim); padding-bottom: .3rem; }
  .day {
    aspect-ratio: 1; min-height: 2.1rem; border: 1px solid transparent; border-radius: 8px;
    background: none; color: var(--ink); font: inherit; font-size: .9rem; cursor: pointer;
  }
  .day:hover:not(:disabled) { border-color: var(--line-strong); }
  .day.outside { color: var(--dim); opacity: .5; }
  .day:disabled { opacity: .25; cursor: default; }
  /* The whole week lights up, because the week is what is kept. */
  .day.inweek { background: var(--accent-tint); }
  .day.on { background: var(--accent); color: var(--on-accent); font-weight: 700; }
  .day:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
</style>
