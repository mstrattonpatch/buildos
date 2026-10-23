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


let pm, sup, sub, org, proj, a3, a4, a5;
before(async () => {
  await q("truncate public.organisations cascade; delete from auth.users");
  pm = await signUp("pm@d.test", "Pat PM"); sup = await signUp("sup@d.test", "Sue Super"); sub = await signUp("sub@d.test", "Sid Sub");
  org = (await rpc(pm, "create_organisation", { p_name: "D Co" })).id;
  proj = (await rpc(pm, "create_project", { p_org: org, p: { name: "P", code: "P1" } })).id;
  const con = (await rpc(pm, "create_contractor", { p_org: org, p: { trading_name: "Sub Co" } })).id;
  await rpc(pm, "invite_member", { p_org: org, p_email: "sup@d.test", p_role: "site_supervisor", p_title: "" });
  await rpc(pm, "invite_member", { p_org: org, p_email: "sub@d.test", p_role: "subcontractor_admin", p_title: "", p_contractor: con });
  await rpc(sup, "accept_invitations", {}); await rpc(sub, "accept_invitations", {});
});
after(() => pool.end());
const doc = (o) => ({ number: "a-102", title: "General arrangement L2–L4", category: "Architectural", revision: "3", file_path: `${org}/a.pdf`, file_name: "A-102.pdf", ...o });

test("upload validates number, title, revision, file and company storage", async () => {
  await assert.rejects(rpc(sup, "upload_document", { p_project: proj, p: doc({ number: "" }) }), /document number/);
  await assert.rejects(rpc(sup, "upload_document", { p_project: proj, p: doc({ file_path: "" }) }), /Choose the file/);
  await assert.rejects(rpc(sup, "upload_document", { p_project: proj, p: doc({ file_path: "other-org/x.pdf" }) }), /isn't in your company/);
});

test("controlled drawings go to review first; number is normalised", async () => {
  const r = await rpc(sup, "upload_document", { p_project: proj, p: doc() });
  assert.match(r.message, /A-102 rev 3 uploaded for review/);
  a3 = r.id;
  assert.equal((await q("select status, number from documents where id = $1", [a3])).rows[0].status, "in_review");
  await assert.rejects(rpc(sup, "upload_document", { p_project: proj, p: doc({ revision: "4" }) }), /already waiting for review/);
  await assert.rejects(rpc(sup, "review_document", { p_document: a3, p_decision: "approve" }), /can't do that/);
  assert.match((await rpc(pm, "review_document", { p_document: a3, p_decision: "approve" })).message, /now current/);
});

test("a new revision stays in review while the old one stays current; approval supersedes", async () => {
  await assert.rejects(rpc(sup, "upload_document", { p_project: proj, p: doc({ revision: "3" }) }), /already exists/);
  a4 = (await rpc(sub, "upload_document", { p_project: proj, p: doc({ revision: "4" }) })).id;
  const st = async (id) => (await q("select status from documents where id = $1", [id])).rows[0].status;
  assert.equal(await st(a3), "current"); assert.equal(await st(a4), "in_review");
  await assert.rejects(rpc(pm, "review_document", { p_document: a4, p_decision: "reject", p_comment: "" }), /Say why/);
  await rpc(pm, "review_document", { p_document: a4, p_decision: "reject", p_comment: "Wrong title block" });
  assert.equal(await st(a3), "current"); assert.equal(await st(a4), "rejected");
  a5 = (await rpc(sup, "upload_document", { p_project: proj, p: doc({ revision: "5" }) })).id;
  const r = await rpc(pm, "review_document", { p_document: a5, p_decision: "approve" });
  assert.match(r.message, /rev 5 is now current; rev 3 superseded/);
  assert.equal(await st(a3), "superseded");
});

test("uncontrolled documents are issued straight away and supersede the last one", async () => {
  const m1 = await rpc(sup, "upload_document", { p_project: proj, p: doc({ number: "MIN-01", title: "Site meeting minutes", category: "Minutes", revision: "1" }) });
  assert.match(m1.message, /issued/);
  const m2 = await rpc(sup, "upload_document", { p_project: proj, p: doc({ number: "MIN-01", title: "Site meeting minutes", category: "Minutes", revision: "2" }) });
  assert.match(m2.message, /rev 1 is now superseded/);
});
