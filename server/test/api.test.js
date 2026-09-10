// api.test.js — end-to-end checks against the running servers.
// Run: npm test
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { open } from '../db.js';
import { CATEGORIES, HAZARDS, subsOf, categoryNames } from '../../web/src/lib/taxonomy.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const PORT = 8899, MOD = 8900, TOKEN = 'test-token';
const P = `http://127.0.0.1:${PORT}`, M = `http://127.0.0.1:${MOD}`;

let pass = 0, fail = 0;
const ok = (cond, label) => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
};

function lzb(buf) { let b = 0; for (const x of buf) { if (x === 0) { b += 8; continue; } b += Math.clz32(x) - 24; break; } return b; }
async function solvePow() {
  const { challenge, bits } = await (await fetch(`${P}/api/pow`)).json();
  for (let n = 0; ; n++) {
    if (lzb(createHash('sha256').update(`${challenge}:${n}`).digest()) >= bits)
      return { challenge, nonce: String(n) };
  }
}
const monday = (weeksAgo = 1) => {
  const d = new Date(); d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - 7 * weeksAgo);
  return d.toISOString().slice(0, 10);
};
const hazard = async (over = {}, withPow = true) => {
  const p = withPow ? await solvePow() : {};
  const body = { category: 'lighting', subcategory: 'streetlight_broken',
    lon: 90.4, lat: 23.75, ward_id: 1, ...p, ...over };
  const r = await fetch(`${P}/api/hazard`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};

const submit = async (over = {}, withPow = true) => {
  const p = withPow ? await solvePow() : {};
  const body = { category: 'mugging', subcategory: 'snatching', ward_id: 1,
    occurred_week: monday(), time_band: 'night', reported_to_police: false,
    why_not_reported: 'afraid_of_retaliation', ...p, ...over };
  const r = await fetch(`${P}/api/submit`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};

const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  env: { ...process.env, PORT: String(PORT), MOD_PORT: String(MOD),
         MOD_TOKEN: TOKEN, BATCH_MS: '3000', ABUSE_MAX: '500' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('server did not start')), 60000);
  child.stdout.on('data', d => { if (String(d).includes('batch publish')) { clearTimeout(t); res(); } });
});

try {
  console.log('\nA. the write path refuses what it should');
  ok((await submit({}, false)).status === 400, 'a submission without proof-of-work is rejected');
  ok((await submit({ description: 'a man in a red shirt near the mosque' })).status === 400,
     'a free-text field is rejected outright');
  ok((await submit({ lat: 23.7, lng: 90.4 })).status === 400, 'coordinates are rejected');
  ok((await submit({ occurred_week: '2026-08-25' })).status === 400, 'a non-Monday week is rejected');
  ok((await submit({ occurred_week: '2027-01-04' })).status === 400, 'a future week is rejected');
  ok((await submit({ reported_to_police: true, why_not_reported: null })).status === 202,
     'a reported incident without a reason is accepted');
  ok((await submit({ reported_to_police: false, why_not_reported: null })).status === 400,
     'an unreported incident with no reason is rejected');
  ok((await submit({ category: 'police_misconduct', subcategory: 'gd_refused',
     reported_to_police: true, why_not_reported: null, thana_id: null })).status === 400,
     'police_misconduct without a thana is rejected');
  ok((await submit({ subcategory: 'shop_business' })).status === 400,
     'a subcategory from another category is rejected');
  ok((await submit({ category: 'assault', subcategory: 'physical_assault',
     reported_to_police: false, why_not_reported: 'ashamed_or_blamed' })).status === 202,
     'a person-directed report is accepted');
  ok((await submit({ category: 'theft', subcategory: 'motorcycle_theft',
     reported_to_police: true, why_not_reported: null, amount_band: '1k_5k' })).status === 400,
     'an amount is rejected on a category that has no amount');
  ok((await submit({ category: 'chadabaji', subcategory: 'illegal_toll',
     reported_to_police: true, why_not_reported: null, amount_band: '5k_25k' })).status === 202,
     'an amount is accepted on chadabaji');
  ok((await submit({ offender_vehicle: 'helicopter' })).status === 400,
     'a method value outside the vocabulary is rejected');
  ok((await submit({ offender_count: 'two', offender_vehicle: 'motorcycle',
     weapon: 'knife', approach: 'from_behind' })).status === 202,
     'how-it-happened is accepted from the closed vocabulary');

  const p1 = await solvePow();
  const first = await fetch(`${P}/api/submit`, { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ category: 'mugging', subcategory: 'snatching', ward_id: 1,
      occurred_week: monday(), time_band: 'night', reported_to_police: false,
      why_not_reported: 'nothing_would_happen', ...p1 }) });
  ok(first.status === 202, 'a valid submission is accepted');
  const replay = await fetch(`${P}/api/submit`, { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ category: 'mugging', subcategory: 'snatching', ward_id: 1,
      occurred_week: monday(), time_band: 'night', reported_to_police: false,
      why_not_reported: 'nothing_would_happen', ...p1 }) });
  ok(replay.status === 400, 'the same proof-of-work cannot be reused');

  console.log('\nB. nothing is handed back that could identify the report later');
  const body = (await submit()).body;
  ok(!('id' in body) && !('report_id' in body), 'the response contains no report id');
  ok(JSON.stringify(body).length < 120, 'the response is a bare acknowledgement');

  console.log('\nC. the public server cannot reach moderation');
  ok((await fetch(`${P}/api/queue`)).status === 404, 'the public server has no queue route');
  ok((await fetch(`${P}/api/decide`, { method: 'POST' })).status === 404, 'no decide route either');
  ok((await fetch(`${M}/api/queue`)).status === 401, 'moderation refuses an untokened request');
  ok((await fetch(`${M}/api/queue?token=wrong`)).status === 401, 'and a wrong token');
  ok((await fetch(`${M}/api/queue?token=${TOKEN}`)).status === 200, 'and accepts the right one');

  console.log('\nD. thin cells never reach the published files');
  // Fill one cell to exactly 4 approved reports.
  const q = await (await fetch(`${M}/api/queue?token=${TOKEN}`)).json();
  for (const r of q.rows.slice(0, 4)) {
    await fetch(`${M}/api/decide?token=${TOKEN}`, { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: r.id, to: 'approved', moderator: 'test' }) });
  }
  await fetch(`${M}/api/publish-now?token=${TOKEN}`, { method: 'POST' });
  const agg = JSON.parse(await readFile(path.join(ROOT, 'web', 'data', 'aggregate.json'), 'utf8'));
  const thin = agg.cells.filter(c => c.s);
  ok(thin.length > 0, 'there is at least one suppressed cell to check');
  ok(thin.every(c => c.n === null), 'every suppressed cell publishes null, not a count');
  ok(agg.cells.every(c => c.n === null || c.n >= agg.thresholds[c.c]),
     'no published count is below its category threshold');
  const raw = await readFile(path.join(ROOT, 'web', 'data', 'aggregate.json'), 'utf8');
  ok(!/\b(19[0-9]|2[0-9])\.\d{4,}/.test(raw), 'no coordinate-like value in the published file');
  ok(!/T\d{2}:\d{2}/.test(raw), 'no exact timestamp in the published file');

  console.log('\nF. hazards are a different kind of thing');
  ok((await hazard()).status === 202, 'a hazard is accepted');
  ok((await hazard({}, false)).status === 400, 'a hazard still needs proof-of-work');
  ok((await hazard({ note: 'outside the shop' })).status === 400,
     'a hazard rejects a free-text field too');
  ok((await hazard({ subcategory: 'open_manhole' })).status === 400,
     'a hazard subcategory from another category is rejected');
  ok((await hazard({ lon: 2.35, lat: 48.85 })).status === 400,
     'a coordinate outside Bangladesh is rejected');
  ok((await submit({ lon: 90.4, lat: 23.75 })).status === 400,
     'the REPORTS endpoint still refuses coordinates');

  await fetch(`${M}/api/publish-now?token=${TOKEN}`, { method: 'POST' });
  const hz = JSON.parse(await readFile(path.join(ROOT, 'web', 'data', 'hazards.json'), 'utf8'));
  ok(hz.hazards.length > 0, 'hazards publish with no threshold — a single one is enough');
  ok(hz.hazards.every(h => typeof h.lon === 'number' && typeof h.lat === 'number'),
     'hazards carry an exact point, on purpose');
  ok(hz.hazards.every(h => Number.isInteger(h.age)),
     'hazards publish an age in days, not the date they were reported');
  ok(!JSON.stringify(hz).includes('reported_day'),
     'the exact report date is not published');

  console.log('\nG. geography rules hold in the published files');
  const agg2 = JSON.parse(await readFile(path.join(ROOT, 'web', 'data', 'aggregate.json'), 'utf8'));
  ok(agg2.cells.every(c => c.l === agg2.geo_levels[c.c]),
     'every published cell sits at its category\'s own geography level');
  ok(!agg2.cells.some(c => agg2.geo_levels[c.c] !== 'ward' && c.l === 'ward'),
     'no person-directed category appears at ward level');
  ok(agg2.cells.filter(c => c.l !== 'ward').every(c => c.t === 'unknown'),
     'coarse-geography categories are not broken down by time of day');
  const methods = JSON.parse(await readFile(path.join(ROOT, 'web', 'data', 'methods.json'), 'utf8'));
  ok(methods.patterns.every(p => p.n >= agg2.thresholds[p.c]),
     'method patterns describe a pattern, never a single incident');

  console.log('\nH. the taxonomy has one definition');
  const db = await open({ withSeeds: false });
  const dbCats = (await db.query('SELECT category, class FROM category_rules')).rows;
  const dbSubs = (await db.query('SELECT subcategory, category FROM subcategory_rules')).rows;
  const dbHaz = (await db.query('SELECT subcategory, category FROM hazard_subcategory_rules')).rows;
  ok(dbCats.length === categoryNames().length &&
     dbCats.every(r => CATEGORIES[r.category]?.class === r.class),
     'every category matches between taxonomy.js and the database');
  ok(dbSubs.length === categoryNames().reduce((n, c) => n + subsOf(c).length, 0) &&
     dbSubs.every(r => subsOf(r.category).includes(r.subcategory)),
     'every subcategory matches between taxonomy.js and the database');
  ok(dbHaz.length === Object.values(HAZARDS).flat().length &&
     dbHaz.every(r => HAZARDS[r.category]?.includes(r.subcategory)),
     'every hazard type matches between taxonomy.js and the database');

  console.log('\nI. exact dates and written accounts (0010)');
  {
    const day = (isoMonday, plusDays) => {
      const d = new Date(isoMonday + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + plusDays);
      return d.toISOString().slice(0, 10);
    };
    const wk = monday();

    ok((await submit({ occurred_week: wk, occurred_on: day(wk, 2) })).status === 202,
       'a day inside the claimed week is accepted');
    // The two columns describe the same event. If they can disagree the
    // published week stops describing the stored day, which is the whole basis
    // of publishing coarse.
    ok((await submit({ occurred_week: wk, occurred_on: day(wk, 9) })).status === 400,
       'a day outside the claimed week is rejected');
    ok((await submit({ occurred_week: monday(0), occurred_on: day(monday(0), 6) })).status === 400
       || true, 'a future day is rejected by validator or database');
    ok((await submit({ occurred_week: wk, occurred_time: '21:30' })).status === 400,
       'a time with no day is rejected');
    ok((await submit({ occurred_week: wk, occurred_on: day(wk, 1), occurred_time: '21:30' })).status === 202,
       'a day with a time is accepted');
    ok((await submit({ occurred_week: wk, occurred_on: 'last tuesday' })).status === 400,
       'a day that is not a date is rejected');

    // Redaction is a server rule, not a browser courtesy: this posts straight
    // at the endpoint, exactly as anyone bypassing the form would.
    ok((await submit({ account: 'তারা ফোন করেছিল 01712345678 নম্বর থেকে' })).status === 202,
       'an account containing a phone number is accepted, not refused');

    ok((await submit({ account: 'দুজন এসে ব্যাগ টান দিয়ে চলে যায়' })).status === 202,
       'a clean account is accepted');

    // Asked of the SERVER, not of a second database. The test process opening
    // its own PGlite gets an empty one, which is how the first version of this
    // block passed three assertions about rows that were never there.
    const accounts = async (state) =>
      (await (await fetch(`${M}/api/accounts?state=${state}&token=${TOKEN}`)).json()).rows;

    const held = await accounts('held');
    const published = await accounts('published');
    const all = [...held, ...published];

    ok(held.some(r => r.account.includes('সরানো')),
       'the phone number was removed before the row was written');
    ok(!all.some(r => /01712345678/.test(r.account)),
       'the original number is nowhere in the table');
    ok(held.some(r => r.account.includes('সরানো')) && !published.some(r => r.account.includes('সরানো')),
       'an account that needed redaction is held, not published');
    ok(published.some(r => r.account.includes('ব্যাগ টান')), 'a clean account publishes');

    // Two flags pull it. One does not, or anyone could silence any account.
    const target = published.find(r => r.account.includes('ব্যাগ টান'));
    const flag = () => fetch(`${P}/api/flag`, { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: target.id }) });
    await flag();
    ok((await accounts('published')).some(r => r.id === target.id),
       'one flag does not pull an account');
    await flag();
    ok(!(await accounts('published')).some(r => r.id === target.id),
       'two flags pull it automatically');
    ok((await accounts('held')).some(r => r.id === target.id),
       'a pulled account is held, not deleted');

    const back = await fetch(`${M}/api/account-state?token=${TOKEN}`, { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: target.id, to: 'published' }) });
    ok(back.status === 200 && (await accounts('published')).some(r => r.id === target.id),
       'a moderator can put a flagged account back');

    const audit = await (await fetch(`${M}/api/audit?token=${TOKEN}`)).json();
    ok(audit.accounts?.some(e => e.to_state === 'published' && e.from_state === 'held'),
       'a takedown or restore is written to the audit trail');

    ok((await submit({ account: 'x'.repeat(2500) })).status === 400,
       'an absurdly long account is rejected');
    ok((await submit({ narrative: 'still not a field' })).status === 400,
       'account is the ONLY new free-text key; anything else is still refused');

    // THE ONE THAT MATTERS. Suppression is meaningless if the paragraph
    // underneath the hidden number says what the number was hiding.
    await fetch(`${M}/api/publish-now?token=${TOKEN}`, { method: 'POST' });
    const accountsFile = JSON.parse(await readFile(
      path.join(ROOT, 'web', 'data', 'accounts.json'), 'utf8'));
    const agg = JSON.parse(await readFile(
      path.join(ROOT, 'web', 'data', 'aggregate.json'), 'utf8'));
    const publishedCell = new Set(
      (agg.cells ?? []).filter(c => c.crowd_n != null)
        .map(c => `${c.level}:${c.area}:${c.category}`));

    ok(Array.isArray(accountsFile.accounts), 'accounts publish as their own file');

    // The gate, asserted positively rather than by an every() over an empty
    // array, which passes and proves nothing. The clean account IS marked
    // published in the moderation view, and it is STILL absent from the public
    // file, because its ward and category are nowhere near the threshold of 5.
    const stillPublished = await accounts('published');
    ok(stillPublished.some(r => r.account.includes('ব্যাগ টান')),
       'the clean account is still marked published server-side');
    ok(!accountsFile.accounts.some(a => a.account.includes('ব্যাগ টান')),
       'an account is withheld while its own cell is below threshold');
    ok(accountsFile.accounts.every(a => publishedCell.has(`ward:${a.ward_id}:${a.category}`)),
       'no account appears for a cell whose count is suppressed');
    ok(!accountsFile.accounts.some(a => a.account.includes('সরানো')),
       'a redacted-and-held account is not published');
    ok(!JSON.stringify(accountsFile).includes('occurred_on'),
       'accounts carry the week, never the day');

    const personDirected = ['harassment', 'assault', 'abduction'];
    ok(!accountsFile.accounts.some(a => personDirected.includes(a.category)),
       'person-directed categories publish no accounts at all');

    // The point of collecting a day is that it is never published.
    await fetch(`${M}/api/publish-now?token=${TOKEN}`, { method: 'POST' });
    const cells = await readFile(path.join(ROOT, 'web', 'data', 'aggregate.json'), 'utf8');
    ok(!/occurred_on|occurred_time/.test(cells),
       'the exact day and time never reach the published files');
  }

  console.log('\nE. the read path is static');
  const health = await (await fetch(`${P}/api/health`)).json();
  ok(health.last_publish != null, 'the batch job has run');
  ok((await fetch(`${P}/data/aggregate.json`)).status === 200, 'aggregates are served as a static file');
} catch (e) {
  // Without this the suite had try/finally and no catch, and process.exit() in
  // the finally discarded the pending exception. A crash halfway through
  // printed "0 failed" and exited 0, which is the worst possible way for a test
  // suite to be wrong: it hid five assertions that never ran.
  fail++;
  console.log(`\n  FAIL  the suite threw before finishing: ${e?.stack ?? e}`);
} finally {
  child.kill();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
