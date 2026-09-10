-- 0011_public_accounts.sql
-- Which written accounts may be shown, and where.
--
-- THE RULE THIS FUNCTION EXISTS TO ENFORCE. An account is attached to a WARD,
-- never to a point, because `reports` has no coordinate and is not getting one.
-- And it is shown only when the cell it belongs to is ITSELF publishable.
--
-- That second half is the part that is easy to get wrong. If a ward shows
-- "insufficient data" for chadabaji, and we publish a written account tagged
-- ward 86 / chadabaji next to it, we have just published the exact fact the
-- suppression was hiding: that at least one such report exists there. The
-- threshold would still be enforced on the number and completely defeated by
-- the paragraph underneath it. So an account inherits its cell's fate.
--
-- PERSON-DIRECTED CATEGORIES PUBLISH NO ACCOUNTS AT ALL, for now. Harassment,
-- assault and abduction are held to thana or district level precisely because a
-- ward is small enough to identify a victim, and those are also the accounts
-- most likely to contain the detail that identifies them. Ward-rule categories
-- only, until there is a moderator who reads every one of them.
--
-- The exact day is not returned. The week is, same as everywhere else.

BEGIN;

CREATE OR REPLACE FUNCTION public_accounts()
RETURNS TABLE (
  id            uuid,
  ward_id       integer,
  category      report_category,
  subcategory   report_subcategory,
  occurred_week date,
  account       text,
  flags         integer
)
LANGUAGE sql STABLE AS $$
  WITH cell AS (
    SELECT r.ward_id, r.category, count(*)::int AS n
      FROM reports r
     WHERE r.status = 'approved'
     GROUP BY r.ward_id, r.category
  )
  SELECT r.id, r.ward_id, r.category, r.subcategory, r.occurred_week,
         r.account, r.account_flags
    FROM reports r
    JOIN cell c ON c.ward_id = r.ward_id AND c.category = r.category
    JOIN display_thresholds d ON d.category = r.category
   WHERE r.account IS NOT NULL
     AND r.account_state = 'published'
     AND r.status = 'approved'
     -- The cell must clear its own threshold before its accounts are readable.
     AND c.n >= d.k_min
     -- Ward-rule categories only. See the header.
     AND d.geo_level = 'ward'
   ORDER BY r.account_at DESC
$$;

GRANT EXECUTE ON FUNCTION public_accounts() TO nirapod_aggregator;

COMMIT;
