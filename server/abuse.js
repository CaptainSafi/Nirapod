// abuse.js — rate limiting without retaining identity. Spec §3.4.
//
// Buckets are keyed on a SALTED HASH, and the salt is discarded weekly, so
// linkage between a bucket and any network identity expires by design and
// cannot be reconstructed afterwards — not by us, not by anyone who compels us.
//
// Nothing here touches the database. It lives in memory and dies with the
// process. The raw address is hashed on arrival and never held.

import { createHash, randomBytes } from 'node:crypto';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = Number(process.env.ABUSE_MAX ?? 12);

let salt = randomBytes(32);
let saltBornAt = Date.now();
const buckets = new Map();   // hash -> timestamps[]

function rotateIfStale() {
  if (Date.now() - saltBornAt < WEEK_MS) return;
  salt = randomBytes(32);            // the old salt is not kept anywhere
  saltBornAt = Date.now();
  buckets.clear();                   // and neither are the old buckets
}

/** @returns {{allowed: boolean, remaining: number}} */
export function check(rawSignal) {
  rotateIfStale();
  const key = createHash('sha256').update(salt).update(String(rawSignal)).digest('hex');
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter(t => now - t < WINDOW_MS);
  if (hits.length >= MAX_PER_WINDOW) {
    buckets.set(key, hits);
    return { allowed: false, remaining: 0 };
  }
  hits.push(now);
  buckets.set(key, hits);
  return { allowed: true, remaining: MAX_PER_WINDOW - hits.length };
}

export function _rotateNow() { saltBornAt = 0; rotateIfStale(); }
export function _size() { return buckets.size; }
