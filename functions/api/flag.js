// POST /api/flag — a reader reports a published account.
//
// Two flags hold it automatically and a moderator can put it back. One flag
// would be trivial censorship; waiting for a human on a site that has no human
// on duty is how bad content stays up for a week.
//
// No identity is taken from the flagger, which means this is abusable by anyone
// patient. That is the accepted cost of having no accounts, and it is why two
// flags HOLD rather than delete.
import { connect } from '../_lib/db.js';
import { json, readJson } from '../_lib/respond.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function onRequestPost({ request, env }) {
  const body = await readJson(request);
  if (typeof body?.id !== 'string' || !UUID.test(body.id))
    return json(400, { ok: false });

  // An UPDATE the submit role does not have and must not get: UPDATE on reports
  // would let this credential rewrite anybody's account. flag_account() is
  // SECURITY DEFINER and touches exactly two columns of one row. See 0012.
  const db = connect(env);
  const r = await db.query(`SELECT flag_account($1) AS found`, [body.id]);
  if (!r.rows[0]?.found) return json(404, { ok: false });

  // Nothing about the outcome is returned. Telling a flagger whether their flag
  // pulled something is a way to probe how many others have already flagged it.
  return json(202, { ok: true });
}
