# Nirapod.site — feature list

Everything below is built and tested. Items still to build are in the last
section, kept separate so this list is not a wish list.

---

## 1. Reporting

**Five screens, one question each, no account.** Complete in about three
seconds of typing and under two minutes of thinking. Bangla by default, English
on a toggle, Bangla numerals throughout.

- **Two report kinds**, chosen on the first screen: a crime or incident, or a
  street hazard. They follow different paths because they carry different risk.
- **12 crime categories, 54 subcategories** across street crime, theft,
  extortion, land grabbing, hooliganism, drugs and weapons, fraud and
  impersonation, dangerous driving, police misconduct, harassment, assault and
  abduction.
- **20 street-hazard types** in 7 groups: lighting, road and drains, footpath,
  construction, electrical, crossings, obstruction.
- **"How it happened"** as four optional closed vocabularies: how many people,
  vehicle, weapon, approach. Every field skippable, tap again to deselect.
- **Ward picker** with search across Bangla and English names. No GPS is ever
  requested, and there is no "use my location" button.
- **Week, not date.** The form offers the last eight weeks; an exact date is
  never collected.
- **Tap-the-map location for hazards only** — the one place an exact coordinate
  is taken, because a hazard has no victim in it.
- **Proof of work in the browser** (~1-3s) instead of a captcha, so no third
  party ever sees a visitor.
- **Support resources** shown after a harassment, assault or abduction report.
- **No receipt, no report id, no confirmation email.** There is nothing to
  receive and nothing to look up later.

## 2. The public map

- **Ward choropleth** over 203 real Dhaka wards, with 46 thanas for the coarser
  categories.
- **Validated single-hue colour scale**, five quantile buckets, legend showing
  the actual number range each colour means.
- **Time-of-day toggle** (all / day / night) — the feature the site exists to
  have.
- **Hazard layer** with exact points, filterable by type and by status
  (open / over 30 days / fixed), and a live count of what is being shown.
- **Escalation clock** on every open hazard: days unresolved, and the mark turns
  from amber to red past 30 days.
- **Colourblind-safe by measurement**, not by eye: the hazard states are amber,
  red and a hollow grey ring — no red/green pair anywhere.
- **Detail panel** pinned by tap or by keyboard, showing count, period,
  share who did not go to the police, busiest time of day, how the area compares
  with the average, press-tier count, a month-by-month sparkline, and the typical
  method for that area.
- **Table view** with search, so every number is reachable without hovering.
- **Watermark inside the map** while the site carries demo data, so a screenshot
  cannot lose its context.

## 3. Accountability surfaces

- **Thana scorecards** — reports received, GD-refusal share, no-action share.
  Sortable by any column, searchable, with inline bars on a shared scale.
- **Institutions are named; people never are.**
- **Reported-to-response gap** as the site's headline figure, with the most
  common reason people gave for not going to the police.
- **Two-tier counters** — crowd-reported and press-verified, always shown
  separately, never summed.
- **"Unverified" label** on every crowd figure.

## 4. Privacy and disclosure controls

- **Three disclosure classes**, enforced by the database rather than by
  convention: hazards (no victim, exact point, no threshold), area crime (ward,
  threshold 5), person-directed (thana or district, threshold 15).
- **k-anonymity suppression inside the database.** A thin cell returns `null`,
  so the suppressed number never leaves the server and cannot leak client-side.
- **Geography ceiling per category.** A rare crime is never pinned to one small
  ward however high its count, and coarse categories carry no time-of-day split.
- **"Insufficient data", never zero**, for a suppressed cell.
- **No coordinate column exists** in the reports table; hazards live in their own
  table so neither rule can be applied to the other's rows.
- **Enum-only submissions.** No free-text field anywhere; unknown fields are
  rejected outright.
- **Day-precision dates**, week-precision incidents, no timestamps in any
  published file.
- **No IP, user-agent, session, cookie or localStorage** anywhere.
- **Rate limiting on a salted hash whose salt is discarded weekly**, held in
  memory only, so the linkage expires by design.
- **Content Security Policy** locking the page to its own origin.

## 5. Moderation

- **Separate server, separate auth, no route from the public site.**
- **Review queue** with the reason each report was held ("person-directed",
  "police misconduct", "names a thana").
- **Auto-approve** only when publishing cannot expose anyone: no institution
  named, nothing person-directed, and a target cell that already clears its
  threshold.
- **Hazards auto-publish and are spot-checked**, except the types that imply a
  responsible party.
- **Append-only audit log**; a moderator cannot delete the record of their own
  decisions.
- **Batch publish** every 30 minutes in production, so nothing publishes
  instantly and submit-and-watch correlation does not work.

## 6. Static read path

- **Pre-rendered JSON and HTML.** The database serves writes only; readers never
  touch it, so a traffic spike cannot generate database load or a bill.
- **No third-party request of any kind** — no CDN, no font host, no map tiles,
  no analytics.
- **~590 KB first visit**, most of it ward boundaries.
- Works on a mid-range Android over mobile data; no horizontal scroll at 390px.

## 7. Public information pages

- **How to file a GD**, what to do when it is refused, and emergency numbers.
- **Methodology** in plain Bangla and English: what is collected, what cannot be
  seen, how thresholds work, known bias, and how flooding is resisted.
- **Correction and dispute route** for any institution named.

## 8. Developer surface

- `npm run dev` — API plus hot-reloading frontend, one command, any OS
- `npm start` — API serving the built site
- `npm run build:review` — a folder that uploads to any static host
- `npm test` — 47 end-to-end checks
- `scripts/migrate.sh` — migrations plus 41 database invariant assertions
- Single taxonomy shared by the frontend, the validator and the database, with a
  test that fails if they drift

---

## Not built yet

| Area | Status |
|---|---|
| Press seed pipeline | Sprint 4, the longest pole. The map has no real data without it |
| Sealed tier (names, narrative, photos, video) | Deliberately unbuilt until a press or legal-aid partner holds the key |
| Named-group register | Schema designed in `decision_table.md`; needs the seed CSV and a partner |
| Extortion at thana level, CCTV layer, recovery-destination flow | Specified in `decision_table.md`, not yet built |
| Area subscribe, corroboration prompt, ward escalation clocks | Sprint 5 |
| Per-capita normalisation | Needs ward population figures |
| Real basemap under the choropleth | Needs a self-hosted Protomaps extract |
| Bangla review pass | ~100 taxonomy terms plus 88 ward names are unreviewed |
