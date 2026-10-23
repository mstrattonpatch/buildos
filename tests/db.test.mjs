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

let alice, bob, sam, pete, will, org, org2, proj, sub, defectId;

before(async () => {
  await q("truncate public.organisations cascade; delete from auth.users; delete from storage.objects");
  alice = await signUp("alice@builder.test", "Alice Chen");
  bob = await signUp("bob@other.test", "Bob Other");
  sam = await signUp("SAM@aquaseal.test", "Sam Sub");
  pete = await signUp("pete@builder.test", "Pete Manager");
  will = await signUp("will@solid.test", "Will Worker");
});
after(() => pool.end());

test("sign-up creates a profile with initials", async () => {
  const p = (await q("select * from profiles where id = $1", [alice.id])).rows[0];
  assert.equal(p.full_name, "Alice Chen");
  assert.equal(p.initials, "AC");
});

test("creating a company makes the creator an admin director", async () => {
  org = (await rpc(alice, "create_organisation", { p_name: "Chen Builders", p_abn: "12 345" })).id;
  const m = await as(alice, "select role, is_admin from memberships where org_id = $1", [org]);
  assert.deepEqual(m, [{ role: "director", is_admin: true }]);
  org2 = (await rpc(bob, "create_organisation", { p_name: "Other Co" })).id;
});

test("companies are isolated from each other", async () => {
  assert.equal((await as(bob, "select * from organisations where id = $1", [org])).length, 0);
  await assert.rejects(rpc(bob, "create_project", { p_org: org, p: { name: "X", code: "X1" } }), /not a member/);
});

test("anonymous visitors can't read or call anything", async () => {
  assert.equal((await as(null, "select * from organisations")).length, 0);
  await assert.rejects(as(null, "select public.create_organisation('x')"), /permission denied/);
});

test("business tables can't be written to directly", async () => {
  await assert.rejects(as(alice, "insert into projects (org_id, code, name) values ($1, 'Z', 'Z')", [org]), /row-level security/);
});

test("project, contractor and defect creation", async () => {
  proj = (await rpc(alice, "create_project", { p_org: org, p: { name: "Riverside", code: "P-1", contract_sum: 1800000000 } })).id;
  await assert.rejects(rpc(alice, "create_project", { p_org: org, p: { name: "Dup", code: "P-1" } }), /already used/);
  sub = (await rpc(alice, "create_contractor", { p_org: org, p: { trading_name: "AquaSeal", trade: "Waterproofing", pl_expires: "2030-01-01" } })).id;
  const loc = (await as(alice, "select id from locations where project_id = $1", [proj]))[0].id;
  const r = await rpc(alice, "create_defect", { p: { project_id: proj, title: "Membrane lap short", location_id: loc, contractor_id: sub, due_date: "2030-01-05", photos: [`${org}/a.jpg`] } });
  assert.match(r.message, /DEF-0001 raised and assigned/);
  defectId = r.id;
  const r2 = await rpc(alice, "create_defect", { p: { project_id: proj, title: "Second", location_id: loc } });
  assert.match(r2.message, /DEF-0002 raised\./);
});

test("retrying with the same client key doesn't duplicate a defect", async () => {
  const key = "11111111-1111-4111-8111-111111111111";
  const loc = (await as(alice, "select id from locations where project_id = $1", [proj]))[0].id;
  const p = { project_id: proj, title: "Retry me", location_id: loc, client_key: key };
  const a = await rpc(alice, "create_defect", { p }), b = await rpc(alice, "create_defect", { p });
  assert.equal(a.id, b.id);
  assert.match(b.message, /Already received/);
});

test("assigning needs a due date", async () => {
  const d2 = (await as(alice, "select id from defects where ref = 'DEF-0002'"))[0].id;
  await assert.rejects(rpc(alice, "defect_action", { p_defect: d2, p_type: "assign", p: { contractor_id: sub } }), /due date is needed/);
});

test("invitations turn into memberships when the invitee signs in (email case-insensitive)", async () => {
  await assert.rejects(rpc(alice, "invite_member", { p_org: org, p_email: "sam@aquaseal.test", p_role: "subcontractor_admin", p_title: "" }), /Link a subcontractor/);
  await rpc(alice, "invite_member", { p_org: org, p_email: "sam@aquaseal.test", p_role: "subcontractor_admin", p_title: "Contracts admin", p_contractor: sub });
  await rpc(alice, "invite_member", { p_org: org, p_email: "pete@builder.test", p_role: "project_manager", p_title: "PM" });
  assert.equal((await rpc(sam, "accept_invitations", {})).accepted, 1);
  assert.equal((await rpc(pete, "accept_invitations", {})).accepted, 1);
  const m = await as(sam, "select role, contractor_id from memberships where user_id = $1", [sam.id]);
  assert.equal(m[0].role, "subcontractor_admin");
  await assert.rejects(rpc(pete, "invite_member", { p_org: org, p_email: "x@y.test", p_role: "worker", p_title: "" }), /Only company admins/);
});

test("subcontractors see only their own defects and no commercial data", async () => {
  const mine = await as(sam, "select ref from defects where org_id = $1 order by ref", [org]);
  assert.deepEqual(mine.map((r) => r.ref), ["DEF-0001"]);
  await rpc(alice, "create_variation", { p_project: proj, p: { title: "Extra steel", amount: 4820000 } });
  assert.equal((await as(sam, "select * from variations")).length, 0);
  assert.equal((await as(sam, "select * from audit_events where record_type = 'variation'")).length, 0);
  assert.equal((await as(alice, "select * from variations")).length, 1);
});

test("defect workflow: evidence and an authorised reviewer are required to close", async () => {
  await assert.rejects(rpc(sam, "defect_action", { p_defect: defectId, p_type: "submit_for_verification", p: { note: "Relapped", evidence: [] } }), /completion photo/);
  await rpc(sam, "defect_action", { p_defect: defectId, p_type: "start_rectification", p: {} });
  await rpc(sam, "defect_action", { p_defect: defectId, p_type: "submit_for_verification", p: { note: "Relapped", evidence: [`${org}/fix.jpg`] } });
  await assert.rejects(rpc(sam, "defect_action", { p_defect: defectId, p_type: "verify", p: {} }), /can't verify/);
  await assert.rejects(rpc(alice, "defect_action", { p_defect: defectId, p_type: "reject", p: { reason: "" } }), /Give a reason/);
  const r = await rpc(alice, "defect_action", { p_defect: defectId, p_type: "verify", p: {} });
  assert.match(r.message, /verified and closed/);
  const hist = await as(alice, "select action from audit_events where record_id = $1 order by id", [defectId]);
  assert.deepEqual(hist.map((h) => h.action), ["Defect raised", "Assigned", "Rectification started", "Submitted for verification", "Verified and closed"]);
});

test("variation approval respects the PM's $50k limit and can't be approved twice", async () => {
  const big = (await rpc(alice, "create_variation", { p_project: proj, p: { title: "Rock", amount: 16200000 } })).id;
  await assert.rejects(rpc(pete, "variation_action", { p_variation: big, p_type: "approve" }), /delegated limit of \$50,000/);
  const small = (await as(alice, "select id from variations where title = 'Extra steel'"))[0].id;
  await rpc(pete, "variation_action", { p_variation: small, p_type: "approve" });
  await assert.rejects(rpc(pete, "variation_action", { p_variation: small, p_type: "approve" }), /Can't approve/);
  await rpc(alice, "variation_action", { p_variation: big, p_type: "approve" });
  await assert.rejects(rpc(sam, "variation_action", { p_variation: big, p_type: "include_in_claim" }), /can't do that/);
});

test("worker sign-in names the exact blocker and is refused until met", async () => {
  const w = (await rpc(alice, "create_worker", { p_org: org, p: { name: "Will Worker", contractor_id: sub, white_card: "WC1" } })).id;
  await rpc(alice, "invite_member", { p_org: org, p_email: "will@solid.test", p_role: "worker", p_title: "Concreter", p_worker: w });
  await rpc(will, "accept_invitations", {});
  await assert.rejects(rpc(will, "site_sign_in", { p_project: proj }), /Site induction — not yet inducted/);
  await rpc(alice, "record_induction", { p_worker: w, p_project: proj });
  const swms = (await q("insert into swms (org_id, project_id, ref, title, contractor_id, version, status) values ($1,$2,'SWMS-01','Waterproofing',$3,2,'approved') returning id", [org, proj, sub])).rows[0].id;
  await assert.rejects(rpc(will, "site_sign_in", { p_project: proj }), /SWMS · Waterproofing v2 — needs signing/);
  await rpc(will, "swms_acknowledge", { p_swms: swms });
  assert.match((await rpc(will, "site_sign_in", { p_project: proj })).message, /signed in/);
  await assert.rejects(rpc(alice, "site_sign_in", { p_project: proj }), /Only workers/);
});

test("hold points need evidence and an authorised releaser; release unblocks but doesn't complete the task", async () => {
  const itp = (await q("insert into itps (org_id, project_id, ref, title) values ($1,$2,'ITP-01','Slab') returning id", [org, proj])).rows[0].id;
  const task = (await q("insert into tasks (org_id, project_id, name, status, itp_id) values ($1,$2,'Pour','blocked',$3) returning id", [org, proj, itp])).rows[0].id;
  await q("update itps set task_id = $1 where id = $2", [task, itp]);
  const pt = (await q("insert into itp_points (org_id, itp_id, name, type, status, evidence) values ($1,$2,'Reo','hold','submitted',4) returning id", [org, itp])).rows[0].id;
  await assert.rejects(rpc(sam, "itp_point_action", { p_point: pt, p_decision: "release" }), /can't sign off/);
  await rpc(pete, "itp_point_action", { p_point: pt, p_decision: "release" });
  const t = (await q("select status from tasks where id = $1", [task])).rows[0];
  assert.equal(t.status, "not_started");
});

test("diary can't be submitted twice for the same day", async () => {
  await rpc(alice, "submit_diary", { p_project: proj, p_weather: "Fine", p_notes: "Reo placed", p_delays: "", p_date: "2026-10-22" });
  await assert.rejects(rpc(alice, "submit_diary", { p_project: proj, p_weather: "Fine", p_notes: "Again", p_delays: "", p_date: "2026-10-22" }), /already submitted/);
});

test("roles can be changed by admins only; admins can't demote themselves", async () => {
  await assert.rejects(rpc(alice, "update_member", { p_org: org, p_user: alice.id, p_role: "director", p_title: "", p_is_admin: false }), /own admin/);
  await rpc(alice, "update_member", { p_org: org, p_user: pete.id, p_role: "site_supervisor", p_title: "Super", p_is_admin: false });
  await assert.rejects(rpc(pete, "variation_action", { p_variation: "00000000-0000-0000-0000-000000000000", p_type: "approve" }), /not found/);
});

test("photo storage is limited to your own company's folder", async () => {
  await q("insert into storage.buckets values ('photos','photos',false) on conflict do nothing");
  await as(alice, "insert into storage.objects (bucket_id, name) values ('photos', $1)", [`${org}/x.jpg`]);
  await assert.rejects(as(bob, "insert into storage.objects (bucket_id, name) values ('photos', $1)", [`${org}/y.jpg`]), /row-level security/);
  assert.equal((await as(bob, "select * from storage.objects")).length, 0);
});

test("sample data only loads into an empty company", async () => {
  await assert.rejects(rpc(alice, "import_sample_data", { p_org: org, p: {} }), /no projects yet/);
  const c = crypto.randomUUID(), p = crypto.randomUUID();
  await rpc(bob, "import_sample_data", { p_org: org2, p: {
    contractors: [{ id: c, legal_name: "A", trading_name: "A", trade: "Tiling" }],
    projects: [{ id: p, code: "S-1", name: "Sample", contract_sum: 100, next_milestone_name: "PC", next_milestone_date: "2027-01-01" }],
    audit_events: [{ project_id: p, record_type: "project", record_id: p, action: "Loaded" }],
  } });
  assert.equal((await as(bob, "select name from projects")).map((r) => r.name).join(), "Sample");
  assert.equal((await as(alice, "select * from projects where org_id = $1", [org2])).length, 0);
});
