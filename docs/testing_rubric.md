# Testing rubric — Nirapod.site demo

Two kinds of requirement, and they are not equally important.

**MUST DO** is functionality. A failure here is a bug: the demo does not do
something it claims to do.

**MUST NOT** is the privacy contract. A failure here is not a bug to file — it
is a reason to stop and fix before anything else proceeds, because every one of
these corresponds to a way a person who reported a mugging could be identified
by the person who mugged them.

Setup: `cd server && npm install && DEMO=1 npm start`, then
http://localhost:8787 and http://localhost:8788/?token=demo-moderator-token.
Full instructions in `RUNNING.md`.

---

## A. MUST DO — the submit flow

| # | Test | Expected |
|---|---|---|
| A1 | Open `/submit/` | Five screens, one question each, progress bar at top |
| A2 | Complete it start to finish | Under two minutes with no hurrying |
| A3 | Every screen | One question only; nothing asks for a name, phone, email |
| A4 | Pick a category | Subcategories appear for that category only — mugging never offers "shop/business" |
| A4b | Category list | 12 categories in two groups: nine area-crime chips, then three dashed person-directed chips (harassment, assault, abduction) |
| A4c | Pick a person-directed category | A note appears explaining it will be shown at thana/district level, not ward |
| A5 | Ward screen | Type "Ramna", "Mirpur", "ধানমন্ডি" — the list filters |
| A6 | Ward screen | Wards are named with their thana ("Ramna — Ward No-12"), never a bare "Ward No-12" |
| A7 | When screen | Offers **weeks**, not a date picker |
| A8 | Answer "no" to *did you report it* | The seven reasons appear and one is required |
| A9 | Answer "yes" | Outcome options appear; the *why not* list does not |
| A10 | Chadabaji | An amount **band** appears; no free-number field |
| A10b | "How did it happen?" screen | Four optional groups — how many, vehicle, weapon, approach. Every one skippable, all closed options, no text box |
| A10c | Tap a chosen method option again | It deselects — the field is genuinely optional |
| A11 | Review screen | Shows exactly what will be sent, nothing more |
| A12 | Submit | ~1–3s "verifying", then a thank-you |
| A13 | Resubmit | Works repeatedly (up to the rate limit) with no login |
| A14 | Phone-sized window (≈390px) | Everything reachable, no horizontal scroll, tap targets usable |
| A15 | Submit an assault or harassment report | The thank-you screen also shows support resources (999, 16430, 109) and a link to the GD page |

## A2. MUST DO — the hazard flow

| # | Test | Expected |
|---|---|---|
| AH1 | `/submit/` first screen | Two choices: a crime or incident, or a street hazard |
| AH2 | Choose street hazard | Three screens, not five — hazards have no victim and no police question |
| AH3 | Hazard types | Seven groups, 20 types — lighting, road and drains, footpath, construction, electrical, crossing, blocked road |
| AH4 | "Exactly where?" | A map you tap. This is the one place an exact coordinate is collected, and it is collected because there is no person in it |
| AH5 | Tap inside a ward | A pin appears and the ward name is shown below |
| AH6 | Tap outside every ward (the sea of background) | Nothing happens — no pin, no ward |
| AH7 | Submit it | Accepted, and it appears on the map at the next batch — **no threshold, a single hazard publishes** |
| AH8 | Hazard layer on `/` | Dots at exact positions: amber recent, red over 30 days, green fixed |
| AH9 | Hover a hazard | Type, days unresolved, and how many others confirmed it |
| AH10 | Compare with the crime layer | Crime is ward polygons with suppression; hazards are exact points with none. Two visibly different rules |

## B. MUST DO — the public surface

| # | Test | Expected |
|---|---|---|
| B1 | `/` loads | Map of 203 Dhaka wards renders |
| B2 | Category toggle | Map re-colours for mugging / chadabaji / police misconduct |
| B3 | Day/night toggle | Map changes — this is the feature the site exists to have |
| B4 | Hover a dark ward | Tooltip says **"insufficient data"**, not a number and not zero |
| B5 | Hover a coloured ward | Shows a count of **5 or more** (10+ for police misconduct) |
| B5b | Hover a ward with enough reports | A "typically" panel: how many attackers, vehicle, weapon, approach. This is the awareness content |
| B5c | Select harassment | The map switches to **thana** polygons, and a note explains why |
| B5d | Select assault or abduction | No ward map at all — a district-level table |
| B6 | Counters | Crowd-reported and press-verified shown as **two separate numbers**, never summed |
| B7 | Crowd counter | Carries a visible "Unverified" label |
| B8 | Headline | Shows the % who did not go to the police, plus the top reason |
| B9 | `/thana/` | Thanas named with reports received, GD-refused share, no-action share |
| B10 | `/thana/` | Thin thanas say "insufficient data" across the row |
| B11 | `/gd/` | How to file a GD, what to do if refused, emergency numbers |
| B12 | `/methodology/` | Plain-language account of what is collected, what cannot be seen, how thresholds work, known bias |
| B13 | Language toggle | Whole site switches; **Bangla is the default on first load** |
| B14 | In Bangla | Numerals render as ০১২৩৪৫৬৭৮৯, not 0123456789 |
| B15 | Demo banner | Red "every number is synthetic" bar on every page while `DEMO=1` |

## C. MUST DO — moderation and publication

| # | Test | Expected |
|---|---|---|
| C1 | Open moderation without `?token=` | 401, and no data |
| C2 | Wrong token | 401 |
| C3 | Correct token | Queue of pending reports |
| C4 | Queue rows | Flagged with *why* they are queued ("misconduct", "names a thana") |
| C5 | Submit a police-misconduct report | It lands in the queue — **never auto-approved** |
| C6 | Approve a report | Disappears from pending, appears under "approved" |
| C7 | "publish now" | Aggregates regenerate |
| C8 | Audit log | Shows every decision, with before → after status |
| C9 | Approve enough reports to push a cell from 4 to 5 | The ward's number appears only after that fifth |
| C10 | Submit a report and watch `/` | It does **not** appear until the next batch |

## D. MUST NOT — the privacy contract

Any failure here blocks everything else.

| # | Test | Must be |
|---|---|---|
| D1 | Whole submit flow | The browser **never prompts for location**. No "use my location" button exists |
| D2 | Every screen | **No free-text box anywhere.** Not "other, please specify", not a comment field |
| D3 | Submit response (DevTools → Network) | No report id, no receipt, no link. Nothing to look up later |
| D4 | DevTools → Application → Storage | No cookies, no localStorage, no sessionStorage, no IndexedDB |
| D5 | DevTools → Network, whole session | **Every request goes to localhost.** No Google, no CDN, no font host, no analytics, no map tile server |
| D6 | View source | No analytics snippet, no tag manager |
| D7 | `curl localhost:8787/data/aggregate.json` | No latitude/longitude, no exact timestamp, no free text, no ids |
| D8 | Same file | Every suppressed cell is `null`. Not `0`, not the real number with a "hide" flag |
| D9 | `curl localhost:8787/api/queue` | **404** — the public server has no route to moderation |
| D10 | `curl -X POST localhost:8787/api/decide` | **404** |
| D11 | Submit with DevTools: add `"description":"..."` to the request body | **400** — unexpected field rejected |
| D12 | Submit with `"lat":23.7,"lng":90.4` | **400** |
| D13 | Submit with `occurred_week` set to a Tuesday | **400** |
| D14 | Submit with a future week | **400** |
| D15 | Replay the exact same request (same challenge and nonce) twice | Second one **400** |
| D16 | Submit with no proof-of-work | **400** |
| D17 | Submit ~15 reports quickly | Rate limited (429) — with no account and no stored IP |
| D18 | Server console during all of the above | **No request log.** No IP, no user-agent, no path+time line |
| D19 | Any published number | Never below 5 (or below 10 for police misconduct) |
| D20 | Any thin cell in the UI | Says "insufficient data" — never "0" |
| D21 | Crowd and press counts | Never added together into one figure anywhere |
| D22 | Any public page | No individual's name, no group's name — institutions only |
| D23 | `curl -X POST localhost:8787/api/submit` with `"lat":23.7,"lng":90.4` | **400** — the reports endpoint still refuses coordinates, even though the hazard endpoint accepts them |
| D24 | Submit a hazard with an extra `"note"` field | **400** — hazards reject free text too |
| D25 | Submit a hazard with a coordinate in Paris | **400** |
| D26 | `curl localhost:8787/data/aggregate.json` | No `harassment`, `assault` or `abduction` cell has `"l":"ward"` |
| D27 | Same file | Every cell's `l` equals `geo_levels[c]` for its category |
| D28 | Same file | Cells above ward level have `"t":"unknown"` — coarse geography is not broken down by time of day |
| D29 | `curl localhost:8787/data/hazards.json` | Ages in days, never a reported date |
| D30 | `curl localhost:8787/data/methods.json` | Every pattern's `n` is at or above its category threshold — a method never describes one incident |

Automated coverage for much of section D:

```bash
cd server && npm test        # 47 checks — expect "47 passed, 0 failed"
```

And for the database itself, against a real Postgres+PostGIS:

```bash
DATABASE_URL=postgres://... ./scripts/migrate.sh   # expect 41 PASS, then "ALL INVARIANT TESTS PASSED"
```

## E. Non-functional

| # | Requirement | How to check | Target |
|---|---|---|---|
| E1 | Usable on a mid-range Android over mobile data | DevTools → Network → "Fast 3G", reload `/` | Interactive in a few seconds |
| E2 | Page weight | DevTools → Network, total for `/` | Under ~600 KB, most of it the ward boundaries |
| E3 | Proof-of-work cost | Time the "verifying" state | 1–3s on a phone. If it is 10s, `POW_BITS` is too high |
| E4 | Read path never touches the database | Stop nothing, just note: `/`, `/data/*.json` are files on disk | Served as static files |
| E5 | Cost shape | Read `server/index.js` and `aggregate.js` | Readers hit static JSON only; a traffic spike cannot generate database load or a bill |
| E6 | Bangla rendering | Bangla text and numerals on Windows/Android | No tofu boxes, no clipped conjuncts |
| E7 | Keyboard access | Tab through submit flow and map | Everything reachable, focus visible |
| E8 | No console errors | DevTools → Console on every page | Clean |

---

## F. Known gaps — expected to be missing

These are **not** test failures. They are the honest state of the work, and
each is either a deliberate v1 scope cut from the spec or an input I could not
obtain. Do not mark the demo as passing or failing on them.

| Gap | Why | What it needs |
|---|---|---|
| Bangla labels for the widened taxonomy are unreviewed | I wrote ~100 Bangla terms for the new categories. The common ones (ছিনতাই, চাঁদাবাজি, মাস্তানি, জিডি) I am confident about; the legal and infrastructure vocabulary needs a native speaker's eye. Every visitor sees these | An hour of review on `web/src/lib/labels.js` |
| Hazards have no "mark as fixed" route | The escalation clock runs, but only a moderator can close it. A public "this was fixed" button needs its own anti-gaming design | Sprint 5 |
| 88 of 203 wards have no Bangla name | The boundary source has English names only. Ward *numbers* are transliterated mechanically (ওয়ার্ড ১২); rural union names are not, because inventing them is fabrication | A BBS/census name file, then human review |
| No population figures | Not in the boundary source | Census population per ward — until then the map shows raw counts only, and per-capita normalisation (spec §4.3) cannot be built |
| No basemap under the choropleth | Protomaps needs a tile extract I could not fetch from here; a map CDN is not acceptable | Generate and self-host a Bangladesh `.pmtiles` extract, then swap the SVG for MapLibre |
| Press tier is 60 fake rows | Real seed data requires the press ingest and human review — Sprint 4, the longest pole | 12–24 months of crime reporting and court listings, extracted then reviewed |
| Sealed tier absent | **Deliberate.** Do not build until a press or legal-aid partner holds the key. Until then, do not collect names at all | A confirmed partner |
| Group/entity register absent | Deliberate — v2, external-anchor gated | Same partner, plus the entity-resolution work |
| Escalation clocks, area subscribe, corroboration prompt | Sprint 5 | — |
| Moderation behind a token, not Cloudflare Access | The demo has no Cloudflare | An account, then a tunnel |
| Ward coverage is Dhaka only | Chosen scope cut — OSM/geoBoundaries coverage is good for Dhaka and thin elsewhere | Boundary sourcing per division |

## G. Before any of this is real

Not testable in the demo, and none of it is code:

- Domain bought with registrar privacy; hardware-key 2FA on registrar, host and repo
- Request logging verified **off** at CDN, host and proxy — provider retention confirmed in writing
- Data policy and threat model written in plain Bangla and shipped on the site at launch
- **A written decision on what happens when someone demands the data.** The architecture is what makes "there is nothing to hand over" a true statement rather than a promise — but only if it is written down before launch, not during
- A named answer to: who moderates at 500 reports a day? This is the thing most likely to sink the project, and it is not hosting cost
