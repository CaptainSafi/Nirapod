// pow.js — proof of work, without a server that remembers anything.
//
// server/pow.js keeps issued challenges in a Map, which is correct there and
// impossible here: a Worker has no memory between requests, and two requests
// may not even reach the same machine. So the challenge carries its own proof
// that we issued it.
//
//   challenge = <ts>.<random>.<hmac of the first two>
//
// Verifying is recomputing the HMAC and checking the timestamp is recent. No
// storage, no table of live challenges, and nothing about the submitter goes
// into it, so it still cannot become an identifier.
//
// THE CONTRACT WITH THE BROWSER IS UNCHANGED and must stay that way: the client
// hashes `${challenge}:${nonce}` with SHA-256 and looks for `bits` leading
// zeroes. Only the shape of `challenge` changed, and to the client it is opaque.

const TTL_MS = 10 * 60 * 1000;
export const DIFFICULTY_BITS = 18;

const enc = new TextEncoder();
const hex = (bytes) => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');

async function sign(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

export async function issue(secret) {
  const ts = Date.now().toString(36);
  const rand = hex(crypto.getRandomValues(new Uint8Array(12)));
  const body = `${ts}.${rand}`;
  const sig = (await sign(secret, body)).slice(0, 32);
  return { challenge: `${body}.${sig}`, bits: DIFFICULTY_BITS };
}

export function leadingZeroBits(bytes) {
  let bits = 0;
  for (const byte of bytes) {
    if (byte === 0) { bits += 8; continue; }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

/** Constant-time-ish compare. Not a secret leak of consequence here, but a
 *  signature check that returns early is a habit worth not forming. */
function same(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * @param {KVNamespace|undefined} used  optional store for single-use enforcement
 */
export async function verify(secret, challenge, nonce, used) {
  if (typeof challenge !== 'string' || typeof nonce !== 'string')
    return { ok: false, reason: 'malformed' };

  const parts = challenge.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [ts, rand, sig] = parts;

  const expect = (await sign(secret, `${ts}.${rand}`)).slice(0, 32);
  if (!same(sig, expect)) return { ok: false, reason: 'unknown_or_expired' };

  const issuedAt = parseInt(ts, 36);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > TTL_MS || issuedAt > Date.now() + 60_000)
    return { ok: false, reason: 'unknown_or_expired' };

  const digest = new Uint8Array(await crypto.subtle.digest(
    'SHA-256', enc.encode(`${challenge}:${nonce}`)));
  if (leadingZeroBits(digest) < DIFFICULTY_BITS)
    return { ok: false, reason: 'insufficient_work' };

  // Single use. Without a store a solved challenge can be replayed for the rest
  // of its ten minutes, which turns one unit of work into as many submissions
  // as the attacker can send in that window. With KV bound, a solution works
  // exactly once, and the free tier's 1,000 writes a day doubles as a cap on
  // submissions per day, which for this site is a reasonable ceiling rather
  // than a limitation.
  if (used) {
    if (await used.get(challenge)) return { ok: false, reason: 'already_used' };
    await used.put(challenge, '1', { expirationTtl: 700 });
  }

  return { ok: true };
}
