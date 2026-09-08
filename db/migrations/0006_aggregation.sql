-- 0006_aggregation.sql
-- k-suppressed aggregation at the geography each category is allowed.
-- Handoff §2: suppression happens HERE, in the aggregation layer, not in the
-- frontend. Suppressed numbers must never leave the database.
--
-- Two protections, not one:
--   * the COUNT threshold  — a cell below k_min publishes NULL, never a number
--   * the GEOGRAPHY level  — a category may not be published finer than its
--     geo_level, so a rare person-directed crime is never pinned to one ward
--
-- Cells below threshold render as "insufficient data" — never as zero. A single
-- report in a small ward, with a category and a time window, can identify the
-- victim to the person who did it.

BEGIN;

-- Raw cell counts at every level. Aggregator-only. NOT a public surface.
CREATE VIEW cell_counts_raw AS
SELECT
  r.ward_id,
  w.thana_id,
  w.district,
  r.category,
  r.time_band,
  date_trunc('month', r.occurred_week)::date AS occurred_month,
  count(*)::integer                                     AS crowd_n,
  count(*) FILTER (WHERE r.reported_to_police = false)::integer
                                                        AS unreported_n,
  count(*) FILTER (WHERE r.police_outcome = 'gd_refused')::integer
                                                        AS gd_refused_n,
  count(*) FILTER (WHERE r.police_outcome = 'no_action')::integer
                                                        AS no_action_n
FROM reports r
JOIN wards w ON w.id = r.ward_id
WHERE r.status = 'approved'
GROUP BY 1,2,3,4,5,6;

-- The one public aggregate. `level` says which geography `area` refers to,
-- and it is chosen by the category's own rule — never by the caller, so no
-- query can ask for a finer breakdown than a category permits.
CREATE FUNCTION public_cells()
RETURNS TABLE (
  level          text,
  area           text,
  category       report_category,
  time_band      time_band,
  occurred_month date,
  crowd_n        integer,
  unreported_n   integer,
  suppressed     boolean
)
LANGUAGE sql STABLE AS $$
  WITH rolled AS (
    SELECT
      t.geo_level AS level,
      CASE t.geo_level
        WHEN 'ward'     THEN c.ward_id::text
        WHEN 'thana'    THEN c.thana_id::text
        WHEN 'district' THEN c.district
      END AS area,
      c.category,
      -- Time of day is itself identifying when the geography is coarse and the
      -- category is rare, so person-directed categories are not broken down by
      -- time band at all.
      CASE WHEN t.geo_level = 'ward' THEN c.time_band ELSE 'unknown'::time_band END AS time_band,
      c.occurred_month,
      sum(c.crowd_n)::integer      AS crowd_n,
      sum(c.unreported_n)::integer AS unreported_n,
      t.k_min
    FROM cell_counts_raw c
    JOIN display_thresholds t ON t.category = c.category
    GROUP BY 1,2,3,4,5,t.k_min
  )
  SELECT
    level, area, category, time_band, occurred_month,
    CASE WHEN crowd_n >= k_min THEN crowd_n END,
    CASE WHEN crowd_n >= k_min THEN unreported_n END,
    crowd_n < k_min
  FROM rolled
  WHERE area IS NOT NULL;
$$;

-- Press tier, counted separately. Never merged with the crowd tier into one
-- number. Spec §2.3: the gap between them is the finding.
CREATE VIEW press_cell_counts AS
SELECT
  p.ward_id,
  p.category,
  date_trunc('month', COALESCE(p.occurred_week, p.published_date))::date
    AS occurred_month,
  count(*)::integer AS press_n
FROM press_records p
WHERE p.status = 'approved' AND p.ward_id IS NOT NULL
GROUP BY 1,2,3;

-- Thana scorecard. Institutions are named; people never are. Naming a police
-- station is fair comment on a public body — that is what keeps this citable.
CREATE FUNCTION public_thana_scorecards()
RETURNS TABLE (
  thana_id        integer,
  reports_n       integer,
  gd_refused_rate numeric,
  no_action_rate  numeric,
  suppressed      boolean
)
LANGUAGE sql STABLE AS $$
  WITH agg AS (
    SELECT
      r.thana_id,
      count(*)::integer AS n,
      count(*) FILTER (WHERE r.police_outcome = 'gd_refused')::numeric AS ref,
      count(*) FILTER (WHERE r.police_outcome = 'no_action')::numeric  AS noa
    FROM reports r
    -- police_misconduct ONLY. Counting every category here would let mugging
    -- volume carry a thin misconduct signal over the higher threshold, which
    -- is exactly what the higher threshold exists to prevent.
    WHERE r.status = 'approved'
      AND r.thana_id IS NOT NULL
      AND r.category = 'police_misconduct'
    GROUP BY 1
  )
  SELECT
    a.thana_id,
    CASE WHEN a.n >= t.k_min THEN a.n END,
    CASE WHEN a.n >= t.k_min THEN round(a.ref / a.n, 3) END,
    CASE WHEN a.n >= t.k_min THEN round(a.noa / a.n, 3) END,
    a.n < t.k_min
  FROM agg a
  JOIN display_thresholds t ON t.category = 'police_misconduct';
$$;

-- How it happened, aggregated. This is the awareness content: not who, but
-- what to expect on this stretch after dark. Only published for cells that
-- already clear the threshold, so the method never describes one incident.
CREATE FUNCTION public_method_patterns()
RETURNS TABLE (
  ward_id          integer,
  category         report_category,
  n                integer,
  top_offender_count offender_count_band,
  top_vehicle      vehicle_type,
  top_weapon       weapon_type,
  top_approach     approach_type
)
LANGUAGE sql STABLE AS $$
  WITH agg AS (
    SELECT r.ward_id, r.category, count(*)::integer AS n,
           mode() WITHIN GROUP (ORDER BY r.offender_count)   AS oc,
           mode() WITHIN GROUP (ORDER BY r.offender_vehicle) AS ov,
           mode() WITHIN GROUP (ORDER BY r.weapon)           AS wp,
           mode() WITHIN GROUP (ORDER BY r.approach)         AS ap
    FROM reports r
    JOIN display_thresholds t ON t.category = r.category
    WHERE r.status = 'approved' AND t.geo_level = 'ward'
    GROUP BY 1,2
  )
  SELECT a.ward_id, a.category, a.n, a.oc, a.ov, a.wp, a.ap
  FROM agg a
  JOIN display_thresholds t ON t.category = a.category
  WHERE a.n >= t.k_min;
$$;

-- The launch headline: the reported-to-response gap. Spec §6 Phase 2.
CREATE FUNCTION public_reporting_gap(min_n integer DEFAULT 30)
RETURNS TABLE (
  scope        text,
  scope_name   text,
  total_n      integer,
  unreported_n integer,
  unreported_share numeric,
  top_reason   why_not_reported
)
LANGUAGE sql STABLE AS $$
  WITH base AS (
    SELECT w.district AS scope_name, r.reported_to_police, r.why_not_reported
    FROM reports r JOIN wards w ON w.id = r.ward_id
    WHERE r.status = 'approved'
  ), agg AS (
    SELECT
      scope_name,
      count(*)::integer AS total_n,
      count(*) FILTER (WHERE reported_to_police = false)::integer AS unrep,
      mode() WITHIN GROUP (ORDER BY why_not_reported) AS top_reason
    FROM base GROUP BY 1
  )
  SELECT 'district', scope_name, total_n, unrep,
         round(unrep::numeric / total_n, 3), top_reason
  FROM agg WHERE total_n >= min_n;
$$;

REVOKE ALL ON cell_counts_raw, press_cell_counts FROM PUBLIC;
GRANT SELECT ON cell_counts_raw, press_cell_counts TO nirapod_aggregator;
GRANT EXECUTE ON FUNCTION public_cells, public_thana_scorecards,
  public_reporting_gap, public_method_patterns TO nirapod_aggregator;

COMMIT;
