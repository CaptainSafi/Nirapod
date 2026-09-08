-- 0007_hazards.sql
-- Street hazards: the things that make a street unsafe with nobody committing
-- a crime. A broken streetlight, an open manhole, a footpath so encroached
-- that pedestrians walk in the traffic lane.
--
-- WHY THIS IS A SEPARATE TABLE, and not another category in `reports`:
--
--   A hazard has no victim. Nobody is exposed by publishing its exact
--   location — that IS the useful information, and suppressing it to ward
--   level would make it worthless ("there is a manhole somewhere in Mirpur").
--   So hazards carry a real point geometry and no k-threshold.
--
--   `reports` carries no coordinate column at all, and must not, because a
--   point plus a time plus a category identifies a person. Putting hazards in
--   that table would mean adding lat/lng to it and losing that guarantee for
--   every report in the system.
--
--   Two tables, two disclosure rules, neither able to leak into the other.

BEGIN;

CREATE TYPE hazard_category AS ENUM (
  'lighting', 'road_surface', 'footpath', 'construction', 'electrical',
  'crossing', 'obstruction'
);

CREATE TYPE hazard_subcategory AS ENUM (
  'streetlight_broken', 'streetlight_absent', 'dark_stretch',
  'open_manhole', 'open_drain', 'broken_road', 'waterlogging',
  'footpath_blocked', 'footpath_encroached', 'footpath_broken',
  'unsafe_construction', 'debris_on_road', 'unmarked_excavation',
  'dangling_wires', 'exposed_transformer',
  'no_crossing', 'broken_signal', 'accident_blackspot',
  'abandoned_vehicle', 'blocking_parking'
);

CREATE TABLE hazard_subcategory_rules (
  subcategory hazard_subcategory PRIMARY KEY,
  category    hazard_category NOT NULL
);
INSERT INTO hazard_subcategory_rules VALUES
  ('streetlight_broken','lighting'),('streetlight_absent','lighting'),
  ('dark_stretch','lighting'),
  ('open_manhole','road_surface'),('open_drain','road_surface'),
  ('broken_road','road_surface'),('waterlogging','road_surface'),
  ('footpath_blocked','footpath'),('footpath_encroached','footpath'),
  ('footpath_broken','footpath'),
  ('unsafe_construction','construction'),('debris_on_road','construction'),
  ('unmarked_excavation','construction'),
  ('dangling_wires','electrical'),('exposed_transformer','electrical'),
  ('no_crossing','crossing'),('broken_signal','crossing'),
  ('accident_blackspot','crossing'),
  ('abandoned_vehicle','obstruction'),('blocking_parking','obstruction');

-- A CHECK cannot contain a subquery, so the lookup is wrapped in a function,
-- the same way the report taxonomy is. The rules stay data in a table rather
-- than a hand-maintained list repeated inside a constraint.
CREATE FUNCTION hazard_subcategory_matches(
  cat hazard_category, sub hazard_subcategory
) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM hazard_subcategory_rules
                  WHERE subcategory = sub AND category = cat)
$$;

CREATE TABLE hazards (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category      hazard_category    NOT NULL,
  subcategory   hazard_subcategory NOT NULL,

  -- An exact point, on purpose. No person is described by it.
  location      geometry(Point, 4326) NOT NULL,
  ward_id       integer NOT NULL REFERENCES wards(id),

  -- Hazards auto-publish and are spot-checked afterwards: they are the highest
  -- volume category and there is no accusation in them to get wrong. Anything
  -- reported as dangerous, or flagged, still goes to a human.
  status        report_status NOT NULL DEFAULT 'approved',
  reported_day  date NOT NULL DEFAULT CURRENT_DATE,
  published_at  date,

  -- Corroboration instead of a threshold: five people reporting the same dark
  -- stretch is a stronger signal than one, and it is shown rather than hidden.
  confirmations integer NOT NULL DEFAULT 0 CHECK (confirmations >= 0),

  -- The escalation clock. A hazard that stays open is the accountability
  -- story: "reported 14 March, still open, 62 days". Publishing institutional
  -- silence is the lever.
  resolved_on   date,
  resolved_note text CHECK (resolved_note IS NULL OR length(resolved_note) <= 200),

  pow_nonce     text,

  CONSTRAINT hazard_subcategory_fits_category
    CHECK (hazard_subcategory_matches(category, subcategory)),
  CONSTRAINT hazard_not_resolved_before_reported
    CHECK (resolved_on IS NULL OR resolved_on >= reported_day),
  CONSTRAINT hazard_published_only_when_approved
    CHECK (published_at IS NULL OR status = 'approved')
);

CREATE INDEX hazards_location_idx ON hazards USING GIST (location);
CREATE INDEX hazards_open_idx ON hazards (ward_id, category)
  WHERE status = 'approved' AND resolved_on IS NULL;

-- The public hazard layer. No suppression, no threshold — but note what is
-- NOT here: reported_day is exposed as an age in days rather than a date, so
-- the feed cannot be used to work out exactly when somebody was standing at
-- that spot with their phone out.
CREATE FUNCTION public_hazards()
RETURNS TABLE (
  id            uuid,
  category      hazard_category,
  subcategory   hazard_subcategory,
  lon           double precision,
  lat           double precision,
  ward_id       integer,
  confirmations integer,
  age_days      integer,
  resolved      boolean
)
LANGUAGE sql STABLE AS $$
  SELECT h.id, h.category, h.subcategory,
         round(ST_X(h.location)::numeric, 5)::double precision,
         round(ST_Y(h.location)::numeric, 5)::double precision,
         h.ward_id, h.confirmations,
         (CURRENT_DATE - h.reported_day)::integer,
         h.resolved_on IS NOT NULL
  FROM hazards h
  WHERE h.status = 'approved';
$$;

GRANT INSERT ON hazards TO nirapod_submit;
GRANT SELECT ON hazard_subcategory_rules TO nirapod_submit;
GRANT SELECT, UPDATE ON hazards TO nirapod_moderator;
GRANT SELECT ON hazards, hazard_subcategory_rules TO nirapod_aggregator;
GRANT EXECUTE ON FUNCTION public_hazards TO nirapod_aggregator;

COMMIT;
