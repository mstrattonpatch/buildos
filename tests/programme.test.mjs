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


let pm, sup, sub, org, proj, a, b, c;
before(async () => {
  await q("truncate public.organisations cascade; delete from auth.users");
  pm = await signUp("pm@b.test", "Pat Manager"); sup = await signUp("sup@b.test", "Sue Super"); sub = await signUp("sub@b.test", "Sid Sub");
  org = (await rpc(pm, "create_organisation", { p_name: "B Co" })).id;
  proj = (await rpc(pm, "create_project", { p_org: org, p: { name: "P", code: "P1" } })).id;
  const con = (await rpc(pm, "create_contractor", { p_org: org, p: { trading_name: "Sub Co" } })).id;
  await rpc(pm, "invite_member", { p_org: org, p_email: "sup@b.test", p_role: "site_supervisor", p_title: "" });
  await rpc(pm, "invite_member", { p_org: org, p_email: "sub@b.test", p_role: "subcontractor_admin", p_title: "", p_contractor: con });
  await rpc(sup, "accept_invitations", {}); await rpc(sub, "accept_invitations", {});
});
after(() => pool.end());

test("create tasks and a milestone; baseline is set from the forecast", async () => {
  a = (await rpc(pm, "create_task", { p_project: proj, p: { name: "Formwork", forecast_start: "2030-01-01", forecast_finish: "2030-01-07" } })).id;
  b = (await rpc(pm, "create_task", { p_project: proj, p: { name: "Reo", forecast_start: "2030-01-08", forecast_finish: "2030-01-10", predecessor_ids: [a] } })).id;
  c = (await rpc(pm, "create_task", { p_project: proj, p: { name: "Pour", is_milestone: true, forecast_start: "2030-01-11", forecast_finish: "2030-02-01", predecessor_ids: [b] } })).id;
  const t = (await q("select * from tasks where id = $1", [c])).rows[0];
  assert.equal(t.forecast_finish.toISOString().slice(0, 10), t.forecast_start.toISOString().slice(0, 10), "milestone finish = start");
  assert.equal(t.baseline_start.getTime(), t.forecast_start.getTime());
});

test("dates are validated", async () => {
  await assert.rejects(rpc(pm, "create_task", { p_project: proj, p: { name: "X", forecast_start: "2030-01-05", forecast_finish: "2030-01-01" } }), /before the start/);
  await assert.rejects(rpc(pm, "create_task", { p_project: proj, p: { name: "X" } }), /start date/);
});

test("dependency loops and self-links are refused", async () => {
  const base = { name: "Formwork", forecast_start: "2030-01-01", forecast_finish: "2030-01-07" };
  await assert.rejects(rpc(pm, "update_task", { p_task: a, p: { ...base, predecessor_ids: [c] } }), /loop/);
  await assert.rejects(rpc(pm, "update_task", { p_task: a, p: { ...base, predecessor_ids: [a] } }), /itself/);
});

test("predecessors must be on the same project", async () => {
  const p2 = (await rpc(pm, "create_project", { p_org: org, p: { name: "P2", code: "P2" } })).id;
  await assert.rejects(rpc(pm, "create_task", { p_project: p2, p: { name: "Y", forecast_start: "2030-01-01", forecast_finish: "2030-01-02", predecessor_ids: [a] } }), /same project/);
});

test("pushing the finish out needs a delay reason; baseline stays put", async () => {
  const p = { name: "Reo", forecast_start: "2030-01-08", forecast_finish: "2030-01-14", predecessor_ids: [a] };
  await assert.rejects(rpc(pm, "update_task", { p_task: b, p }), /add a delay reason/);
  assert.match((await rpc(pm, "update_task", { p_task: b, p: { ...p, delay_reason: "Wet weather 3 days" } })).message, /delay recorded/);
  const t = (await q("select * from tasks where id = $1", [b])).rows[0];
  assert.equal(t.baseline_finish.toISOString().slice(0, 10) < t.forecast_finish.toISOString().slice(0, 10), true);
  assert.equal(t.delay_reason, "Wet weather 3 days");
  const h = (await q("select action, detail from audit_events where record_id = $1 order by id desc limit 1", [b])).rows[0];
  assert.equal(h.action, "Task delayed");
  assert.match(h.detail, /reason: Wet weather/);
});

test("site supervisor can update progress but not edit the programme; subcontractor can do neither", async () => {
  await assert.rejects(rpc(sup, "update_task", { p_task: a, p: { name: "Z", forecast_start: "2030-01-01", forecast_finish: "2030-01-07" } }), /can't do that/);
  await rpc(sup, "update_task_progress", { p_task: a, p_progress: 40 });
  let t = (await q("select status, actual_start from tasks where id = $1", [a])).rows[0];
  assert.equal(t.status, "in_progress"); assert.ok(t.actual_start);
  await rpc(sup, "update_task_progress", { p_task: a, p_progress: 100 });
  t = (await q("select status, actual_finish from tasks where id = $1", [a])).rows[0];
  assert.equal(t.status, "complete"); assert.ok(t.actual_finish);
  await assert.rejects(rpc(sup, "update_task_progress", { p_task: b, p_progress: 10, p_blocked: true, p_note: "" }), /blocking/);
  assert.match((await rpc(sup, "update_task_progress", { p_task: b, p_progress: 10, p_blocked: true, p_note: "Crane down" })).message, /blocked/);
  await assert.rejects(rpc(sub, "update_task_progress", { p_task: b, p_progress: 50 }), /Only the site team/);
  await assert.rejects(rpc(sup, "update_task_progress", { p_task: b, p_progress: 120 }), /between 0 and 100/);
});

test("tasks with progress can't be deleted; deleting removes it from successors' links", async () => {
  await assert.rejects(rpc(pm, "delete_task", { p_task: a }), /progress recorded/);
  await rpc(pm, "update_task_progress", { p_task: b, p_progress: 0 });
  await rpc(pm, "delete_task", { p_task: b });
  const t = (await q("select predecessor_ids from tasks where id = $1", [c])).rows[0];
  assert.deepEqual(t.predecessor_ids, []);
});

test("re-baselining needs a reason and copies forecast to baseline", async () => {
  await assert.rejects(rpc(pm, "rebaseline_programme", { p_project: proj, p_reason: "" }), /reason/);
  await assert.rejects(rpc(sup, "rebaseline_programme", { p_project: proj, p_reason: "x" }), /can't do that/);
  assert.match((await rpc(pm, "rebaseline_programme", { p_project: proj, p_reason: "EOT 1 approved" })).message, /2 tasks/);
});
