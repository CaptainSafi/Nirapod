# Running the demo

Requires **Node 20 or newer**. Nothing else — no database to install, no
account, no API key. The demo runs Postgres 16 compiled to WebAssembly
(PGlite) inside the Node process.

```
npm run dev
```

From the repo root, on any OS. The first run installs dependencies for you. It
starts two processes and prints both URLs:

| what | where |
|---|---|
| the site (hot reload) | http://localhost:5173 |
| moderation queue | http://localhost:8788/?token=demo-moderator-token |

Two processes, because the architecture has two halves: Vite serves the
frontend and proxies `/api` and `/data` to the API server on :8787. That is the
same shape as production — a CDN in front, a write-only endpoint behind — so
something that works in dev works deployed.

### Other commands

| command | what it does |
|---|---|
| `npm run dev` | API + Vite with hot reload — **use this while working on the frontend** |
| `npm start` | API only, serving the built static site on :8787. No hot reload |
| `npm run build` | Rebuild `web/build` |
| `npm run build:review` | Build a folder you can upload to any static host — see below |
| `npm test` | The 47 end-to-end checks |
| `npm run setup` | Install both dependency trees without starting anything |

`start-demo.cmd` (double-click) and `start-demo.ps1` do the same as `npm start`
for anyone who would rather not open a terminal. Windows PowerShell 5.1 has no
`&&` and does not understand `DEMO=1 npm start`, so prefer the npm scripts over
pasting bash one-liners.

Everything runs with `DEMO=1` by default, which fills the database with **9,000
synthetic reports and 400 hazards** so the map is not blank. Every page carries
a red DEMO banner while that data is loaded. Set `DEMO=0` for an empty database
— the map will then be almost entirely "insufficient data", which is correct
behaviour at low volume, not a bug.

## Options

| variable | default | notes |
|---|---|---|
| `BATCH_MS` | `15000` | publish cadence. **Production is 1800000 (30 min)** — the demo is short so you are not waiting half an hour to see a report appear |
| `POW_BITS` | `18` | proof-of-work difficulty; ~1–3s in a browser |
| `ABUSE_MAX` | `12` | submissions per hour per rate-limit bucket |
| `MOD_TOKEN` | `demo-moderator-token` | demo stand-in for Cloudflare Access |
| `DEMO` | unset | `1` loads synthetic data |

## Tests

```bash
cd server && npm test            # 25 end-to-end checks against both servers
```

Database invariants need a real Postgres with PostGIS (they assert on PostGIS
types and on role grants):

```bash
DATABASE_URL=postgres://... ./scripts/migrate.sh    # migrations + 29 assertions
node scripts/ingest_geo.js | psql "$DATABASE_URL"   # ward/thana boundaries
```

## Rebuilding the frontend after editing `web/src`

```bash
./scripts/build_web.sh
```

`node_modules` for the frontend is installed **outside** the repo
(`$HOME/webdeps` by default, override with `WEB_DEPS`). Installing tens of
thousands of small files onto a synced or mounted drive is slow and leaves the
tree corrupted if it is interrupted. Only `web/build` is copied back.

## What the demo swaps out

These differ from production **on purpose**, and each is a line item in the
test rubric rather than a hidden shortcut:

| production | demo | why |
|---|---|---|
| Supabase Postgres + PostGIS | PGlite (no PostGIS) | starts with no install. Migrations are applied verbatim except the PostGIS lines; every constraint, grant and suppression rule is identical |
| MapLibre GL + self-hosted Protomaps tiles | inline SVG choropleth | a basemap needs a tile extract, and no map CDN is acceptable. The SVG has the same suppression behaviour and makes zero third-party requests |
| Cloudflare Access / tunnel | a token on a separate port | the point being demonstrated is that the public server has **no route** to moderation, which holds in both |
| 30-minute batch | 15-second batch | testability |
| press records from real journalism, human-reviewed | 60 rows pointing at `example.invalid` | fabricating plausible-looking press records is exactly the failure that ends the project in week one |


---

## Publishing a review build

Host walkthroughs, all free: `docs/DEPLOY.md`. Cloudflare Pages is the one to
use.

```
npm run build:review
```

Generates the data, builds the site, copies the data in beside it, and refuses
to finish if `robots.txt` or `_headers` is missing from the output. Upload the
**contents of `web/build/`** to Cloudflare Pages,
Netlify, GitHub Pages, or anything else that serves files. No server, no
database, no build step on the host.

### What the uploaded copy does and does not do

The read path was always static, so the map, the scorecards, the methodology
and the whole submit flow are all there and clickable. What is missing on a
static host is the **write path** — there is no endpoint to receive a report.
The submit form detects that on load and says so, with the send button
disabled, rather than failing with a network error. One build, two behaviours:
served by `npm start` it accepts reports; uploaded, it is a preview.

### Before you send the link to anyone

Everything on this build is **synthetic data attached to real ward and thana
names**. That combination is the risk: a screenshot of "Badda — ৬৮টি রিপোর্ট,
৭১% পুলিশে জানাননি" travels perfectly well without the page around it. Four
things are in place so it does not:

- the page `<title>` says DEMO, so it says DEMO in a browser tab and in a link preview
- a red banner on every page
- **a watermark inside the map SVG**, so it is in the screenshot itself
- the methodology page leads with it, before anything else
- `noindex` and a `Disallow: /` robots.txt, so it cannot turn up in a search for
  "Badda crime statistics"

When you share it, say in your own words that the figures are generated. The
labelling is there to survive the cases where you are not in the room.

If a reviewer needs the submit flow to actually accept a report, run
`npm start` locally and share your screen instead — do not put a live write
endpoint on the public internet before the launch checklist in the README is
done.
