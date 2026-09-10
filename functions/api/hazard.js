// POST /api/hazard — a street hazard.
//
// A separate endpoint because it is a separate disclosure rule: no victim, so
// it carries an exact point and publishes with no threshold.
import { validateHazard } from '../../server/validate.js';
import { routeHazard } from '../../server/rules.js';
import { verify } from '../_lib/pow.js';
import { connect } from '../_lib/db.js';
import { json, readJson } from '../_lib/respond.js';

export async function onRequestPost({ request, env }) {
  const body = await readJson(request);
  if (!body) return json(400, { ok: false, error: 'expected a json body' });

  const v = validateHazard(body);
  if (v.errors.length) return json(400, { ok: false, errors: v.errors });

  if (!env.POW_SECRET) return json(500, { ok: false, error: 'not_configured' });
  const p = await verify(env.POW_SECRET, body.challenge, body.nonce, env.POW_USED);
  if (!p.ok) return json(400, { ok: false, error: `pow_${p.reason}` });

  const db = connect(env);
  // Same reason as submit: the role cannot SELECT. See 0012.
  const ctx = await db.query(`SELECT burst FROM hazard_context($1)`, [body.ward_id]);
  const decision = routeHazard(body, { nearbyToday: ctx.rows[0]?.burst ? 10 : 0 });

  try {
    await db.query(
      `INSERT INTO hazards (category, subcategory, location, ward_id, status, pow_nonce)
       VALUES ($1,$2,ST_SetSRID(ST_MakePoint($3,$4),4326),$5,$6,$7)`,
      [body.category, body.subcategory, body.lon, body.lat, body.ward_id,
       decision.status, String(body.nonce)]);
  } catch (e) {
    return json(400, { ok: false, error: 'rejected', detail: e.message });
  }

  return json(202, {
    ok: true,
    queued: decision.status === 'pending',
    next_publish_seconds: 3600,
  });
}
