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




let pm, sup, org;
before(async () => {
  await q("truncate public.organisations cascade; delete from auth.users");
  pm = await signUp("pm@es.test", "Pat PM"); sup = await signUp("sup@es.test", "Sue Super");
  org = (await rpc(pm, "create_organisation", { p_name: "ES Co" })).id;
  await rpc(pm, "invite_member", { p_org: org, p_email: "sup@es.test", p_role: "site_supervisor", p_title: "", p_contractor: null, p_worker: null });
  await rpc(sup, "accept_invitations", {});
});
after(() => pool.end());

test("estimate: items × rate, selected quote replaces a package, markup, versions, convert to a job", async () => {
  await assert.rejects(rpc(sup, "create_estimate", { p_org: org, p: { name: "x" } }), /can't do that/);
  const e = (await rpc(pm, "create_estimate", { p_org: org, p: { name: "12 Smith St", client: "J Smith", markup_pct: 20 } })).id;
  await assert.rejects(rpc(pm, "save_estimate", { p_estimate: e, p: { items: [{ description: "Slab", qty: 1, rate: 1 }] } }), /a category/);
  const r = await rpc(pm, "save_estimate", { p_estimate: e, p: { items: [
    { category: "Concrete", description: "Slab", qty: 120.5, unit: "m²", rate: 9500, qty_formula: "12.05*10" },
    { category: "Concrete", description: "Pump", qty: 1, rate: 150000 },
    { category: "Electrical", description: "Allowance", qty: 1, rate: 1000000 }],
    quotes: [{ category: "Electrical", supplier: "Sparky A", amount: 1200000 }, { category: "Electrical", supplier: "Sparky B", amount: 900000, selected: true }] } });
  // concrete 1,144,750 + 150,000 = 1,294,750; electrical 900,000 (quote) → cost 2,194,750; sell ×1.2 = 1,553,700 + 1,080,000 = 2,633,700
  assert.match(r.message, /EST-001 saved — \$26,337.00/);
  assert.equal((await as(sup, "select * from estimate_costs($1)", [e])).length, 0, "supervisors can't read estimate costs");
  await assert.rejects(rpc(pm, "save_estimate", { p_estimate: e, p: { quotes: [{ category: "E", supplier: "a", amount: 1, selected: true }, { category: "E", supplier: "b", amount: 1, selected: true }] } }), /one quote per trade package/);
  await assert.rejects(rpc(pm, "estimate_action", { p_estimate: e, p_action: "won" }), /sent first/);
  await rpc(pm, "estimate_action", { p_estimate: e, p_action: "send" });
  await assert.rejects(rpc(pm, "save_estimate", { p_estimate: e, p: { name: "y" } }), /locked/);
  const v2 = (await rpc(pm, "estimate_action", { p_estimate: e, p_action: "new_version" })).id;
  assert.equal((await q("select status from estimates where id = $1", [e])).rows[0].status, "superseded");
  assert.equal(Number((await q("select count(*) from estimate_items where estimate_id = $1", [v2])).rows[0].count), 3);
  await rpc(pm, "save_estimate", { p_estimate: v2, p: { markup_pct: 10 } });
  await rpc(pm, "estimate_action", { p_estimate: v2, p_action: "send" });
  await assert.rejects(rpc(pm, "estimate_action", { p_estimate: v2, p_action: "convert", p: { code: "J1" } }), /won/);
  await rpc(pm, "estimate_action", { p_estimate: v2, p_action: "won" });
  const c = await rpc(pm, "estimate_action", { p_estimate: v2, p_action: "convert", p: { code: "J1" } });
  // 2,194,750 × 1.1 = 2,414,225
  assert.match(c.message, /contract sum \$24,142.25, 2 budget lines/);
  const pr = (await q("select contract_sum from projects where id = $1", [c.id])).rows[0];
  assert.equal(Number(pr.contract_sum), 2414225);
  const sumItems = Number((await q("select sum(value) from contract_items where project_id = $1", [c.id])).rows[0].sum);
  assert.equal(sumItems, 2414225, "claim schedule adds up to the contract sum");
  assert.deepEqual((await q("select cost_code, description, original_budget from budget_lines where project_id = $1 order by cost_code", [c.id])).rows.map((x) => [x.cost_code, x.description, Number(x.original_budget)]), [["01", "Concrete", 1294750], ["02", "Electrical", 900000]]);
  await assert.rejects(rpc(pm, "estimate_action", { p_estimate: v2, p_action: "convert", p: { code: "J2" } }), /already a job/);
  globalThis.job = c.id;
});

test("assemblies need components", async () => {
  await assert.rejects(rpc(pm, "save_assembly", { p_org: org, p_id: null, p: { name: "Stud wall", components: [] } }), /at least one component/);
  assert.match((await rpc(pm, "save_assembly", { p_org: org, p_id: null, p: { name: "Stud wall", unit: "m²", category: "Framing", components: [{ description: "Studs", qty: 2.2, unit: "lm", rate: 650 }] } })).message, /Stud wall saved/);
});

test("handover: outstanding items must be acknowledged; project moves to DLP", async () => {
  const pid = globalThis.job;
  const loc = (await q("select id from locations where project_id = $1", [pid])).rows[0].id;
  await rpc(sup, "create_defect", { p: { project_id: pid, title: "Scuffed paint", location_id: loc, trade: "Painting", priority: "low" } });
  await assert.rejects(rpc(sup, "issue_handover", { p_project: pid, p: { recipient: "Client" } }), /can't do that/);
  await assert.rejects(rpc(pm, "issue_handover", { p_project: pid, p: { recipient: "J Smith" } }), /1 open defects/);
  const h = await rpc(pm, "issue_handover", { p_project: pid, p: { recipient: "J Smith", accept_outstanding: true, dlp_months: 12 } });
  assert.match(h.message, /Handover pack issued to J Smith/);
  assert.equal((await q("select status from projects where id = $1", [pid])).rows[0].status, "dlp");
  assert.equal((await q("select outstanding from handovers where id = $1", [h.id])).rows[0].outstanding.defects[0].title, "Scuffed paint");
});
