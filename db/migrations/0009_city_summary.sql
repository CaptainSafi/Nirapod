-- 0009_city_summary.sql
-- One city-wide row of numbers, plus two distributions.
--
-- WHY. GhushSite launched in August 2026 and took 804 reports in three days,
-- and the number that travelled with it was a single figure: roughly 13.65
-- crore taka demanded. A headline number is what a screenshot carries, what a
-- reporter quotes, and what makes a stranger believe the site is alive.
--
-- Nirapod has no money total to quote, and inventing one would be dishonest:
-- reports carry an amount BAND, not an amount. What it does have, and what no
-- police statistic will ever publish, is what happened to the people who did
-- go to the police. That is this project's equivalent headline, and it is
-- stronger, because it is the finding rather than the volume.
--
-- SUPPRESSION. City-wide is the coarsest geography that exists here, so a
-- count over the whole city says less about any individual than any cell on
-- the map. Each bucket is still checked against the same k floor, so a bucket
-- nobody is in cannot be published as a small number; the total is published
-- only when the whole set clears it.

BEGIN;

CREATE FUNCTION public_city_summary()
RETURNS TABLE (
  metric  text,     -- 'total' | 'police_outcome' | 'amount_band' | 'why_not'
  bucket  text,     -- enum value, or 'all'
  n       integer,  -- NULL when below the floor
  of_n    integer   -- denominator this bucket is a share of
)
LANGUAGE sql STABLE AS $$
  WITH k AS (SELECT min(k_min) AS floor FROM display_thresholds),
  approved AS (
    SELECT * FROM reports WHERE status = 'approved'
  ),
  totals AS (
    SELECT count(*)::integer AS all_n,
           count(*) FILTER (WHERE reported_to_police)::integer AS told_n,
           count(*) FILTER (WHERE NOT reported_to_police)::integer AS untold_n
    FROM approved
  ),
  base AS (
    SELECT 'total' AS metric, 'all' AS bucket, all_n AS n, all_n AS of_n FROM totals
    UNION ALL
    SELECT 'total', 'reported_to_police', told_n, all_n FROM totals
    UNION ALL
    SELECT 'total', 'not_reported', untold_n, all_n FROM totals
    UNION ALL
    -- What happened to the people who DID go. This is the finding.
    SELECT 'police_outcome', a.police_outcome::text, count(*)::integer,
           (SELECT told_n FROM totals)
    FROM approved a
    WHERE a.reported_to_police AND a.police_outcome IS NOT NULL
    GROUP BY a.police_outcome
    UNION ALL
    -- Why the rest did not.
    SELECT 'why_not', a.why_not_reported::text, count(*)::integer,
           (SELECT untold_n FROM totals)
    FROM approved a
    WHERE NOT a.reported_to_police AND a.why_not_reported IS NOT NULL
    GROUP BY a.why_not_reported
    UNION ALL
    -- Extortion demands by band. Not a money total: a report carries a band,
    -- never an amount, so any taka figure would be invented.
    SELECT 'amount_band', a.amount_band::text, count(*)::integer,
           (SELECT count(*)::integer FROM approved WHERE amount_band IS NOT NULL)
    FROM approved a
    WHERE a.amount_band IS NOT NULL
    GROUP BY a.amount_band
  )
  SELECT metric, bucket,
         CASE WHEN n >= (SELECT floor FROM k) THEN n END,
         of_n
  FROM base
  WHERE of_n >= (SELECT floor FROM k);
$$;

REVOKE ALL ON FUNCTION public_city_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_city_summary() TO nirapod_aggregator;

COMMIT;
