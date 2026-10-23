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


let dir, pm, pm2, sup, sub, wk, outsider, org, p1, p2, con, w;
const see = async (u, sql, args = []) => (await as(u, sql, args)).length;
before(async () => {
  await q("truncate public.organisations cascade; delete from auth.users; delete from storage.objects");
  dir = await signUp("dir@pa.test", "Dee Director"); pm = await signUp("pm@pa.test", "Pat PM"); pm2 = await signUp("pm2@pa.test", "Penny PM");
  sup = await signUp("sup@pa.test", "Sue Super"); sub = await signUp("sub@pa.test", "Sid Sub"); wk = await signUp("wk@pa.test", "Wes Worker"); outsider = await signUp("out@pa.test", "Olly Out");
  org = (await rpc(dir, "create_organisation", { p_name: "PA Co" })).id;
  await rpc(outsider, "create_organisation", { p_name: "Other Co" });
  p1 = (await rpc(dir, "create_project", { p_org: org, p: { name: "Tower One", code: "T1" } })).id;
  p2 = (await rpc(dir, "create_project", { p_org: org, p: { name: "Tower Two", code: "T2" } })).id;
  con = (await rpc(dir, "create_contractor", { p_org: org, p: { trading_name: "Pour Co" } })).id;
  w = (await rpc(dir, "create_worker", { p_org: org, p: { name: "Wes Worker", contractor_id: con, inducted_project_id: p1 } })).id;
  for (const [u, email, role, c, wid] of [[pm, "pm@pa.test", "project_manager"], [pm2, "pm2@pa.test", "project_manager"], [sup, "sup@pa.test", "site_supervisor"], [sub, "sub@pa.test", "subcontractor_admin", con], [wk, "wk@pa.test", "worker", null, w]]) {
    await rpc(dir, "invite_member", { p_org: org, p_email: email, p_role: role, p_title: "", p_contractor: c ?? null, p_worker: wid ?? null });
    await rpc(u, "accept_invitations", {});
  }
});
after(() => pool.end());

test("by default everyone in the company sees every project (no change for existing companies)", async () => {
  for (const u of [pm, pm2, sup]) assert.equal(await see(u, "select id from projects"), 2);
  assert.equal(await see(outsider, "select id from projects where org_id = $1", [org]), 0);
});

test("only admins switch to assigned access; then people see only their projects", async () => {
  await assert.rejects(rpc(pm, "set_project_access", { p_org: org, p_mode: "assigned" }), /Only company admins/);
  await rpc(dir, "set_project_access", { p_org: org, p_mode: "assigned" });
  assert.equal(await see(dir, "select id from projects"), 2, "directors see everything");
  for (const u of [pm, pm2, sup]) assert.equal(await see(u, "select id from projects"), 0, "nobody else until added");
  await rpc(dir, "set_project_members", { p_project: p1, p_users: `{${[pm.id, sup.id].join(",")}}` });
  await rpc(dir, "set_project_members", { p_project: p2, p_users: `{${[pm2.id].join(",")}}` });
  assert.deepEqual((await as(pm, "select id from projects")).map((r) => r.id), [p1]);
  assert.deepEqual((await as(pm2, "select id from projects")).map((r) => r.id), [p2]);
  assert.equal(await see(sup, "select user_id from project_members where project_id = $1", [p2]), 0, "can't see another project's team");
});

test("records on hidden projects are hidden too — including records under a parent (ITP points)", async () => {
  await rpc(pm2, "create_location", { p_project: p2, p_building: "A", p_level: "L1", p_zone: "" });
  const loc = (await q("select id from locations where project_id = $1", [p2])).rows[0].id;
  await rpc(pm2, "create_defect", { p: { project_id: p2, title: "Hidden crack", location_id: loc } });
  const tpl = (await rpc(dir, "create_itp_template", { p_org: org, p: { name: "Slab", points: [{ name: "Reo", type: "hold", check: "Cover" }] } })).id;
  await rpc(pm2, "apply_itp_template", { p_template: tpl, p_project: p2, p_task: null });
  assert.equal(await see(pm, "select id from defects where title = 'Hidden crack'"), 0);
  assert.equal(await see(pm2, "select id from defects where title = 'Hidden crack'"), 1);
  assert.equal(await see(pm, "select p.id from itp_points p join itps i on i.id = p.itp_id where i.project_id = $1", [p2]), 0);
  assert.equal(await see(pm, "select id from itp_points"), 0);
  assert.ok(await see(pm2, "select id from itp_points") > 0);
  assert.equal(await see(pm, "select id from audit_events where project_id = $1", [p2]), 0, "history of a hidden project is hidden");
});

test("writes to a hidden project are refused by the database, whichever function is used", async () => {
  await assert.rejects(rpc(pm, "create_location", { p_project: p2, p_building: "A", p_level: "L9", p_zone: "" }), /don't have access to that project/);
  const loc = (await q("select id from locations where project_id = $1 limit 1", [p2])).rows[0].id;
  await assert.rejects(rpc(pm, "create_defect", { p: { project_id: p2, title: "Sneaky", location_id: loc } }), /don't have access|isn't on this project|not found/);
  await assert.rejects(rpc(pm, "set_project_members", { p_project: p2, p_users: `{${[pm.id].join(",")}}` }), /don't have access/);
  await assert.rejects(rpc(sup, "set_project_members", { p_project: p1, p_users: `{${[sup.id].join(",")}}` }), /can't do that/);
  await assert.rejects(rpc(pm, "set_project_members", { p_project: p1, p_users: `{${[outsider.id].join(",")}}` }), /must be in the company/);
});

test("subcontractors see projects their company works on; workers see projects they're inducted on", async () => {
  assert.deepEqual((await as(wk, "select id from projects")).map((r) => r.id), [p1]);
  assert.equal(await see(sub, "select id from projects"), 1, "Pour Co's worker is inducted on Tower One");
  await rpc(dir, "create_task", { p_project: p2, p: { name: "Pour", forecast_start: "2030-01-10", forecast_finish: "2030-01-11", contractor_id: con } });
  assert.equal(await see(sub, "select id from projects"), 2, "a task on Tower Two brings the company onto it");
});

test("whoever creates a project is on its team; switching back shows everyone everything", async () => {
  const p3 = (await rpc(pm, "create_project", { p_org: org, p: { name: "Tower Three", code: "T3" } })).id;
  assert.ok((await as(pm, "select id from projects")).some((r) => r.id === p3));
  assert.ok(!(await as(pm2, "select id from projects")).some((r) => r.id === p3));
  await rpc(dir, "set_project_access", { p_org: org, p_mode: "all" });
  assert.equal(await see(pm2, "select id from projects"), 3);
});
