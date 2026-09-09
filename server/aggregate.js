// aggregate.js — the batch publish job. Spec §3.3, §4.
//
// This is the ONLY thing that turns database rows into a public surface, and
// it runs on a cadence rather than on submit: batching prevents the
// submit-and-watch correlation attack, where someone submits a report, refreshes
// the map, and learns which cell moved — which tells them the map is reporting
// them specifically.
//
// Everything written here has already passed k-suppression INSIDE the database
// (public_ward_cells() returns NULL, not a small number). The suppressed counts
// never enter this process, so they cannot leak into a JSON file by mistake.

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Dates leave this process as YYYY-MM-DD strings and nothing else.
 * The driver hands back JS Date objects, and JSON.stringify would render those
 * as "2026-08-01T00:00:00.000Z" — a timestamp shape in a file that is not
 * allowed to contain one. Coercing here means a published file can never carry
 * a time component even if a new column is added upstream.
 */
function day(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

export async function publish(db, outDir, { seedsDir, demo = false } = {}) {
  await mkdir(outDir, { recursive: true });

  const cells = (await db.query(`SELECT * FROM public_cells()`)).rows;
  const rollups = (await db.query(`SELECT * FROM public_rollups()`)).rows;
  const summary = (await db.query(`SELECT * FROM public_city_summary()`)).rows;
  const hazards = (await db.query(`SELECT * FROM public_hazards()`)).rows;
  const methods = (await db.query(`SELECT * FROM public_method_patterns()`)).rows;
  const scorecards = (await db.query(`SELECT * FROM public_thana_scorecards()`)).rows;
  const gap = (await db.query(`SELECT * FROM public_reporting_gap($1)`, [5])).rows;
  const press = (await db.query(`SELECT * FROM press_cell_counts`)).rows;
  const thresholds = (await db.query(`SELECT * FROM display_thresholds`)).rows;
  const wards = (await db.query(
    `SELECT id, thana_id, name_en, name_bn, district, upazila, population FROM wards ORDER BY id`)).rows;
  const thanas = (await db.query(
    `SELECT id, name_en, name_bn FROM thanas ORDER BY id`)).rows;

  // A published cell must never carry a count below its threshold. This is a
  // belt-and-braces check on top of the database function: if it ever fires,
  // something has gone wrong in the suppression layer and we publish nothing.
  const kFor = Object.fromEntries(thresholds.map(t => [t.category, t.k_min]));
  const geoFor = Object.fromEntries(thresholds.map(t => [t.category, t.geo_level]));
  for (const c of cells) {
    if (c.crowd_n != null && c.crowd_n < kFor[c.category]) {
      throw new Error(
        `refusing to publish: cell ${c.level}=${c.area} ${c.category} has ` +
        `n=${c.crowd_n} below threshold ${kFor[c.category]}`);
    }
    if (c.suppressed && c.crowd_n != null) {
      throw new Error('refusing to publish: suppressed cell carries a count');
    }
    // A category may never be published finer than its own geography rule.
    // The database already enforces this; publishing is the last place it can
    // still be got wrong, so it is checked again before anything hits disk.
    if (c.level !== geoFor[c.category]) {
      throw new Error(
        `refusing to publish: ${c.category} at level "${c.level}" but its rule ` +
        `is "${geoFor[c.category]}"`);
    }
  }

  // Rollups get the same belt-and-braces treatment as cells. `any` is checked
  // against the strictest ward threshold, because that is what the database
  // used, and a rollup may never be finer than the category's own rule.
  const anyK = Math.max(...Object.entries(kFor)
    .filter(([c]) => geoFor[c] === 'ward').map(([, k]) => k));
  const LEVEL_RANK = { ward: 0, thana: 1, district: 2 };
  for (const r of rollups) {
    const k = r.scope === 'any' ? anyK : kFor[r.scope];
    if (k === undefined) {
      throw new Error(`refusing to publish: rollup scope "${r.scope}" has no threshold`);
    }
    if (r.crowd_n != null && r.crowd_n < k) {
      throw new Error(
        `refusing to publish: rollup ${r.level}=${r.area} ${r.scope} has ` +
        `n=${r.crowd_n} below threshold ${k}`);
    }
    if (r.suppressed && r.crowd_n != null) {
      throw new Error('refusing to publish: suppressed rollup carries a count');
    }
    // Coarser than the category's own rule is fine and is the point of a
    // rollup. Finer is a disclosure bug.
    const rule = r.scope === 'any' ? 'ward' : geoFor[r.scope];
    if (LEVEL_RANK[r.level] < LEVEL_RANK[rule]) {
      throw new Error(
        `refusing to publish: rollup ${r.scope} at level "${r.level}" is finer ` +
        `than its rule "${rule}"`);
    }
  }

  // The city summary is the coarsest thing published here, but it is still
  // counts of people, so it gets the same refusal as everything else.
  const kFloor = Math.min(...Object.values(kFor));
  for (const r of summary) {
    if (r.n != null && r.n < kFloor) {
      throw new Error(
        `refusing to publish: city summary ${r.metric}/${r.bucket} has n=${r.n} ` +
        `below the floor ${kFloor}`);
    }
  }

  const generated_at = new Date().toISOString().slice(0, 10);   // day precision

  const files = {
    'aggregate.json': {
      generated_at,
      demo,
      thresholds: kFor,
      // crowd_n is null wherever the cell is suppressed. The client renders
      // "insufficient data" for null. It never receives the real number.
      // `l` is the geography level and `a` the area id at that level — a ward
      // id, a thana id, or a district name. The client cannot ask for a finer
      // level than a category allows, because a finer level was never written.
      cells: cells.map(c => ({
        l: c.level, a: c.area, c: c.category, t: c.time_band,
        m: day(c.occurred_month), n: c.crowd_n, u: c.unreported_n,
        s: c.suppressed,
      })),
      geo_levels: geoFor,
      // Totals over every time band and month, each threshold-checked in its
      // own right. This is what the map reads by default: the sliced `cells`
      // are for the day/night breakdown, and slicing is what made 90% of the
      // map read "insufficient data". `k` is the threshold that applied.
      rollups: rollups.map(r => ({
        l: r.level, a: r.area, c: r.scope,
        n: r.crowd_n, u: r.unreported_n, s: r.suppressed,
      })),
      any_threshold: anyK,
      // City-wide totals and distributions. The one row of numbers a
      // screenshot can carry, and the answer to "what happened when people
      // did go to the police", which no official statistic publishes.
      summary: summary.map(r => ({
        m: r.metric, b: r.bucket, n: r.n, of: r.of_n,
      })),
    },
    // Street hazards: exact points, no threshold, no victim. Separate file
    // because it is a separate disclosure rule, and mixing them in one payload
    // is how a rule gets applied to the wrong rows.
    'hazards.json': {
      generated_at,
      hazards: hazards.map(h => ({
        id: h.id, c: h.category, s: h.subcategory,
        lon: h.lon, lat: h.lat, w: h.ward_id,
        conf: h.confirmations, age: h.age_days, done: h.resolved,
      })),
    },
    // How it happened, for cells that already clear their threshold. This is
    // the awareness content — what to expect on this stretch after dark —
    // and it describes a pattern, never one incident.
    'methods.json': {
      generated_at,
      patterns: methods.map(m => ({
        w: m.ward_id, c: m.category, n: m.n,
        count: m.top_offender_count, vehicle: m.top_vehicle,
        weapon: m.top_weapon, approach: m.top_approach,
      })),
    },
    'press.json': {
      generated_at,
      // The press tier is a SEPARATE counter. Never summed with the crowd tier.
      cells: press.map(p => ({ w: p.ward_id, c: p.category, m: day(p.occurred_month), n: p.press_n })),
    },
    'thanas.json': {
      generated_at,
      thanas: thanas.map(t => ({
        ...t,
        scorecard: scorecards.find(s => s.thana_id === t.id) ?? null,
      })),
    },
    'gap.json': { generated_at, districts: gap },
    'wards.json': { generated_at, wards },
    'meta.json': {
      generated_at,
      demo,
      thresholds: kFor,
      note: 'Counts below the threshold for their category are published as null and shown as "insufficient data", never as zero.',
    },
  };

  for (const [name, body] of Object.entries(files)) {
    await writeFile(path.join(outDir, name), JSON.stringify(body));
  }

  // Boundaries are static and change rarely; copy them once into the same
  // static payload so the read path never touches the database.
  if (seedsDir) {
    for (const f of ['dhaka_wards.geojson', 'dhaka_thanas.geojson']) {
      await writeFile(path.join(outDir, f), await readFile(path.join(seedsDir, f)));
    }
  }

  return {
    cells: cells.length,
    published: cells.filter(c => !c.suppressed).length,
    hazards: hazards.length,
    methods: methods.length,
  };
}
