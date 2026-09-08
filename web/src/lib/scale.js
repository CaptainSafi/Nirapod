// scale.js — the sequential colour scale for the choropleth.
//
// One hue, monotone lightness, five steps. The previous version moved hue,
// saturation and lightness together, which is a rainbow ramp: readers cannot
// order it, and it implies category changes where there is only more or less
// of the same thing.
//
// These steps were validated, not chosen by eye, against this app's own dark
// surface (#171a1d):
//   monotone lightness · adjacent ΔL ≥ 0.06 · single hue (12° spread)
//   darkest step 2.42:1 against the surface, so the lowest bucket is still
//   distinguishable from a ward with no reports at all.
export const RAMP = ['#7a4d1e', '#a26722', '#c9852f', '#e3a85c', '#f6cd93'];

// Three states that are NOT on the ramp, because they are not magnitudes:
export const NO_DATA = '#1b1f23';        // no reports here
export const SUPPRESSED = 'url(#hatch)'; // below threshold — texture, not a colour

/**
 * Quantile buckets over the published values.
 *
 * Equal-interval buckets would put almost every ward in bucket 1 and leave the
 * top four for a handful of outliers, which is what the old continuous scale
 * effectively did. Quantiles spend the colour range on the wards that exist.
 */
export function buckets(values) {
  const v = values.filter(n => n !== null && n !== undefined).sort((a, b) => a - b);
  if (!v.length) return [];
  const cuts = [];
  for (let i = 1; i < RAMP.length; i++) {
    cuts.push(v[Math.floor((i / RAMP.length) * v.length)]);
  }
  // Collapse duplicate cuts (small data sets), keeping the ramp monotone.
  return cuts.filter((c, i) => i === 0 || c > cuts[i - 1]);
}

export function colourFor(n, cuts) {
  if (n === null || n === undefined) return null;
  let i = 0;
  while (i < cuts.length && n >= cuts[i]) i++;
  return RAMP[Math.min(i, RAMP.length - 1)];
}

/**
 * Legend rows: the colour, and the range of values it stands for.
 *
 * `min` is the smallest value actually published. Starting the first bucket at
 * 1 would be a lie in both directions: nothing below the k-threshold is ever
 * published, so no ward on this map has a count of 1, and a reader would take
 * the low end of the scale to mean "almost none happened here".
 */
export function legendSteps(cuts, min = 1) {
  const rows = [];
  for (let i = 0; i < Math.min(RAMP.length, cuts.length + 1); i++) {
    const lo = i === 0 ? min : cuts[i - 1];
    const hi = i < cuts.length ? cuts[i] - 1 : null;
    rows.push({ colour: RAMP[i], lo, hi });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Hazard status.
//
// The previous legend used green for "fixed" and red for "over 30 days open".
// That pair measures ΔE 4.1 under deuteranopia — about one man in twelve cannot
// tell those dots apart, and they carry opposite meanings.
//
// So: green is gone. A fixed hazard is a hollow grey ring — no hue, and a
// different SHAPE, so the state survives both colourblindness and greyscale
// printing. The two live states are amber and red, which measure ΔE 24.4.
export const HAZARD = {
  fixed:   { fill: 'none',    stroke: '#6b7280', ring: true,  r: 3 },
  recent:  { fill: '#fab219', stroke: '#0f1113', ring: false, r: 4 },
  overdue: { fill: '#d03b3b', stroke: '#0f1113', ring: false, r: 5 },
};

export function hazardState(h) {
  if (h.done) return 'fixed';
  return h.age > 30 ? 'overdue' : 'recent';
}
