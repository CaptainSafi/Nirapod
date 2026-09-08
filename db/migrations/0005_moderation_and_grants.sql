-- 0005_moderation_and_grants.sql
-- Moderation audit log, tunable thresholds, and the privilege split that makes
-- "the submit endpoint cannot read the reports table" a database fact rather
-- than an application promise. Handoff §0, spec §5.1.

BEGIN;

-- Audit log of moderator actions. Records the MODERATOR, never the submitter.
CREATE TABLE moderation_events (
  id           bigserial PRIMARY KEY,
  report_id    uuid REFERENCES reports(id),
  press_id     uuid REFERENCES press_records(id),
  moderator    text NOT NULL,
  from_status  report_status,
  to_status    report_status NOT NULL,
  reason       text,
  acted_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT one_target CHECK (num_nonnulls(report_id, press_id) = 1)
);
CREATE INDEX moderation_events_report_idx ON moderation_events (report_id);

COMMENT ON COLUMN moderation_events.acted_at IS
  'Full timestamp is acceptable here and ONLY here: this records our staff, not a submitter. Never join this table to reports for timing analysis.';

-- Thresholds live in a table so they can be raised without a migration.
--
-- geo_level is the FINEST geography at which this category may be published.
-- It is not a display preference: a rare, person-directed crime pinned to a
-- small ward identifies the victim to whoever did it, however high the count
-- threshold is. Coarsening the geography is the protection; the threshold
-- alone is not enough.
CREATE TABLE display_thresholds (
  category   report_category PRIMARY KEY REFERENCES category_rules(category),
  k_min      integer NOT NULL CHECK (k_min >= 5),
  geo_level  text NOT NULL CHECK (geo_level IN ('ward','thana','district'))
);

INSERT INTO display_thresholds (category, k_min, geo_level) VALUES
  -- Area crime: the pattern is the point, and the place is what makes it
  -- useful tonight. Ward level, standard threshold.
  ('mugging',             5,  'ward'),
  ('theft',               5,  'ward'),
  ('chadabaji',           5,  'ward'),
  ('land_grabbing',       5,  'ward'),
  ('hooliganism',         5,  'ward'),
  ('drugs_weapons',       5,  'ward'),
  ('fraud_impersonation', 5,  'ward'),
  ('transport_danger',    5,  'ward'),
  -- An accusation against a named public body: higher bar, because the
  -- population who had that specific interaction with that thana is small.
  ('police_misconduct',   10, 'ward'),
  -- Person-directed. Rarer than a mugging, so a single report in a small ward
  -- is far more identifying. Coarser geography AND a higher count.
  ('harassment',          15, 'thana'),
  ('assault',             15, 'district'),
  ('abduction',           15, 'district');

-- Every category must have a disclosure rule. A new category with no row here
-- would otherwise be published with no threshold at all.
CREATE FUNCTION assert_every_category_has_a_threshold() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE missing text;
BEGIN
  SELECT string_agg(c.category::text, ', ') INTO missing
    FROM category_rules c
    LEFT JOIN display_thresholds t ON t.category = c.category
   WHERE t.category IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'categories with no display threshold: %', missing;
  END IF;
END $$;
SELECT assert_every_category_has_a_threshold();

-- ---------------------------------------------------------------------------
-- Privilege split
-- ---------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;

-- submit: INSERT only. No SELECT, no UPDATE, no DELETE. It cannot read back
-- what it wrote, so a compromised submit endpoint cannot enumerate reports.
GRANT USAGE ON SCHEMA public TO nirapod_submit;
GRANT INSERT ON reports TO nirapod_submit;
GRANT SELECT (id, name_en, name_bn, thana_id) ON wards  TO nirapod_submit;
GRANT SELECT (id, name_en, name_bn)           ON thanas TO nirapod_submit;

-- moderator: reads the queue, changes status, writes the audit log.
GRANT USAGE ON SCHEMA public TO nirapod_moderator;
GRANT SELECT, UPDATE ON reports, press_records TO nirapod_moderator;
GRANT SELECT ON wards, thanas, display_thresholds, category_rules, subcategory_rules TO nirapod_moderator;
GRANT SELECT, INSERT ON moderation_events TO nirapod_moderator;
GRANT USAGE ON SEQUENCE moderation_events_id_seq TO nirapod_moderator;
-- a moderator must not be able to erase the record of their own decisions
REVOKE DELETE ON moderation_events FROM nirapod_moderator;

-- aggregator: read-only, and only what the batch job needs.
GRANT USAGE ON SCHEMA public TO nirapod_aggregator;
GRANT SELECT ON reports, press_records, wards, thanas, display_thresholds,
  category_rules, subcategory_rules TO nirapod_aggregator;

COMMIT;
