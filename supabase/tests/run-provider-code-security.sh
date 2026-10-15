#!/usr/bin/env bash
# Prueba aislada del rate limit del código permanente de estudio.
# Requiere PostgreSQL + pgcrypto; usa PGHOST/PGUSER/PGPASSWORD habituales.
set -euo pipefail
DB="${LUNI_TEST_DB:-luni_code_security_test}"
HERE="$(cd "$(dirname "$0")" && pwd)"
MIGRATIONS="$HERE/../migrations"

psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists \"$DB\"" -c "create database \"$DB\""
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/00_stubs.sql"

for migration in "$MIGRATIONS"/*.sql; do
  psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$migration"
done

output="$(psql -X -q -d "$DB" -f "$HERE/08_provider_code_rate_limit.sql" 2>&1)" || {
  echo "$output"
  exit 1
}
echo "$output" | grep -E 'PASS|FAIL|ERROR'
if echo "$output" | grep -qE 'FAIL |ERROR'; then
  exit 1
fi
passes="$(echo "$output" | grep -c 'PASS ' || true)"
[ "$passes" -ge 2 ]
