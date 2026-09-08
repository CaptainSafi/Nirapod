-- 0001_extensions.sql
-- Nirapod.site — extensions and roles.
-- Invariant (handoff §0): the submit path can write and cannot read.

BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- Three trust levels, three roles. See handoff "Architecture".
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nirapod_submit') THEN
    CREATE ROLE nirapod_submit NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nirapod_moderator') THEN
    CREATE ROLE nirapod_moderator NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nirapod_aggregator') THEN
    CREATE ROLE nirapod_aggregator NOLOGIN;
  END IF;
END
$$;

COMMIT;
