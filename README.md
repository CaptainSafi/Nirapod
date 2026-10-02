# Nirapod.site

**Live demo:** [nirapod.pages.dev](https://nirapod.pages.dev)

Nirapod is an anonymous, community-driven safety map for Bangladesh. People report street crime, extortion (chadabaji), police misconduct and street hazards without creating an account, and the site publishes only aggregated, privacy-safe patterns by ward and thana, so nobody can be traced from what is published.

It covers 12 report categories (54 subcategories) and 20 street-hazard types, in Bangla and English.

**Launch scope (v1):** the public tier publishes aggregates and institutions only. No individual names. No group names. Those are v2 and gated on a partner organisation.

```
npm run dev     # API + Vite with hot reload, http://localhost:5173
npm start       # API only, serving the built site, http://localhost:8787
npm test        # 74 end-to-end checks
```

What it does: `docs/FEATURES.md`. Deploying a review build: `docs/DEPLOY.md`.

Read `docs/invariants.md` before writing any code. Those constraints are not features; they are the conditions every later decision must respect.

## Layout

```
db/migrations/   schema, in order (apply with scripts/migrate.sh)
db/tests/        invariant assertions; part of the definition of done
db/seeds/        ward/thana geography and reviewed press records
server/          API server, aggregation batch job, proof-of-work, tests
functions/       edge functions for production (submit, flag, hazard, pow)
moderation/      moderation queue UI, served separately
scripts/         dev runner, builds, migrations, pow expiry
web/             SvelteKit frontend (static export)
docs/            invariants, threat model, data policy, deploy and testing guides
```

## Stack

| layer | choice | why |
|---|---|---|
| Frontend | SvelteKit, static adapter | small bundles; must be usable on a mid-range Android over mobile data |
| Hosting/CDN | Cloudflare Pages | unmetered bandwidth, so a traffic spike cannot generate a bill |
| DB | Supabase (Postgres + PostGIS) | writes only; small |
| Submit | Edge Function, write-only | no read grant on `reports` |
| Maps | MapLibre GL + Protomaps, self-hosted tiles | **not Google Maps**: it bills per map load, and it would show Google every visitor to a police-misconduct site |
| Errors | Sentry, PII scrubbing on | |

## Status

- [x] **Sprint 1:** schema + migrations, roles, k-suppressed aggregation, 41 invariant assertions
- [x] Ward/thana geo ingest: 46 thanas, 203 wards, Dhaka district (geoBoundaries, CC-BY 4.0)
- [x] Submit endpoint + proof-of-work, validation, rotating-salt rate limiting
- [x] Auto-approve rules + review queue routing
- [x] Moderation app on a separate server with an audit log
- [x] **Sprint 2:** batch aggregation to static JSON, k-suppression in the aggregation layer
- [x] **Sprint 3:** submit flow, ward choropleth, day/night toggle, thana scorecards, two-tier counters, bn/en, static pages
- [x] Widened taxonomy: 12 categories, 54 subcategories, plus 20 street-hazard types
- [x] Street hazards: exact point, no threshold, escalation clock
- [x] "How it happened": closed-vocabulary method fields and published patterns
- [ ] Sprint 4: seed pipeline from real journalism (the longest pole)
- [ ] Sprint 5: area subscribe, escalation clocks, corroboration prompt

**Run it:** see `RUNNING.md`. **Test it:** `docs/testing_rubric.md`.
**Known gaps and what they need:** `docs/testing_rubric.md` §F.

## Before launch (not code)

- Domain bought with registrar privacy; hardware-key 2FA on registrar, host, repo
- Request logging verified off at every layer, provider retention confirmed **in writing**
- Data policy and threat model written in plain Bangla
- **A written decision on what happens when someone demands the data** (court order, police request, or informal). The architecture is what lets the answer be "there is nothing to hand over", but only if it is written down first.

## Author

**Safiur Rahman Safi** · [@CaptainSafi](https://github.com/CaptainSafi)
