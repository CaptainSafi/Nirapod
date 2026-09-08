-- invariants_test.sql
-- The done-when for the data layer is not "the code runs". It is "no
-- identifying data exists anywhere — verified by dumping the DB and reading
-- it". These tests fail loudly if a later change breaks an invariant.
--
-- Run:  psql -v ON_ERROR_STOP=1 -d nirapod_test -f invariants_test.sql

\set ON_ERROR_STOP on
SET client_min_messages TO NOTICE;

CREATE OR REPLACE FUNCTION assert(cond boolean, label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cond THEN RAISE NOTICE 'PASS  %', label;
  ELSE RAISE EXCEPTION 'FAIL  %', label;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION rejects(stmt text) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE stmt;
  RETURN false;           -- it was accepted: the constraint is missing
EXCEPTION WHEN others THEN
  RETURN true;
END $$;

-- ---------------------------------------------------------------------------
-- A. Schema shape: the columns that must NOT exist in `reports`
-- ---------------------------------------------------------------------------

SELECT assert(
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'reports'
      AND data_type IN ('timestamp with time zone','timestamp without time zone','time without time zone')
  ), 'reports has no timestamp column');

SELECT assert(
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'reports'
      AND (column_name ~* '(lat|lon|lng|geom|coord|point)' OR udt_name = 'geometry')
  ), 'reports has no coordinate or geometry column');

SELECT assert(
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'reports'
      AND column_name ~* '(ip|agent|device|cookie|session|email|phone|contact|token|narrative|description|note|detail)'
  ), 'reports has no submitter-linked column');

-- "How it happened" is captured as enums. If this count ever rises, someone
-- has added a text column to the table that must not have one.
SELECT assert(
  (SELECT count(*) FROM information_schema.columns
   WHERE table_name='reports' AND data_type IN ('text','character varying')) = 1,
  'reports still has exactly one text column (pow_nonce)');

-- Hazards are the opposite case and prove the split is real.
SELECT assert(
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'hazards' AND udt_name = 'geometry'),
  'hazards DOES carry an exact point — no victim, so no suppression needed');

-- ---------------------------------------------------------------------------
-- B. Every category has a disclosure rule
-- ---------------------------------------------------------------------------
SELECT assert(
  NOT EXISTS (SELECT 1 FROM category_rules c
              LEFT JOIN display_thresholds t ON t.category = c.category
              WHERE t.category IS NULL),
  'every category has a display threshold');

SELECT assert(
  NOT EXISTS (SELECT 1 FROM category_rules c
              JOIN display_thresholds t ON t.category = c.category
              WHERE c.class = 'person_directed' AND t.geo_level = 'ward'),
  'no person-directed category may be published at ward level');

SELECT assert(
  (SELECT min(k_min) FROM display_thresholds t JOIN category_rules c USING (category)
    WHERE c.class = 'person_directed') > 
  (SELECT max(k_min) FROM display_thresholds t JOIN category_rules c USING (category)
    WHERE c.class = 'area_crime' AND category <> 'police_misconduct'),
  'person-directed categories carry a higher threshold than area crime');

SELECT assert(
  NOT EXISTS (SELECT 1 FROM subcategory_rules s
              LEFT JOIN category_rules c ON c.category = s.category
              WHERE c.category IS NULL),
  'every subcategory belongs to a known category');

-- ---------------------------------------------------------------------------
-- C. Fixtures
-- ---------------------------------------------------------------------------
INSERT INTO thanas (id, name_bn, name_en, division, district)
VALUES (1, 'রমনা', 'Ramna', 'Dhaka', 'Dhaka') ON CONFLICT DO NOTHING;

INSERT INTO wards (id, thana_id, name_bn, name_en, division, district, geometry, population)
VALUES (1, 1, 'ওয়ার্ড ১', 'Ward 1', 'Dhaka', 'Dhaka',
        ST_Multi(ST_GeomFromText('POLYGON((90 23,90.1 23,90.1 23.1,90 23.1,90 23))',4326)),
        50000) ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- D. Constraints that enforce coarsening
-- ---------------------------------------------------------------------------

SELECT assert(rejects($$
  INSERT INTO reports (category,subcategory,ward_id,occurred_week,reported_to_police,why_not_reported)
  VALUES ('mugging','snatching',1,'2026-08-25',false,'nothing_would_happen')$$),
  'occurred_week must be a Monday (a Tuesday is rejected)');

SELECT assert(rejects($$
  INSERT INTO reports (category,subcategory,ward_id,occurred_week,reported_to_police,why_not_reported)
  VALUES ('mugging','snatching',1,'2027-01-04',false,'nothing_would_happen')$$),
  'occurred_week cannot be in the future');

SELECT assert(rejects($$
  INSERT INTO reports (category,subcategory,ward_id,occurred_week,reported_to_police,why_not_reported)
  VALUES ('police_misconduct','gd_refused',1,'2026-08-24',false,'afraid_of_retaliation')$$),
  'police_misconduct requires a thana');

SELECT assert(rejects($$
  INSERT INTO reports (category,subcategory,ward_id,occurred_week,reported_to_police)
  VALUES ('mugging','snatching',1,'2026-08-24',false)$$),
  'why_not_reported is required when not reported to police');

SELECT assert(rejects($$
  INSERT INTO reports (category,subcategory,ward_id,occurred_week,reported_to_police,why_not_reported)
  VALUES ('mugging','snatching',1,'2026-08-24',true,'nothing_would_happen')$$),
  'why_not_reported is forbidden when it WAS reported');

SELECT assert(rejects($$
  INSERT INTO reports (category,subcategory,ward_id,occurred_week,reported_to_police,police_outcome,why_not_reported)
  VALUES ('mugging','snatching',1,'2026-08-24',false,'gd_filed','nothing_would_happen')$$),
  'police_outcome is forbidden when it was not reported');

SELECT assert(rejects($$
  INSERT INTO reports (category,subcategory,ward_id,occurred_week,reported_to_police)
  VALUES ('mugging','shop_business',1,'2026-08-24',true)$$),
  'subcategory must belong to its category');

SELECT assert(rejects($$
  INSERT INTO reports (category,subcategory,ward_id,occurred_week,reported_to_police,amount_band)
  VALUES ('mugging','snatching',1,'2026-08-24',true,'1k_5k')$$),
  'amount_band is rejected on a category that has no amount');

SELECT assert(rejects($$
  INSERT INTO reports (category,subcategory,ward_id,occurred_week,reported_to_police,why_not_reported)
  VALUES ('assault','snatching',1,'2026-08-24',false,'afraid_of_retaliation')$$),
  'a mugging subcategory is rejected under assault');

INSERT INTO reports (category,subcategory,ward_id,thana_id,occurred_week,time_band,
                     reported_to_police,why_not_reported,offender_count,offender_vehicle,weapon,approach)
VALUES ('mugging','snatching',1,1,'2026-08-24','night',false,'afraid_of_retaliation',
        'two','motorcycle','knife','from_behind');
SELECT assert((SELECT count(*) FROM reports) = 1, 'a valid report inserts');
SELECT assert((SELECT status FROM reports LIMIT 1) = 'pending',
  'a new report lands as pending, not visible');

SELECT assert(rejects($$
  UPDATE reports SET published_at = CURRENT_DATE WHERE status = 'pending'$$),
  'a pending report cannot carry a published_at date');

-- ---------------------------------------------------------------------------
-- E. Privilege split: the submit path cannot read
-- ---------------------------------------------------------------------------
SELECT assert(NOT has_table_privilege('nirapod_submit','reports','SELECT'),
  'nirapod_submit cannot SELECT reports');
SELECT assert(NOT has_table_privilege('nirapod_submit','reports','UPDATE'),
  'nirapod_submit cannot UPDATE reports');
SELECT assert(NOT has_table_privilege('nirapod_submit','reports','DELETE'),
  'nirapod_submit cannot DELETE reports');
SELECT assert(has_table_privilege('nirapod_submit','reports','INSERT'),
  'nirapod_submit CAN insert');
SELECT assert(NOT has_table_privilege('nirapod_submit','hazards','SELECT'),
  'nirapod_submit cannot read hazards either');
SELECT assert(has_table_privilege('nirapod_submit','hazards','INSERT'),
  'nirapod_submit CAN insert a hazard');
SELECT assert(NOT has_table_privilege('nirapod_submit','press_records','SELECT'),
  'nirapod_submit cannot read the press tier');
SELECT assert(NOT has_table_privilege('nirapod_moderator','moderation_events','DELETE'),
  'a moderator cannot delete their own audit trail');
SELECT assert(NOT has_table_privilege('nirapod_aggregator','reports','UPDATE'),
  'the aggregator is read-only');

-- ---------------------------------------------------------------------------
-- F. k-anonymity and geography, together
-- ---------------------------------------------------------------------------
INSERT INTO reports (category,subcategory,ward_id,thana_id,occurred_week,time_band,reported_to_police,why_not_reported,status)
SELECT 'mugging','snatching',1,1,'2026-08-24','night',false,'nothing_would_happen','approved'
FROM generate_series(1,4);

SELECT assert(
  (SELECT crowd_n IS NULL AND suppressed
   FROM public_cells() WHERE area='1' AND category='mugging' AND time_band='night'),
  'a 4-report cell is suppressed, and returns NULL rather than the count');

INSERT INTO reports (category,subcategory,ward_id,thana_id,occurred_week,time_band,reported_to_police,why_not_reported,status)
VALUES ('mugging','snatching',1,1,'2026-08-24','night',false,'nothing_would_happen','approved');

SELECT assert(
  (SELECT crowd_n = 5 AND NOT suppressed
   FROM public_cells() WHERE area='1' AND category='mugging' AND time_band='night'),
  'a 5-report cell publishes');

-- Person-directed: even a large number must not appear at ward level.
INSERT INTO reports (category,subcategory,ward_id,thana_id,occurred_week,time_band,reported_to_police,why_not_reported,status)
SELECT 'harassment','street_harassment',1,1,'2026-08-24','evening',false,'ashamed_or_blamed','approved'
FROM generate_series(1,20);

SELECT assert(
  NOT EXISTS (SELECT 1 FROM public_cells() WHERE category='harassment' AND level='ward'),
  'harassment is never published at ward level, however many reports there are');
SELECT assert(
  (SELECT level FROM public_cells() WHERE category='harassment' LIMIT 1) = 'thana',
  'harassment is published at thana level');
SELECT assert(
  (SELECT bool_and(time_band = 'unknown') FROM public_cells() WHERE level <> 'ward'),
  'coarse-geography categories are not broken down by time of day');

INSERT INTO reports (category,subcategory,ward_id,thana_id,occurred_week,time_band,reported_to_police,why_not_reported,status)
SELECT 'assault','physical_assault',1,1,'2026-08-24','night',false,'afraid_of_retaliation','approved'
FROM generate_series(1,14);
SELECT assert(
  (SELECT bool_and(suppressed) FROM public_cells() WHERE category='assault'),
  'assault at 14 reports is still suppressed — the threshold is 15');
SELECT assert(
  (SELECT bool_and(level='district') FROM public_cells() WHERE category='assault'),
  'assault is published at district level only');

-- police_misconduct keeps its higher bar.
INSERT INTO reports (category,subcategory,ward_id,thana_id,occurred_week,time_band,reported_to_police,police_outcome,status)
SELECT 'police_misconduct','gd_refused',1,1,'2026-08-24','morning',true,'gd_refused','approved'
FROM generate_series(1,9);
SELECT assert(
  (SELECT bool_and(suppressed) FROM public_cells() WHERE category='police_misconduct'),
  'police_misconduct is suppressed at 9 — a higher bar than area risk');
SELECT assert(
  (SELECT reports_n IS NULL AND suppressed FROM public_thana_scorecards() WHERE thana_id=1),
  'a thin thana scorecard is suppressed, not published as a small number');

-- No published cell anywhere may sit below its own threshold.
SELECT assert(
  NOT EXISTS (SELECT 1 FROM public_cells() c
              JOIN display_thresholds t ON t.category = c.category
              WHERE c.crowd_n IS NOT NULL AND c.crowd_n < t.k_min),
  'no published cell is below its category threshold');
SELECT assert(
  NOT EXISTS (SELECT 1 FROM public_cells() WHERE suppressed AND crowd_n IS NOT NULL),
  'a suppressed cell never carries a count');

-- Method patterns describe a pattern, never a single incident.
SELECT assert(
  NOT EXISTS (SELECT 1 FROM public_method_patterns() m
              JOIN display_thresholds t ON t.category = m.category
              WHERE m.n < t.k_min),
  'method patterns are only published for cells that clear the threshold');

-- ---------------------------------------------------------------------------
-- G. Hazards: exact location, no suppression, and an escalation clock
-- ---------------------------------------------------------------------------
INSERT INTO hazards (category, subcategory, location, ward_id, reported_day)
VALUES ('lighting','streetlight_broken',
        ST_SetSRID(ST_MakePoint(90.05, 23.05), 4326), 1, CURRENT_DATE - 62);

SELECT assert((SELECT count(*) FROM public_hazards()) = 1,
  'a single hazard publishes immediately — no threshold, because no victim');
SELECT assert((SELECT age_days FROM public_hazards()) = 62,
  'the escalation clock counts days since it was reported');
SELECT assert(
  NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'hazards'
                AND column_name ~* '(ip|agent|session|email|phone|contact)'),
  'hazards carry no submitter-linked column either');
SELECT assert(rejects($$
  INSERT INTO hazards (category, subcategory, location, ward_id)
  VALUES ('lighting','open_manhole', ST_SetSRID(ST_MakePoint(90.05,23.05),4326), 1)$$),
  'a hazard subcategory from another category is rejected');
SELECT assert(rejects($$
  UPDATE hazards SET resolved_on = CURRENT_DATE - 200$$),
  'a hazard cannot be resolved before it was reported');

SELECT 'ALL INVARIANT TESTS PASSED' AS result;
