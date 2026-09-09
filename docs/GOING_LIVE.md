# Going live: nirapod.site, always on, without your PC

The beta build is static files and needs no server. Going live adds exactly two
moving parts: somewhere to **accept** a report, and something to **publish** the
aggregates on a clock. This is what each one costs and what it does to the
privacy claims.

---

## The shape of it

    a phone  ──►  Cloudflare Pages          static site + map tiles   (free)
                  nirapod.site

    a report ──►  Supabase Edge Function    the ONLY endpoint that     (free)
                  submit                    sees a visitor request
                       │
                       ▼
                  Supabase Postgres         reports, write-only role   (free)
                  + PostGIS
                       │
                       │  every 2–3 hours
                       ▼
                  GitHub Actions            runs the batch, rebuilds   (free)
                       │                    the JSON, redeploys Pages
                       ▼
                  Cloudflare Pages          new static data files

Nothing here needs your computer. Nothing here needs a card.

The read path stays 100% static on purpose. Every dynamic endpoint is a place
where a request, and therefore an IP, can be logged. One endpoint that can be
audited is a claim you can defend; a dynamic read path is not.

---

## 1. The domain

`nirapod.site` — .site is usually cheap in year one and about 25–35 USD a year
after. Two things matter more than price:

- **WHOIS privacy included, permanently.** Porkbun and Namecheap include it
  free. Without it your name, address and phone are a public lookup on a site
  about police misconduct.
- **Registrar lock and hardware-key 2FA on the registrar account.** The domain
  is the one thing you cannot rebuild from a backup.

Point the nameservers at Cloudflare (free), then attach the domain to the Pages
project. Cloudflare Registrar sells at cost with free privacy, but does not
carry every TLD; check `.site` before assuming.

---

## 2. Hosting the site (free, no card)

Cloudflare Pages, direct upload or connected to the GitHub repo:

    npm run build:beta -- --light

Upload the **contents** of `web/build`. `--light` keeps the basemap under the
25 MiB per-file limit. `_headers` is already in the build and carries the
security headers; `robots.txt` keeps it out of search while it is a beta.

Turn Cloudflare Web Analytics **off**. It injects a script on every page view,
and the methodology page tells visitors nothing here observes them.

---

## 3. The write path (the only real decision)

The schema is Postgres with PostGIS, and Supabase runs both on its free tier
(500 MB, plenty: a report is a few hundred bytes).

1. Create the project, run `db/migrations/*.sql` in order through the SQL
   editor. They are written to apply verbatim.
2. Create the three roles the migrations expect. `nirapod_submit` can INSERT
   into `reports` and nothing else — no SELECT, so the endpoint physically
   cannot read back what it wrote.
3. Port `server/index.js`'s three public routes to one Supabase Edge Function:
   `/api/pow`, `/api/submit`, `/api/hazard`. The proof-of-work, the validation
   and the rate limiting move across unchanged; they are already separate
   modules (`pow.js`, `validate.js`, `abuse.js`).

**The honest caveat.** Supabase logs requests, including IPs, for its own
operations. `docs/invariants.md` says no IP, ever, at any layer. Before this
goes live you need that in writing from them, or an endpoint in front that
strips it, or a documented exception. That is item one on the pre-launch list,
not a detail.

---

## 4. Publishing on a clock

Reports must not appear the instant they are submitted: batching is what stops
someone submitting a report, refreshing, and learning which cell moved.

A GitHub Action on a schedule does it with no server:

- every 2–3 hours, check out the repo, run the batch against Supabase, write
  `web/data/*.json`, rebuild, deploy to Pages.
- Cloudflare Pages allows 500 builds a month on the free plan. Every 3 hours is
  240. Every 30 minutes would be 1,440 and would not fit, which is fine:
  **more batching is safer, not worse.**

Tell visitors the cadence. "Reports appear at the next publish, within about
three hours" is a promise you can keep and a correlation attack you have priced
out.

---

## 5. Moderation

The moderation app must never be on the public internet. Run it behind
Cloudflare Access (free for up to 50 users) on a subdomain, or on your machine
against the production database when you clear the queue.

This is the piece with no technical answer left: **somebody has to read the
queue.** Reports do not publish until they are approved, so an unattended queue
is not a backlog, it is a site that silently accepts reports and shows nothing.

---

## What is still not a technical problem

Before the first real report arrives:

1. Who clears the moderation queue, and how often.
2. The data policy and threat model, in Bangla, on the site.
3. The written answer to a demand for the data — court order, police request,
   or an informal call. The architecture exists so the answer can be "there is
   nothing to hand over", and that only holds if it is decided in advance.
4. Request logging confirmed off, in writing, at every layer that sees a
   request: Cloudflare, Supabase, the registrar.
5. Ward population, so the map can show a rate rather than a count. Until then
   the colour is report volume presented as risk.

Items 1–4 are launch blockers. Item 5 is an honesty problem you can ship with,
as long as the legend says what the colour means.
