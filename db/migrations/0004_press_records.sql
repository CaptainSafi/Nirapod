-- 0004_press_records.sql
-- The seed tier. Spec §2.3.
-- Press-sourced records so the launch map is not empty. These are a SEPARATE
-- counter from crowd reports and must never be merged into one number:
-- the gap between "what the news reported" and "what people told us" is the
-- actual finding.

BEGIN;

CREATE TABLE press_records (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  source_url     text NOT NULL,
  source_name    text NOT NULL,
  published_date date NOT NULL,

  category       report_category    NOT NULL,
  subcategory    report_subcategory,
  ward_id        integer REFERENCES wards(id),
  thana_id       integer REFERENCES thanas(id),

  occurred_week  date,

  -- OUR OWN WORDS, <= 2 sentences. Never paste article text: this is a
  -- copyright matter and it is what keeps the papers on our side.
  summary_bn     text NOT NULL,
  summary_en     text NOT NULL,

  -- No auto-publish of LLM-extracted claims, ever. A hallucinated detail in
  -- seed data ends the project in week one.
  reviewed_by    text,
  status         report_status NOT NULL DEFAULT 'pending',
  published_at   date,

  -- QA flags from the extraction pipeline (spec §4 seed rules)
  geocode_confidence real
    CHECK (geocode_confidence IS NULL
           OR (geocode_confidence >= 0 AND geocode_confidence <= 1)),
  extraction_model   text,

  CONSTRAINT press_subcategory_fits_category
    CHECK (subcategory IS NULL
           OR subcategory_matches_category(category, subcategory)),
  CONSTRAINT press_summary_bn_short CHECK (length(summary_bn) <= 400),
  CONSTRAINT press_summary_en_short CHECK (length(summary_en) <= 400),
  CONSTRAINT press_occurred_week_is_monday
    CHECK (occurred_week IS NULL OR EXTRACT(ISODOW FROM occurred_week) = 1),
  -- the human-review gate, enforced by the database rather than by discipline
  CONSTRAINT press_approved_requires_reviewer
    CHECK (status <> 'approved' OR reviewed_by IS NOT NULL),
  CONSTRAINT press_published_only_when_approved
    CHECK (published_at IS NULL OR status = 'approved'),
  UNIQUE (source_url, category, ward_id)
);

CREATE INDEX press_cell_idx
  ON press_records (ward_id, category, occurred_week)
  WHERE status = 'approved';
CREATE INDEX press_status_idx ON press_records (status);

COMMIT;
