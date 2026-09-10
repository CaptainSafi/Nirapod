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

  const db = connect(env);
  const r = await db.query(
    `UPDATE reports
        SET account_flags = account_flags + 1,
            account_state = CASE WHEN account_state = 'published'
                                  AND account_flags + 1 >= 2 THEN 'held'
                                 ELSE account_state END
      WHERE id = $1 AND account IS NOT NULL
      RETURNING id`, [body.id]);
  if (!r.rows.length) return json(404, { ok: false });

  // Nothing about the outcome is returned. Telling a flagger whether their flag
  // pulled something is a way to probe how many others have already flagged it.
  return json(202, { ok: true });
}
