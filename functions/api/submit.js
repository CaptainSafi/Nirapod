// POST /api/submit — a report.
//
// The same validator, the same redaction and the same routing rules as the Node
// server in server/index.js. Those three files are pure JavaScript and are
// imported here unchanged: a second implementation of the submit contract is a
// second place for the suppression rules to be subtly wrong.
import { validate } from '../../server/validate.js';
import { redact } from '../../server/redact.js';
import { route } from '../../server/rules.js';
import { verify } from '../_lib/pow.js';
import { connect } from '../_lib/db.js';
import { json, readJson } from '../_lib/respond.js';

export async function onRequestPost({ request, env }) {
  const body = await readJson(request);
  if (!body) return json(400, { ok: false, error: 'expected a json body' });

  const v = validate(body);
  if (v.errors.length) return json(400, { ok: false, errors: v.errors });

  if (!env.POW_SECRET) return json(500, { ok: false, error: 'not_configured' });
  const p = await verify(env.POW_SECRET, body.challenge, body.nonce, env.POW_USED);
  if (!p.ok) return json(400, { ok: false, error: `pow_${p.reason}` });

  const db = connect(env);

  // Routing needs two facts about the database, and the credential this runs
  // with cannot SELECT anything: nirapod_submit has INSERT and nothing else, so
  // that a leak of this string lets someone add rows and read none. See 0012.
  //
  // submit_context() is SECURITY DEFINER and returns two booleans rather than
  // the counts, because route() only ever compares them. Whether a cell is above
  // its threshold is already visible on the published map; the count is not, and
  // the count is what the thresholds exist to hide.
  const ctx = await db.query(
    `SELECT cell_thin, burst FROM submit_context($1, $2, $3)`,
    [body.category, body.ward_id, body.time_band]);
  if (!ctx.rows.length) return json(400, { ok: false, error: 'unknown category' });
  const { cell_thin, burst } = ctx.rows[0];

  // rules.js is shared with the Node server and the tests, so it keeps its
  // numeric signature and this translates. The numbers below are stand-ins that
  // reproduce the same two comparisons; they are never stored or shown.
  const decision = route(body, {
    cellN: cell_thin ? 0 : 1,
    kMin: 1,
    recent: burst ? 5 : 0,
  });

  // Redacted before the insert, and the original is never written anywhere.
  const acc = redact(body.account);
  const accountState = acc.text == null ? 'none'
    : acc.removed.length ? 'held' : 'published';

  try {
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
       acc.text, accountState, acc.text ? new Date().toISOString() : null,
       decision.status, String(body.nonce)]);
  } catch (e) {
    // The database is the last line of defence for every invariant. If it
    // rejects a row the validator let through, that is a bug in the validator,
    // but the row still does not get in.
    return json(400, { ok: false, error: 'rejected', detail: e.message });
  }

  // NOTHING is returned that could be used to find this report later: no id, no
  // receipt, no link. There is nothing to receive.
  return json(202, {
    ok: true,
    queued: decision.status === 'pending',
    // The batch is hourly here, not the demo's 30 minutes: the publish runs in
    // GitHub Actions on a cron. See .github/workflows/publish.yml.
    next_publish_seconds: 3600,
    // What the filters took out, by kind, never by value. A reporter who wrote
    // a phone number should be told it was removed rather than discover later
    // that it was published, or silently assume it was kept.
    redacted: acc.removed,
  });
}
