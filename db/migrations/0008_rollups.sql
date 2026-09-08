-- 0008_rollups.sql
-- Rollup cells: the same suppression rules, applied to coarser slices.
--
-- WHY THIS EXISTS. `public_cells()` slices by category x area x time band x
-- month. With 12 categories, 203 wards and 4 time bands that is ~9,700 ward
-- cells per month, and a threshold of 5 on each. A ward with twelve muggings
-- spread over three months and four time bands publishes NOTHING, because no
-- single cell reaches 5. Measured on the demo set: 9,000 reports produced 437
-- published cells out of 2,845, and any single category showed a number in 18
-- of 203 wards. A map that is 90% "insufficient data" reads as a dead site,
-- and a dead site collects no reports, which is the only thing that ever fixes
-- the coverage.
--
-- The fix is NOT a lower threshold. It is to also publish the totals, each one
-- threshold-checked in its own right:
--   * all time bands and all months together, per category, per area
--   * "any area crime" combined, per area
--   * the same at thana level, which has 46 units instead of 203
--
-- WHAT IS AND IS NOT SAFE HERE.
-- Every rollup is checked against k_min on its own count, so no rollup can
-- publish a number the detailed cells were not allowed to publish. Coarser is
-- strictly safer: a thana total says less about any individual than a ward
-- total, and a total across time bands says less than one band.
--
-- The one real risk is DIFFERENCING. If "any" included the person-directed
-- categories, then any_ward - sum(published area-crime categories) would leave
-- a residual that is the person-directed count for that ward — reconstructing
-- exactly the ward-level number those categories are forbidden to have. So
-- `any` includes ONLY categories whose own rule is ward level, and its
-- threshold is the highest k_min among them.

BEGIN;

CREATE FUNCTION public_rollups()
RETURNS TABLE (
  level        text,
  area         text,
  scope        text,     -- a category name, or 'any' for combined area crime
  crowd_n      integer,
  unreported_n integer,
  suppressed   boolean
)
LANGUAGE sql STABLE AS $$
  WITH per_category AS (
    -- Each category at its OWN geography, totalled over time bands and months.
    SELECT
      t.geo_level AS level,
      CASE t.geo_level
        WHEN 'ward'     THEN c.ward_id::text
        WHEN 'thana'    THEN c.thana_id::text
        WHEN 'district' THEN c.district
      END AS area,
      c.category::text AS scope,
      sum(c.crowd_n)::integer      AS crowd_n,
      sum(c.unreported_n)::integer AS unreported_n,
      t.k_min
    FROM cell_counts_raw c
    JOIN display_thresholds t ON t.category = c.category
    GROUP BY 1,2,3,t.k_min
  ),
  per_category_thana AS (
    -- The same categories rolled up to thana. Coarser than their own rule, so
    -- always permitted; this is what lets the map open at thana level, where
    -- 46 units share the reports that 203 wards were splitting.
    SELECT
      'thana' AS level,
      c.thana_id::text AS area,
      c.category::text AS scope,
      sum(c.crowd_n)::integer      AS crowd_n,
      sum(c.unreported_n)::integer AS unreported_n,
      t.k_min
    FROM cell_counts_raw c
    JOIN display_thresholds t ON t.category = c.category
    WHERE t.geo_level = 'ward'          -- already thana or coarser otherwise
    GROUP BY 1,2,3,t.k_min
  ),
  any_crime AS (
    -- Combined area crime. Ward-rule categories only — see the differencing
    -- note above — at both levels, with the strictest threshold among them.
    SELECT lvl AS level, area, 'any' AS scope,
           sum(crowd_n)::integer AS crowd_n,
           sum(unreported_n)::integer AS unreported_n,
           (SELECT max(k_min) FROM display_thresholds WHERE geo_level = 'ward') AS k_min
    FROM (
      SELECT 'ward' AS lvl, c.ward_id::text AS area, c.crowd_n, c.unreported_n
      FROM cell_counts_raw c
      JOIN display_thresholds t ON t.category = c.category AND t.geo_level = 'ward'
      UNION ALL
      SELECT 'thana', c.thana_id::text, c.crowd_n, c.unreported_n
      FROM cell_counts_raw c
      JOIN display_thresholds t ON t.category = c.category AND t.geo_level = 'ward'
    ) u
    GROUP BY 1,2
  ),
  all_rollups AS (
    SELECT * FROM per_category
    UNION ALL SELECT * FROM per_category_thana
    UNION ALL SELECT * FROM any_crime
  )
  SELECT
    level, area, scope,
    CASE WHEN crowd_n >= k_min THEN crowd_n END,
    CASE WHEN crowd_n >= k_min THEN unreported_n END,
    crowd_n < k_min
  FROM all_rollups
  WHERE area IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public_rollups() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_rollups() TO nirapod_aggregator;

COMMIT;
