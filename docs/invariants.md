# Non-negotiable constraints

Any implementation choice must satisfy these. If a library, service, or
shortcut conflicts with one, pick something else.

1. **No IP, user-agent, device ID, cookie ID, or session ID is ever written to
   disk** — at any layer, including logs.
2. **No free text in the public tier.** Narrative goes to the sealed tier only.
3. **Coarsen at ingest.** Ward-level location and week-level dates only. No
   lat/lng column, no second-precision timestamp, anywhere in the public schema.
4. **Read path is static.** Pre-rendered JSON on the CDN. The database serves
   writes only.
5. **Nothing publishes instantly.** 30-minute batch, screening queue first.
6. **k-anonymity: suppress any display cell with fewer than 5 reports**
   (10 for `police_misconduct`, 15 for person-directed). Show "insufficient
   data", never a zero and never a single-report cell.
7. **A category may never be published finer than its `geo_level`.** The count
   threshold alone is not enough: a rare, person-directed crime pinned to one
   small ward identifies the victim however high the count is. Coarsening the
   geography is the second protection, and it is not optional.
8. **Hazards are not reports.** A street hazard has no victim, so it carries an
   exact point and no threshold. It lives in its own table so that neither
   disclosure rule can ever be applied to the other's rows.
9. **No analytics SDK. No transactional email.** There are no accounts.
10. **Public tier names institutions, never people, never groups.**

> Assume the database will eventually be dumped. The test for every column:
> does a full dump identify a submitter? If yes, the column does not exist.

## How these are enforced, not just documented

| Invariant | Enforcement |
|---|---|
| No coordinates, no timestamps | The columns do not exist. `db/tests/invariants_test.sql` §A fails the build if one is added. |
| Week-level dates | `CHECK (EXTRACT(ISODOW FROM occurred_week) = 1)` — a non-Monday is rejected by Postgres. |
| Day-level submit time | `submitted_day` is `date`, not `timestamptz`. |
| Submit path cannot read | `nirapod_submit` holds `INSERT` on `reports` and no `SELECT` grant. A compromised submit endpoint cannot enumerate reports. |
| Nothing publishes instantly | `status` defaults to `pending`; `published_at` is rejected unless `status = 'approved'`. |
| k-suppression server-side | `public_ward_cells()` returns `NULL` for a thin cell. The suppressed number never leaves the database, so it cannot leak to the client. |
| Higher bar for misconduct | `display_thresholds` — and the thana scorecard counts `police_misconduct` only, so mugging volume cannot carry a thin misconduct signal over the threshold. |
| Audit trail is append-only | `DELETE` on `moderation_events` is revoked from `nirapod_moderator`. |
| Two tiers never merged | `press_records` is a separate table with a separate counter. No view joins them into one number. |
| Geography rule per category | `display_thresholds.geo_level`. `public_cells()` rolls each category up to its own level, so a finer breakdown is never written. The publish job refuses to write anything if a cell's level disagrees with its rule. |
| Hazards cannot leak into reports | Two tables. `hazards` has a point geometry and no threshold; `reports` has no coordinate column at all. |
| One taxonomy | `web/src/lib/taxonomy.js` is imported by the frontend and the validator, and `npm test` asserts it matches `category_rules` / `subcategory_rules` / `hazard_subcategory_rules` in the database. |
| No free text in the method fields | The four "how it happened" fields are enums, not text. `reports` has exactly one text column and the test fails the build if a second appears. |

## Verification

```
DATABASE_URL=postgres://... ./scripts/migrate.sh
```

Runs every migration, then 41 invariant assertions. The Sprint 1 done-when
also requires the manual check: dump the database and read it.

```
pg_dump -d "$DATABASE_URL" --data-only | less
```

Last run: every row was category, ward, thana, week, time band, and a random
UUID. Nothing else.
