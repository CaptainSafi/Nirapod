-- 0002_geography.sql
-- Ward and thana geography. Spec §2.2.
-- Wards are the ONLY spatial resolution that exists in this database.
-- There is deliberately no point geometry anywhere: coarsening happens at
-- ingest, not at display (handoff §0).

BEGIN;

CREATE TABLE thanas (
  id          serial PRIMARY KEY,
  name_bn     text NOT NULL,
  name_en     text NOT NULL,
  division    text NOT NULL,
  district    text NOT NULL,
  upazila     text,
  geometry    geometry(MultiPolygon, 4326),
  population  integer CHECK (population IS NULL OR population > 0),
  UNIQUE (name_en, district)
);

CREATE TABLE wards (
  id          serial PRIMARY KEY,
  thana_id    integer REFERENCES thanas(id),
  name_bn     text NOT NULL,
  name_en     text NOT NULL,
  division    text NOT NULL,
  district    text NOT NULL,
  upazila     text,
  geometry    geometry(MultiPolygon, 4326) NOT NULL,
  population  integer CHECK (population IS NULL OR population > 0),
  -- provenance for the boundary, so the methodology page can be honest
  source      text NOT NULL DEFAULT 'osm',
  UNIQUE (name_en, district)
);

CREATE INDEX wards_geometry_idx ON wards USING GIST (geometry);
CREATE INDEX thanas_geometry_idx ON thanas USING GIST (geometry);
CREATE INDEX wards_thana_idx ON wards (thana_id);
CREATE INDEX wards_rollup_idx ON wards (division, district);

COMMENT ON TABLE wards IS
  'Ward polygons. Population is required for per-capita normalisation (spec §4.3) so the map does not say "Dhaka is dangerous" when it means "smartphones are in Dhaka".';

COMMIT;
