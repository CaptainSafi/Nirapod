-- 0012_submit_context.sql
-- What the submit role is allowed to ask, without being allowed to read.
--
-- THE PROBLEM THIS SOLVES. nirapod_submit has INSERT on reports and nothing
-- else, deliberately: the credential that sits in a public cloud dashboard
-- should be able to add a report and unable to read one. But routing a
-- submission needs to know two things about the database first, and the Worker
-- was doing that with plain SELECTs, which the role correctly refused. The site
-- returned 500 on every submission, and that 500 was the security model
-- working.
--
-- The fix is not to grant SELECT. rules.js never needs the numbers; look at
-- route(): it uses `cellN < kMin` and `recent >= 5` and nothing else. So these
-- functions return the two booleans and never the counts.
--
-- WHAT THAT LEAKS, stated honestly. Anyone holding the submit credential can
-- learn, for a ward and category they choose, whether that cell is already
-- above its display threshold. That is exactly what the published map already
-- shows: a cell is either coloured or marked "insufficient data". So this
-- reveals nothing that is not on the front page. It does NOT reveal the count,
-- which is the thing the thresholds exist to hide.
--
-- SECURITY DEFINER means these run as the owner. search_path is pinned so a
-- caller cannot shadow `reports` with their own table and change what the
-- function reads.

BEGIN;

CREATE FUNCTION submit_context(
  p_category  report_category,
  p_ward_id   integer,
  p_time_band time_band
) RETURNS TABLE (cell_thin boolean, burst boolean)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT
    (SELECT count(*) FROM reports r
      WHERE r.status = 'approved' AND r.ward_id = p_ward_id
        AND r.category = p_category AND r.time_band = p_time_band)
    < (SELECT k_min FROM display_thresholds WHERE category = p_category),

    (SELECT count(*) FROM reports r
      WHERE r.ward_id = p_ward_id AND r.category = p_category
        AND r.submitted_day = CURRENT_DATE) >= 5
$$;

CREATE FUNCTION hazard_context(p_ward_id integer)
RETURNS TABLE (burst boolean)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT (SELECT count(*) FROM hazards h
           WHERE h.ward_id = p_ward_id AND h.reported_day = CURRENT_DATE) >= 10
$$;

-- Flagging is an UPDATE, which nirapod_submit also does not have and should not
-- get: UPDATE on reports would let the credential rewrite anybody's account.
-- This does exactly one thing to exactly one column pair, and returns nothing
-- about the outcome, so a flagger cannot probe how many others have flagged a
-- given account by watching when it disappears.
CREATE FUNCTION flag_account(p_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER VOLATILE
SET search_path = public
AS $$
  WITH bumped AS (
    UPDATE reports
       SET account_flags = account_flags + 1,
           account_state = CASE WHEN account_state = 'published'
                                 AND account_flags + 1 >= 2 THEN 'held'
                                ELSE account_state END
     WHERE id = p_id AND account IS NOT NULL
     RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM bumped)
$$;

GRANT EXECUTE ON FUNCTION submit_context(report_category, integer, time_band) TO nirapod_submit;
GRANT EXECUTE ON FUNCTION hazard_context(integer) TO nirapod_submit;
GRANT EXECUTE ON FUNCTION flag_account(uuid) TO nirapod_submit;

-- PUBLIC gets EXECUTE on new functions by default, which for a SECURITY DEFINER
-- function that can write is not acceptable. Take it back explicitly.
REVOKE EXECUTE ON FUNCTION submit_context(report_category, integer, time_band) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION hazard_context(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION flag_account(uuid) FROM PUBLIC;

COMMIT;
