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


let pm, sup, sub, sub2, wkr, org, proj, con, con2, task, w, s1, s2, s3;
const HZ = [{ hazard: "Pump boom contact with power lines", controls: "Spotter; 4m exclusion zone", responsible: "Pump operator" }];
before(async () => {
  await q("truncate public.organisations cascade; delete from auth.users");
  pm = await signUp("pm@s.test", "Pat PM"); sup = await signUp("sup@s.test", "Sue Super"); sub = await signUp("sub@s.test", "Sid Sub"); sub2 = await signUp("sub2@s.test", "Ola Other"); wkr = await signUp("w@s.test", "Wes Worker");
  org = (await rpc(pm, "create_organisation", { p_name: "S Co" })).id;
  proj = (await rpc(pm, "create_project", { p_org: org, p: { name: "P", code: "P1" } })).id;
  con = (await rpc(pm, "create_contractor", { p_org: org, p: { trading_name: "Pour Co", trade: "Concrete" } })).id;
  con2 = (await rpc(pm, "create_contractor", { p_org: org, p: { trading_name: "Other Co" } })).id;
  task = (await rpc(pm, "create_task", { p_project: proj, p: { name: "Pour", forecast_start: "2030-01-10", forecast_finish: "2030-01-10" } })).id;
  w = (await rpc(pm, "create_worker", { p_org: org, p: { name: "Wes Worker", contractor_id: con, white_card: "WC1", inducted_project_id: proj } })).id;
  for (const [u, email, role, c, wid] of [[sup, "sup@s.test", "site_supervisor"], [sub, "sub@s.test", "subcontractor_admin", con], [sub2, "sub2@s.test", "subcontractor_admin", con2], [wkr, "w@s.test", "worker", null, w]]) {
    await rpc(pm, "invite_member", { p_org: org, p_email: email, p_role: role, p_title: "", p_contractor: c ?? null, p_worker: wid ?? null });
    await rpc(u, "accept_invitations", {});
  }
});
after(() => pool.end());

test("submitting needs an activity and at least one hazard with controls", async () => {
  await assert.rejects(rpc(sub, "submit_swms", { p_project: proj, p: { title: "Concrete placement", activity: "Pumping", hazards: [] } }), /at least one hazard/);
  await assert.rejects(rpc(sub, "submit_swms", { p_project: proj, p: { title: "Concrete placement", activity: "Pumping", hazards: [{ hazard: "Falls" }] } }), /controls for "Falls"/);
});

test("subcontractors submit for their own company only; tasks get linked", async () => {
  const r = await rpc(sub, "submit_swms", { p_project: proj, p: { title: "Concrete placement", activity: "Pumping and placing", contractor_id: con2, hazards: HZ, high_risk_categories: ["Movement of powered mobile plant"], task_ids: [task] } });
  assert.match(r.message, /SWMS-01 submitted/);
  s1 = r.id;
  const row = (await q("select * from swms where id = $1", [s1])).rows[0];
  assert.equal(row.contractor_id, con, "forced to the subbie's own company");
  assert.equal(row.series_id, s1);
  assert.equal((await q("select swms_id from tasks where id = $1", [task])).rows[0].swms_id, s1);
  await assert.rejects(rpc(sub2, "revise_swms", { p_swms: s1, p: { title: "x", activity: "x", hazards: HZ } }), /own company/);
  await assert.rejects(rpc(sub, "swms_review", { p_swms: s1, p_decision: "approve" }), /can't do that/);
});

test("changes requested → revision → approval with review date", async () => {
  await assert.rejects(rpc(sup, "swms_review", { p_swms: s1, p_decision: "changes", p_comment: "" }), /what needs to change/);
  await rpc(sup, "swms_review", { p_swms: s1, p_decision: "changes", p_comment: "Add washout area controls" });
  const r = await rpc(sub, "revise_swms", { p_swms: s1, p: { title: "Concrete placement", activity: "Pumping and placing", hazards: [...HZ, { hazard: "Washout", controls: "Bunded washout bay" }] } });
  assert.match(r.message, /v2 submitted/);
  s2 = r.id;
  assert.equal((await q("select status from swms where id = $1", [s1])).rows[0].status, "superseded");
  assert.equal((await q("select swms_id from tasks where id = $1", [task])).rows[0].swms_id, s2, "task follows the new version");
  await rpc(pm, "swms_review", { p_swms: s2, p_decision: "approve", p_review_months: 6 });
  const row = (await q("select status, review_due, reviewed_by from swms where id = $1", [s2])).rows[0];
  assert.equal(row.status, "approved"); assert.ok(row.review_due); assert.equal(row.reviewed_by, pm.id);
});

test("worker must acknowledge before sign-in; only their own company's SWMS", async () => {
  await assert.rejects(rpc(wkr, "site_sign_in", { p_project: proj }), /SWMS · Concrete placement v2 — needs signing/);
  await assert.rejects(rpc(wkr, "swms_acknowledge", { p_swms: s1 }), /newer version/);
  await rpc(wkr, "swms_acknowledge", { p_swms: s2 });
  assert.match((await rpc(wkr, "site_sign_in", { p_project: proj })).message, /signed in/);
  const other = (await rpc(pm, "submit_swms", { p_project: proj, p: { title: "Other", activity: "x", contractor_id: con2, hazards: HZ } })).id;
  await rpc(pm, "swms_review", { p_swms: other, p_decision: "approve" });
  await assert.rejects(rpc(wkr, "swms_acknowledge", { p_swms: other }), /another company/);
});

test("revision of an approved SWMS: old stays in force until the new one is approved", async () => {
  s3 = (await rpc(sub, "revise_swms", { p_swms: s2, p: { title: "Concrete placement", activity: "Pumping and placing", hazards: HZ, requires_reack: true } })).id;
  await assert.rejects(rpc(sub, "revise_swms", { p_swms: s2, p: { title: "x", activity: "x", hazards: HZ } }), /already waiting/);
  assert.equal((await q("select status from swms where id = $1", [s2])).rows[0].status, "approved", "v2 still in force");
  assert.deepEqual((await q("select public.site_blockers($1, $2) as b", [w, proj])).rows[0].b, [], "worker still fine on v2");
  const r = await rpc(pm, "swms_review", { p_swms: s3, p_decision: "approve" });
  assert.match(r.message, /must acknowledge the new version/);
  assert.equal((await q("select status from swms where id = $1", [s2])).rows[0].status, "superseded");
  assert.deepEqual((await q("select public.site_blockers($1, $2) as b", [w, proj])).rows[0].b, ["SWMS · Concrete placement v3 — needs signing"]);
});

test("the blocker check isn't callable from the app", async () => {
  await assert.rejects(rpc(wkr, "site_blockers", { p_worker: w, p_project: proj }), /permission denied/);
});

test("minor revisions can carry acknowledgements forward", async () => {
  await rpc(wkr, "swms_acknowledge", { p_swms: s3 });
  const s4 = (await rpc(sub, "revise_swms", { p_swms: s3, p: { title: "Concrete placement", activity: "Pumping and placing (typo fixed)", hazards: HZ, requires_reack: false } })).id;
  await rpc(pm, "swms_review", { p_swms: s4, p_decision: "approve" });
  assert.deepEqual((await q("select public.site_blockers($1, $2) as b", [w, proj])).rows[0].b, []);
  assert.equal((await q("select count(*)::int n from swms where series_id = $1", [s1])).rows[0].n, 4, "full version history kept");
});
