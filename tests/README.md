# Tests

Everything here runs locally against a real Postgres database with every migration applied, and a small
stand-in for the Supabase API (`mock-supabase.mjs`) that also serves the website, app and demo. So the tests
exercise the real app code and the real database rules, without touching the live Supabase project.

| Command | What it does |
| --- | --- |
| `tests/run.sh setup` | Once: installs the test packages and creates a local database in `tests/.pg` |
| `tests/run.sh all` | Database tests, then every browser suite, each on a fresh database |
| `tests/run.sh unit` | Database tests only (`*.test.mjs`) — permissions, workflows, refusals |
| `tests/run.sh e2e costs` | One browser suite (`e2e-costs.mjs`), clicking through the app in Chromium |
| `tests/run.sh mock` | Fresh database + the app at http://localhost:54321/buildos/app/ to try by hand |
| `tests/run.sh stop` | Stops the mock server and the database |

**Needs:** Node 20+, PostgreSQL 16 (`initdb`, `pg_ctl`, `psql` on the PATH, or set `PG_BIN`), and Chromium —
set `CHROMIUM_PATH`, or run `npx playwright install chromium` inside `tests/`. On a Mac: `brew install postgresql@16`.

**What's in here**

- `*.test.mjs` — database tests, one file per module (signed in as different roles, checking what's allowed and refused).
- `e2e-*.mjs` — browser tests, one per module; `e2e-demo.mjs` checks the in-browser demo, `e2e-ai.mjs` the AI features.
- `mock-supabase.mjs` — the Supabase stand-in (auth, database functions, table reads, storage). It runs the real
  AI Edge Function code (`supabase/functions/ai`) with `fake-anthropic.mjs` in place of the Claude API, so tests never spend money.
- `capture.mjs` — screenshots of every page from the demo: `tests/run.sh mock`, then `node tests/capture.mjs <folder>`.
- `env.mjs` — paths and ports; override with `SETOUT_PG_DIR`, `SETOUT_PG_PORT`, `CHROMIUM_PATH`.

**When you change something:** run `tests/run.sh all` before pushing. Add a migration → also run
`node demo/build-manifest.mjs` so the demo loads it. Add a feature → add checks to the matching test files.
