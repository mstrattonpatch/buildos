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


let pm, sup, sub, wk, org, proj, con, w, gate, wcode;
before(async () => {
  await q("truncate public.organisations cascade; delete from auth.users; delete from public.gate_attempts");
  pm = await signUp("pm@sf.test", "Pat PM"); sup = await signUp("sup@sf.test", "Sue Super"); sub = await signUp("sub@sf.test", "Sid Sub"); wk = await signUp("wk@sf.test", "Wes Worker");
  org = (await rpc(pm, "create_organisation", { p_name: "SF Co" })).id;
  proj = (await rpc(pm, "create_project", { p_org: org, p: { name: "P", code: "P1" } })).id;
  con = (await rpc(pm, "create_contractor", { p_org: org, p: { trading_name: "Pour Co" } })).id;
  w = (await rpc(pm, "create_worker", { p_org: org, p: { name: "Wes Worker", contractor_id: con, white_card: "WC1" } })).id;
  for (const [u, email, role, c, wid] of [[sup, "sup@sf.test", "site_supervisor"], [sub, "sub@sf.test", "subcontractor_admin", con], [wk, "wk@sf.test", "worker", null, w]]) {
    await rpc(pm, "invite_member", { p_org: org, p_email: email, p_role: role, p_title: "", p_contractor: c ?? null, p_worker: wid ?? null });
    await rpc(u, "accept_invitations", {});
  }
  gate = (await q("select gate_code from projects where id = $1", [proj])).rows[0].gate_code;
  wcode = (await q("select worker_code from workers where id = $1", [w])).rows[0].worker_code;
});
after(() => pool.end());

test("every project and worker gets a code", () => { assert.match(gate, /^[0-9a-f]{18}$/); assert.match(wcode, /^\d{6}$/); });

test("NCR workflow: containment, root cause and corrective action, closed by someone else", async () => {
  await assert.rejects(rpc(sub, "create_ncr", { p_project: proj, p: { title: "x", requirement: "y" } }), /can't do that/);
  await assert.rejects(rpc(sup, "create_ncr", { p_project: proj, p: { title: "Cover short" } }), /requirement that was breached/);
  const n = (await rpc(sup, "create_ncr", { p_project: proj, p: { title: "Slab cover short", requirement: "S-201 note 4: 40 mm cover", contractor_id: con } })).id;
  await assert.rejects(rpc(sup, "advance_ncr", { p_ncr: n }), /containment/);
  await rpc(sup, "update_ncr", { p_ncr: n, p: { containment: "Pour stopped" } });
  await rpc(sup, "advance_ncr", { p_ncr: n });
  await assert.rejects(rpc(sup, "advance_ncr", { p_ncr: n }), /root cause/);
  await rpc(sub, "update_ncr", { p_ncr: n, p: { root_cause: "Chairs crushed", corrective_action: "Replace chairs, re-check cover" } });
  await rpc(sup, "advance_ncr", { p_ncr: n });
  await assert.rejects(rpc(sup, "advance_ncr", { p_ncr: n }), /other than the person who raised/);
  assert.match((await rpc(pm, "advance_ncr", { p_ncr: n })).message, /NCR-001 verified and closed/);
});

test("permits: requested by crew, approved by another authorised person, never self-issued", async () => {
  await assert.rejects(rpc(wk, "request_permit", { p_project: proj, p: { type: "Hot work", location: "L3", valid_from: "2030-01-02", valid_to: "2030-01-20" } }), /at most 7 days/);
  const p1 = (await rpc(sup, "request_permit", { p_project: proj, p: { type: "Hot work", location: "L3 riser", valid_from: "2030-01-02" } })).id;
  await assert.rejects(rpc(sup, "permit_action", { p_permit: p1, p_action: "approve" }), /another authorised person/);
  await assert.rejects(rpc(wk, "permit_action", { p_permit: p1, p_action: "approve" }), /authorised person/);
  await rpc(pm, "permit_action", { p_permit: p1, p_action: "approve" });
  await rpc(sup, "permit_action", { p_permit: p1, p_action: "close", p_note: "Fire watch done" });
  const p2 = (await rpc(sub, "request_permit", { p_project: proj, p: { type: "Working at heights", location: "Roof", valid_from: "2030-01-02", contractor_id: "00000000-0000-0000-0000-000000000000" } })).id;
  assert.equal((await q("select contractor_id from permits where id = $1", [p2])).rows[0].contractor_id, con, "subbie permits are for their own company");
  await assert.rejects(rpc(pm, "permit_action", { p_permit: p2, p_action: "reject" }), /Say why/);
});

test("incidents: anyone reports; closing needs a corrective action", async () => {
  const i = await rpc(wk, "report_incident", { p_project: proj, p: { type: "near_miss", title: "Pallet fell from hoist", severity: "high", notifiable: true } });
  assert.match(i.message, /INC-001 reported\. Notifiable/);
  await assert.rejects(rpc(wk, "incident_action", { p_incident: i.id, p_action: "close" }), /can't do that/);
  await assert.rejects(rpc(sup, "incident_action", { p_incident: i.id, p_action: "close" }), /corrective action/);
  await rpc(sup, "incident_action", { p_incident: i.id, p_action: "close", p: { corrective_action: "Load restraint check added to hoist SWMS" } });
  const o = await rpc(sub, "report_incident", { p_project: proj, p: { type: "observation", title: "Great housekeeping on L2" } });
  assert.match(o.message, /OBS-001/);
  await rpc(sup, "incident_action", { p_incident: o.id, p_action: "close" });
});

test("toolbox talks need attendees", async () => {
  await assert.rejects(rpc(sup, "record_toolbox_talk", { p_project: proj, p: { topic: "Hoist loading", attendees: [] } }), /who attended/);
  assert.match((await rpc(sup, "record_toolbox_talk", { p_project: proj, p: { topic: "Hoist loading", attendees: [w] } })).message, /1 attendee\./);
});

test("gate: anonymous worker flow with codes; requirements enforced", async () => {
  await assert.rejects(rpc(null, "gate_info", { p_code: "nope" }), /isn't valid/);
  assert.equal((await rpc(null, "gate_info", { p_code: gate })).project, "P");
  assert.match((await rpc(null, "gate_worker_status", { p_code: gate, p_worker_code: "000000x" })).error, /wasn't found/);
  assert.equal(Number((await q("select count(*) from gate_attempts where project_id = $1", [proj])).rows[0].count), 2, "wrong guesses still count");
  let st = await rpc(null, "gate_worker_status", { p_code: gate, p_worker_code: wcode });
  assert.equal(st.name, "Wes Worker");
  assert.deepEqual(st.blockers, ["Site induction — not yet inducted to this site"]);
  await assert.rejects(rpc(null, "gate_worker_action", { p_code: gate, p_worker_code: wcode, p_action: "sign_in" }), /induction/);
  await rpc(pm, "record_induction", { p_worker: w, p_project: proj });
  const sw = (await rpc(sub, "submit_swms", { p_project: proj, p: { title: "Pour", activity: "Pump", hazards: [{ hazard: "Boom", controls: "Spotter" }] } })).id;
  await rpc(pm, "swms_review", { p_swms: sw, p_decision: "approve" });
  st = await rpc(null, "gate_worker_status", { p_code: gate, p_worker_code: wcode });
  assert.equal(st.swms[0].hazards[0].controls, "Spotter");
  await rpc(null, "gate_worker_action", { p_code: gate, p_worker_code: wcode, p_action: "acknowledge", p_swms: sw });
  assert.match((await rpc(null, "gate_worker_action", { p_code: gate, p_worker_code: wcode, p_action: "sign_in" })).message, /signed in, Wes/);
  assert.equal((await rpc(null, "gate_worker_status", { p_code: gate, p_worker_code: wcode })).on_site, true);
  await rpc(null, "gate_worker_action", { p_code: gate, p_worker_code: wcode, p_action: "sign_out" });
});

test("gate: visitors sign in and out; must accept rules; anon can't read tables", async () => {
  await assert.rejects(rpc(null, "gate_visitor_sign_in", { p_code: gate, p: { name: "Vic", purpose: "Meeting" } }), /site rules/);
  const v = await rpc(null, "gate_visitor_sign_in", { p_code: gate, p: { name: "Vic Visitor", company: "Council", purpose: "Inspection", host: "Sue", rules_accepted: true } });
  assert.match(v.message, /Welcome, Vic/);
  assert.equal((await as(null, "select * from visitors")).length, 0, "anon can't list visitors");
  assert.equal((await as(sup, "select * from visitors")).length, 1);
  assert.equal((await as(sub, "select * from visitors")).length, 0, "subbies can't read visitor details");
  await rpc(null, "gate_visitor_sign_out", { p_code: gate, p_visitor: v.id });
  assert.match((await rpc(null, "gate_visitor_sign_out", { p_code: gate, p_visitor: v.id })).error, /Already/);
});

test("gate is rate-limited", async () => {
  await q("insert into gate_attempts (project_id) select $1 from generate_series(1, 60)", [proj]);
  await assert.rejects(rpc(null, "gate_info", { p_code: gate }), /Too many attempts/);
  await q("delete from gate_attempts");
});

test("manual sign-in needs a reason and still checks requirements; missing sign-outs are closed", async () => {
  const w2 = (await rpc(pm, "create_worker", { p_org: org, p: { name: "No Card", contractor_id: con } })).id;
  await assert.rejects(rpc(sup, "manual_sign_in", { p_project: proj, p_worker: w, p_reason: "" }), /reason/);
  await assert.rejects(rpc(sup, "manual_sign_in", { p_project: proj, p_worker: w2, p_reason: "No phone" }), /White Card/);
  await assert.rejects(rpc(sub, "manual_sign_in", { p_project: proj, p_worker: w, p_reason: "x" }), /can't do that/);
  assert.match((await rpc(sup, "manual_sign_in", { p_project: proj, p_worker: w, p_reason: "Phone flat" })).message, /signed in/);
  await q("update attendance set at = at - interval '1 day' where worker_id = $1", [w]);
  assert.match((await rpc(sup, "fix_missing_sign_outs", { p_project: proj })).message, /1 missing sign-out/);
  const out = (await q("select at from attendance where worker_id = $1 and override_reason = 'Missing sign-out recorded'", [w])).rows[0].at;
  assert.ok(out);
});

test("new gate code invalidates the old poster", async () => {
  await rpc(pm, "reset_gate_code", { p_project: proj });
  await assert.rejects(rpc(null, "gate_info", { p_code: gate }), /isn't valid/);
});
