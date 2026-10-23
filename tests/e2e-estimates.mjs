import { chromium } from "playwright-core";
import { CHROMIUM } from "./env.mjs";
const APP = "http://localhost:54321/buildos/app/";
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
const txt = async (loc) => (await loc.textContent()).replace(/\s+/g, " ");
async function fillRow(row, o) { for (const [k, v] of Object.entries(o)) await row.locator(`[name=${k}]`).fill(v); }

const dee = await newPage();
await dee.goto(APP + "#/signup");
await dee.fill("[name=full_name]", "Dee Director"); await dee.fill("[name=email]", "dee@est.test"); await dee.fill("[name=password]", "builders123");
await dee.getByRole("button", { name: "Create account" }).click();
await dee.fill("[name=name]", "Estimate Co"); await dee.getByRole("button", { name: "Create company" }).click();
await dee.waitForSelector("main.content");

// ---- estimate
await dee.getByRole("link", { name: "Estimates" }).click(); await dee.waitForSelector("h1:has-text('Estimates')");
let fm = dee.locator("form[data-act=createEstimate]");
await fm.locator("[name=name]").fill("12 Smith St — new dwelling"); await fm.locator("[name=client]").fill("J Smith"); await fm.locator("[name=address]").fill("12 Smith St, Parramatta NSW"); await fm.locator("[name=markup_pct]").fill("20");
await fm.getByRole("button", { name: "Start estimate" }).click();
check(await hasToast(dee, /EST-001 started/), "Estimate started");
await dee.waitForSelector("form[data-act=saveEstimate]");
const rows = dee.locator("[data-rows=items] .est-row");
await fillRow(rows.nth(0), { it_cat: "Concrete", it_desc: "Slab on ground", it_qty: "12.05*10", it_unit: "m²", it_rate: "95" });
check((await rows.nth(0).locator("[data-line-total]").textContent()) === "$11,448", "Line total from a quantity formula");
await fillRow(rows.nth(1), { it_cat: "Electrical", it_desc: "Electrical allowance", it_qty: "1", it_rate: "10,000" });
await fillRow(rows.nth(2), { it_cat: "", it_desc: "Pump hire", it_qty: "1", it_rate: "1,500" });
await dee.locator("form[data-act=saveEstimate]").getByRole("button", { name: "Save estimate" }).click();
check(/a category/.test(await errIn(dee.locator("form[data-act=saveEstimate]"))), "Items need a category");
await rows.nth(2).locator("[name=it_cat]").fill("Concrete");
await rows.nth(0).locator("[name=it_qty]").fill("12*x");
await dee.locator("form[data-act=saveEstimate]").getByRole("button", { name: "Save estimate" }).click();
check(/Check the quantity/.test(await errIn(dee.locator("form[data-act=saveEstimate]"))), "Bad formula refused");
await rows.nth(0).locator("[name=it_qty]").fill("12.05*10");
await dee.locator("form[data-act=saveEstimate]").getByRole("button", { name: "Save estimate" }).click();
// concrete 11,447.50 + 1,500 = 12,947.50; electrical 10,000 → cost 22,947.50 × 1.2 = 27,537.00
check(await hasToast(dee, /EST-001 saved — \$27,537.00/), "Estimate saved with 20% markup");
const q = dee.locator("[data-rows=quotes] .est-row").first();
await fillRow(q, { q_cat: "Electrical", q_supplier: "Sparky B", q_amount: "9,000" }); await q.locator("[name=q_sel]").check();
await dee.locator("form[data-act=saveEstimate]").getByRole("button", { name: "Save estimate" }).click();
check(await hasToast(dee, /\$26,337.00/), "Selected trade quote replaces the electrical allowance");
check(/Electrical\s*Quote: Sparky B\s*\$9,000\s*\$10,800/.test(await txt(dee.locator("aside.stack-lg"))), "Summary shows the package from the quote");

// ---- assembly
await dee.goto(APP + "#/app/estimates");
fm = dee.locator("form[data-act=saveAssembly]");
await fm.locator("[name=name]").fill("Stud wall"); await fm.locator("[name=unit]").fill("m²"); await fm.locator("[name=category]").fill("Framing");
await fm.locator("[name=c_desc]").first().fill("90×45 studs"); await fm.locator("[name=c_qty]").first().fill("2.2"); await fm.locator("[name=c_unit]").first().fill("lm"); await fm.locator("[name=c_rate]").first().fill("6.50");
await fm.getByRole("button", { name: "Save assembly" }).click(); check(await hasToast(dee, /Stud wall saved/), "Assembly saved");
await dee.getByRole("link", { name: "12 Smith St — new dwelling" }).click(); await dee.waitForSelector("form[data-act=saveEstimate]");
await dee.locator("[data-asm]").selectOption({ label: "Stud wall (per m²)" }); await dee.locator("[data-asm-qty]").fill("10");
await dee.getByRole("button", { name: "Insert" }).click();
const asmRow = dee.locator("[data-rows=items] .est-row", { has: dee.locator("[name=it_desc][value*='Stud wall']") });
check(await dee.locator("[data-rows=items] .est-row").count() === 4 && (await dee.locator("[data-rows=items] .est-row").nth(3).locator("[name=it_qty]").inputValue()) === "22", "Assembly expands into an item (2.2 lm × 10 m²)");
await dee.locator("form[data-act=saveEstimate] [name=exclusions]").fill("Landscaping\nFloor coverings");
await dee.locator("form[data-act=saveEstimate]").getByRole("button", { name: "Save estimate" }).click();
// + framing 22 × 6.50 = 143 → ×1.2 = 171.60 → 26,508.60
check(await hasToast(dee, /\$26,508.60/), "Assembly priced into the estimate");
await shot(dee, "e1-estimate");

// ---- client quote
await dee.getByRole("link", { name: "Client quote" }).click(); await dee.waitForSelector("h1:has-text('Client quote')");
const doc = await txt(dee.locator(".claim-doc"));
check(/Total incl. GST\s*\$29,159/.test(doc) && /Floor coverings/.test(doc), "Quote shows sell totals incl. GST and exclusions");
check(!/Sparky|95\.00|\$9,000/.test(doc), "Quote hides suppliers, rates and costs");
await shot(dee, "e2-quote");

// ---- send, win, convert
await dee.goBack(); await dee.waitForSelector("form[data-act=saveEstimate]");
await dee.getByRole("button", { name: "Mark as sent to client" }).click(); check(await hasToast(dee, /marked as sent/), "Quote marked as sent");
check(await dee.locator("text=locked").count() >= 1, "Sent version is locked");
await dee.getByRole("button", { name: "Won" }).click(); await hasToast(dee, /won/);
fm = dee.locator("form[data-act=estimateAction]", { hasText: "Convert to a job" });
await fm.locator("[name=code]").fill("P-9"); await fm.getByRole("button", { name: "Create the job" }).click();
check(await hasToast(dee, /Job created from EST-001: contract sum \$26,508.60, 3 budget lines/), "Won estimate converts to a job");
await dee.waitForSelector("h1:has-text('Commercial')");
check(/Original contract\s*\$27k/.test(await txt(dee.locator(".metrics"))), "Job has the contract sum");
const pid = await dee.evaluate(() => location.hash.split("/")[3]), P = APP + `#/app/projects/${pid}`;
await dee.goto(P + "/commercial/ledger");
check(await dee.locator("table.ledger tr", { hasText: "Framing" }).count() === 1, "Budget lines created from the estimate packages");

// ---- reports
await dee.goto(P + "/reports"); await dee.waitForSelector(".report");
check(await dee.locator(".report h2", { hasText: "Programme" }).count() === 1 && await dee.locator(".report h2", { hasText: "Labour" }).count() === 1, "Weekly site report has its sections");
await dee.locator("form[data-filter] [name=view]").selectOption("client"); await dee.getByRole("button", { name: "Update" }).click();
await dee.waitForSelector(".report >> text=client view");
check(await dee.locator(".report h2", { hasText: "Programme" }).count() === 0, "Client view leaves out internal sections");
await dee.getByRole("link", { name: "Cost report" }).click(); await dee.waitForSelector(".report h1:has-text('Cost report')");
check(await dee.locator(".report h2", { hasText: "Contract & margin" }).count() === 1, "Cost report available internally");

// ---- handover
await dee.goto(P + "/handover"); await dee.waitForSelector("h1:has-text('Handover')");
check(await dee.locator("tr", { hasText: "Warranties" }).locator("text=None uploaded").count() === 1, "Readiness shows missing warranties");
fm = dee.locator("form[data-act=issueHandover]");
await fm.getByRole("button", { name: "Issue handover pack" }).click();
check(/Who is the pack going to/.test(await errIn(fm)), "Recipient required");
await fm.locator("[name=recipient]").fill("J Smith"); await fm.getByRole("button", { name: "Issue handover pack" }).click();
check(await hasToast(dee, /Handover pack issued to J Smith/), "Handover pack issued");
check(await dee.locator(".notice-ok", { hasText: "Defects liability period" }).count() === 1, "Handover recorded with DLP end date");
await shot(dee, "e3-handover");

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILURES\n${fails.join("\n")}` : "\nALL PASSED");
process.exit(fails.length ? 1 : 0);
