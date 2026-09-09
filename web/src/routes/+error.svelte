<script>
  // The 404 used to render a title and nothing else: a dark empty page with no
  // message, no navigation and no way back. SvelteKit's static adapter turns
  // this component into 404.html, which is what a host serves for any unknown
  // path.
  import { ui } from '$lib/state.svelte.js';
  import { strings } from '$lib/i18n.js';
  import PageHead from '$lib/PageHead.svelte';
  import { page } from '$app/state';
  const t = $derived(strings[ui.lang]);
</script>

<PageHead title={t.nf_title} description={t.nf_body} />

<section class="nf">
  <h1>{t.nf_title}</h1>
  <p class="dim">{t.nf_body}</p>
  {#if page.status && page.status !== 404}
    <p class="code">{page.status}</p>
  {/if}
  <div class="links">
    <a class="cta" href="/">{t.nf_home}</a>
    <a class="plain" href="/submit/">{t.nav_submit}</a>
    <a class="plain" href="/gd/">{t.nav_help}</a>
  </div>
</section>

<style>
  .nf { max-width: 34rem; margin: 3rem auto; text-align: center; }
  .dim { color: var(--dim); }
  .code { color: var(--dim); font-size: .8rem; }
  .links { display: flex; gap: .8rem; justify-content: center; flex-wrap: wrap;
           margin-top: 1.4rem; }
  .cta { background: var(--accent); color: #17130a; text-decoration: none;
         font-weight: 700; border-radius: 999px; padding: .5rem 1.1rem; }
  .plain { color: var(--dim); text-decoration: none; align-self: center; }
  .plain:hover { color: var(--ink); }
</style>
