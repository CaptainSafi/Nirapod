// GET /api/pow — issue a proof-of-work challenge.
import { issue } from '../_lib/pow.js';
import { json } from '../_lib/respond.js';

export async function onRequestGet({ env }) {
  if (!env.POW_SECRET) {
    // Falling back to a default secret would let anyone mint their own valid
    // challenges, which is the whole point of signing them. Fail loudly.
    return json(500, { ok: false, error: 'not_configured' });
  }
  return json(200, await issue(env.POW_SECRET));
}
