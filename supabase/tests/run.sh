#!/usr/bin/env bash
# Pruebas de la base de datos de Luni sobre un PostgreSQL local (con btree_gist y pgcrypto).
#   Uso:  supabase/tests/run.sh
#   Variables: LUNI_TEST_DB (por defecto luni_test) y las habituales PGHOST/PGUSER/PGPASSWORD.
# Aplica las migraciones en orden, ejecuta los archivos NN_*.sql y falla si hay algún FAIL o ERROR.
set -uo pipefail
DB="${LUNI_TEST_DB:-luni_test}"
HERE="$(cd "$(dirname "$0")" && pwd)"
MIGRATIONS="$HERE/../migrations"

psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists \"$DB\"" -c "create database \"$DB\"" || exit 1
run() { psql -X -q -d "$DB" -f "$1" 2>&1; }

out="$(psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/00_stubs.sql" 2>&1)" || { echo "$out"; exit 1; }
for m in "$MIGRATIONS"/*.sql; do
  out="$(psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$m" 2>&1)" || { echo "$out"; echo "Falló la migración $m"; exit 1; }
done

all=""
for f in "$HERE"/[0-9][0-9]_*.sql; do
  [ "$(basename "$f")" = "00_stubs.sql" ] && continue
  all+="$(run "$f")"$'\n'
done

echo "$all" | grep -E 'PASS|FAIL|ERROR' | sed -E 's/^psql:[^ ]+ NOTICE:  //'
pass=$(echo "$all" | grep -c 'PASS ')
fail=$(echo "$all" | grep -cE 'FAIL |ERROR')
echo "----"; echo "Pasaron: $pass · Fallaron: $fail"
[ "$fail" -eq 0 ] && [ "$pass" -gt 0 ]
