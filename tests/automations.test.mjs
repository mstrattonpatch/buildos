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


const API = "http://localhost:54321";
const ymdOff = (d) => new Date(Date.now() + d * 86400000).toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
const notes = async (u) => (await as(u, "select kind, title, link from notifications order by created_at")).map((r) => r);
const runAll = async () => (await q("select run_automations() as r")).rows[0].r;
let dir, sup, qm, sub, wk, org, proj, con, w, itp;
before(async () => {
  await q("truncate public.organisations cascade; delete from auth.users; delete from storage.objects; delete from public.jobs");
  dir = await signUp("dir@au.test", "Dee Director"); sup = await signUp("sup@au.test", "Sue Super"); qm = await signUp("qm@au.test", "Quinn QM");
  sub = await signUp("sub@au.test", "Sid Sub"); wk = await signUp("wk@au.test", "Wes Worker");
  org = (await rpc(dir, "create_organisation", { p_name: "Auto Co" })).id;
  proj = (await rpc(dir, "create_project", { p_org: org, p: { name: "Tower", code: "T1" } })).id;
  con = (await rpc(dir, "create_contractor", { p_org: org, p: { trading_name: "Pour Co" } })).id;
  w = (await rpc(dir, "create_worker", { p_org: org, p: { name: "Wes Worker", contractor_id: con, inducted_project_id: proj } })).id;
  for (const [u, email, role, c, wid] of [[sup, "sup@au.test", "site_supervisor"], [qm, "qm@au.test", "quality_manager"], [sub, "sub@au.test", "subcontractor_admin", con], [wk, "wk@au.test", "worker", null, w]]) {
    await rpc(dir, "invite_member", { p_org: org, p_email: email, p_role: role, p_title: "", p_contractor: c ?? null, p_worker: wid ?? null });
    await rpc(u, "accept_invitations", {});
  }
});
after(() => pool.end());

test("every audited change also becomes an event; only admins read events", async () => {
  await rpc(dir, "create_location", { p_project: proj, p_building: "A", p_level: "L1", p_zone: "" });
  const loc = (await q("select id from locations where project_id = $1", [proj])).rows[0].id;
  const d = await rpc(sup, "create_defect", { p: { project_id: proj, title: "Crack", location_id: loc, contractor_id: con, due_date: ymdOff(5) } });
  const ev = (await q("select type, actor_id from events where subject_id = $1", [d.id])).rows;
  assert.ok(ev.length >= 1 && ev.every((e) => e.type.startsWith("defect.")), JSON.stringify(ev));
  assert.equal(ev[0].actor_id, sup.id);
  assert.ok((await as(dir, "select id from events")).length > 0);
  assert.equal((await as(sup, "select id from events")).length, 0);
});

test("expiring ticket: worker, their company admin and people managers are told once; never twice", async () => {
  await rpc(sup, "add_credential", { p_worker: w, p: { type: "Working at heights", number: "WAH-1", expires: ymdOff(10), file_path: `${org}/x.jpg`, sighted: true, method: "Original sighted" } });
  const r = await runAll();
  assert.ok(r.notifications >= 4, JSON.stringify(r));
  for (const u of [wk, sub, dir, sup]) assert.ok((await notes(u)).some((n) => n.kind === "credential_expiring" && /Working at heights for Wes Worker expires/.test(n.title)), u.email);
  assert.equal((await notes(qm)).filter((n) => n.kind === "credential_expiring").length, 0, "quality manager doesn't manage people");
  const again = await runAll();
  assert.equal(again.notifications, 0, "nothing new on the second run");
  assert.equal(Number((await q("select count(*) from automation_runs where rule = 'credential_expiring'")).rows[0].count), 1);
});

test("rules can be switched off and tuned by admins only", async () => {
  await assert.rejects(rpc(sup, "set_automation", { p_org: org, p_rule: "credential_expiring", p_enabled: false, p_days: null }), /Only company admins/);
  await rpc(dir, "set_automation", { p_org: org, p_rule: "credential_expiring", p_enabled: true, p_days: 5 });
  await rpc(sup, "add_credential", { p_worker: w, p: { type: "First aid", number: "FA-1", expires: ymdOff(8), file_path: `${org}/y.jpg`, sighted: true, method: "Original sighted" } });
  assert.equal((await runAll()).notifications, 0, "8 days away is outside a 5-day warning");
  await rpc(dir, "set_automation", { p_org: org, p_rule: "credential_expiring", p_enabled: false, p_days: 30 });
  assert.equal((await runAll()).notifications, 0, "switched off");
  await rpc(dir, "set_automation", { p_org: org, p_rule: "credential_expiring", p_enabled: true, p_days: 30 });
  assert.ok((await runAll()).notifications > 0, "back on with 30 days catches it");
});

test("overdue defect: the responsible company's admin and defect assigners are told", async () => {
  const d = (await q("select id from defects limit 1")).rows[0].id;
  await q("update defects set due_date = $1, status = 'assigned' where id = $2", [ymdOff(-2), d]);
  const r = await runAll();
  assert.ok(r.notifications >= 3, JSON.stringify(r));
  for (const u of [sub, dir, sup, qm]) assert.ok((await notes(u)).some((n) => n.kind === "defect_overdue"), u.email);
  assert.equal((await notes(wk)).filter((n) => n.kind === "defect_overdue").length, 0);
  assert.equal((await runAll()).notifications, 0);
});

test("hold point submitted: people who can release it are told, never the person who submitted it", async () => {
  const tpl = (await rpc(dir, "create_itp_template", { p_org: org, p: { name: "Slab", points: [{ name: "Reo cover", type: "hold", check: "40 mm cover" }] } })).id;
  itp = (await rpc(dir, "apply_itp_template", { p_template: tpl, p_project: proj, p_task: null })).id;
  const pt = (await q("select id from itp_points where itp_id = $1 order by seq limit 1", [itp])).rows[0].id;
  await rpc(qm, "submit_itp_point", { p_point: pt, p: { photos: [] } });
  await runAll();
  assert.ok((await notes(dir)).some((n) => n.kind === "hold_point_submitted" && /Hold point waiting: Reo cover/.test(n.title)));
  assert.equal((await notes(qm)).filter((n) => n.kind === "hold_point_submitted").length, 0, "not the submitter");
  assert.equal((await notes(sup)).filter((n) => n.kind === "hold_point_submitted").length, 0, "supervisors can't release holds");
});

test("people mark their own notifications read; nobody sees anyone else's", async () => {
  const mine = await as(dir, "select id from notifications");
  assert.ok(mine.length > 0);
  assert.equal((await as(sup, "select id from notifications where user_id = $1", [dir.id])).length, 0);
  await rpc(dir, "mark_notifications_read", { p_ids: null });
  assert.equal((await as(dir, "select id from notifications where read_at is null")).length, 0);
});

test("jobs: one email job per notification; retries back off, then dead; only admins retry; people can't run the queue", async () => {
  const n = Number((await q("select count(*) from notifications")).rows[0].count);
  assert.equal(Number((await q("select count(*) from jobs where type = 'notification.email'")).rows[0].count), n);
  await assert.rejects(as(sup, "select * from claim_jobs('notification.email', 5)"), /permission denied/);
  await assert.rejects(as(dir, "select run_automations()"), /permission denied/);
  const [j] = (await q("select * from claim_jobs('notification.email', 1)")).rows;
  await q("select fail_job($1, 'boom')", [j.id]);
  let row = (await q("select status, attempts, run_after > now() later from jobs where id = $1", [j.id])).rows[0];
  assert.deepEqual([row.status, row.attempts, row.later], ["failed", 1, true]);
  assert.equal((await q("select * from claim_jobs('notification.email', 100) where id = $1", [j.id])).rows.length, 0, "not before its retry time");
  await q("update jobs set attempts = max_attempts - 1, run_after = now() where id = $1", [j.id]);
  await q("select id from claim_jobs('notification.email', 100)"); await q("update jobs set status = 'queued' where status = 'running' and id <> $1", [j.id]);
  await q("select fail_job($1, 'boom again')", [j.id]);
  assert.equal((await q("select status from jobs where id = $1", [j.id])).rows[0].status, "dead");
  await assert.rejects(rpc(sup, "retry_job", { p_id: j.id }), /Only company admins/);
  await rpc(dir, "retry_job", { p_id: j.id });
  assert.equal((await q("select status from jobs where id = $1", [j.id])).rows[0].status, "queued");
  assert.ok((await as(dir, "select id from jobs")).length > 0); assert.equal((await as(sup, "select id from jobs")).length, 0);
});

test("worker: refuses calls without its secret, emails each notification once, records failures", async () => {
  assert.equal((await fetch(`${API}/functions/v1/worker`, { method: "POST" })).status, 401);
  await q("update notifications set read_at = null");
  await q("update profiles set email = 'bounce@au.test' where id = $1", [qm.id]);
  await fetch(`${API}/__mail`, { method: "POST" });
  const call = () => fetch(`${API}/functions/v1/worker`, { method: "POST", headers: { "x-worker-secret": "test-worker-secret" } }).then((r) => r.json());
  let out = await call();
  for (let i = 0; i < 5 && (await q("select count(*) from jobs where status in ('queued')")).rows[0].count > 0; i++) out = await call();
  const mail = await (await fetch(`${API}/__mail`)).json();
  assert.ok(mail.length >= 5, `emails sent: ${mail.length}`);
  assert.ok(mail.some((m) => m.to === "wk@au.test" && /Working at heights/.test(m.subject) && /#\/app\/people\/workers\//.test(m.text)));
  assert.ok(!mail.some((m) => m.to === "bounce@au.test"));
  assert.ok(Number((await q("select count(*) from jobs where status = 'failed' and error like '%invalid address%'")).rows[0].count) >= 1);
  const before = mail.length; await call();
  assert.equal((await (await fetch(`${API}/__mail`)).json()).length, before, "running again sends nothing new");
  assert.ok(out.automations && typeof out.jobs.done === "number");
});
