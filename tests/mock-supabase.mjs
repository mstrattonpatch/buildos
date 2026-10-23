// Minimal stand-in for the Supabase API (auth, PostgREST, storage) backed by
// the local Postgres, so the real supabase-js client can be tested end to end.
// Also serves the app at /app/. Testing only.
import http from "node:http";
import fs from "node:fs";
import { ROOT } from "./env.mjs";
import path from "node:path";
import pg from "pg";
import { PG } from "./env.mjs";
import { createClient } from "@supabase/supabase-js";
import { fakeAnthropic, AI } from "./fake-anthropic.mjs";
// The real Edge Function code, run here with a fake Claude API.
fs.mkdirSync(new URL("./ai-fn/", import.meta.url), { recursive: true });
let aiHandle = null, workerHandle = null;
const MAIL = [];
if (fs.existsSync(`${ROOT}/supabase/functions/ai/handler.ts`)) {
  for (const f of ["handler.ts", "guide.ts"]) fs.copyFileSync(`${ROOT}/supabase/functions/ai/${f}`, new URL(`./ai-fn/${f}`, import.meta.url));
  aiHandle = (await import("./ai-fn/handler.ts")).handle;
}
if (fs.existsSync(`${ROOT}/supabase/functions/worker/handler.ts`)) {
  fs.copyFileSync(`${ROOT}/supabase/functions/worker/handler.ts`, new URL("./ai-fn/worker-handler.ts", import.meta.url));
  workerHandle = (await import("./ai-fn/worker-handler.ts")).handleWorker;
}


const PORT = 54321;
const APP_DIR = ROOT;
const SUPA_JS = new URL("./node_modules/@supabase/supabase-js/dist/umd/supabase.js", import.meta.url).pathname;
// Match PostgREST's JSON: dates as YYYY-MM-DD, int8 as numbers.
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(20, (v) => Number(v));
const pool = new pg.Pool(PG);
const files = new Map(); // storage path -> Buffer

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
// A service-role token, like the worker's secret key (testing only).
const SERVICE_JWT = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ role: "service_role" })}.sig`;
const makeJwt = (u) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: u.id, email: u.email, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const userFromJwt = (h) => {
  const t = (h || "").replace(/^Bearer /, "");
  try { const p = JSON.parse(Buffer.from(t.split(".")[1], "base64url")); return p.role === "service_role" ? { service: true } : p.sub ? { id: p.sub, email: p.email } : null; } catch { return null; }
};
const userJson = (r) => ({ id: r.id, aud: "authenticated", role: "authenticated", email: r.email, user_metadata: r.raw_user_meta_data || {}, app_metadata: { provider: "email" }, created_at: r.created_at, email_confirmed_at: r.created_at });
const sessionJson = (r) => ({ access_token: makeJwt(r), token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "r-" + r.id, user: userJson(r) });

async function asUser(user, sql, params) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const role = user?.service ? "service_role" : user ? "authenticated" : "anon";
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(user?.service ? { role } : user ? { sub: user.id, email: user.email, role } : { role })]);
    await c.query(`set local role ${role}`);
    const r = await c.query(sql, params);
    await c.query("commit");
    return r.rows;
  } catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
}

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  res.writeHead(status, { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", "content-type": isBuf ? "application/octet-stream" : "application/json", ...headers });
  res.end(isBuf ? body : body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body));
}
const readBody = (req) => new Promise((r) => { const ch = []; req.on("data", (c) => ch.push(c)); req.on("end", () => r(Buffer.concat(ch))); });
// supabase-js sends Blobs as multipart/form-data; keep just the file bytes, like Supabase does.
function fileFromBody(type, body) {
  const m = type.match(/boundary=(.+)$/);
  if (!m) return body;
  const sep = Buffer.from("--" + m[1]);
  let i = body.indexOf(sep);
  while (i !== -1) {
    const next = body.indexOf(sep, i + sep.length);
    if (next === -1) break;
    const part = body.subarray(i + sep.length, next);
    const h = part.indexOf("\r\n\r\n");
    const head = part.subarray(0, h).toString();
    if (/filename=|Content-Type:\s*image/i.test(head)) return part.subarray(h + 4, part.length - 2);
    i = next;
  }
  return body;
}
const pgErr = (e) => ({ code: e.code || "P0001", message: e.message, details: null, hint: null });

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  if (req.method === "OPTIONS") return send(res, 204);
  try {
    // ---------- static app
    if (p === "/supabase.js") return send(res, 200, fs.readFileSync(SUPA_JS), { "content-type": "text/javascript" });
    if (p === "/qrcode.js") return send(res, 200, fs.readFileSync(new URL("./node_modules/qrcode-generator/qrcode.js", import.meta.url).pathname), { "content-type": "text/javascript" });
    if (p.startsWith("/buildos/")) {
      let f = path.join(APP_DIR, p.slice("/buildos/".length));
      if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
      if (!fs.existsSync(f)) return send(res, 404, "not found");
      let body = fs.readFileSync(f);
      if (f.endsWith("index.html")) body = Buffer.from(body.toString().replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^"]+/, "/supabase.js").replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/qrcode-generator@[^"]+/, "/qrcode.js"));
      if (f.endsWith("config.js")) body = Buffer.from(`window.BUILDOS_CONFIG = { supabaseUrl: "http://localhost:${PORT}", supabaseKey: "sb_publishable_test" };`);
      return send(res, 200, body, { "content-type": MIME[path.extname(f)] || "text/plain" });
    }
    const user = userFromJwt(req.headers.authorization);
    const body = ["POST", "PUT", "PATCH"].includes(req.method) ? await readBody(req) : Buffer.alloc(0);
    const json = () => (body.length ? JSON.parse(body.toString()) : {});

    // ---------- auth
    if (p === "/auth/v1/signup") {
      const { email, password, data } = json();
      if (!email || !password || password.length < 6) return send(res, 422, { code: 422, error_code: "weak_password", msg: "Password should be at least 6 characters." });
      const exists = await pool.query("select 1 from auth.users where lower(email) = lower($1)", [email]);
      if (exists.rowCount) return send(res, 422, { code: 422, error_code: "user_already_exists", msg: "User already registered" });
      const r = (await pool.query("insert into auth.users (email, encrypted_password, raw_user_meta_data) values ($1,$2,$3) returning *", [email, password, data || {}])).rows[0];
      return send(res, 200, sessionJson(r));
    }
    if (p === "/auth/v1/token") {
      const g = url.searchParams.get("grant_type");
      let r;
      if (g === "password") {
        const { email, password } = json();
        r = (await pool.query("select * from auth.users where lower(email) = lower($1) and encrypted_password = $2", [email, password])).rows[0];
        if (!r) return send(res, 400, { error: "invalid_grant", error_description: "Invalid login credentials", error_code: "invalid_credentials", msg: "Invalid login credentials" });
      } else {
        const id = (json().refresh_token || "").slice(2);
        r = (await pool.query("select * from auth.users where id::text = $1", [id])).rows[0];
        if (!r) return send(res, 400, { error: "invalid_grant", error_description: "Invalid Refresh Token" });
      }
      return send(res, 200, sessionJson(r));
    }
    if (p === "/auth/v1/user") {
      if (!user) return send(res, 401, { msg: "not authenticated" });
      if (req.method === "PUT") {
        const b = json();
        if (b.password) await pool.query("update auth.users set encrypted_password = $1 where id = $2", [b.password, user.id]);
      }
      const r = (await pool.query("select * from auth.users where id = $1", [user.id])).rows[0];
      return send(res, 200, userJson(r));
    }
    if (p === "/auth/v1/logout") return send(res, 204);
    if (p === "/auth/v1/recover") return send(res, 200, {});

    // ---------- Edge Function "ai" (and test controls)
    if (p === "/functions/v1/ai" && aiHandle) {
      const r = await aiHandle(new Request(`http://localhost:${PORT}${p}`, { method: req.method, headers: Object.fromEntries(Object.entries(req.headers).filter(([, v]) => typeof v === "string")), body: req.method === "POST" ? body : undefined }), {
        anthropic: AI.mode === "nokey" ? null : fakeAnthropic,
        supabaseFor: (auth) => createClient(`http://localhost:${PORT}`, "sb_publishable_test", { global: { headers: { Authorization: auth } }, auth: { persistSession: false } }),
      });
      return send(res, r.status, await r.text(), Object.fromEntries(r.headers));
    }
    if (p === "/functions/v1/worker" && workerHandle) {
      const r = await workerHandle(new Request(`http://localhost:${PORT}${p}`, { method: req.method, headers: Object.fromEntries(Object.entries(req.headers).filter(([, v]) => typeof v === "string")), body: req.method === "POST" ? body : undefined }), {
        db: createClient(`http://localhost:${PORT}`, SERVICE_JWT, { global: { headers: { Authorization: `Bearer ${SERVICE_JWT}` } }, auth: { persistSession: false } }),
        secret: "test-worker-secret", appUrl: `http://localhost:${PORT}/buildos/app/`,
        sendEmail: AI.mode === "noemail" ? null : async (e) => { if (e.to.includes("bounce")) throw new Error("Email provider said 422: invalid address"); MAIL.push(e); },
      });
      return send(res, r.status, await r.text(), Object.fromEntries(r.headers));
    }
    if (p === "/__mail") { if (req.method === "POST") MAIL.length = 0; return send(res, 200, MAIL); }
    if (p === "/__ai") { if (req.method === "POST") AI.mode = json().mode || "ok"; return send(res, 200, { mode: AI.mode, requests: AI.requests }); }

    // ---------- RPC
    let m = p.match(/^\/rest\/v1\/rpc\/(\w+)$/);
    if (m) {
      const args = json(), keys = Object.keys(args);
      // Like PostgREST: arrays go to array parameters as-is, everything else object-like is JSON.
      const types = Object.fromEntries((await pool.query("select unnest(proargnames) n, unnest(proargtypes::regtype[]::text[]) t from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace", [m[1]])).rows.map((r) => [r.n, r.t]));
      const vals = keys.map((k) => (args[k] !== null && typeof args[k] === "object" && !(Array.isArray(args[k]) && /\[\]$/.test(types[k] || "")) ? JSON.stringify(args[k]) : args[k]));
      try {
        // Like PostgREST: a function returning rows gives an array (setof) or one object (a single row type).
        const [shape] = (await pool.query("select p.proretset set, t.typtype = 'c' row from pg_proc p join pg_type t on t.oid = p.prorettype where p.proname = $1 and p.pronamespace = 'public'::regnamespace limit 1", [m[1]])).rows;
        const call = `public.${m[1]}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`;
        if (shape?.set || shape?.row) {
          const rows = (await asUser(user, `select * from ${call}`, vals)).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v])));
          return send(res, 200, shape.set ? rows : rows[0] ?? null);
        }
        const rows = await asUser(user, `select ${call} as r`, vals);
        return send(res, 200, rows[0].r);
      } catch (e) { return send(res, 400, pgErr(e)); }
    }
    // ---------- table reads (PostgREST subset)
    m = p.match(/^\/rest\/v1\/(\w+)$/);
    if (m && req.method === "GET") {
      const where = [], params = [];
      let order = "", limit = "";
      for (const [k, v] of url.searchParams) {
        if (k === "select") continue;
        if (k === "order") { const [col, dir] = v.split("."); order = ` order by ${pg.escapeIdentifier(col)} ${dir === "desc" ? "desc" : "asc"}`; continue; }
        if (k === "limit") { limit = ` limit ${parseInt(v, 10)}`; continue; }
        const [op, ...rest] = v.split("."), val = rest.join(".");
        const col = pg.escapeIdentifier(k);
        if (op === "eq") { params.push(val); where.push(`${col}::text = $${params.length}`); }
        else if (op === "gte") { params.push(val); where.push(`${col} >= $${params.length}`); }
        else if (op === "gt") { params.push(val); where.push(`${col} > $${params.length}`); }
        else if (op === "is" && val === "null") where.push(`${col} is null`);
        else if (op === "in") { params.push(val.replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/"/g, ""))); where.push(`${col}::text = any($${params.length})`); }
        else return send(res, 400, { message: `mock: unsupported filter ${k}=${v}` });
      }
      try {
        const rows = await asUser(user, `select * from public.${pg.escapeIdentifier(m[1])}${where.length ? " where " + where.join(" and ") : ""}${order}${limit}`, params);
        const toJson = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v])));
        if ((req.headers.accept || "").includes("vnd.pgrst.object")) {
          if (toJson.length !== 1) return send(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
          return send(res, 200, toJson[0]);
        }
        return send(res, 200, toJson);
      } catch (e) { return send(res, 400, pgErr(e)); }
    }
    // ---------- storage
    m = p.match(/^\/storage\/v1\/object\/sign\/(\w+)$/);
    if (m && req.method === "POST") {
      const { paths } = json();
      const ok = await asUser(user, "select name from storage.objects where bucket_id = $1 and name = any($2)", [m[1], paths]);
      const okSet = new Set(ok.map((r) => r.name));
      return send(res, 200, paths.map((x) => ({ path: x, signedURL: okSet.has(x) ? `/object/sign/${m[1]}/${x}?token=t` : null, error: okSet.has(x) ? null : "Either the object does not exist or you do not have access to it" })));
    }
    m = p.match(/^\/storage\/v1\/object\/sign\/(\w+)\/(.+)$/);
    if (m) { const b = files.get(`${m[1]}/${decodeURIComponent(m[2])}`); return b ? send(res, 200, b, { "content-type": m[2].endsWith(".pdf") ? "application/pdf" : "image/jpeg" }) : send(res, 404, {}); }
    m = p.match(/^\/storage\/v1\/object\/(\w+)\/(.+)$/);
    if (m && req.method === "POST") {
      const name = decodeURIComponent(m[2]);
      try { await asUser(user, "insert into storage.objects (bucket_id, name, owner) values ($1, $2, auth.uid())", [m[1], name]); }
      catch (e) { return send(res, 403, { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" }); }
      files.set(`${m[1]}/${name}`, fileFromBody(req.headers["content-type"] || "", body));
      return send(res, 200, { Key: `${m[1]}/${name}`, Id: name });
    }
    send(res, 404, { message: `mock: no route ${req.method} ${p}` });
  } catch (e) {
    console.error(e);
    send(res, 500, { message: e.message });
  }
}).listen(PORT, () => console.log(`mock supabase on :${PORT}`));
