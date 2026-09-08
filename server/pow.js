// pow.js — proof-of-work on submit. Spec §3.4.
//
// Free for one honest user (~1-2s in the browser), expensive for ten thousand
// fake ones. This is the anti-flooding measure that does NOT require knowing
// who the submitter is: no account, no IP record, no captcha vendor watching
// the visitor.
//
// A challenge is random, single-use, and expires in 10 minutes. It is not
// derived from anything about the submitter, so it cannot become an identifier.

import { createHash, randomBytes } from 'node:crypto';

const TTL_MS = 10 * 60 * 1000;
export const DIFFICULTY_BITS = Number(process.env.POW_BITS ?? 18);

// In memory ONLY. Never written to disk: a table of live challenges plus
// submit times would be a correlation surface.
const issued = new Map();   // challenge -> expiresAt

export function issue() {
  sweep();
  const challenge = randomBytes(16).toString('hex');
  issued.set(challenge, Date.now() + TTL_MS);
  return { challenge, bits: DIFFICULTY_BITS };
}

function sweep() {
  const now = Date.now();
  for (const [c, exp] of issued) if (exp < now) issued.delete(c);
}

export function leadingZeroBits(buf) {
  let bits = 0;
  for (const byte of buf) {
    if (byte === 0) { bits += 8; continue; }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

/** Verify and CONSUME the challenge. A solution works exactly once. */
export function verify(challenge, nonce) {
  sweep();
  if (typeof challenge !== 'string' || typeof nonce !== 'string')
    return { ok: false, reason: 'malformed' };
  if (!issued.has(challenge)) return { ok: false, reason: 'unknown_or_expired' };

  const digest = createHash('sha256').update(`${challenge}:${nonce}`).digest();
  if (leadingZeroBits(digest) < DIFFICULTY_BITS)
    return { ok: false, reason: 'insufficient_work' };

  issued.delete(challenge);              // single use: no replay
  return { ok: true };
}

export function solve(challenge, bits = DIFFICULTY_BITS) {
  // Reference solver — the browser runs the same loop in a worker.
  for (let n = 0; ; n++) {
    const d = createHash('sha256').update(`${challenge}:${n}`).digest();
    if (leadingZeroBits(d) >= bits) return String(n);
  }
}

export function _size() { return issued.size; }
