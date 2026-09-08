# Deploying the review build

The site is static files. Every option below is **free and needs no card**.

The build is 45 files and 1.1 MB, so it fits comfortably inside every free tier
listed here.

Read section 0 first. Two of those four points are the difference between a
review link and a problem.

---

## 0. Read this before you deploy

**1. This deployment cannot accept reports, and that is deliberate.**
A static host has no write endpoint, so the submit form detects that on load and
shows a labelled preview with the send button disabled. Reviewers can walk the
whole flow; nothing is stored because there is nowhere to store it. Do not put a
live submit endpoint on the internet until the launch checklist in `README.md`
is done.

**2. The moderation app must never be deployed.**
It is excluded by `.vercelignore`, and on the other hosts you upload
`web/build/` only, which never contains it. In production it belongs behind
Cloudflare Access or a tunnel. On a public host the only thing in front of the
review queue would be a token in a URL.

**3. Never enable the host's analytics.**
Cloudflare Web Analytics, Netlify Analytics, Vercel Speed Insights: all of them
add a script that phones home on every page view. Your own methodology page
tells visitors that nothing here observes them, and this is a site about police
misconduct. Enabling analytics makes that page a lie. All are opt-in; decline
the prompt.

**4. This is a review host, not your production host.**
Whichever you pick, the production decision is separate and turns on one
question: does the host keep request logs containing visitor IP addresses? The
first line of `docs/invariants.md` is *no IP, ever, at any layer*. For a demo
full of synthetic numbers it does not matter. For the real site it decides the
host.

---

## 1. Which one

| | Free | Custom headers | Repo can stay private | Notes |
|---|---|---|---|---|
| **Cloudflare Pages** | yes | yes (`_headers`) | yes | **Recommended.** What the build spec already chose for production |
| **Netlify** | yes | yes (`_headers`) | yes | Closest alternative; bandwidth is capped on the free tier |
| **GitHub Pages** | yes | **no** | **no** (needs Pro) | Fine as a last resort; see the caveats below |
| **Vercel** | yes | yes (`vercel.json`) | yes | Works, but keeps IP-bearing request logs |

**Pick Cloudflare Pages.** It is free, it takes the `_headers` file this repo
already ships, and it is the host the project is heading for anyway, so the
review deploy doubles as a rehearsal. Its free plan allows 500 builds a month,
one build at a time, 20,000 files and 25 MiB per file; bandwidth is not among
the documented free-plan limits.
([limits](https://developers.cloudflare.com/pages/platform/limits))

---

## 2. Build it

Same first step for every host:

```powershell
cd "H:\Dev Games\Nirapod"
npm run build:review
```

It generates the data, builds the site, copies the data in, and refuses to
finish if `robots.txt` or `_headers` is missing from the output. What you upload
is the **contents of `web\build`**.

---

## 3. Cloudflare Pages

### Route A: drag and drop, no Git, about two minutes

1. Sign up at [pages.cloudflare.com](https://pages.cloudflare.com) (no card).
2. **Create a project → Upload assets.**
3. Name it `nirapod-review` — leave `nirapod` free for the real site.
4. Drag the **contents** of `web\build` onto the page. Not the folder itself:
   `index.html` must be at the top level.
5. **Deploy site.** You get `nirapod-review.pages.dev`.

To update later, re-run the build and upload again as a new deployment.

### Route B: connect Git, redeploys on push

1. Push the repo to GitHub or GitLab. It can stay **private**.
2. Cloudflare Pages → **Create a project → Connect to Git** → pick the repo.
3. Build settings:

   | Field | Value |
   |---|---|
   | Framework preset | **None** |
   | Build command | `npm install --prefix server && npm install --prefix web && npm run build:review` |
   | Build output directory | `web/build` |
   | Node version | set `NODE_VERSION` = `20` under Environment variables |

4. **Save and Deploy.**

The build applies the real database migrations to an in-process Postgres to
generate the data, so `server/` and `db/migrations/` must be in the repo. They
are; just do not add them to an ignore file later.

### Then check it

Open the URL and confirm all six:

| # | Check | Expected |
|---|---|---|
| 1 | Every page | red DEMO banner |
| 2 | The map itself | watermarked, so screenshots carry it |
| 3 | Browser tab and link previews | say DEMO |
| 4 | Submit flow, last screen | preview notice, send disabled |
| 5 | DevTools → Network, whole session | every request to your own domain, no third party |
| 6 | `/robots.txt` | `Disallow: /` |

And that the headers arrived:

```powershell
curl.exe -I https://nirapod-review.pages.dev
```

Look for `x-robots-tag: noindex`, `referrer-policy: no-referrer`, and
`permissions-policy: geolocation=()`. That last one means the browser itself
will refuse a location request from this page, so "we never ask where you are"
stops being a promise and becomes something the browser enforces.

---

## 4. Netlify

1. Sign up at [netlify.com](https://www.netlify.com) (no card for the free tier).
2. Drag the **contents** of `web\build` onto the deploy area, or connect the repo
   with build command `npm install --prefix server && npm install --prefix web && npm run build:review` and publish directory `web/build`.

Netlify reads the same `_headers` file, so the security headers apply unchanged.
Its free tier caps bandwidth per month, which is fine for a review link and is
the reason it is second choice rather than first.

---

## 5. GitHub Pages, with two real caveats

Workable, but know what you are accepting:

- **Your repository must be public.** Publishing Pages from a private repo needs
  GitHub Pro or higher; the free plan cannot do it.
  ([discussion](https://github.com/orgs/community/discussions/22817))
- **The published site is public either way.** Repository visibility protects the
  source, not the site. There is no access control on Pages outside Enterprise.
- **No custom response headers.** `_headers` is ignored, so `X-Robots-Tag` never
  arrives. The `<meta name="robots" content="noindex">` in the page and
  `robots.txt` still apply, and the CSP still arrives as a meta tag, so you keep
  most of the protection but not all of it.

If you accept those: create a repo, put the **contents of `web/build`** on a
`gh-pages` branch (or in `/docs` on the default branch), then
**Settings → Pages** and pick that source.

Given this project publishes synthetic figures against real ward names, the
public-repo requirement is the part to think about, not the headers.

---

## 6. Vercel

`vercel.json` in the repo root already sets the build command, output directory
and headers.

```powershell
npm install -g vercel
cd "H:\Dev Games\Nirapod"
vercel login
vercel          # preview
vercel --prod   # promote
```

Name the project `nirapod-review`. Works fine, but Vercel keeps request logs
that include visitor IPs, which is why it is last here.

---

## 7. No hosting at all

Sometimes the right answer for a small review round:

- **Send the folder.** Zip `web\build` and share it. Opening `index.html`
  directly from disk will not work (the browser blocks local file reads), but
  `npx serve web/build` runs it locally in one command.
- **Show it live.** `npm run dev` on your machine and share your screen. This is
  the only way a reviewer can actually submit a report and watch it move through
  the moderation queue, and it keeps the write endpoint off the internet.

---

## 8. Do not point the real domain at this

`nirapod.site` should not resolve to a build full of generated figures. A real
domain is what makes a screenshot look official, and the labelling is designed
to survive being shared, not to be argued with afterwards.

---

## 9. When the real thing is ready

Not this path. Roughly:

1. **Cloudflare Pages** for the static read path, with request logging verified
   off and the provider's retention confirmed in writing.
2. **Supabase** (Postgres + PostGIS) for writes: run `scripts/migrate.sh`
   against it, then pipe `scripts/ingest_geo.js` into it for the boundaries.
3. **A write endpoint** as an edge function using the `nirapod_submit` role,
   which holds `INSERT` and no `SELECT` grant.
4. **The moderation app** behind Cloudflare Access, on a separate host, with no
   route from the public site.
5. **A scheduled job** running the batch publish every 30 minutes.
6. Everything in the "Before launch" checklist in `README.md`, most of which is
   not code.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Build fails at "generating published data" | `server/` or `db/migrations/` is missing from the repo. The build applies the real migrations to an in-process database |
| Build fails on rollup or esbuild | A stale `web/node_modules`. Delete it and let the install step rebuild it |
| Build stops with "refusing to finish" | `robots.txt` or `_headers` did not reach `web/build`. They live in `web/static/` |
| Pages load but the map is blank | `web/build/data/` was not uploaded. Upload the **contents** of `web/build`, not a subfolder |
| Site is indexed anyway | Check `x-robots-tag` on the response. GitHub Pages cannot send it |
