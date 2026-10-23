#!/usr/bin/env bash
# Local test setup for Setout: a real Postgres with every migration, a stand-in for the Supabase API
# (tests/mock-supabase.mjs, which also serves the app), and the database + browser tests.
#
#   tests/run.sh setup      install test packages and create the local database (once)
#   tests/run.sh all        run every test (database tests, then each browser suite on a fresh database)
#   tests/run.sh unit       database tests only
#   tests/run.sh e2e NAME   one browser suite, e.g. tests/run.sh e2e costs  (tests/e2e-NAME.mjs)
#   tests/run.sh mock       fresh database + the mock server on http://localhost:54321/buildos/ (leave it running)
#   tests/run.sh stop       stop the mock server and the database
#
# Needs: Node 20+, PostgreSQL 16 server binaries (initdb, pg_ctl, psql) on PATH or in $PG_BIN, and Chromium
# (set CHROMIUM_PATH, or run "npx playwright install chromium" in tests/).
set -euo pipefail
T="$(cd "$(dirname "$0")" && pwd)"; R="$(dirname "$T")"
PG_DIR="${SETOUT_PG_DIR:-$T/.pg}"; PORT="${SETOUT_PG_PORT:-54329}"
PG_BIN="${PG_BIN:-$(dirname "$(command -v pg_ctl 2>/dev/null || ls /usr/lib/postgresql/*/bin/pg_ctl 2>/dev/null | tail -1 || echo /usr/bin/pg_ctl)")}"
# Postgres won't run as root; in a root container run it as the postgres user.
as_pg() { if [ "$(id -u)" = 0 ]; then chown -R postgres "$PG_DIR"; su postgres -c "$*"; else bash -c "$*"; fi; }
PSQL="$PG_BIN/psql -h $PG_DIR -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"

db_start() {
  mkdir -p "$PG_DIR"
  [ -f "$PG_DIR/data/PG_VERSION" ] || as_pg "$PG_BIN/initdb -D '$PG_DIR/data' -U postgres -A trust >/dev/null"
  $PG_BIN/pg_isready -h "$PG_DIR" -p "$PORT" >/dev/null 2>&1 || as_pg "$PG_BIN/pg_ctl -D '$PG_DIR/data' -l '$PG_DIR/log' -o \"-p $PORT -k $PG_DIR -c listen_addresses=''\" -w start >/dev/null"
}
db_reset() {
  db_start
  $PSQL -c 'drop database if exists buildos' -c 'create database buildos'
  # The same Supabase stand-in the in-browser demo uses, then every migration in order.
  $PSQL -d buildos -f "$R/demo/supabase-stub.sql" $(for f in "$R"/supabase/migrations/*.sql; do printf -- '-f %s ' "$f"; done) 2>&1 | grep -v NOTICE || true
}
mock_stop() { pkill -f "[n]ode mock-supabase.mjs" 2>/dev/null || true; sleep 0.5; }
mock_start() { mock_stop; (cd "$T" && nohup node mock-supabase.mjs > "$PG_DIR/mock.log" 2>&1 &); for _ in $(seq 40); do curl -s -o /dev/null localhost:54321/buildos/app/ && return; sleep 0.25; done; echo "mock server didn't start — see $PG_DIR/mock.log"; exit 1; }
fresh() { mock_stop; db_reset; mock_start; }

case "${1:-all}" in
  setup) (cd "$T" && npm install --no-fund --no-audit); db_start; echo "Ready. Run: tests/run.sh all" ;;
  unit) fresh; rc=0; (cd "$T" && node --test --test-concurrency=1 ./*.test.mjs) || rc=$?; mock_stop; exit $rc ;;
  e2e) fresh; rc=0; (cd "$T" && node "e2e-$2.mjs" "${3:-}") || rc=$?; mock_stop; exit $rc ;;
  mock) fresh; echo "Mock Supabase + app on http://localhost:54321/buildos/app/ (demo: /buildos/demo/). Stop with tests/run.sh stop" ;;
  stop) mock_stop; [ -d "$PG_DIR/data" ] && as_pg "$PG_BIN/pg_ctl -D '$PG_DIR/data' stop -m fast >/dev/null" || true ;;
  all)
    fails=0
    fresh; (cd "$T" && node --test --test-concurrency=1 ./*.test.mjs) || fails=$((fails + 1))
    for f in "$T"/e2e-*.mjs; do
      n="$(basename "$f" .mjs)"; fresh
      if (cd "$T" && node "$n.mjs" > "$PG_DIR/$n.log" 2>&1); then echo "PASS $n"; else echo "FAIL $n (see $PG_DIR/$n.log)"; tail -n 40 "$PG_DIR/$n.log"; fails=$((fails + 1)); fi
    done
    mock_stop
    [ "$fails" = 0 ] && echo "ALL PASSED" || { echo "$fails suite(s) failed"; exit 1; } ;;
  *) sed -n '2,13p' "$0"; exit 1 ;;
esac
