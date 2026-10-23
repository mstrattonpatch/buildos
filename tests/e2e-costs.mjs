import { chromium } from "playwright-core";
import { CHROMIUM } from "./env.mjs";
const APP = "http://localhost:54321/buildos/app/";
const PHOTO = new URL("./fixtures/photo.png", import.meta.url).pathname;
const SHOTS = process.argv[2];
const browser = await chromium.launch({ executablePath: CHROMIUM });
const fails = [];
const check = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails.push(m); };
async function newPage(viewport = { width: 1400, height: 900 }) {
  const page = await (await browser.newContext({ timezoneId: "Australia/Sydney", viewport })).newPage();
  page.on("pageerror", (e) => fails.push("pageerror: " + e.message));
  page.on("dialog", (d) => d.accept());
  return page;
}
const hasToast = async (page, re) => { try { await page.locator(".toast", { hasText: re }).first().waitFor({ timeout: 8000 }); await page.evaluate(() => document.querySelectorAll(".toast").forEach((x) => x.remove())); return true; } catch { return false; } };
const errIn = (loc) => loc.locator(".form-msg .notice-error").first().textContent({ timeout: 8000 }).catch(() => "");
const shot = async (page, n) => SHOTS && page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
const fresh = async (page, url) => { await page.goto(url); await page.reload(); await page.waitForSelector("main.content, .site-body"); };
const txt = async (loc) => (await loc.textContent()).replace(/\s+/g, " ");
async function signUp(page, name, email) {
  await page.goto(APP + "#/signup");
  await page.fill("[name=full_name]", name); await page.fill("[name=email]", email); await page.fill("[name=password]", "builders123");
  await page.getByRole("button", { name: "Create account" }).click();
}
async function invite(page, email, role, extra = {}) {
  await page.goto(APP + "#/app/settings");
  const fm = page.locator("form[data-act=invite]");
  await fm.locator("[name=email]").fill(email); await fm.locator("[name=role]").selectOption(role);
  if (extra.worker) await fm.locator("[name=worker]").selectOption({ label: extra.worker });
  await fm.getByRole("button", { name: "Save invitation" }).click();
  await hasToast(page, /Invitation saved/);
}
async function enterBill(page, o) {
  const fm = page.locator("form[data-act=enterBill]");
  await fm.locator("[name=contractor_id]").selectOption({ label: "Pour Co" }); await fm.locator("[name=invoice_number]").fill(o.inv); await fm.locator("[name=amount]").fill(o.amount);
  if (o.po) await fm.locator("[name=po_id]").selectOption({ index: 1 });
  if (o.code) await fm.locator("[name=cost_code]").fill(o.code);
  await fm.getByRole("button", { name: "Enter bill" }).click();
}
const billRow = (page, inv) => page.locator("tr", { hasText: inv }).filter({ has: page.locator("td.mono") });

// ---- set-up: director, PM, worker
const dee = await newPage();
await signUp(dee, "Dee Director", "dee@cost.test");
await dee.fill("[name=name]", "Cost Co"); await dee.getByRole("button", { name: "Create company" }).click();
await dee.getByRole("link", { name: "New project" }).first().click();
await dee.fill("[name=name]", "Tower G"); await dee.fill("[name=code]", "P-7"); await dee.fill("[name=contract_sum]", "1,000,000"); await dee.fill("[name=address]", "1 George St, Sydney NSW 2000");
await dee.getByRole("button", { name: "Create project" }).click(); await dee.waitForSelector("h1:has-text('Tower G')");
const pid = await dee.evaluate(() => DB.projects[0].id), C = APP + `#/app/projects/${pid}/commercial`;
await dee.goto(APP + "#/app/people");
await dee.fill("#new-contractor [name=trading_name]", "Pour Co"); await dee.getByRole("button", { name: "Add contractor" }).click(); await hasToast(dee, /Contractor added/);
await dee.fill("#new-worker [name=name]", "Wes Worker"); await dee.selectOption("#new-worker [name=contractor_id]", { label: "Pour Co" }); await dee.getByRole("button", { name: "Add worker" }).click(); await hasToast(dee, /Worker added/);
await invite(dee, "pat@cost.test", "project_manager");
await invite(dee, "wes@cost.test", "worker", { worker: "Wes Worker" });
const pat = await newPage();
await signUp(pat, "Pat Manager", "pat@cost.test"); await pat.waitForSelector("main.content");

// ---- budget
await dee.goto(C + "/ledger");
for (const [code, d, kind, b] of [["02-conc", "Concrete", "standard", "200,000"], ["PS-01", "Rock excavation", "ps", "10,000"]]) {
  const fm = dee.locator("form[data-act=budgetLine]").last();
  await fm.locator("[name=cost_code]").fill(code); await fm.locator("[name=description]").fill(d); await fm.locator("[name=kind]").selectOption(kind); await fm.locator("[name=budget]").fill(b);
  await fm.getByRole("button", { name: "Add budget line" }).click(); await hasToast(dee, /saved/);
}
check(await dee.locator("table.ledger tr", { hasText: "02-CONC" }).count() === 1, "Budget lines added (codes upper-cased)");

// ---- purchase orders
await fresh(pat, C + "/pos");
let fm = pat.locator("form[data-act=createPo]");
await fm.locator("[name=contractor_id]").selectOption({ label: "Pour Co" }); await fm.locator("[name=cost_code]").fill("02-CONC"); await fm.locator("[name=description]").fill("Supply and place slabs"); await fm.locator("[name=amount]").fill("70,000");
await fm.getByRole("button", { name: "Issue PO" }).click();
check(/need a director/.test(await errIn(fm)), "PM can't issue a PO over $50,000");
await fm.locator("[name=amount]").fill("45,000"); await fm.getByRole("button", { name: "Issue PO" }).click();
check(await hasToast(pat, /PO-0001 issued to Pour Co for \$45,000.00/), "PM issues a PO within their limit");

// ---- bills
await pat.goto(C + "/bills");
await enterBill(pat, { inv: "INV-1", amount: "40,000", po: true });
check(await hasToast(pat, /Invoice INV-1 from Pour Co entered/), "Bill entered against the PO");
check(await billRow(pat, "INV-1").locator("text=Entered by you").count() === 1, "The person who entered a bill can't approve it");
await enterBill(pat, { inv: "inv-1", amount: "1", code: "02-CONC" });
check(/already entered/.test(await errIn(pat.locator("form[data-act=enterBill]"))), "Duplicate invoice refused");
await pat.locator("form[data-act=enterBill] [name=invoice_number]").fill("INV-2"); await pat.locator("form[data-act=enterBill] [name=amount]").fill("10,000");
await pat.locator("form[data-act=enterBill] [name=po_id]").selectOption({ index: 1 }); await pat.locator("form[data-act=enterBill]").getByRole("button", { name: "Enter bill" }).click(); await hasToast(pat, /INV-2/);
await enterBill(pat, { inv: "INV-3", amount: "12,000", code: "PS-01" }); await hasToast(pat, /INV-3/);
await fresh(dee, APP + "#/app/tasks");
check(await dee.locator(".task-item", { hasText: "Approve bill · Pour Co INV-1" }).count() === 1, "Bills to approve are in the director's tasks");
await dee.goto(C + "/bills");
await billRow(dee, "INV-1").getByRole("button", { name: "Approve" }).click(); check(await hasToast(dee, /INV-1 approved/), "Director approves the bill");
await billRow(dee, "INV-2").getByRole("button", { name: "Approve" }).click();
check(/over its \$45,000.00 value/.test(await errIn(billRow(dee, "INV-2"))), "Bill over the PO needs a reason");
await billRow(dee, "INV-2").locator("[name=note]").fill("Extra pour for VAR-001"); await billRow(dee, "INV-2").getByRole("button", { name: "Approve" }).click(); await hasToast(dee, /INV-2 approved/);
await billRow(dee, "INV-3").getByRole("button", { name: "Approve" }).click(); await hasToast(dee, /INV-3 approved/);
await billRow(dee, "INV-1").getByRole("button", { name: "Mark paid" }).click(); check(await hasToast(dee, /INV-1 paid/), "Bill marked paid");

// ---- receipt from the phone
const wes = await newPage({ width: 400, height: 860 });
await signUp(wes, "Wes Worker", "wes@cost.test"); await wes.waitForSelector("text=Hi Wes");
await wes.goto(APP + "#/site"); await wes.getByRole("link", { name: "Receipt" }).click();
fm = wes.locator("form[data-act=submitReceipt]");
await fm.locator("[name=supplier]").fill("Bunnings"); await fm.locator("[name=amount]").fill("110"); await fm.locator("[name=paid_with]").selectOption("personal");
await fm.getByRole("button", { name: "Send to the office" }).click();
check(/photo/.test(await errIn(fm)), "Receipt needs a photo");
await fm.locator("[name=photo]").setInputFiles(PHOTO); await fm.getByRole("button", { name: "Send to the office" }).click();
check(await hasToast(wes, /Receipt for \$110.00 sent .* reimbursed/), "Worker sends a receipt paid personally");
await fresh(pat, C + "/costs");
const rr = pat.locator("tr", { hasText: "Bunnings" });
check(await rr.locator(".thumb").count() === 1, "Receipt photo shown to the office");
await rr.locator("[name=cost_code]").fill("02-CONC"); await rr.getByRole("button", { name: "Approve" }).click(); check(await hasToast(pat, /Bunnings approved/), "PM approves the receipt with a cost code");
await pat.locator("tr", { hasText: "Bunnings" }).getByRole("button", { name: "Mark reimbursed" }).click(); check(await hasToast(pat, /reimbursed/), "Reimbursement recorded");
fm = pat.locator("form[data-act=backcharge]");
await fm.locator("[name=contractor_id]").selectOption({ label: "Pour Co" }); await fm.locator("[name=amount]").fill("500"); await fm.locator("[name=reason]").fill("Washout clean-up"); await fm.locator("[name=cost_code]").fill("02-CONC");
await fm.getByRole("button", { name: "Notify backcharge" }).click(); check(await hasToast(pat, /BC-001 notified/), "Backcharge notified");
await pat.locator("tr", { hasText: "BC-001" }).getByRole("button", { name: "Agreed" }).click(); await hasToast(pat, /agreed/);

// ---- ledger and warnings
await fresh(pat, C + "/ledger");
const conc = await txt(pat.locator("table.ledger tr", { hasText: "02-CONC" }));
check(conc.includes("$200,000") && conc.includes("$49,600"), `Concrete actual = bills 50,000 + receipt 100 − backcharge 500 (${conc.slice(0, 160)})`);
const ps = await txt(pat.locator("table.ledger tr", { hasText: "PS-01" }));
check(/Provisional sum over allowance by \$2,000/.test(ps), "PS overrun flagged for adjustment with the client");
await shot(pat, "k1-ledger");

// ---- lump-sum claim
await pat.goto(C + "/claims");
fm = pat.locator("form[data-act=contractSetup]");
const d = fm.locator("[name=ci_desc]"), v = fm.locator("[name=ci_value]");
await d.nth(0).fill("Structure"); await v.nth(0).fill("600,000"); await d.nth(1).fill("Fit-out"); await v.nth(1).fill("300,000");
await fm.getByRole("button", { name: "Save set-up" }).click();
check(/adds up to \$900,000.00/.test(await errIn(fm)), "Schedule must add up to the contract sum");
await v.nth(1).fill("400,000"); await fm.getByRole("button", { name: "Save set-up" }).click(); await hasToast(pat, /set-up saved/);
fm = pat.locator("form[data-act=createClaim]");
await fm.locator("tr", { hasText: "Structure" }).locator("input").fill("300,000");
await fm.getByRole("button", { name: "Prepare draft claim" }).click();
check(await hasToast(pat, /PC-01 drafted: \$285,000.00 excl. GST/), "Draft claim: 300,000 less 5% retention");
await pat.waitForSelector("h1:has-text('Payment claim PC-01')");
const doc = await txt(pat.locator(".claim-doc"));
check(/Amount claimed \(incl. GST\)\s*\$313,500/.test(doc) && /Security of Payment Act 1999 \(NSW\)/.test(doc), "Claim document totals incl. GST and the NSW SOP statement");
await pat.locator("form[data-act=claimAction]").getByRole("button", { name: "Submit claim" }).click(); check(await hasToast(pat, /PC-01 submitted/), "Claim submitted");
fm = pat.locator("form[data-act=claimAction]");
await fm.locator("[name=amount]").fill("280,000"); await fm.getByRole("button", { name: "Record certificate" }).click();
check(/record the reason/.test(await errIn(fm)), "Short certificate needs the payment schedule reason");
await fm.locator("[name=note]").fill("Formwork L5 not complete"); await fm.getByRole("button", { name: "Record certificate" }).click();
check(await hasToast(pat, /certified — \$5,000.00 short/), "Certificate recorded, shortfall shown");
await shot(pat, "k2-claim");
await pat.locator("form[data-act=claimAction]").getByRole("button", { name: "Record payment" }).click(); check(await hasToast(pat, /PC-01 paid/), "Payment recorded");
await pat.goto(C);
check(/PC-01 certified \$5,000 less than claimed/.test(await txt(pat.locator("section", { hasText: "Warnings" }).first())), "Overview warns about the short certificate");
await fresh(wes, APP + "#/site/receipt");
check(await wes.locator(".list-card", { hasText: "Bunnings" }).locator("text=reimbursed").count() === 1, "Worker sees the receipt was reimbursed");

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILURES\n${fails.join("\n")}` : "\nALL PASSED");
process.exit(fails.length ? 1 : 0);
