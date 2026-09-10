// validate.js — the submit contract.
//
// The public tier accepts ENUM VALUES ONLY, with two named exceptions added on
// Safi's decision (2026-09-09): the exact day and time, and one free-text
// account. Everything else is still closed vocabulary, and this validator still
// rejects any key it does not recognise, so nothing else can be smuggled in.
//
// Free text remains the single most common deanonymisation vector in systems
// like this one. It is accepted here, not trusted here: the text is handed to
// server/redact.js before it reaches the database, and only the redacted
// version is ever stored. This file's job is to bound it, not to clean it.
//
// The taxonomy comes from web/src/lib/taxonomy.js — one definition shared with
// the frontend, and asserted against the database in the test suite.

import {
  CATEGORIES, HAZARDS, METHOD, TIME_BANDS, AMOUNT_BANDS, WHY_NOT, OUTCOMES,
  categoryOfSub, hazardCategoryOf,
} from '../web/src/lib/taxonomy.js';

export { CATEGORIES, HAZARDS };

const REPORT_KEYS = new Set(['category', 'subcategory', 'ward_id', 'thana_id',
  'occurred_week', 'occurred_on', 'occurred_time', 'account',
  'time_band', 'amount_band', 'reported_to_police',
  'why_not_reported', 'police_outcome',
  'offender_count', 'offender_vehicle', 'weapon', 'approach',
  'challenge', 'nonce']);

// Bigger than the 600 the database stores, because redaction shortens text and
// a reporter who pasted a little too much should get a trimmed account rather
// than a rejected form. Far below anything that could be used as a payload.
const ACCOUNT_RAW_MAX = 2000;

/** The Monday of the week containing an ISO date. Mirrors the SQL check. */
function mondayOfISO(isoDay) {
  const d = new Date(isoDay + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

const HAZARD_KEYS = new Set(['category', 'subcategory', 'lon', 'lat', 'ward_id',
  'challenge', 'nonce']);

function checkWeek(wk, push) {
  if (typeof wk !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(wk)) return push('occurred_week');
  const d = new Date(wk + 'T00:00:00Z');
  if (Number.isNaN(+d)) return push('occurred_week');
  if (d.getUTCDay() !== 1) return push('occurred_week must be a Monday');
  if (d > new Date()) return push('occurred_week cannot be in the future');
  if (+new Date() - +d > 3 * 365 * 864e5) return push('occurred_week too old');
}

export function validate(body) {
  const errors = [];
  const push = (m) => errors.push(m);
  if (typeof body !== 'object' || body === null) return { errors: ['body must be an object'] };

  for (const k of Object.keys(body)) if (!REPORT_KEYS.has(k)) push(`unexpected field: ${k}`);

  const { category, subcategory, time_band, amount_band,
          why_not_reported, police_outcome, reported_to_police } = body;

  const rule = CATEGORIES[category];
  if (!rule) push('category');
  if (!rule || categoryOfSub(subcategory) !== category) push('subcategory');
  if (!Number.isInteger(body.ward_id)) push('ward_id');
  if (body.thana_id != null && !Number.isInteger(body.thana_id)) push('thana_id');
  if (!TIME_BANDS.includes(time_band)) push('time_band');
  if (typeof reported_to_police !== 'boolean') push('reported_to_police');

  // The week is still required and is still what gets published. The day is
  // optional and must agree with it: two columns that can drift are two columns
  // that will drift, and then the published week stops describing the stored
  // day. The database asserts this again in 0010, because a validator is a
  // convenience and a CHECK constraint is a guarantee.
  checkWeek(body.occurred_week, push);

  if (body.occurred_on != null) {
    if (typeof body.occurred_on !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.occurred_on)) {
      push('occurred_on');
    } else {
      const d = new Date(body.occurred_on + 'T00:00:00Z');
      if (Number.isNaN(+d)) push('occurred_on');
      else if (d > new Date()) push('occurred_on cannot be in the future');
      else if (mondayOfISO(body.occurred_on) !== body.occurred_week)
        push('occurred_on is not inside occurred_week');
    }
  }

  // A time with no day is a client bug, and a time on its own would be a
  // slightly odd thing to store about someone.
  if (body.occurred_time != null) {
    if (typeof body.occurred_time !== 'string' || !/^\d{2}:\d{2}(:\d{2})?$/.test(body.occurred_time))
      push('occurred_time');
    else if (body.occurred_on == null) push('occurred_time without occurred_on');
  }

  if (body.account != null) {
    if (typeof body.account !== 'string') push('account');
    else if (body.account.length > ACCOUNT_RAW_MAX) push('account is too long');
  }

  if (reported_to_police === false) {
    if (!WHY_NOT.includes(why_not_reported)) push('why_not_reported is required');
    if (police_outcome != null) push('police_outcome without a report');
  } else if (reported_to_police === true) {
    if (why_not_reported != null) push('why_not_reported on a reported incident');
    if (police_outcome != null && !OUTCOMES.includes(police_outcome)) push('police_outcome');
  }

  if (amount_band != null) {
    if (!AMOUNT_BANDS.includes(amount_band)) push('amount_band');
    else if (!rule?.amount) push('amount_band is not meaningful for this category');
  }

  if (rule?.thana && !Number.isInteger(body.thana_id))
    push(`${category} requires a thana`);

  // "How it happened" — optional, but only from the closed vocabulary.
  for (const [field, allowed] of Object.entries(METHOD)) {
    const v = body[field];
    if (v != null && !allowed.includes(v)) push(field);
  }

  return { errors };
}

/**
 * Hazards take an exact coordinate, which `reports` never does — there is no
 * victim to expose. What they must NOT take is anything about the person who
 * reported it, so the key allowlist is just as strict.
 */
export function validateHazard(body) {
  const errors = [];
  const push = (m) => errors.push(m);
  if (typeof body !== 'object' || body === null) return { errors: ['body must be an object'] };

  for (const k of Object.keys(body)) if (!HAZARD_KEYS.has(k)) push(`unexpected field: ${k}`);

  if (!HAZARDS[body.category]) push('category');
  else if (hazardCategoryOf(body.subcategory) !== body.category) push('subcategory');

  if (!Number.isInteger(body.ward_id)) push('ward_id');

  // Bangladesh's bounding box, roughly. A coordinate outside it is a mistake
  // or a probe, and either way is not a hazard on a Dhaka street.
  const { lon, lat } = body;
  if (typeof lon !== 'number' || lon < 88 || lon > 92.7) push('lon');
  if (typeof lat !== 'number' || lat < 20.5 || lat > 26.7) push('lat');

  return { errors };
}
