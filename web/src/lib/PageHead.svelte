<script>
  // PageHead.svelte — title, description and sharing tags for one page.
  //
  // WHY THIS EXISTS. Every page used to share one <title>, so five open tabs
  // were indistinguishable and a bookmark said nothing. Worse, there were no
  // og: tags at all: a link pasted into WhatsApp, Facebook or a Slack channel
  // showed a bare URL. This site spreads by people passing links to each other,
  // so an unpreviewable link is a broken distribution channel.
  //
  // The card image is a static file we serve ourselves (no third-party image
  // service), and the URL is absolute at runtime because scrapers do not
  // resolve relative og:image paths.
  import { ui } from '$lib/state.svelte.js';
  import { strings } from '$lib/i18n.js';

  let { title = null, description = null } = $props();

  const t = $derived(strings[ui.lang]);
  const site = $derived(`${t.site}.site`);
  // The DEMO marker rides in the title so it survives a link preview and a
  // browser tab, which are the two places a screenshot does not reach.
  const full = $derived(title ? `${title} · ${site} (ডেমো / DEMO)` : `${site} (ডেমো / DEMO)`);
  const desc = $derived(description ?? t.meta_default);
  const origin = $derived(typeof location === 'undefined' ? '' : location.origin);
  const url = $derived(typeof location === 'undefined' ? '' : location.origin + location.pathname);
</script>

<svelte:head>
  <title>{full}</title>
  <meta name="description" content={desc} />

  <meta property="og:type" content="website" />
  <meta property="og:site_name" content={site} />
  <meta property="og:title" content={full} />
  <meta property="og:description" content={desc} />
  <meta property="og:image" content="{origin}/og.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content={t.og_alt} />
  <meta property="og:url" content={url} />
  <meta property="og:locale" content={ui.lang === 'bn' ? 'bn_BD' : 'en_GB'} />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={full} />
  <meta name="twitter:description" content={desc} />
  <meta name="twitter:image" content="{origin}/og.png" />
</svelte:head>
