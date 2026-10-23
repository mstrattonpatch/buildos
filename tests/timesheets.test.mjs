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
  const r = await as(user, `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`, keys.map((k) => (args[k] !== null && typeof args[k] === "object" && !Array.isArray(args[k]) ? JSON.stringify(args[k]) : args[k])));
  return r[0].r;
};
async function signUp(email, name) {
  const r = await q("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id, email", [email, { full_name: name }]);
  return r.rows[0];
}


let pm, sup, sub, wk, org, proj, con, own, w, w2, staff;
const ymdOff = (o) => { const d = new Date(Date.now() + 10 * 3600e3); d.setUTCDate(d.getUTCDate() + o); return d.toISOString().slice(0, 10); };
const today = ymdOff(0), yday = ymdOff(-1);
before(async () => {
  await q("truncate public.organisations cascade; delete from auth.users");
  pm = await signUp("pm@ts.test", "Pat PM"); sup = await signUp("sup@ts.test", "Sue Super"); sub = await signUp("sub@ts.test", "Sid Sub"); wk = await signUp("wk@ts.test", "Wes Worker");
  org = (await rpc(pm, "create_organisation", { p_name: "TS Co" })).id;
  proj = (await rpc(pm, "create_project", { p_org: org, p: { name: "P", code: "P1" } })).id;
  con = (await rpc(pm, "create_contractor", { p_org: org, p: { trading_name: "Pour Co" } })).id;
  own = (await rpc(pm, "create_contractor", { p_org: org, p: { trading_name: "Other Co" } })).id;
  w = (await rpc(pm, "create_worker", { p_org: org, p: { name: "Wes Worker", contractor_id: con, white_card: "WC1" } })).id;
  w2 = (await rpc(pm, "create_worker", { p_org: org, p: { name: "Olly Other", contractor_id: own, white_card: "WC2" } })).id;
  const crew = (await rpc(pm, "create_contractor", { p_org: org, p: { trading_name: "TS Co own crew" } })).id;
  staff = (await rpc(pm, "create_worker", { p_org: org, p: { name: "Sue Staff", contractor_id: crew, white_card: "WC3" } })).id;
  for (const [u, email, role, c, wid] of [[sup, "sup@ts.test", "site_supervisor", null, staff], [sub, "sub@ts.test", "subcontractor_admin", con], [wk, "wk@ts.test", "worker", null, w]]) {
    await rpc(pm, "invite_member", { p_org: org, p_email: email, p_role: role, p_title: "", p_contractor: c ?? null, p_worker: wid ?? null });
    await rpc(u, "accept_invitations", {});
  }
});
after(() => pool.end());
const ts = (u, p) => rpc(u, "create_timesheet", { p_project: proj, p });

test("hours from start, finish and break, rounded to 15 minutes", async () => {
  const r = await ts(sup, { worker_id: w, date: yday, start_time: "06:58", end_time: "15:31", break_min: 30 });
  assert.match(r.message, /8 h for Wes Worker/);
  assert.equal(Number((await q("select hours from timesheets where id = $1", [r.id])).rows[0].hours), 8);
  await assert.rejects(ts(sup, { worker_id: w, date: yday, start_time: "15:00", end_time: "17:00" }), /overlap 15:00–17:00/);
  await assert.rejects(ts(sup, { worker_id: w, date: yday, start_time: "10:00", end_time: "09:00" }), /finish time must be after/);
  await assert.rejects(ts(sup, { worker_id: w, date: yday, start_time: "10:00", end_time: "10:20", break_min: 30 }), /break is longer/);
  await assert.rejects(ts(sup, { worker_id: w, date: ymdOff(2), hours: 8 }), /future/);
  await assert.rejects(ts(sup, { worker_id: w, date: yday, hours: 17 }), /more than 24 hours/);
  await assert.rejects(ts(sup, { worker_id: w, date: yday }), /start and finish times, or the hours/);
});

test("who can enter hours for whom", async () => {
  assert.match((await ts(wk, { worker_id: w, date: today, hours: 7.5 })).message, /7.5 h/);
  assert.equal((await q("select source from timesheets where worker_id = $1 and date = $2", [w, today])).rows[0].source, "site_app");
  await assert.rejects(ts(wk, { worker_id: w2, date: today, hours: 8 }), /only enter hours for yourself/);
  await assert.rejects(ts(sub, { worker_id: w2, date: today, hours: 8 }), /your own company/);
  await ts(sub, { worker_id: w, date: ymdOff(-2), hours: 4 });
});

test("subbies and workers only see their own; approvers see all", async () => {
  await ts(sup, { worker_id: w2, date: yday, hours: 8 });
  assert.equal((await as(wk, "select * from timesheets")).every((r) => r.worker_id === w), true);
  assert.equal((await as(sub, "select * from timesheets")).every((r) => r.worker_id === w), true);
  assert.ok((await as(sup, "select * from timesheets")).some((r) => r.worker_id === w2));
});

test("approve, reject with a reason, never your own", async () => {
  const mine = await ts(pm, { worker_id: staff, date: yday, hours: 8 });
  await assert.rejects(rpc(sup, "timesheet_action", { p_ids: [mine.id], p_action: "approve" }), /your own hours/);
  await assert.rejects(rpc(wk, "timesheet_action", { p_ids: [mine.id], p_action: "approve" }), /can't do that/);
  await assert.rejects(rpc(sup, "timesheet_action", { p_ids: [mine.id], p_action: "reject" }), /Say why/);
  await rpc(sup, "timesheet_action", { p_ids: [mine.id], p_action: "reject", p_reason: "Was on leave" });
  await rpc(pm, "update_timesheet", { p_ts: mine.id, p: { date: yday, hours: 4 } });
  assert.equal((await q("select status, reject_reason from timesheets where id = $1", [mine.id])).rows[0].status, "pending");
  const ids = (await q("select id from timesheets where status = 'pending' and worker_id <> $1", [staff])).rows.map((r) => r.id);
  assert.match((await rpc(sup, "timesheet_action", { p_ids: ids, p_action: "approve" })).message, /approved/);
  await assert.rejects(rpc(wk, "update_timesheet", { p_ts: ids[0], p: { date: today, hours: 1 } }), /can't be changed|can't change/);
});

test("process locks rates; resolution order; missing rates refused", async () => {
  const ids = (await q("select id from timesheets where status = 'approved'")).rows.map((r) => r.id);
  await assert.rejects(rpc(sup, "timesheet_action", { p_ids: ids, p_action: "process" }), /can't do that/);
  await assert.rejects(rpc(pm, "timesheet_action", { p_ids: ids, p_action: "process" }), /No rate is set up for .*Wes Worker/);
  const card = (await rpc(pm, "save_rate_card", { p_org: org, p_id: null, p: { name: "Labourer", cost_rate: 5000, charge_rate: 8000 } })).id;
  await rpc(pm, "set_rate_rule", { p_org: org, p: { worker_id: w, rate_card_id: card } });
  await rpc(pm, "set_rate_rule", { p_org: org, p: { worker_id: w2, cost_rate: 6000, charge_rate: 9000 } });
  await rpc(pm, "set_rate_rule", { p_org: org, p: { project_id: proj, worker_id: w, charge_rate: 9500 } });
  const r = (await q("select * from resolve_rate($1, $2, null)", [w, proj])).rows[0];
  assert.deepEqual([Number(r.cost_rate), Number(r.charge_rate), r.cost_source, r.charge_source], [5000, 9500, "Rate card: Labourer", "Job rate for this person"]);
  const msg = (await rpc(pm, "timesheet_action", { p_ids: ids, p_action: "process" })).message;
  assert.match(msg, /processed .* labour cost \$/);
  const c = (await q("select c.cost_rate, c.charge_rate from timesheet_costs c join timesheets t on t.id = c.timesheet_id where t.worker_id = $1 limit 1", [w])).rows[0];
  assert.deepEqual([Number(c.cost_rate), Number(c.charge_rate)], [5000, 9500]);
  await rpc(pm, "save_rate_card", { p_org: org, p_id: card, p: { name: "Labourer", cost_rate: 9999, charge_rate: 9999 } });
  assert.equal(Number((await q("select cost_rate from timesheet_costs c join timesheets t on t.id = c.timesheet_id where t.worker_id = $1 limit 1", [w])).rows[0].cost_rate), 5000, "processed rates stay locked");
  await rpc(pm, "set_rate_rule", { p_org: org, p: { cost_code: "LAB", charge_rate: 1 } });
  await rpc(pm, "set_rate_rule", { p_org: org, p: { cost_code: "LAB" } });
  assert.equal(Number((await q("select count(*) from rate_rules where cost_code = 'LAB'")).rows[0].count), 0, "empty rule removes it");
  await rpc(pm, "timesheet_action", { p_ids: ids.slice(0, 1), p_action: "unprocess" });
  assert.equal((await q("select status from timesheets where id = $1", [ids[0]])).rows[0].status, "approved");
});

test("rates and costs are hidden from supervisors and subbies", async () => {
  assert.equal((await as(sup, "select * from rate_cards")).length, 0);
  assert.equal((await as(sub, "select * from timesheet_costs")).length, 0);
  assert.ok((await as(pm, "select * from timesheet_costs")).length > 0);
});

test("one-off rate when processing", async () => {
  const id = (await ts(sup, { worker_id: staff, date: ymdOff(-3), hours: 6, billable: false })).id;
  await rpc(pm, "timesheet_action", { p_ids: [id], p_action: "approve" });
  await assert.rejects(rpc(pm, "timesheet_action", { p_ids: [id], p_action: "process" }), /Sue Staff/);
  await rpc(pm, "timesheet_action", { p_ids: [id], p_action: "process", p_cost: 4500 });
  const c = (await q("select * from timesheet_costs where timesheet_id = $1", [id])).rows[0];
  assert.deepEqual([Number(c.cost_rate), Number(c.charge_rate)], [4500, 0], "not billable → no chargeout");
});

test("timesheets from sign-ins", async () => {
  await q(`insert into attendance (org_id, project_id, worker_id, kind, at) values
    ($1, $2, $3, 'check_in', ($4::date + time '06:52') at time zone 'Australia/Sydney'),
    ($1, $2, $3, 'check_out', ($4::date + time '15:20') at time zone 'Australia/Sydney'),
    ($1, $2, $5, 'check_in', ($4::date + time '07:00') at time zone 'Australia/Sydney')`, [org, proj, w2, ymdOff(-5), w]);
  const m = (await rpc(sup, "timesheets_from_sign_ins", { p_project: proj, p_date: ymdOff(-5) })).message;
  assert.match(m, /1 timesheet created from sign-ins · 1 skipped \(no sign-out\)/);
  const t = (await q("select * from timesheets where worker_id = $1 and date = $2", [w2, ymdOff(-5)])).rows[0];
  assert.deepEqual([t.start_time, t.end_time, t.break_min, Number(t.hours), t.source], ["06:52:00", "15:20:00", 30, 8, "sign_in"]);
  assert.match((await rpc(sup, "timesheets_from_sign_ins", { p_project: proj, p_date: ymdOff(-5) })).message, /0 timesheets .* 1 already had hours/);
});

test("delete only while pending", async () => {
  const id = (await ts(wk, { worker_id: w, date: ymdOff(-6), hours: 2 })).id;
  await rpc(wk, "delete_timesheet", { p_ts: id });
  const done = (await q("select id from timesheets where status = 'processed' limit 1")).rows[0].id;
  await assert.rejects(rpc(pm, "delete_timesheet", { p_ts: done }), /Only pending or rejected/);
});
