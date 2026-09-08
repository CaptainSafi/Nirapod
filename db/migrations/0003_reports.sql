-- 0003_reports.sql
-- The write-only submission table. Spec §2.1, widened taxonomy.
--
-- THE TEST FOR EVERY COLUMN HERE: does a full dump of this table identify a
-- submitter? If yes, the column does not exist. There is no free text, no
-- coordinate, no exact timestamp, no IP, no user-agent, no session id, no
-- contact field. Do not add one.
--
-- Street hazards (broken lights, open manholes) are NOT in this table. They
-- have no victim, so they carry an exact point and no suppression, and they
-- live in `hazards` (0007). Keeping them apart is what lets this table keep
-- its "no coordinates, ever" rule while the map still shows a pothole where
-- the pothole actually is.
--
-- NOTE ON MIGRATIONS: until the first real deployment, migrations are edited
-- in place rather than appended to, so the schema stays readable as one story.
-- After the first deploy that stops: from then on, changes are new files.

BEGIN;

-- How a report may be disclosed. This drives geography and threshold, so a
-- new category cannot be added without deciding how exposed it is.
CREATE TYPE report_class AS ENUM (
  'area_crime',      -- a pattern in a place: ward level, standard threshold
  'person_directed'  -- aimed at a person: coarser geography, higher threshold
);

CREATE TYPE report_category AS ENUM (
  -- area crime
  'mugging',
  'theft',
  'chadabaji',
  'land_grabbing',
  'hooliganism',
  'drugs_weapons',
  'fraud_impersonation',
  'transport_danger',
  'police_misconduct',
  -- person-directed
  'harassment',
  'assault',
  'abduction'
);

CREATE TYPE report_subcategory AS ENUM (
  -- mugging
  'snatching', 'armed_robbery', 'vehicle_based', 'hijacking',
  -- theft
  'pickpocketing', 'motorcycle_theft', 'vehicle_theft', 'burglary', 'shop_robbery',
  -- chadabaji
  'shop_business', 'construction_site', 'transport', 'festival_event', 'land',
  'illegal_toll', 'protection_racket',
  -- land grabbing
  'eviction_threat', 'forced_occupation', 'fake_documents', 'boundary_encroachment',
  -- hooliganism / mastani
  'street_fight', 'intimidation_display', 'vandalism', 'forced_shutdown',
  -- drugs and weapons
  'dealing_spot', 'open_drug_use', 'arms_display', 'gambling_den',
  -- fraud and impersonation
  'fake_police', 'fake_checkpoint', 'coerced_mobile_banking', 'fake_collection',
  -- transport danger
  'reckless_driving', 'street_racing', 'unlicensed_driver', 'dangerous_overtaking',
  -- police misconduct
  'gd_refused', 'bribe_to_file', 'bribe_to_drop', 'complicity_with_group',
  'direct_extortion', 'custodial_abuse', 'harassment_by_police',
  'illegal_checkpoint',
  -- harassment (person-directed)
  'street_harassment', 'transport_groping', 'stalking', 'threats',
  -- assault
  'physical_assault', 'weapon_assault', 'acid_attack',
  -- abduction
  'kidnapping', 'attempted_abduction', 'trafficking_suspicion'
);

CREATE TYPE time_band AS ENUM (
  'morning', 'afternoon', 'evening', 'night', 'unknown'
);

CREATE TYPE amount_band AS ENUM (
  'under_1k', '1k_5k', '5k_25k', '25k_100k', 'over_100k'
);

CREATE TYPE why_not_reported AS ENUM (
  'would_ask_for_money',
  'connected_to_group',
  'would_tell_them_i_complained',
  'nothing_would_happen',
  'afraid_of_retaliation',
  'did_not_know_how',
  'ashamed_or_blamed',
  'other'
);

CREATE TYPE police_outcome AS ENUM (
  'gd_filed', 'gd_refused', 'no_action', 'money_demanded', 'other'
);

CREATE TYPE report_status AS ENUM ('pending', 'approved', 'rejected', 'held');

-- "How it happened", as closed vocabularies. These are enums and not text
-- with a CHECK for a reason: a text column in this table is a text column a
-- future change can widen into a narrative field, and free text is the single
-- most common deanonymisation vector in systems like this. `reports` has
-- exactly one text column (pow_nonce), and the invariant test fails the build
-- if a second appears.
CREATE TYPE offender_count_band AS ENUM ('one','two','three_to_five','more','unknown');
CREATE TYPE vehicle_type AS ENUM ('none','motorcycle','cng','car','bicycle','unknown');
CREATE TYPE weapon_type AS ENUM ('none','knife','firearm','blunt','acid','other','unknown');
CREATE TYPE approach_type AS ENUM ('from_behind','blocked_path','posed_as_official','followed','group_surrounded','other','unknown');

CREATE TYPE source_tier AS ENUM ('crowd', 'press');

-- The taxonomy, as data the database can check rather than a comment.
CREATE TABLE category_rules (
  category    report_category PRIMARY KEY,
  class       report_class NOT NULL,
  amount_band_allowed boolean NOT NULL DEFAULT false,
  thana_required      boolean NOT NULL DEFAULT false
);

INSERT INTO category_rules (category, class, amount_band_allowed, thana_required) VALUES
  ('mugging',             'area_crime',      false, false),
  ('theft',               'area_crime',      false, false),
  ('chadabaji',           'area_crime',      true,  false),
  ('land_grabbing',       'area_crime',      true,  false),
  ('hooliganism',         'area_crime',      false, false),
  ('drugs_weapons',       'area_crime',      false, false),
  ('fraud_impersonation', 'area_crime',      true,  false),
  ('transport_danger',    'area_crime',      false, false),
  ('police_misconduct',   'area_crime',      true,  true),
  ('harassment',          'person_directed', false, false),
  ('assault',             'person_directed', false, false),
  ('abduction',           'person_directed', false, false);

CREATE TABLE subcategory_rules (
  subcategory report_subcategory PRIMARY KEY,
  category    report_category NOT NULL REFERENCES category_rules(category)
);

INSERT INTO subcategory_rules (subcategory, category) VALUES
  ('snatching','mugging'),('armed_robbery','mugging'),('vehicle_based','mugging'),
  ('hijacking','mugging'),
  ('pickpocketing','theft'),('motorcycle_theft','theft'),('vehicle_theft','theft'),
  ('burglary','theft'),('shop_robbery','theft'),
  ('shop_business','chadabaji'),('construction_site','chadabaji'),
  ('transport','chadabaji'),('festival_event','chadabaji'),('land','chadabaji'),
  ('illegal_toll','chadabaji'),('protection_racket','chadabaji'),
  ('eviction_threat','land_grabbing'),('forced_occupation','land_grabbing'),
  ('fake_documents','land_grabbing'),('boundary_encroachment','land_grabbing'),
  ('street_fight','hooliganism'),('intimidation_display','hooliganism'),
  ('vandalism','hooliganism'),('forced_shutdown','hooliganism'),
  ('dealing_spot','drugs_weapons'),('open_drug_use','drugs_weapons'),
  ('arms_display','drugs_weapons'),('gambling_den','drugs_weapons'),
  ('fake_police','fraud_impersonation'),('fake_checkpoint','fraud_impersonation'),
  ('coerced_mobile_banking','fraud_impersonation'),('fake_collection','fraud_impersonation'),
  ('reckless_driving','transport_danger'),('street_racing','transport_danger'),
  ('unlicensed_driver','transport_danger'),('dangerous_overtaking','transport_danger'),
  ('gd_refused','police_misconduct'),('bribe_to_file','police_misconduct'),
  ('bribe_to_drop','police_misconduct'),('complicity_with_group','police_misconduct'),
  ('direct_extortion','police_misconduct'),('custodial_abuse','police_misconduct'),
  ('harassment_by_police','police_misconduct'),('illegal_checkpoint','police_misconduct'),
  ('street_harassment','harassment'),('transport_groping','harassment'),
  ('stalking','harassment'),('threats','harassment'),
  ('physical_assault','assault'),('weapon_assault','assault'),('acid_attack','assault'),
  ('kidnapping','abduction'),('attempted_abduction','abduction'),
  ('trafficking_suspicion','abduction');

CREATE FUNCTION subcategory_matches_category(
  cat report_category, sub report_subcategory
) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM subcategory_rules
                  WHERE subcategory = sub AND category = cat)
$$;

CREATE FUNCTION category_allows_amount(cat report_category) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT amount_band_allowed FROM category_rules WHERE category = cat
$$;

CREATE FUNCTION category_requires_thana(cat report_category) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT thana_required FROM category_rules WHERE category = cat
$$;

CREATE TABLE reports (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- random, not sequential: sequential ids leak volume and ordering

  category           report_category    NOT NULL,
  subcategory        report_subcategory NOT NULL,

  ward_id            integer NOT NULL REFERENCES wards(id),
  thana_id           integer          REFERENCES thanas(id),

  occurred_week      date NOT NULL,
  time_band          time_band NOT NULL DEFAULT 'unknown',
  amount_band        amount_band,

  -- How it happened, as fixed options rather than a narrative. This is the
  -- awareness content that actually changes behaviour — "two on a motorcycle,
  -- from behind, after dark" — without a free-text field, which is the single
  -- most common deanonymisation vector in systems like this.
  offender_count     offender_count_band,
  offender_vehicle   vehicle_type,
  weapon             weapon_type,
  approach           approach_type,

  reported_to_police boolean NOT NULL,
  why_not_reported   why_not_reported,
  police_outcome     police_outcome,

  status             report_status NOT NULL DEFAULT 'pending',
  submitted_day      date NOT NULL DEFAULT CURRENT_DATE,
  published_at       date,

  source_tier        source_tier NOT NULL DEFAULT 'crowd',
  pow_nonce          text,

  CONSTRAINT subcategory_fits_category
    CHECK (subcategory_matches_category(category, subcategory)),

  CONSTRAINT thana_required_for_some_categories
    CHECK (NOT category_requires_thana(category) OR thana_id IS NOT NULL),

  -- occurred_week is the MONDAY of the week. Never an exact date.
  CONSTRAINT occurred_week_is_monday
    CHECK (EXTRACT(ISODOW FROM occurred_week) = 1),

  CONSTRAINT occurred_week_not_future
    CHECK (occurred_week <= CURRENT_DATE),

  CONSTRAINT why_not_reported_iff_unreported
    CHECK (
      (reported_to_police = false AND why_not_reported IS NOT NULL)
      OR
      (reported_to_police = true  AND why_not_reported IS NULL)
    ),

  CONSTRAINT outcome_only_if_reported
    CHECK (reported_to_police = true OR police_outcome IS NULL),

  CONSTRAINT amount_band_only_where_meaningful
    CHECK (amount_band IS NULL OR category_allows_amount(category)),

  CONSTRAINT published_only_when_approved
    CHECK (published_at IS NULL OR status = 'approved')
);

CREATE INDEX reports_cell_idx
  ON reports (ward_id, category, occurred_week)
  WHERE status = 'approved';
CREATE INDEX reports_status_idx ON reports (status, submitted_day);
CREATE INDEX reports_thana_idx  ON reports (thana_id) WHERE status = 'approved';

COMMENT ON COLUMN reports.pow_nonce IS
  'Proof-of-work receipt. Discarded after 30 days by scripts/expire_pow.sql.';
COMMENT ON COLUMN reports.submitted_day IS
  'Day precision ONLY. Never widen this to a timestamp: submit-time correlated with publish-time deanonymises.';

COMMIT;
