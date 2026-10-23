// Tests the Setout migration against a local Postgres with a Supabase stub.
import pg from "pg";
import { PG } from "./env.mjs";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

const pool = new pg.Pool(PG);
const q = (sql, params) => pool.query(sql, params);

// Run SQL as a signed-in user (or anon when user is null), like PostgREST does.
async function as(user, sql, params = []) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const claims = user ? { sub: user.id, email: user.email, role: "authenticated" } : { role: "anon" };
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await c.query(`set local role ${user ? "authenticated" : "anon"}`);
    const r = await c.query(sql, params);
    await c.query("commit");
    return r.rows;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}
const rpc = async (user, fn, args) => {
  const keys = Object.keys(args);
  const r = await as(user, `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`, keys.map((k) => (args[k] !== null && typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k])));
  return r[0].r;
};
async function signUp(email, name) {
  const r = await q("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id, email", [email, { full_name: name }]);
  return r.rows[0];
}




let pm, sup, sub, wk, org, proj, con, w, wsup;
before(async () => {
  await q("truncate public.organisations cascade; delete from auth.users; delete from storage.objects");
  pm = await signUp("pm@wl.test", "Pat PM"); sup = await signUp("sup@wl.test", "Sue Super"); sub = await signUp("sub@wl.test", "Sid Sub"); wk = await signUp("wk@wl.test", "Wes Worker");
  org = (await rpc(pm, "create_organisation", { p_name: "WL Co" })).id;
  proj = (await rpc(pm, "create_project", { p_org: org, p: { name: "P", code: "P1" } })).id;
  con = (await rpc(pm, "create_contractor", { p_org: org, p: { trading_name: "Pour Co" } })).id;
  w = (await rpc(pm, "create_worker", { p_org: org, p: { name: "Wes Worker", contractor_id: con, white_card: "WC1", inducted_project_id: proj } })).id;
  wsup = (await rpc(pm, "create_worker", { p_org: org, p: { name: "Sue Super", contractor_id: con } })).id;
  for (const [u, email, role, c, wid] of [[sup, "sup@wl.test", "site_supervisor", null, wsup], [sub, "sub@wl.test", "subcontractor_admin", con], [wk, "wk@wl.test", "worker", null, w]]) {
    await rpc(pm, "invite_member", { p_org: org, p_email: email, p_role: role, p_title: "", p_contractor: c ?? null, p_worker: wid ?? null });
    await rpc(u, "accept_invitations", {});
  }
});
after(() => pool.end());
const blockers = async () => (await q("select site_blockers($1, $2) as b", [w, proj])).rows[0].b;

test("credentials: uploads wait for review; sighted by the office is verified; nobody verifies their own", async () => {
  await assert.rejects(rpc(wk, "add_credential", { p_worker: w, p: { type: "Working at heights", sighted: true } }), /Only the site office/);
  await assert.rejects(rpc(wk, "add_credential", { p_worker: w, p: { type: "Working at heights" } }), /Attach a photo/);
  const c = await rpc(wk, "add_credential", { p_worker: w, p: { type: "Working at heights", number: "WAH-9", expires: "2030-01-01", file_path: `${org}/wah.jpg` } });
  assert.match(c.message, /waiting for verification/);
  const own = (await rpc(sup, "add_credential", { p_worker: wsup, p: { type: "First aid", file_path: `${org}/fa.jpg` } })).id;
  await assert.rejects(rpc(sup, "review_credential", { p_cred: own, p_decision: "verify", p: { method: "Original sighted" } }), /Someone else/);
  await assert.rejects(rpc(sup, "review_credential", { p_cred: c.id, p_decision: "verify", p: {} }), /how you verified/);
  await assert.rejects(rpc(sup, "review_credential", { p_cred: c.id, p_decision: "reject", p: {} }), /Say why/);
  await assert.rejects(rpc(sub, "review_credential", { p_cred: c.id, p_decision: "verify", p: { method: "x" } }), /can't do that/);
  await rpc(sup, "review_credential", { p_cred: c.id, p_decision: "unable", p: { note: "Register offline" } });
  assert.equal((await q("select status from credentials where id = $1", [c.id])).rows[0].status, "unable_to_verify");
  globalThis.wah = c.id;
});

test("project requirements block sign-in until verified and in date", async () => {
  assert.deepEqual(await blockers(), []);
  await assert.rejects(rpc(wk, "set_project_requirements", { p_project: proj, p_types: ["Working at heights"] }), /can't do that/);
  assert.match((await rpc(pm, "set_project_requirements", { p_project: proj, p_types: ["Working at heights", "white card", "Working at heights"] })).message, /1 extra credential is now required/);
  assert.deepEqual(await blockers(), ["Working at heights — could not be verified"]);
  await rpc(sup, "review_credential", { p_cred: globalThis.wah, p_decision: "verify", p: { method: "Checked the issuer's register" } });
  assert.deepEqual(await blockers(), []);
  await q("update credentials set expires = current_date - 1 where id = $1", [globalThis.wah]);
  assert.deepEqual(await blockers(), ["Working at heights — expired"]);
});

test("self-service link: managers only, anonymous use, uploads only into the link's own folder", async () => {
  await assert.rejects(rpc(sub, "portal_link", { p_kind: "worker", p_id: w }), /can't do that/);
  const tok = (await rpc(pm, "portal_link", { p_kind: "worker", p_id: w })).token;
  assert.match(tok, /^[0-9a-f]{64}$/);
  assert.equal((await rpc(pm, "portal_link", { p_kind: "worker", p_id: w })).token, tok, "same link until replaced");
  assert.equal((await as(wk, "select * from portal_links")).length, 0, "workers can't read links");
  assert.equal((await as(sub, "select * from portal_links")).length, 0);
  const info = await rpc(null, "wallet_info", { p_token: tok });
  assert.equal(info.name, "Wes Worker"); assert.deepEqual(info.required, ["Working at heights"]);
  assert.equal(info.credentials.find((c) => c.type === "Working at heights").status, "expired");
  await as(null, "insert into storage.objects (bucket_id, name) values ('documents', $1)", [`${org}/portal/${tok}/card.jpg`]);
  await assert.rejects(as(null, "insert into storage.objects (bucket_id, name) values ('documents', $1)", [`${org}/other.jpg`]), /row-level security/);
  await assert.rejects(as(null, "insert into storage.objects (bucket_id, name) values ('documents', $1)", [`${org}/portal/${"0".repeat(64)}/x.jpg`]), /row-level security/);
  await assert.rejects(rpc(null, "wallet_add", { p_token: tok, p: { type: "Forklift licence", file_path: `${org}/other.jpg` } }), /wasn't uploaded through this link/);
  assert.match((await rpc(null, "wallet_add", { p_token: tok, p: { type: "Forklift licence", file_path: `${org}/portal/${tok}/card.jpg` } })).message, /site office will check/);
  assert.equal((await q("select source, status from credentials where type = 'Forklift licence'")).rows[0].source, "worker");
  await rpc(pm, "portal_link", { p_kind: "worker", p_id: w, p_reset: true });
  await assert.rejects(rpc(null, "wallet_info", { p_token: tok }), /isn't valid/);
});

test("contractor portal: contacts, insurance upload, office verification", async () => {
  const tok = (await rpc(pm, "portal_link", { p_kind: "contractor", p_id: con })).token;
  await rpc(null, "supplier_update", { p_token: tok, p: { contact_name: "Cara Contact", contact_phone: "0400 000 000", emergency_name: "Eddie", emergency_phone: "0411 111 111" } });
  assert.equal((await q("select contact_name from contractors where id = $1", [con])).rows[0].contact_name, "Cara Contact");
  await assert.rejects(rpc(null, "supplier_add", { p_token: tok, p_what: "insurance", p: { type: "Public liability", file_path: `${org}/portal/${tok}/coc.pdf` } }), /expiry/);
  const ins = (await rpc(null, "supplier_add", { p_token: tok, p_what: "insurance", p: { type: "Public liability", expires: "2030-06-30", cover_limit: 2000000000, file_path: `${org}/portal/${tok}/coc.pdf` } })).id;
  const info = await rpc(null, "supplier_info", { p_token: tok });
  assert.equal(info.insurances[0].status, "awaiting_verification");
  assert.equal(info.workers.find((x) => x.name === "Wes Worker").white_card, true);
  await assert.rejects(rpc(pm, "review_compliance_item", { p_kind: "insurance", p_id: ins, p_decision: "reject" }), /Say why/);
  await rpc(pm, "review_compliance_item", { p_kind: "insurance", p_id: ins, p_decision: "verify" });
  assert.equal((await q("select status, verified from insurances where id = $1", [ins])).rows[0].verified, true);
  await rpc(pm, "save_contractor", { p_contractor: con, p: { trades: ["Concrete", "Formwork"], prequal_status: "approved", prequal_expires: "2027-06-30" } });
  assert.deepEqual((await q("select trades from contractors where id = $1", [con])).rows[0].trades, ["Concrete", "Formwork"]);
  await assert.rejects(rpc(pm, "save_contractor", { p_contractor: (await rpc(pm, "create_contractor", { p_org: org, p: { trading_name: "X" } })).id, p: { prequal_status: "approved" } }), /expires/);
});
