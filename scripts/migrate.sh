#!/usr/bin/env bash
# Apply all migrations in order, then run the invariant tests.
# Usage: DATABASE_URL=postgres://... ./scripts/migrate.sh
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL}"
for f in db/migrations/0*.sql; do
  echo ">> $f"
  psql -v ON_ERROR_STOP=1 -q -d "$DATABASE_URL" -f "$f"
done
echo ">> invariant tests"
psql -v ON_ERROR_STOP=1 -q -d "$DATABASE_URL" -f db/tests/invariants_test.sql
