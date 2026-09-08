// demo_seed.js — SYNTHETIC data so the demo map is not blank.
//
// Every row this writes is invented. None of it describes a real incident, and
// the press-tier rows point at example.invalid rather than at any publication,
// so a demo database can never be mistaken for, or quietly promoted into, the
// real one. The real seed tier is press-sourced, human-reviewed, and linked to
// its source — see the seed pipeline rules in the spec.
//
// Runs only when DEMO=1.

import { CATEGORIES, HAZARDS, METHOD, WHY_NOT, OUTCOMES }
  from '../web/src/lib/taxonomy.js';

const BANDS = ['morning', 'afternoon', 'evening', 'night'];

// Rough shares so the demo is not a uniform smear across twelve categories.
// Street crime dominates because that is what a site like this collects;
// person-directed categories are rarer, which is exactly why they carry a
// higher threshold and a coarser map.
const CATEGORY_WEIGHTS = {
  mugging: 22, theft: 16, chadabaji: 12, transport_danger: 9,
  drugs_weapons: 8, hooliganism: 8, fraud_impersonation: 7,
  police_misconduct: 6, land_grabbing: 4,
  harassment: 5, assault: 2, abduction: 1,
};

// Deterministic PRNG so a demo looks the same every run and a tester can
// compare two runs meaningfully.
function rng(seed = 42) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const mondays = (n) => {
  const out = [];
  const d = new Date(); d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  for (let i = 1; i <= n; i++) {
    const x = new Date(d); x.setUTCDate(x.getUTCDate() - 7 * i);
    out.push(x.toISOString().slice(0, 10));
  }
  return out;
};

// How each category tends to happen. Uniform-random method values produced
// nonsense in the published patterns — "snatching, typical weapon: acid" —
// which makes a working feature look broken to anyone reading the map. These
// are plausible shapes for demo purposes only; the real patterns come from
// what people actually report.
const METHOD_PROFILE = {
  mugging:             { count: ['one','two','two'], vehicle: ['motorcycle','motorcycle','none','bicycle'], weapon: ['none','knife','knife'], approach: ['from_behind','followed','blocked_path'] },
  theft:               { count: ['one','one','two'], vehicle: ['none','motorcycle'], weapon: ['none','none','none'], approach: ['from_behind','unknown','followed'] },
  chadabaji:           { count: ['two','three_to_five'], vehicle: ['none','motorcycle'], weapon: ['none','none','blunt'], approach: ['blocked_path','group_surrounded'] },
  land_grabbing:       { count: ['three_to_five','more'], vehicle: ['none','car'], weapon: ['none','blunt'], approach: ['group_surrounded','blocked_path'] },
  hooliganism:         { count: ['three_to_five','more'], vehicle: ['none','motorcycle'], weapon: ['blunt','none','knife'], approach: ['group_surrounded','blocked_path'] },
  drugs_weapons:       { count: ['two','three_to_five'], vehicle: ['none','motorcycle'], weapon: ['none','knife'], approach: ['unknown','group_surrounded'] },
  fraud_impersonation: { count: ['two','three_to_five'], vehicle: ['car','motorcycle','none'], weapon: ['none','none','firearm'], approach: ['posed_as_official','posed_as_official','blocked_path'] },
  transport_danger:    { count: ['one','unknown'], vehicle: ['motorcycle','car','cng'], weapon: ['none'], approach: ['unknown','dangerous'] },
  police_misconduct:   { count: ['one','two'], vehicle: ['none','car'], weapon: ['none'], approach: ['posed_as_official','posed_as_official','posed_as_official','blocked_path'] },
  harassment:          { count: ['one','one','two','three_to_five'], vehicle: ['none','none','motorcycle'], weapon: ['none'], approach: ['followed','followed','from_behind','from_behind','blocked_path'] },
  assault:             { count: ['one','two','three_to_five'], vehicle: ['none','motorcycle'], weapon: ['blunt','knife','none'], approach: ['blocked_path','from_behind','group_surrounded'] },
  abduction:           { count: ['two','three_to_five'], vehicle: ['car','cng','motorcycle'], weapon: ['knife','firearm','none'], approach: ['blocked_path','followed'] },
};
// A few subcategories determine the method regardless of their category.
const SUB_OVERRIDE = {
  acid_attack:     { weapon: ['acid'] },
  weapon_assault:  { weapon: ['knife','firearm','blunt'] },
  armed_robbery:   { weapon: ['knife','firearm'] },
  arms_display:    { weapon: ['firearm','firearm','knife'] },
  vehicle_based:   { vehicle: ['motorcycle','cng','car'] },
  hijacking:       { vehicle: ['motorcycle','cng','car'] },
  burglary:        { approach: ['unknown'], vehicle: ['none'] },
  pickpocketing:   { weapon: ['none'], approach: ['from_behind','group_surrounded'] },
  fake_police:     { approach: ['posed_as_official'] },
  fake_checkpoint: { approach: ['posed_as_official'] },
};

const SUB_WEIGHTS = {
  assault:   { physical_assault: 78, weapon_assault: 19, acid_attack: 3 },
  abduction: { attempted_abduction: 60, kidnapping: 30, trafficking_suspicion: 10 },
  drugs_weapons: { dealing_spot: 45, open_drug_use: 35, gambling_den: 15, arms_display: 5 },
};

function pickSub(rand, category, subs) {
  const w = SUB_WEIGHTS[category];
  if (!w) return subs[Math.floor(rand() * subs.length)];
  const total = subs.reduce((a, s) => a + (w[s] ?? 1), 0);
  let x = rand() * total;
  for (const s of subs) { x -= (w[s] ?? 1); if (x <= 0) return s; }
  return subs[0];
}

function methodFor(rand, category, subcategory, allowed) {
  const key = { offender_count: 'count', offender_vehicle: 'vehicle',
                weapon: 'weapon', approach: 'approach' };
  const base = METHOD_PROFILE[category] ?? {};
  const over = SUB_OVERRIDE[subcategory] ?? {};
  const draw = (field) => {
    const k = key[field];
    const pool = (over[k] ?? base[k] ?? allowed[field])
      .filter(v => allowed[field].includes(v));
    return pool.length ? pool[Math.floor(rand() * pool.length)] : 'unknown';
  };
  return {
    offender_count: draw('offender_count'),
    offender_vehicle: draw('offender_vehicle'),
    weapon: draw('weapon'),
    approach: draw('approach'),
  };
}

function weightedPick(rand, weights) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let x = rand() * total;
  for (const [k, w] of Object.entries(weights)) { x -= w; if (x <= 0) return k; }
  return Object.keys(weights)[0];
}

export async function seed(db, { reports = 9000, hazards = 400 } = {}) {
  const r = rng();
  const pick = (a) => a[Math.floor(r() * a.length)];
  const wards = (await db.query(`SELECT id, thana_id FROM wards ORDER BY id`)).rows;
  const weeks = mondays(10);

  // Concentrate reports in a minority of wards, the way real reporting does:
  // a uniform sprinkle would make every cell thin and every cell suppressed,
  // which would demo nothing.
  const hot = wards.filter(() => r() < 0.10);
  const pool = hot.length ? hot : wards;

  const COLS = 15;
  const batch = [];
  const flush = async () => {
    if (!batch.length) return;
    const values = batch.map((_, k) =>
      '(' + Array.from({ length: COLS }, (_, c) => `$${k * COLS + c + 1}`).join(',') + ')').join(',');
    await db.query(
      `INSERT INTO reports (category,subcategory,ward_id,thana_id,occurred_week,time_band,
         amount_band,reported_to_police,why_not_reported,police_outcome,status,
         offender_count,offender_vehicle,weapon,approach)
       VALUES ${values}`, batch.flat());
    batch.length = 0;
  };

  for (let i = 0; i < reports; i++) {
    const w = r() < 0.8 ? pick(pool) : pick(wards);
    const category = weightedPick(r, CATEGORY_WEIGHTS);
    const rule = CATEGORIES[category];
    const subcategory = pickSub(r, category, rule.subs);
    const misconduct = category === 'police_misconduct';
    // The headline the launch leads with: most people did not go to the police.
    const reported = misconduct ? true : r() < 0.28;
    const amount = rule.amount
      ? pick(['under_1k', '1k_5k', '5k_25k', '25k_100k', 'over_100k']) : null;

    const m = methodFor(r, category, subcategory, METHOD);
    batch.push([category, subcategory, w.id,
      rule.thana ? w.thana_id : (r() < 0.4 ? w.thana_id : null),
      pick(weeks), r() < 0.45 ? 'night' : pick(BANDS), amount,
      reported, reported ? null : pick(WHY_NOT),
      reported ? (misconduct ? pick(['gd_refused', 'no_action', 'money_demanded']) : pick(OUTCOMES)) : null,
      // A slice stays pending so the moderation queue has something in it.
      r() < 0.06 ? 'pending' : 'approved',
      m.offender_count, m.offender_vehicle, m.weapon, m.approach]);

    if (batch.length >= 500 || i === reports - 1) { await flush(); }
  }

  // Press tier — clearly fake sources. Counted separately, never merged.
  for (let i = 0; i < 60; i++) {
    const w = pick(wards);
    const category = weightedPick(r, CATEGORY_WEIGHTS);
    await db.query(
      `INSERT INTO press_records (source_url,source_name,published_date,category,subcategory,
         ward_id,thana_id,occurred_week,summary_bn,summary_en,reviewed_by,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'approved')
       ON CONFLICT DO NOTHING`,
      [`https://example.invalid/demo/${i}`, 'DEMO DATA — not a real source',
       pick(weeks), category, pick(CATEGORIES[category].subs), w.id, w.thana_id, pick(weeks),
       'ডেমো তথ্য — এটি প্রকৃত কোনো ঘটনা নয়।',
       'Demo data — this does not describe a real incident.',
       'demo-seed']);
  }

  // Hazards, scattered inside real ward polygons so the points land on the map
  // where a street actually is.
  const wardGeo = (await db.query(`SELECT id, geometry FROM wards`)).rows;
  const ringsOf = (g) => {
    const j = typeof g === 'string' ? JSON.parse(g) : g;
    return j.type === 'Polygon' ? [j.coordinates[0]] : j.coordinates.map(p => p[0]);
  };
  const inRing = (ring, x, y) => {
    let inside = false;
    for (let i = 0, k = ring.length - 1; i < ring.length; k = i++) {
      const [xi, yi] = ring[i], [xk, yk] = ring[k];
      if ((yi > y) !== (yk > y) && x < ((xk - xi) * (y - yi)) / (yk - yi) + xi)
        inside = !inside;
    }
    return inside;
  };
  // Rejection sampling: a bounding-box point would drop hazards into the river
  // and into neighbouring wards, and a map full of manholes in the Buriganga
  // makes the whole demo look untrustworthy.
  const pointIn = (g) => {
    const rings = ringsOf(g);
    const pts = rings.flat();
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    for (let t = 0; t < 60; t++) {
      const x = minX + r() * (maxX - minX);
      const y = minY + r() * (maxY - minY);
      if (rings.some(ring => inRing(ring, x, y))) return [x, y];
    }
    return null;   // give up on awkward shapes rather than place a false point
  };

  const hazardSubs = Object.entries(HAZARDS)
    .flatMap(([cat, subs]) => subs.map(s => [cat, s]));

  for (let i = 0; i < hazards; i++) {
    const w = pick(wardGeo);
    const [cat, sub] = pick(hazardSubs);
    const p = pointIn(w.geometry);
    if (!p) continue;
    const [lon, lat] = p;
    const age = Math.floor(r() * 120);
    // Most stay open — the escalation clock is the point.
    const resolved = r() < 0.18;
    await db.query(
      `INSERT INTO hazards (category, subcategory, location, ward_id, reported_day,
         confirmations, resolved_on, status)
       VALUES ($1,$2,ST_SetSRID(ST_MakePoint($3,$4),4326),$5,
               CURRENT_DATE - $6::int, $7, $8, 'approved')`,
      [cat, sub, lon, lat, w.id, age, Math.floor(r() * 12),
       resolved ? new Date(Date.now() - Math.floor(r() * age) * 864e5)
                    .toISOString().slice(0, 10) : null]);
  }

  const n = (await db.query(`SELECT count(*)::int c FROM reports`)).rows[0].c;
  const h = (await db.query(`SELECT count(*)::int c FROM hazards`)).rows[0].c;
  return { reports: n, hazards: h };
}
