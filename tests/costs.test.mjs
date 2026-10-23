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




let pm, pm2, dir, sup, wk, org, proj, cp, con;
const ymdOff = (o) => { const d = new Date(Date.now() + 10 * 3600e3); d.setUTCDate(d.getUTCDate() + o); return d.toISOString().slice(0, 10); };
before(async () => {
  await q("truncate public.organisations cascade; delete from auth.users");
  dir = await signUp("dir@cs.test", "Dee Director"); pm = await signUp("pm@cs.test", "Pat PM"); pm2 = await signUp("pm2@cs.test", "Paul PM"); sup = await signUp("sup@cs.test", "Sue Super"); wk = await signUp("wk@cs.test", "Wes Worker");
  org = (await rpc(dir, "create_organisation", { p_name: "CS Co" })).id;
  const c0 = (await rpc(dir, "create_contractor", { p_org: org, p: { trading_name: "Staff" } })).id;
  const w0 = (await rpc(dir, "create_worker", { p_org: org, p: { name: "Wes Worker", contractor_id: c0 } })).id;
  for (const [u, email, role, wid] of [[pm, "pm@cs.test", "project_manager"], [pm2, "pm2@cs.test", "project_manager"], [sup, "sup@cs.test", "site_supervisor"], [wk, "wk@cs.test", "worker", w0]]) {
    await rpc(dir, "invite_member", { p_org: org, p_email: email, p_role: role, p_title: "", p_contractor: null, p_worker: wid ?? null });
    await rpc(u, "accept_invitations", {});
  }
  proj = (await rpc(pm, "create_project", { p_org: org, p: { name: "Lump", code: "L1", contract_sum: 100000000 } })).id;
  cp = (await rpc(pm, "create_project", { p_org: org, p: { name: "Plus", code: "C1", contract_sum: 0 } })).id;
  con = (await rpc(pm, "create_contractor", { p_org: org, p: { trading_name: "Pour Co" } })).id;
});
after(() => pool.end());

test("budget lines: unique codes, PS/PC, only PMs and directors", async () => {
  await rpc(pm, "save_budget_line", { p_project: proj, p_id: null, p: { cost_code: "02-conc", description: "Concrete", budget: 20000000 } });
  await rpc(pm, "save_budget_line", { p_project: proj, p_id: null, p: { cost_code: "PS-01", description: "Rock excavation", budget: 1000000, kind: "ps" } });
  await assert.rejects(rpc(pm, "save_budget_line", { p_project: proj, p_id: null, p: { cost_code: "02-CONC", budget: 1 } }), /already in the budget/);
  await assert.rejects(rpc(sup, "save_budget_line", { p_project: proj, p_id: null, p: { cost_code: "X", budget: 1 } }), /can't do that/);
  assert.equal((await as(sup, "select * from budget_lines")).length, 0, "supervisors can't see the budget");
});

test("purchase orders: PM limit, close releases commitment", async () => {
  await assert.rejects(rpc(pm, "create_po", { p_project: proj, p: { contractor_id: con, cost_code: "02-CONC", description: "Slab pours", amount: 6000000 } }), /need a director/);
  const po = await rpc(dir, "create_po", { p_project: proj, p: { contractor_id: con, cost_code: "02-conc", description: "Slab pours", amount: 6000000 } });
  assert.match(po.message, /PO-0001 issued to Pour Co for \$60,000.00/);
  const po2 = (await rpc(pm, "create_po", { p_project: proj, p: { contractor_id: con, cost_code: "02-CONC", description: "Pump hire", amount: 100000 } })).id;
  assert.match((await rpc(pm, "po_action", { p_po: po2, p_action: "cancel" })).message, /cancelled/);
  globalThis.po = po.id;
});

test("bills: duplicates refused, approved by someone else, over-PO needs a reason", async () => {
  const b1 = (await rpc(pm, "enter_bill", { p_project: proj, p: { contractor_id: con, invoice_number: "INV-1", amount: 4000000, po_id: globalThis.po } })).id;
  await assert.rejects(rpc(pm, "enter_bill", { p_project: proj, p: { contractor_id: con, invoice_number: "inv-1", amount: 1, cost_code: "X" } }), /already entered/);
  await assert.rejects(rpc(pm, "bill_action", { p_bill: b1, p_action: "approve" }), /someone else needs to approve/);
  await assert.rejects(rpc(pm, "bill_action", { p_bill: b1, p_action: "paid" }), /Approve the bill/);
  await rpc(pm2, "bill_action", { p_bill: b1, p_action: "approve" });
  assert.equal((await q("select cost_code, gst from bills where id = $1", [b1])).rows[0].cost_code, "02-CONC", "cost code comes from the PO");
  const b2 = (await rpc(pm, "enter_bill", { p_project: proj, p: { contractor_id: con, invoice_number: "INV-2", amount: 3000000, po_id: globalThis.po } })).id;
  await assert.rejects(rpc(dir, "bill_action", { p_bill: b2, p_action: "approve" }), /over its \$60,000.00 value/);
  await rpc(dir, "bill_action", { p_bill: b2, p_action: "approve", p_note: "Extra pour, VAR-001" });
  await assert.rejects(rpc(pm, "bill_action", { p_bill: b2, p_action: "dispute" }), /waiting for approval/);
  await rpc(pm, "bill_action", { p_bill: b1, p_action: "paid" });
  await assert.rejects(rpc(dir, "po_action", { p_po: globalThis.po, p_action: "cancel" }), /close it instead/);
});

test("receipts: anyone sends with a photo; GST split; own receipts visible", async () => {
  await assert.rejects(rpc(wk, "submit_receipt", { p_project: proj, p: { supplier: "Bunnings", amount: 11000, paid_with: "personal" } }), /photo/);
  const r = await rpc(wk, "submit_receipt", { p_project: proj, p: { supplier: "Bunnings", amount: 11000, paid_with: "personal", photo_path: `${org}/r.jpg` } });
  assert.match(r.message, /\$110.00 .* reimbursed/);
  const row = (await q("select amount, gst from receipts where id = $1", [r.id])).rows[0];
  assert.deepEqual([Number(row.amount), Number(row.gst)], [10000, 1000]);
  assert.equal((await as(wk, "select * from receipts")).length, 1);
  assert.equal((await as(sup, "select * from receipts")).length, 0);
  await assert.rejects(rpc(pm, "receipt_action", { p_receipt: r.id, p_action: "approve" }), /Choose the cost code/);
  await rpc(pm, "receipt_action", { p_receipt: r.id, p_action: "approve", p: { cost_code: "02-conc" } });
  await rpc(pm, "receipt_action", { p_receipt: r.id, p_action: "reimbursed" });
  await assert.rejects(rpc(pm, "receipt_action", { p_receipt: r.id, p_action: "reimbursed" }), /Already/);
});

test("internal charges and backcharges", async () => {
  await rpc(pm, "add_internal_charge", { p_project: proj, p: { cost_code: "02-CONC", description: "Company excavator 2 days", amount: 160000 } });
  const bc = await rpc(pm, "raise_backcharge", { p_project: proj, p: { contractor_id: con, cost_code: "02-CONC", reason: "Clean-up of concrete washout", amount: 50000 } });
  assert.match(bc.message, /BC-001 notified to Pour Co/);
  await rpc(pm, "backcharge_action", { p_bc: bc.id, p_action: "agree" });
  await assert.rejects(rpc(pm, "backcharge_action", { p_bc: bc.id, p_action: "withdraw" }), /already agreed/);
});

test("lump-sum claims: schedule, retention to a cap, previous claims, certify short needs a reason", async () => {
  await assert.rejects(rpc(pm, "save_contract_setup", { p_project: proj, p: { items: [{ description: "Structure", value: 40000000 }] } }), /adds up to \$400,000.00/);
  await rpc(pm, "save_contract_setup", { p_project: proj, p: { retention_pct: 10, retention_cap_pct: 5, items: [{ description: "Structure", value: 60000000 }, { description: "Fit-out", value: 40000000 }] } });
  const items = (await q("select id, description from contract_items where project_id = $1 order by seq", [proj])).rows;
  const v = (await rpc(pm, "create_variation", { p_project: proj, p: { title: "Extra pour", amount: 2000000 } })).id;
  await rpc(dir, "variation_action", { p_variation: v, p_type: "approve" });
  await assert.rejects(rpc(pm, "create_claim", { p_project: proj, p: { period_end: ymdOff(0), items: [{ id: items[0].id, to_date: 70000000 }] } }), /up to \$600,000.00/);
  const c1 = await rpc(pm, "create_claim", { p_project: proj, p: { period_end: ymdOff(-30), items: [{ id: items[0].id, to_date: 30000000 }], variations: [{ id: v, to_date: 1000000 }] } });
  // gross 310,000; retention 10% = 31,000, cap 5% of 1,020,000 = 51,000 → 31,000; net 279,000
  assert.match(c1.message, /PC-01 drafted: \$279,000.00 excl. GST/);
  await assert.rejects(rpc(pm, "create_claim", { p_project: proj, p: { period_end: ymdOff(0) } }), /already a draft/);
  await rpc(pm, "claim_action", { p_claim: c1.id, p_action: "submit" });
  assert.equal((await q("select status from variations where id = $1", [v])).rows[0].status, "included_in_claim");
  await assert.rejects(rpc(pm, "claim_action", { p_claim: c1.id, p_action: "certify", p: { amount: 25000000 } }), /record the reason/);
  await rpc(pm, "claim_action", { p_claim: c1.id, p_action: "certify", p: { amount: 25000000, note: "Fit-out not started" } });
  await rpc(pm, "claim_action", { p_claim: c1.id, p_action: "paid", p: { amount: 25000000 } });
  await assert.rejects(rpc(pm, "save_contract_setup", { p_project: proj, p: { items: [{ description: "All", value: 100000000 }] } }), /locked/);
  await assert.rejects(rpc(pm, "create_claim", { p_project: proj, p: { period_end: ymdOff(-30) } }), /after the last claim/);
  // second: gross 900,000 + 20,000 var; retention capped at 51,000; net 869,000 − previous 279,000 = 590,000
  const c2 = await rpc(pm, "create_claim", { p_project: proj, p: { period_end: ymdOff(0), items: [{ id: items[0].id, to_date: 60000000 }, { id: items[1].id, to_date: 30000000 }], variations: [{ id: v, to_date: 2000000 }] } });
  assert.match(c2.message, /PC-02 drafted: \$590,000.00/);
  const r = (await q("select retention_to_date, previous_net, gst from claims where id = $1", [c2.id])).rows[0];
  assert.deepEqual([Number(r.retention_to_date), Number(r.previous_net), Number(r.gst)], [5100000, 27900000, 5900000]);
  await assert.rejects(rpc(pm, "create_claim", { p_project: proj, p: { period_end: ymdOff(1), items: [{ id: items[0].id, to_date: 1 }] } }), /already a draft/);
  await rpc(pm, "claim_action", { p_claim: c2.id, p_action: "delete" });
  await assert.rejects(rpc(pm, "create_claim", { p_project: proj, p: { period_end: ymdOff(0), items: [{ id: items[0].id, to_date: 1000000 }] } }), /less than already claimed/);
});

test("cost-plus claims: unclaimed costs + fee + labour at chargeout, marked as claimed", async () => {
  await rpc(pm, "save_contract_setup", { p_project: cp, p: { contract_type: "cost_plus", fee_pct: 12, retention_pct: 0 } });
  await assert.rejects(rpc(pm, "create_claim", { p_project: cp, p: { period_end: ymdOff(0) } }), /no approved, unclaimed costs/);
  const b = (await rpc(pm, "enter_bill", { p_project: cp, p: { contractor_id: con, invoice_number: "CP-1", amount: 1000000, cost_code: "03" } })).id;
  await rpc(pm2, "bill_action", { p_bill: b, p_action: "approve" });
  await rpc(pm, "add_internal_charge", { p_project: cp, p: { cost_code: "03", description: "Skip bin", amount: 50000 } });
  const crew = (await rpc(pm, "create_contractor", { p_org: org, p: { trading_name: "Own crew" } })).id;
  const w = (await rpc(pm, "create_worker", { p_org: org, p: { name: "Cal Carpenter", contractor_id: crew } })).id;
  const t = (await rpc(sup, "create_timesheet", { p_project: cp, p: { worker_id: w, date: ymdOff(-1), hours: 8 } })).id;
  await rpc(sup, "timesheet_action", { p_ids: `{${t}}`, p_action: "approve" });
  await rpc(pm, "timesheet_action", { p_ids: `{${t}}`, p_action: "process", p_cost: 5000, p_charge: 9000 });
  // costs 10,500 → fee 1,260; labour 8 × 90 = 720; total 12,480
  const c = await rpc(pm, "create_claim", { p_project: cp, p: { period_end: ymdOff(0) } });
  assert.match(c.message, /PC-01 drafted: \$12,480.00/);
  assert.equal((await q("select claim_id from bills where id = $1", [b])).rows[0].claim_id, c.id);
  await rpc(pm, "claim_action", { p_claim: c.id, p_action: "delete" });
  assert.equal((await q("select claim_id from timesheets where id = $1", [t])).rows[0].claim_id, null, "deleting a draft releases the costs");
});
