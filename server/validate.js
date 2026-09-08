// validate.js — the submit contract.
//
// The public tier accepts ENUM VALUES ONLY. There is no free-text field, and
// this validator rejects any key it does not recognise, so a client cannot
// smuggle a narrative, a name, a phone number or a coordinate into the write
// path. Free text is the single most common deanonymisation vector in systems
// like this one.
//
// The taxonomy comes from web/src/lib/taxonomy.js — one definition shared with
// the frontend, and asserted against the database in the test suite.

import {
  CATEGORIES, HAZARDS, METHOD, TIME_BANDS, AMOUNT_BANDS, WHY_NOT, OUTCOMES,
  categoryOfSub, hazardCategoryOf,
} from '../web/src/lib/taxonomy.js';

export { CATEGORIES, HAZARDS };

const REPORT_KEYS = new Set(['category', 'subcategory', 'ward_id', 'thana_id',
  'occurred_week', 'time_band', 'amount_band', 'reported_to_police',
  'why_not_reported', 'police_outcome',
  'offender_count', 'offender_vehicle', 'weapon', 'approach',
  'challenge', 'nonce']);

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

  // The client sends a week, never a date — but never trust the client with
  // an invariant. The database checks this again.
  checkWeek(body.occurred_week, push);

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
