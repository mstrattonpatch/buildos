// Shared settings for the local tests. Override with environment variables if your setup differs.
import fs from "node:fs";
export const ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
export const NODE_MODULES = `${ROOT}/tests/node_modules`;
export const PG_DIR = process.env.SETOUT_PG_DIR || `${ROOT}/tests/.pg`;   // local Postgres data and socket
export const PG = { host: PG_DIR, port: Number(process.env.SETOUT_PG_PORT || 54329), user: "postgres", database: "buildos" };
// Chromium for the browser tests: CHROMIUM_PATH, or a pre-installed copy, or Playwright's own (npx playwright install chromium).
export const CHROMIUM = process.env.CHROMIUM_PATH || ["/opt/pw-browsers/chromium"].find((p) => fs.existsSync(p)) || undefined;
