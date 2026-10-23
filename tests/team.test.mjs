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



let pm, sup, sub, wk, org, other, proj, w;
before(async () => {
  await q("truncate public.organisations cascade; delete from auth.users");
  pm = await signUp("pm@tm.test", "Pat PM"); sup = await signUp("sup@tm.test", "Sue Super"); sub = await signUp("sub@tm.test", "Sid Sub"); wk = await signUp("wk@tm.test", "Wes Worker");
  const out = await signUp("out@tm.test", "Olly Outsider");
  org = (await rpc(pm, "create_organisation", { p_name: "TM Co" })).id;
  other = (await rpc(out, "create_organisation", { p_name: "Other Co" })).id;
  proj = (await rpc(pm, "create_project", { p_org: org, p: { name: "P", code: "P1" } })).id;
  const con = (await rpc(pm, "create_contractor", { p_org: org, p: { trading_name: "Pour Co" } })).id;
  w = (await rpc(pm, "create_worker", { p_org: org, p: { name: "Wes Worker", contractor_id: con } })).id;
  for (const [u, email, role, c, wid] of [[sup, "sup@tm.test", "site_supervisor"], [sub, "sub@tm.test", "subcontractor_admin", con], [wk, "wk@tm.test", "worker", null, w]]) {
    await rpc(pm, "invite_member", { p_org: org, p_email: email, p_role: role, p_title: "", p_contractor: c ?? null, p_worker: wid ?? null });
    await rpc(u, "accept_invitations", {});
  }
  globalThis.out = out;
});
after(() => pool.end());

test("chat: members post, outsiders can't, photos must be the company's", async () => {
  await rpc(wk, "post_message", { p_project: proj, p_body: "Concrete truck is 20 min late" });
  await assert.rejects(rpc(wk, "post_message", { p_project: proj, p_body: "  " }), /Write a message/);
  await assert.rejects(rpc(globalThis.out, "post_message", { p_project: proj, p_body: "hi" }), /not a member/);
  await assert.rejects(rpc(wk, "post_message", { p_project: proj, p_body: "x", p_photos: [`${other}/a.jpg`] }), /company's storage/);
  await rpc(sub, "post_message", { p_project: proj, p_body: "", p_photos: [`${org}/a.jpg`] });
  assert.equal((await as(globalThis.out, "select * from messages")).length, 0);
  assert.equal((await as(sup, "select * from messages")).length, 2);
  await rpc(sup, "mark_chat_read", { p_project: proj });
  assert.equal((await as(sup, "select * from chat_reads")).length, 1);
  assert.equal((await as(pm, "select * from chat_reads")).length, 0, "read markers are private");
});

test("tasks: given by supervisors, done with photos, checked by someone else", async () => {
  await assert.rejects(rpc(wk, "create_site_task", { p_project: proj, p: { title: "x", assignee_id: sup.id } }), /can't do that/);
  await assert.rejects(rpc(sup, "create_site_task", { p_project: proj, p: { title: "Clean up L2", assignee_id: globalThis.out.id } }), /Choose who/);
  const t = await rpc(sup, "create_site_task", { p_project: proj, p: { title: "Clean up L2 slab edge", assignee_id: wk.id, photos_required: 1, due_date: "2099-01-01" } });
  assert.match(t.message, /T-001 sent to Wes Worker's phone/);
  assert.match((await q("select body from messages where task_id = $1", [t.id])).rows[0].body, /gave Wes Worker a task: Clean up L2 slab edge · due 1 Jan/);
  await assert.rejects(rpc(sub, "site_task_action", { p_task: t.id, p_action: "submit", p: { note: "done" } }), /Only the person/);
  await assert.rejects(rpc(wk, "site_task_action", { p_task: t.id, p_action: "submit", p: { note: "done" } }), /at least 1 photo/);
  await rpc(wk, "site_task_action", { p_task: t.id, p_action: "submit", p: { note: "Swept", photos: [`${org}/x.jpg`] } });
  await assert.rejects(rpc(wk, "site_task_action", { p_task: t.id, p_action: "accept" }), /Only the person who gave/);
  await assert.rejects(rpc(sup, "site_task_action", { p_task: t.id, p_action: "send_back" }), /what still needs doing/);
  await rpc(sup, "site_task_action", { p_task: t.id, p_action: "send_back", p: { note: "Rubbish still at grid C" } });
  let row = (await q("select status, sent_back from site_tasks where id = $1", [t.id])).rows[0];
  assert.deepEqual([row.status, row.sent_back], ["open", 1]);
  await rpc(wk, "site_task_action", { p_task: t.id, p_action: "submit", p: { photos: [`${org}/y.jpg`] } });
  assert.match((await rpc(pm, "site_task_action", { p_task: t.id, p_action: "accept" })).message, /T-001 accepted/);
  const self = await rpc(pm, "create_site_task", { p_project: proj, p: { title: "Sign SWMS", assignee_id: sup.id } });
  await rpc(sup, "site_task_action", { p_task: self.id, p_action: "submit", p: { note: "Signed" } });
  await assert.rejects(rpc(sup, "site_task_action", { p_task: self.id, p_action: "accept" }), /Someone else needs to check/);
});

test("tasks link to records on the same project only", async () => {
  const p2 = (await rpc(pm, "create_project", { p_org: org, p: { name: "P2", code: "P2" } })).id;
  const loc = (await q("insert into locations (org_id, project_id, building, level, zone) values ($1, $2, 'A', 'L1', 'Z') returning id", [org, p2])).rows[0].id;
  const d = (await rpc(sup, "create_defect", { p: { project_id: p2, title: "Chipped tile", location_id: loc, trade: "Tiling", priority: "low" } })).id;
  await assert.rejects(rpc(sup, "create_site_task", { p_project: proj, p: { title: "Fix", assignee_id: wk.id, defect_id: d } }), /isn't on this project/);
  assert.ok((await rpc(sup, "create_site_task", { p_project: p2, p: { title: "Fix tile", assignee_id: wk.id, defect_id: d } })).id);
});

test("site notes: anyone sends, supervisor accepts; late additions flagged", async () => {
  const n1 = (await rpc(wk, "send_site_note", { p_project: proj, p_body: "Crane down 10–11 am for wind" })).id;
  await assert.rejects(rpc(wk, "send_site_note", { p_project: proj, p_body: "x", p_date: "2000-01-01" }), /last 7 days/);
  await assert.rejects(rpc(wk, "site_note_action", { p_note: n1, p_action: "accept" }), /can't do that/);
  assert.match((await rpc(sup, "site_note_action", { p_note: n1, p_action: "accept" })).message, /^Added to the .* diary\.$/);
  await assert.rejects(rpc(sup, "site_note_action", { p_note: n1, p_action: "dismiss" }), /already been reviewed/);
  await rpc(sup, "submit_diary", { p_project: proj, p_weather: "Windy", p_notes: "Pour went ahead", p_delays: "" });
  const n2 = (await rpc(sub, "send_site_note", { p_project: proj, p_body: "Pump hose split at 2 pm" })).id;
  assert.match((await rpc(sup, "site_note_action", { p_note: n2, p_action: "accept" })).message, /late addition/);
});
