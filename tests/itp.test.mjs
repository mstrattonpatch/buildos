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


let pm, qm, sup, sub, org, proj, task, tpl, itp, pts;
const POINTS = [
  { name: "Formwork", type: "inspection", check_text: "Dimensions and stability" },
  { name: "Reinforcement", type: "hold", check_text: "Bar size, spacing and cover", evidence_required: 2, measurement_label: "Cover (mm)", required_signoffs: 2 },
  { name: "Concrete delivery", type: "test", check_text: "Dockets and slump", evidence_required: 1 },
];
before(async () => {
  await q("truncate public.organisations cascade; delete from auth.users");
  pm = await signUp("pm@i.test", "Pat PM"); qm = await signUp("qm@i.test", "Quinn QM"); sup = await signUp("sup@i.test", "Sue Super"); sub = await signUp("sub@i.test", "Sid Sub");
  org = (await rpc(pm, "create_organisation", { p_name: "I Co" })).id;
  proj = (await rpc(pm, "create_project", { p_org: org, p: { name: "P", code: "P1" } })).id;
  const con = (await rpc(pm, "create_contractor", { p_org: org, p: { trading_name: "Pour Co", trade: "Concrete" } })).id;
  task = (await rpc(pm, "create_task", { p_project: proj, p: { name: "L4 slab pour", forecast_start: "2030-01-10", forecast_finish: "2030-01-10", contractor_id: con, trade: "Concrete" } })).id;
  for (const [u, email, role, extra] of [[qm, "qm@i.test", "quality_manager"], [sup, "sup@i.test", "site_supervisor"], [sub, "sub@i.test", "subcontractor_admin", con]]) {
    await rpc(pm, "invite_member", { p_org: org, p_email: email, p_role: role, p_title: "", p_contractor: extra ?? null });
    await rpc(u, "accept_invitations", {});
  }
});
after(() => pool.end());

test("templates: managers only, need points, names unique", async () => {
  await assert.rejects(rpc(sup, "create_itp_template", { p_org: org, p: { name: "X", points: POINTS } }), /can't do that/);
  await assert.rejects(rpc(pm, "create_itp_template", { p_org: org, p: { name: "Empty", points: [] } }), /at least one/);
  tpl = (await rpc(qm, "create_itp_template", { p_org: org, p: { name: "Concrete slab", trade: "Concrete", points: POINTS } })).id;
  await assert.rejects(rpc(pm, "create_itp_template", { p_org: org, p: { name: "concrete slab", points: POINTS } }), /already exists/);
});

test("applying a template copies points; later template edits don't change it", async () => {
  const r = await rpc(pm, "apply_itp_template", { p_template: tpl, p_project: proj, p_task: task });
  assert.match(r.message, /ITP-01 added from Concrete slab v1/);
  itp = r.id;
  pts = (await q("select * from itp_points where itp_id = $1 order by seq", [itp])).rows;
  assert.equal(pts.length, 3);
  assert.equal((await q("select itp_id from tasks where id = $1", [task])).rows[0].itp_id, itp);
  const u = await rpc(pm, "update_itp_template", { p_template: tpl, p: { name: "Concrete slab", points: [POINTS[0]] } });
  assert.match(u.message, /version 2/);
  assert.equal((await q("select count(*)::int n from itp_points where itp_id = $1", [itp])).rows[0].n, 3);
  assert.equal((await q("select template_version from itps where id = $1", [itp])).rows[0].template_version, 1);
});

test("points after an unreleased hold point can't be submitted", async () => {
  await assert.rejects(rpc(sup, "submit_itp_point", { p_point: pts[2].id, p: { photos: ["a"] } }), /Hold point "Reinforcement" must be released/);
});

test("evidence and measurement are required", async () => {
  await rpc(sup, "submit_itp_point", { p_point: pts[0].id, p: {} });
  await assert.rejects(rpc(sup, "submit_itp_point", { p_point: pts[1].id, p: { photos: ["a"] } }), /at least 2 photos/);
  await assert.rejects(rpc(sup, "submit_itp_point", { p_point: pts[1].id, p: { photos: ["a", "b"] } }), /Cover \(mm\)/);
  await rpc(sup, "submit_itp_point", { p_point: pts[1].id, p: { photos: [`${org}/1.jpg`, `${org}/2.jpg`], measurement: "40", note: "All good" } });
  await assert.rejects(rpc(sup, "submit_itp_point", { p_point: pts[1].id, p: { photos: ["a", "b"], measurement: "40" } }), /already submitted/);
});

test("supervisors can accept inspections but not hold points; subbies can't sign off", async () => {
  assert.match((await rpc(sup, "itp_point_action", { p_point: pts[0].id, p_decision: "release" })).message, /released/);
  await assert.rejects(rpc(sup, "itp_point_action", { p_point: pts[1].id, p_decision: "release" }), /can't sign off hold/);
  await assert.rejects(rpc(sub, "itp_point_action", { p_point: pts[1].id, p_decision: "release" }), /can't sign off/);
});

test("rejecting a hold point raises a defect and blocks the task", async () => {
  const r = await rpc(pm, "itp_point_action", { p_point: pts[1].id, p_decision: "reject", p_comment: "Cover only 30mm at grid C" });
  assert.match(r.message, /DEF-0001 raised and task flagged/);
  const d = (await q("select * from defects where itp_id = $1", [itp])).rows[0];
  assert.equal(d.category, "Failed inspection"); assert.equal(d.task_id, task); assert.equal(d.priority, "high"); assert.ok(d.contractor_id);
  assert.equal((await q("select status from tasks where id = $1", [task])).rows[0].status, "blocked");
});

test("two sign-offs needed; submitter can't release their own hold point; same person can't sign twice", async () => {
  await rpc(pm, "submit_itp_point", { p_point: pts[1].id, p: { photos: ["a", "b"], measurement: "45" } });
  await assert.rejects(rpc(pm, "itp_point_action", { p_point: pts[1].id, p_decision: "release" }), /another authorised person/);
  assert.match((await rpc(qm, "itp_point_action", { p_point: pts[1].id, p_decision: "release" })).message, /1 of 2/);
  await assert.rejects(rpc(qm, "itp_point_action", { p_point: pts[1].id, p_decision: "release" }), /already signed/);
  const dir = await signUp("dir@i.test", "Dee Director");
  await rpc(pm, "invite_member", { p_org: org, p_email: "dir@i.test", p_role: "director", p_title: "" });
  await rpc(dir, "accept_invitations", {});
  assert.match((await rpc(dir, "itp_point_action", { p_point: pts[1].id, p_decision: "release" })).message, /released/);
  assert.equal((await q("select status from tasks where id = $1", [task])).rows[0].status, "not_started", "task unblocked, not completed");
  await rpc(sub, "submit_itp_point", { p_point: pts[2].id, p: { photos: ["x"] } });
});

test("archived templates can't be applied", async () => {
  await rpc(pm, "archive_itp_template", { p_template: tpl });
  await assert.rejects(rpc(pm, "apply_itp_template", { p_template: tpl, p_project: proj }), /not found/);
});
