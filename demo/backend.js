// BuildOS demo backend: the real database (every migration in supabase/migrations) running inside the
// visitor's browser with PGlite, behind a stand-in for the Supabase API. The real app code talks to it
// through supabase-js, exactly as it talks to Supabase, so every feature appears in the demo automatically.
// Nothing leaves the browser. Data is kept in this browser (IndexedDB) until "Reset demo".

import { PGlite } from "https://cdn.jsdelivr.net/npm/@electric-sql/pglite@0.5.11/dist/index.js";
import { pgcrypto } from "https://cdn.jsdelivr.net/npm/@electric-sql/pglite@0.5.11/dist/contrib/pgcrypto.js";

export const API = "https://demo.buildos.invalid"; // never contacted: every request is answered below
const ROOT = new URL("../", import.meta.url);      // the site root, where supabase/migrations lives

let db = null;
const files = new Map(); // "bucket/path" -> Blob (uploads in this visit, also kept in IndexedDB)

// ------------------------------------------------------------------ database
export async function openDatabase(onStep = () => {}) {
  const manifest = await (await fetch(new URL("demo/migrations.json", ROOT))).json();
  const name = `buildos-demo-${manifest.version}`;
  // A new release with new migrations starts a fresh demo; old copies are deleted.
  for (const d of (await indexedDB.databases?.()) || []) if (d.name?.startsWith("/pglite/buildos-demo-") && d.name !== `/pglite/${name}`) indexedDB.deleteDatabase(d.name);
  onStep("Starting the database…");
  db = await PGlite.create({ dataDir: `idb://${name}`, extensions: { pgcrypto }, parsers: { 1082: (v) => v }, relaxedDurability: true });
  const ready = (await db.query("select to_regclass('public.demo_meta') is not null as ok")).rows[0].ok;
  if (ready) return { fresh: false };
  onStep("Building the demo database…");
  await db.exec(await (await fetch(new URL("demo/supabase-stub.sql", ROOT))).text());
  for (const f of manifest.migrations) await db.exec(await (await fetch(new URL(`supabase/migrations/${f}`, ROOT))).text());
  return { fresh: true };
}
export async function markSeeded() { await db.exec("create table public.demo_meta (seeded_at timestamptz default now()); revoke all on public.demo_meta from anon, authenticated; insert into public.demo_meta default values;"); }
export async function deleteDemo() {
  for (const d of (await indexedDB.databases?.()) || []) if (/^\/pglite\/buildos-demo-|^buildos-demo-files$|^buildos-offline$/.test(d.name || "")) indexedDB.deleteDatabase(d.name);
}

/** Run SQL as a signed-in person (or anonymous), with Row Level Security, like Supabase's API does. */
async function asUser(user, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(user ? { sub: user.id, email: user.email, role: "authenticated" } : { role: "anon" })]);
    await tx.exec(`set local role ${user ? "authenticated" : "anon"}`);
    return (await tx.query(sql, params)).rows;
  });
}
export const sql = async (text, params = []) => (await db.query(text, params)).rows; // as the database owner (demo set-up only)

const argTypes = new Map();
async function callRpc(user, fn, args = {}) {
  if (!/^\w+$/.test(fn)) throw Object.assign(new Error("Unknown function"), { code: "42883" });
  if (!argTypes.has(fn)) argTypes.set(fn, Object.fromEntries((await sql("select unnest(proargnames) n, unnest(proargtypes::regtype[]::text[]) t from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace", [fn])).map((r) => [r.n, r.t])));
  const types = argTypes.get(fn), keys = Object.keys(args);
  // Like PostgREST: arrays go to array parameters as they are; other objects are sent as JSON.
  const vals = keys.map((k) => (args[k] !== null && typeof args[k] === "object" && !(Array.isArray(args[k]) && /\[\]$/.test(types[k] || "")) ? JSON.stringify(args[k]) : args[k]));
  const rows = await asUser(user, `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`, vals);
  return rows[0].r;
}
export const rpcAs = (user, fn, args) => callRpc(user, fn, args);

// ------------------------------------------------------------------ auth (tokens are not signed: nothing here is secret)
const b64 = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const makeJwt = (u) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: u.id, email: u.email, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 7 * 86400 })}.demo`;
function userFromJwt(h) {
  const t = (h || "").replace(/^Bearer /, "");
  try { const p = JSON.parse(decodeURIComponent(escape(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))))); return p.sub ? { id: p.sub, email: p.email } : null; } catch { return null; }
}
const userJson = (r) => ({ id: r.id, aud: "authenticated", role: "authenticated", email: r.email, user_metadata: r.raw_user_meta_data || {}, app_metadata: { provider: "email" }, created_at: r.created_at, email_confirmed_at: r.created_at });
const sessionJson = (r) => ({ access_token: makeJwt(r), token_type: "bearer", expires_in: 7 * 86400, expires_at: Math.floor(Date.now() / 1000) + 7 * 86400, refresh_token: "r-" + r.id, user: userJson(r) });

// ------------------------------------------------------------------ files
const fileStore = (() => {
  let p = null;
  const open = () => (p ||= new Promise((res, rej) => { const r = indexedDB.open("buildos-demo-files", 1); r.onupgradeneeded = () => r.result.createObjectStore("f"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
  const tx = async (mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction("f", mode), q = fn(t.objectStore("f")); t.oncomplete = () => res(q?.result); t.onerror = () => rej(t.error); }); };
  return { put: (k, v) => tx("readwrite", (s) => s.put(v, k)), get: (k) => tx("readonly", (s) => s.get(k)) };
})();
/** Store a file as if this person had uploaded it (demo set-up only). */
export async function putFile(bucket, path, blob, owner) {
  await sql("insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3)", [bucket, path, owner]);
  files.set(`${bucket}/${path}`, blob); await fileStore.put(`${bucket}/${path}`, blob).catch(() => {});
}

/** A link the browser can open for a stored file (used for photos and documents in the demo). */
export async function fileUrl(bucket, path) {
  const k = `${bucket}/${path}`;
  if (!files.has(k)) { const b = await fileStore.get(k).catch(() => null); if (b) files.set(k, b); }
  const b = files.get(k);
  return b ? (b._url ||= URL.createObjectURL(b)) : null;
}

// ------------------------------------------------------------------ the API
const json = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const pgErr = (e) => ({ code: e.code || "P0001", message: e.message, details: null, hint: null });

export async function demoFetch(input, init) {
  const req = new Request(input, init), url = new URL(req.url), p = url.pathname, method = req.method;
  const user = userFromJwt(req.headers.get("Authorization"));
  const body = async () => { const t = await req.text(); return t ? JSON.parse(t) : {}; };
  try {
    // ---- auth
    if (p === "/auth/v1/signup") {
      const { email, password, data } = await body();
      if (!email || !password || password.length < 6) return json(422, { code: 422, error_code: "weak_password", msg: "Password should be at least 6 characters." });
      if ((await sql("select 1 from auth.users where lower(email) = lower($1)", [email])).length) return json(422, { code: 422, error_code: "user_already_exists", msg: "User already registered" });
      const [r] = await sql("insert into auth.users (email, encrypted_password, raw_user_meta_data) values ($1, $2, $3) returning *", [email, password, data || {}]);
      return json(200, sessionJson(r));
    }
    if (p === "/auth/v1/token") {
      let r;
      if (url.searchParams.get("grant_type") === "password") {
        const { email, password } = await body();
        [r] = await sql("select * from auth.users where lower(email) = lower($1) and encrypted_password = $2", [email, password]);
        if (!r) return json(400, { error: "invalid_grant", error_description: "Invalid login credentials", error_code: "invalid_credentials", msg: "Invalid login credentials" });
      } else {
        [r] = await sql("select * from auth.users where id::text = $1", [((await body()).refresh_token || "").slice(2)]);
        if (!r) return json(400, { error: "invalid_grant", error_description: "Invalid Refresh Token" });
      }
      return json(200, sessionJson(r));
    }
    if (p === "/auth/v1/user") {
      if (!user) return json(401, { msg: "not authenticated" });
      if (method === "PUT") { const b = await body(); if (b.password) await sql("update auth.users set encrypted_password = $1 where id = $2", [b.password, user.id]); }
      const [r] = await sql("select * from auth.users where id = $1", [user.id]);
      return r ? json(200, userJson(r)) : json(401, { msg: "not authenticated" });
    }
    if (p === "/auth/v1/logout") return new Response(null, { status: 204 });
    if (p === "/auth/v1/recover") return json(200, {});

    // ---- database functions
    let m = p.match(/^\/rest\/v1\/rpc\/(\w+)$/);
    if (m) {
      try { return json(200, await callRpc(user, m[1], await body())); } catch (e) { return json(400, pgErr(e)); }
    }
    // ---- table reads (the subset of PostgREST the app uses)
    m = p.match(/^\/rest\/v1\/(\w+)$/);
    if (m && method === "GET") {
      const where = [], params = [];
      let order = "", limit = "";
      for (const [k, v] of url.searchParams) {
        if (k === "select") continue;
        if (k === "order") { const [col, dir] = v.split("."); order = ` order by "${col.replace(/\W/g, "")}" ${dir === "desc" ? "desc" : "asc"}`; continue; }
        if (k === "limit") { limit = ` limit ${parseInt(v, 10)}`; continue; }
        const [op, ...rest] = v.split("."), val = rest.join("."), col = `"${k.replace(/\W/g, "")}"`;
        if (op === "eq") { params.push(val); where.push(`${col}::text = $${params.length}`); }
        else if (op === "gte") { params.push(val); where.push(`${col} >= $${params.length}`); }
        else if (op === "gt") { params.push(val); where.push(`${col} > $${params.length}`); }
        else if (op === "is" && val === "null") where.push(`${col} is null`);
        else if (op === "in") { params.push(val.replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/"/g, ""))); where.push(`${col}::text = any($${params.length})`); }
        else return json(400, { message: `demo: unsupported filter ${k}=${v}` });
      }
      try {
        const rows = await asUser(user, `select * from public."${m[1]}"${where.length ? " where " + where.join(" and ") : ""}${order}${limit}`, params);
        if ((req.headers.get("Accept") || "").includes("vnd.pgrst.object")) return rows.length === 1 ? json(200, rows[0]) : json(406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
        return json(200, rows);
      } catch (e) { return json(400, pgErr(e)); }
    }
    // ---- storage
    m = p.match(/^\/storage\/v1\/object\/sign\/(\w+)$/);
    if (m && method === "POST") {
      const { paths } = await body();
      const ok = new Set((await asUser(user, "select name from storage.objects where bucket_id = $1 and name = any($2)", [m[1], paths])).map((r) => r.name));
      return json(200, paths.map((x) => ({ path: x, signedURL: ok.has(x) ? `/object/sign/${m[1]}/${x}?token=demo` : null, error: ok.has(x) ? null : "Not found" })));
    }
    m = p.match(/^\/storage\/v1\/object\/(\w+)\/(.+)$/);
    if (m && method === "POST") {
      const name = decodeURIComponent(m[2]);
      try { await asUser(user, "insert into storage.objects (bucket_id, name, owner) values ($1, $2, auth.uid())", [m[1], name]); }
      catch { return json(403, { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" }); }
      let blob = await req.blob();
      if ((req.headers.get("Content-Type") || "").startsWith("multipart/form-data")) {
        const fd = await new Request(req.url, { method: "POST", headers: req.headers, body: blob }).formData();
        blob = [...fd.values()].find((v) => v instanceof Blob) || blob;
      }
      files.set(`${m[1]}/${name}`, blob); fileStore.put(`${m[1]}/${name}`, blob).catch(() => {});
      return json(200, { Key: `${m[1]}/${name}`, Id: name });
    }
    // ---- the AI function is not used in the demo (Help answers from a fixed list instead)
    if (p.startsWith("/functions/v1/")) return json(200, { error: "AI features aren't available in the demo." });
    return json(404, { message: `demo: no route ${method} ${p}` });
  } catch (e) {
    console.error(e);
    return json(500, { message: e.message });
  }
}
