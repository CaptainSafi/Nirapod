// rules.js — auto-approve vs review queue. Spec §3.3.
//
// Auto-approve is the FAST AND SAFE path, not the default path. A submission
// takes it only when publishing it cannot expose anyone: no institution named,
// nothing person-directed, and a target cell that already clears the threshold
// without this report. Everything else waits for a human.

import { CATEGORIES } from '../web/src/lib/taxonomy.js';

export const REVIEW_REASONS = {
  PERSON_DIRECTED: 'person-directed — always reviewed',
  MISCONDUCT: 'police_misconduct — always reviewed',
  NAMES_THANA: 'names a thana',
  THIN_CELL: 'target cell is below the display threshold',
  ANOMALY: 'anomalous burst in this cell',
};

/**
 * @param {object} r     the submission
 * @param {number} cellN approved reports ALREADY in the target cell
 * @param {number} kMin  threshold for this category
 * @param {number} recent submissions to this cell today
 */
export function route(r, { cellN, kMin, recent }) {
  const reasons = [];
  const rule = CATEGORIES[r.category];

  // Harassment, assault, abduction. These are about a person, they are rarer,
  // and a mistake here costs more than a mistake about a pothole.
  if (rule?.class === 'person_directed') reasons.push(REVIEW_REASONS.PERSON_DIRECTED);

  // An accusation against a named public body is never auto-published.
  if (r.category === 'police_misconduct') reasons.push(REVIEW_REASONS.MISCONDUCT);
  else if (r.thana_id != null) reasons.push(REVIEW_REASONS.NAMES_THANA);

  // If the cell is thin, this report would be the one that reveals it.
  if (cellN < kMin) reasons.push(REVIEW_REASONS.THIN_CELL);

  // A burst in one cell is either a real event or someone gaming the map.
  if (recent >= 5) reasons.push(REVIEW_REASONS.ANOMALY);

  return reasons.length
    ? { status: 'pending', reasons }
    : { status: 'approved', reasons: [] };
}

/**
 * Hazards publish on the next batch and are spot-checked afterwards.
 *
 * The reasoning is not that hazards do not matter — it is that they contain no
 * accusation and no victim, so the worst case of publishing a bad one is a
 * wasted trip by a repair crew, while the worst case of a moderation backlog
 * is that nobody reports the open manhole at all. They will be the highest
 * volume category on the site; putting them through the same queue as an
 * assault report is what buries the moderation team.
 *
 * A hazard is still queued when it is the kind that names or accuses by
 * implication — an "unsafe construction" report points at a specific builder.
 */
const QUEUED_HAZARDS = new Set(['unsafe_construction', 'unmarked_excavation',
  'footpath_encroached', 'blocking_parking']);

export function routeHazard(h, { nearbyToday = 0 } = {}) {
  const reasons = [];
  if (QUEUED_HAZARDS.has(h.subcategory))
    reasons.push('implies a responsible party — reviewed');
  if (nearbyToday >= 10) reasons.push(REVIEW_REASONS.ANOMALY);

  return reasons.length
    ? { status: 'pending', reasons }
    : { status: 'approved', reasons: [] };
}

/** Sample rate for after-the-fact spot checks of auto-published hazards. */
export const HAZARD_SPOT_CHECK_RATE = 0.05;
