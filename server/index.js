// index.js — two servers, two trust levels. Spec §5.1.
//
//   PUBLIC  (port 8787)  static read path + write-only submit endpoint
//   MODERATION (port 8788)  the queue. In production this is NOT on the public
//                           internet at all — it sits behind Cloudflare Access
//                           or a tunnel. Running it on a separate port with a
//                           separate token is the demo's stand-in, and the
//                           point is that the public server has no route to it.
//
// The public server never reads the reports table. It serves pre-rendered JSON
// written by the batch job, exactly as the CDN would.

import http from 'node:http';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { open, SEEDS } from './db.js';
import * as pow from './pow.js';
import * as abuse from './abuse.js';
import { validate, validateHazard } from './validate.js';
import { redact } from './redact.js';
import { route, routeHazard } from './rules.js';
import { publish } from './aggregate.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const WEB = path.join(ROOT, 'web');
const BUILD = path.join(WEB, 'build');   // static export from `npm run build`
const DATA = path.join(WEB, 'data');     // written by the batch publish job

const PUBLIC_PORT = Number(process.env.PORT ?? 8787);
const MOD_PORT = Number(process.env.MOD_PORT ?? 8788);
const MOD_TOKEN = process.env.MOD_TOKEN ?? 'demo-moderator-token';
// Production cadence is 30 minutes (spec §3.3). The demo default is short so a
// tester does not wait half an hour to see a report appear.
const BATCH_MS = Number(process.env.BATCH_MS ?? 15_000);

const db = await open();
let lastPublish = null;

// DEMO=1 fills the database with SYNTHETIC reports so the map has something to
// show. Never set this anywhere real.
export const DEMO = process.env.DEMO === '1';
if (DEMO) {
  const { seed } = await import('./demo_seed.js');
  const s = await seed(db);
  console.log(`[demo] seeded ${s.reports} synthetic reports — none of this is real`);
}

async function runBatch() {
  try {
    lastPublish = { at: new Date().toISOString(), ...(await publish(db, DATA, { seedsDir: SEEDS, demo: DEMO })) };
  } catch (e) {
    console.error('[batch] refused to publish:', e.message);
  }
}
await runBatch();
setInterval(runBatch, BATCH_MS);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const json = (res, code, body) => {
  const s = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(s),
    // No third party may frame or fingerprint this page.
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  });
  res.end(s);
};

const readBody = (req) => new Promise((resolve, reject) => {
  let n = 0; const chunks = [];
  req.on('data', c => {
    n += c.length;
    if (n > 4096) { reject(new Error('body too large')); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => {
    try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
    catch { reject(new Error('invalid json')); }
  });
  req.on('error', reject);
});

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8', '.svg': 'image/svg+xml' };

async function serveStatic(req, res, roots) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  if (p.includes('..')) { res.writeHead(400); return res.end(); }
  for (const root of roots) {
    const file = path.join(root, p);
    if (!file.startsWith(root)) continue;
    try {
      const s = await stat(file);
      if (!s.isFile()) continue;
      const buf = await readFile(file);
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
        'content-length': buf.length,
        'referrer-policy': 'no-referrer',
      });
      return res.end(buf);
    } catch { /* try next root */ }
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
}

// ---------------------------------------------------------------------------
// public server
// ---------------------------------------------------------------------------
const publicServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  // NOTE ON LOGGING: nothing here logs the request. No IP, no user-agent, no
  // path+time pair that could be correlated with a publish. Do not add a
  // request logger to this server. Spec §5.2.

  if (url.pathname === '/api/pow' && req.method === 'GET') {
    return json(res, 200, pow.issue());
  }

  if (url.pathname === '/api/submit' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); }
    catch (e) { return json(res, 400, { ok: false, error: e.message }); }

    // The address is hashed with a weekly-rotating salt inside abuse.check and
    // is never stored. It does not appear in any log or table.
    const gate = abuse.check(req.socket.remoteAddress ?? 'unknown');
    if (!gate.allowed) return json(res, 429, { ok: false, error: 'rate_limited' });

    const v = validate(body);
    if (v.errors.length) return json(res, 400, { ok: false, errors: v.errors });

    const p = pow.verify(body.challenge, body.nonce);
    if (!p.ok) return json(res, 400, { ok: false, error: `pow_${p.reason}` });

    // Routing needs to know how full the target cell already is.
    const kRow = await db.query(
      `SELECT k_min FROM display_thresholds WHERE category = $1`, [body.category]);
    const cellRow = await db.query(
      `SELECT count(*)::int n FROM reports
        WHERE status='approved' AND ward_id=$1 AND category=$2 AND time_band=$3`,
      [body.ward_id, body.category, body.time_band]);
    const recentRow = await db.query(
      `SELECT count(*)::int n FROM reports
        WHERE ward_id=$1 AND category=$2 AND submitted_day = CURRENT_DATE`,
      [body.ward_id, body.category]);

    const decision = route(body, {
      cellN: cellRow.rows[0].n,
      kMin: kRow.rows[0].k_min,
      recent: recentRow.rows[0].n,
    });

    try {
      // The account is redacted HERE, before the insert, and the original is
      // not kept anywhere. If a filter had to remove something the account is
      // held rather than published: the reporter has already shown they will
      // write identifying detail, and the next sentence may carry the kind no
      // regex can catch.
      const acc = redact(body.account);
      const accountState = acc.text == null ? 'none'
        : acc.removed.length ? 'held' : 'published';

      await db.query(
        `INSERT INTO reports
           (category, subcategory, ward_id, thana_id, occurred_week, time_band,
            amount_band, reported_to_police, why_not_reported, police_outcome,
            occurred_on, occurred_time, account, account_state, account_at,
            status, pow_nonce)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [body.category, body.subcategory, body.ward_id, body.thana_id ?? null,
         body.occurred_week, body.time_band, body.amount_band ?? null,
         body.reported_to_police, body.why_not_reported ?? null,
         body.police_outcome ?? null,
         body.occurred_on ?? null, body.occurred_time ?? null,
         acc.text, accountState, acc.text ? new Date() : null,
         decision.status, String(body.nonce)]);
    } catch (e) {
      // The database is the last line of defence for every invariant. If it
      // rejects a row the validator let through, that is a bug in the
      // validator — but the row still does not get in.
      return json(res, 400, { ok: false, error: 'rejected', detail: e.message });
    }

    // NOTHING is returned that could be used to find this report later: no id,
    // no receipt, no link. There is nothing to receive.
    return json(res, 202, {
      ok: true,
      queued: decision.status === 'pending',
      next_publish_seconds: Math.round(BATCH_MS / 1000),
    });
  }

  // Hazards: a separate endpoint because they are a separate disclosure rule.
  // They carry an exact coordinate, which the reports endpoint must never
  // accept, and they publish without a threshold, which reports must never do.
  if (url.pathname === '/api/hazard' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); }
    catch (e) { return json(res, 400, { ok: false, error: e.message }); }

    const gate = abuse.check(req.socket.remoteAddress ?? 'unknown');
    if (!gate.allowed) return json(res, 429, { ok: false, error: 'rate_limited' });

    const v = validateHazard(body);
    if (v.errors.length) return json(res, 400, { ok: false, errors: v.errors });

    const p = pow.verify(body.challenge, body.nonce);
    if (!p.ok) return json(res, 400, { ok: false, error: `pow_${p.reason}` });

    const nearby = await db.query(
      `SELECT count(*)::int n FROM hazards
        WHERE ward_id = $1 AND reported_day = CURRENT_DATE`, [body.ward_id]);
    const decision = routeHazard(body, { nearbyToday: nearby.rows[0].n });

    try {
      await db.query(
        `INSERT INTO hazards (category, subcategory, location, ward_id, status, pow_nonce)
         VALUES ($1,$2,ST_SetSRID(ST_MakePoint($3,$4),4326),$5,$6,$7)`,
        [body.category, body.subcategory, body.lon, body.lat, body.ward_id,
         decision.status, String(body.nonce)]);
    } catch (e) {
      return json(res, 400, { ok: false, error: 'rejected', detail: e.message });
    }

    return json(res, 202, {
      ok: true,
      queued: decision.status === 'pending',
      next_publish_seconds: Math.round(BATCH_MS / 1000),
    });
  }

  // Anyone reading can flag an account. Two flags pull it automatically and a
  // moderator can put it back: one flag is trivial censorship, and waiting for
  // a human on a site with no human is how bad content stays up for a week.
  // No id of the flagger is taken, so this is abusable by anyone patient. That
  // is the accepted cost of not having accounts.
  if (url.pathname === '/api/flag' && req.method === 'POST') {
    const body = await readBody(req).catch(() => null);
    // reports.id is a uuid, not a serial. Requiring an integer here rejected
    // every real flag with a 400 while the tests happily reported that flagging
    // "did not pull the account".
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof body?.id !== 'string' || !UUID.test(body.id)) return json(res, 400, { ok: false });
    // .allowed, not .ok. The first version of this line read `g.ok`, which is
    // undefined, so every flag was answered 429 and the test that said "one
    // flag does not pull an account" passed because no flag ever landed.
    const g = abuse.check(req.socket.remoteAddress ?? 'unknown');
    if (!g.allowed) return json(res, 429, { ok: false, error: 'slow_down' });
    const r = await db.query(
      `UPDATE reports
          SET account_flags = account_flags + 1,
              account_state = CASE WHEN account_state = 'published'
                                    AND account_flags + 1 >= 2 THEN 'held'
                                   ELSE account_state END
        WHERE id = $1 AND account IS NOT NULL
        RETURNING account_state`, [body.id]);
    if (!r.rows.length) return json(res, 404, { ok: false });
    // Nothing about the outcome is returned. A flagger learning whether their
    // flag pulled something is a way to probe how many others have flagged it.
    return json(res, 202, { ok: true });
  }

  if (url.pathname === '/api/health') {
    return json(res, 200, { ok: true, last_publish: lastPublish });
  }

  // Everything else is static: the read path never touches the database.
  return serveStatic(req, res, [BUILD, WEB]);
});

// ---------------------------------------------------------------------------
// moderation server — separate process boundary, separate auth
// ---------------------------------------------------------------------------
const modServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const token = url.searchParams.get('token') ??
    (req.headers.authorization ?? '').replace(/^Bearer /, '');
  if (token !== MOD_TOKEN) {
    res.writeHead(401, { 'content-type': 'text/plain' });
    return res.end('unauthorised — this app is not a public surface');
  }

  if (url.pathname === '/api/queue') {
    const rows = (await db.query(
      `SELECT r.id, r.category, r.subcategory, r.ward_id, r.thana_id,
              r.occurred_week, r.time_band, r.amount_band, r.reported_to_police,
              r.why_not_reported, r.police_outcome, r.status, r.submitted_day,
              w.name_en AS ward_name, t.name_en AS thana_name
         FROM reports r
         JOIN wards w ON w.id = r.ward_id
         LEFT JOIN thanas t ON t.id = r.thana_id
        WHERE r.status = $1
        ORDER BY r.submitted_day ASC, r.id
        LIMIT 200`, [url.searchParams.get('status') ?? 'pending'])).rows;
    return json(res, 200, { rows });
  }

  if (url.pathname === '/api/decide' && req.method === 'POST') {
    const body = await readBody(req).catch(() => null);
    if (!body?.id || !['approved', 'rejected', 'held'].includes(body.to)) {
      return json(res, 400, { ok: false, error: 'id and to are required' });
    }
    const before = await db.query(`SELECT status FROM reports WHERE id = $1`, [body.id]);
    if (!before.rows.length) return json(res, 404, { ok: false });
    await db.query(`UPDATE reports SET status = $2 WHERE id = $1`, [body.id, body.to]);
    await db.query(
      `INSERT INTO moderation_events (report_id, moderator, from_status, to_status, reason)
       VALUES ($1,$2,$3,$4,$5)`,
      [body.id, body.moderator ?? 'demo', before.rows[0].status, body.to, body.reason ?? null]);
    return json(res, 200, { ok: true });
  }

  // The pull list. Safi chose reactive moderation over a blocking queue: an
  // account publishes on arrival unless a filter caught something, and this is
  // the one screen that shows what is live so it can be taken down in one
  // click. Default order is newest first, because the thing you need to see is
  // whatever just appeared.
  if (url.pathname === '/api/accounts') {
    const state = url.searchParams.get('state') ?? 'published';
    const rows = (await db.query(
      `SELECT r.id, r.account, r.account_state, r.account_flags, r.account_at,
              r.category, r.subcategory, r.ward_id, r.occurred_week,
              w.name_en AS ward_name
         FROM reports r
         JOIN wards w ON w.id = r.ward_id
        WHERE r.account IS NOT NULL AND r.account_state = $1
        ORDER BY r.account_flags DESC, r.account_at DESC
        LIMIT 200`, [state])).rows;
    return json(res, 200, { rows });
  }

  if (url.pathname === '/api/account-state' && req.method === 'POST') {
    const body = await readBody(req).catch(() => null);
    if (!body?.id || !['held', 'published', 'pulled'].includes(body.to)) {
      return json(res, 400, { ok: false, error: 'id and to are required' });
    }
    const before = await db.query(
      `SELECT account_state FROM reports WHERE id = $1 AND account IS NOT NULL`, [body.id]);
    if (!before.rows.length) return json(res, 404, { ok: false });
    await db.query(
      `UPDATE reports SET account_state = $2 WHERE id = $1`, [body.id, body.to]);
    // A takedown is a moderation decision and is audited like one, so it cannot
    // be done quietly. Its own table: moderation_events.to_status is the
    // report_status enum and an account state is not a report status.
    await db.query(
      `INSERT INTO account_events (report_id, moderator, from_state, to_state, reason)
       VALUES ($1,$2,$3,$4,$5)`,
      [body.id, body.moderator ?? 'demo', before.rows[0].account_state, body.to,
       body.reason ?? null]);
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/api/audit') {
    const rows = (await db.query(
      `SELECT * FROM moderation_events ORDER BY id DESC LIMIT 100`)).rows;
    const accounts = (await db.query(
      `SELECT * FROM account_events ORDER BY id DESC LIMIT 100`)).rows;
    return json(res, 200, { rows, accounts });
  }

  if (url.pathname === '/api/publish-now' && req.method === 'POST') {
    await runBatch();
    return json(res, 200, { ok: true, ...lastPublish });
  }

  return serveStatic(req, res, [path.join(ROOT, 'moderation')]);
});

// A port clash is the most likely thing to go wrong on someone's own machine —
// usually a copy of this already running. Say that in one line instead of
// dumping a stack trace, which reads like the project is broken.
function listen(server, port, label, onReady) {
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(
        `\nPort ${port} is already in use, so the ${label} server did not start.\n` +
        `Another copy of this is probably still running — close it, or set a ` +
        `different port:\n` +
        (label === 'moderation' ? `  MOD_PORT=8798 npm start\n` : `  PORT=8797 npm start\n`));
      process.exit(1);
    }
    throw e;
  });
  server.listen(port, onReady);
}

listen(publicServer, PUBLIC_PORT, 'public', () =>
  console.log(`public      http://localhost:${PUBLIC_PORT}`));
listen(modServer, MOD_PORT, 'moderation', () =>
  console.log(`moderation  http://localhost:${MOD_PORT}/?token=${MOD_TOKEN}`));
console.log(`batch publish every ${BATCH_MS / 1000}s (production: 1800s)`);
