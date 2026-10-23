import { chromium } from "playwright-core";
import { CHROMIUM } from "./env.mjs";
import fs from "node:fs";
const APP = "http://localhost:54321/buildos/app/";
const PNG = fs.readFileSync(new URL("./fixtures/photo.png", import.meta.url)), PDFB = fs.readFileSync(new URL("./fixtures/swms.pdf", import.meta.url));
const file = (name) => ({ name, mimeType: name.endsWith(".pdf") ? "application/pdf" : "image/png", buffer: name.endsWith(".pdf") ? PDFB : PNG });
const SHOTS = process.argv[2];
const browser = await chromium.launch({ executablePath: CHROMIUM });
const fails = [];
const check = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails.push(m); };
async function newPage(viewport = { width: 1400, height: 900 }) {
  const ctx = await browser.newContext({ viewport, timezoneId: "Australia/Sydney" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => fails.push("pageerror: " + e.message)); page.on("dialog", (d) => d.accept());
  return page;
}
const hasToast = async (page, re) => { try { await page.locator(".toast", { hasText: re }).first().waitFor({ timeout: 8000 }); await page.evaluate(() => document.querySelectorAll(".toast").forEach((x) => x.remove())); return true; } catch { return false; } };
const shot = async (page, n) => SHOTS && page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: false });
const fresh = async (page, url) => { await page.goto(url); await page.reload(); await page.waitForSelector("main.content, .site-body"); };
const setMode = (mode) => fetch("http://localhost:54321/__ai", { method: "POST", body: JSON.stringify({ mode }) });
await setMode("ok");

const pm = await newPage();
await pm.goto(APP + "#/signup");
await pm.fill("[name=full_name]", "Pat Manager"); await pm.fill("[name=email]", "pat@ai-e2e.test"); await pm.fill("[name=password]", "builders123");
await pm.getByRole("button", { name: "Create account" }).click();
await pm.fill("[name=name]", "Read Co"); await pm.getByRole("button", { name: "Create company" }).click();
await pm.getByRole("link", { name: "New project" }).first().click();
await pm.fill("[name=name]", "Harbour Tower"); await pm.fill("[name=code]", "P-H"); await pm.getByRole("button", { name: "Create project" }).click();
await pm.waitForSelector("h1:has-text('Harbour Tower')");
const pid = await pm.evaluate(() => DB.projects[0].id);
await pm.goto(APP + "#/app/people");
await pm.fill("#new-contractor [name=trading_name]", "Coastal Concrete"); await pm.getByRole("button", { name: "Add contractor" }).click(); await hasToast(pm, /Contractor added/);
await pm.fill("#new-worker [name=name]", "Sam Taylor"); await pm.selectOption("#new-worker [name=contractor_id]", { label: "Coastal Concrete" });
await pm.getByRole("button", { name: "Add worker" }).click(); await hasToast(pm, /Worker added/);

// ---- bill: read an invoice into the form, then save it
await fresh(pm, APP + `#/app/projects/${pid}/commercial/bills`);
let fm = pm.locator("form[data-act=enterBill]");
await fm.getByRole("button", { name: "Read with AI" }).click();
check(/Choose the file first/.test(await fm.locator(".ai-error").textContent()), "Read with AI asks for a file first");
await fm.locator("[name=file]").setInputFiles(file("coastal-invoice.pdf"));
await fm.getByRole("button", { name: "Read with AI" }).click();
await fm.locator(".ai-note", { hasText: "Read by AI" }).waitFor();
const coastal = await pm.evaluate(() => DB.contractors.find((c) => c.tradingName === "Coastal Concrete").id);
check(await fm.locator("[name=contractor_id]").inputValue() === coastal, "Supplier matched to the Coastal Concrete contractor");
check(await fm.locator("[name=invoice_number]").inputValue() === "INV-20931" && await fm.locator("[name=amount]").inputValue() === "18400.00" && await fm.locator("[name=gst]").inputValue() === "1840.00", "Invoice number, amount ex GST and GST filled in");
check(await fm.locator("[name=due_date]").inputValue() === "2026-10-29", "Due date filled in");
check(await fm.locator(".ai-filled").count() === 7, `Filled fields highlighted (${await fm.locator(".ai-filled").count()})`);
check(/check them before saving/.test(await fm.locator(".ai-note").textContent()), "Tells the person to check before saving");
await shot(pm, "ai1-bill");
await fm.locator("[name=invoice_number]").fill("INV-20931A");
check(await fm.locator("[name=invoice_number].ai-filled").count() === 0, "Editing a field clears its highlight");
await fm.locator("[name=cost_code]").fill("03-100");
await fm.getByRole("button", { name: "Enter bill" }).click();
check(await hasToast(pm, /Invoice INV-20931A from Coastal Concrete entered/), "Bill saved from the AI-filled form");
check(await pm.evaluate(() => DB.bills.some((b) => b.invoiceNumber === "INV-20931A" && b.amount === 1840000 && b.filePath)), "Bill stored with the person's edit, the amount and the file");

// wrong kind of document
fm = pm.locator("form[data-act=enterBill]");
await fm.locator("[name=file]").setInputFiles(file("whitecard.png"));
await fm.getByRole("button", { name: "Read with AI" }).click();
await fm.locator(".ai-note").waitFor();
check(/looks like a licence or ticket, not a supplier invoice/.test(await fm.locator(".ai-note").textContent()), "Warns when the document is the wrong kind");

// AI not set up / key wrong
await setMode("nokey");
await fm.getByRole("button", { name: "Read with AI" }).click();
check(/ANTHROPIC_API_KEY/.test(await fm.locator(".ai-error").textContent({ timeout: 8000 })), "Explains plainly when the AI key hasn't been added");
await setMode("ok");

// ---- credential on the worker's page
await pm.goto(APP + "#/app/people"); await pm.getByRole("link", { name: "Sam Taylor" }).first().click();
await pm.waitForSelector("h1:has-text('Sam Taylor')");
fm = pm.locator("form[data-act=addCred]");
await fm.locator("[name=file]").setInputFiles(file("heights-ticket.png"));
await fm.getByRole("button", { name: "Read with AI" }).click();
await fm.locator(".ai-note").waitFor();
check(await fm.locator("[name=type]").inputValue() === "Working at heights" && await fm.locator("[name=number]").inputValue() === "WAH-55120" && await fm.locator("[name=expires]").inputValue() === "2025-03-01", "Credential type, number and expiry read from the ticket");
check(/expired on/.test(await fm.locator(".ai-note").textContent()) && /hard to read/.test(await fm.locator(".ai-note").textContent()), "Flags the expired ticket and the AI's own doubts");

// ---- scan a document → insurance on the contractor
await pm.goto(APP + "#/app/scan");
check(await pm.locator('.sidebar a[href="#/app/scan"]').count() >= 1, "Scan a document is in the company menu");
await pm.locator("[data-scan-file]").setInputFiles(file("coastal-coc.pdf"));
await pm.getByRole("button", { name: "Read with AI" }).click();
await pm.locator("text=Looks like a certificate of currency").waitFor();
check(await pm.locator("[name=dest]").inputValue() === coastal, "Scan picks the matching contractor");
check(/QBE Insurance/.test(await pm.locator(".kv-table").textContent()) && /\$20(\.00)?m/i.test(await pm.locator(".kv-table").textContent()), "Scan shows the details it read");
await shot(pm, "ai2-scan");
await pm.getByRole("button", { name: /Add the insurance/ }).click();
await pm.waitForSelector("h1:has-text('Coastal Concrete')");
fm = pm.locator("form[data-act=addInsurance]");
await fm.locator(".ai-note").waitFor();
check(await fm.locator("[name=insurer]").inputValue() === "QBE Insurance" && await fm.locator("[name=cover_limit]").inputValue() === "20,000,000" && await fm.locator("[name=type]").inputValue() === "Public liability", "Insurance form filled from the scan");
check(await fm.locator("[name=file]").evaluate((i) => i.files.length === 1 && i.files[0].name === "coastal-coc.pdf"), "The scanned file is attached to the form");
await shot(pm, "ai3-insurance");
await fm.getByRole("button", { name: /Add insurance/ }).click();
check(await hasToast(pm, /insurance|added|recorded/i), "Insurance saved");
check(await pm.evaluate(() => DB.contractors.find((c) => c.tradingName === "Coastal Concrete").insurances.some((i) => i.policyNumber === "PL-448812" && i.filePath)), "Insurance stored with policy number and certificate");

// ---- scan a drawing → documents
await pm.goto(APP + "#/app/scan");
await pm.locator("[data-scan-file]").setInputFiles(file("A-301 drawing.pdf"));
await pm.getByRole("button", { name: "Read with AI" }).click();
await pm.getByRole("button", { name: /Upload the document/ }).click();
await pm.waitForSelector("form[data-act=uploadDoc] .ai-note");
fm = pm.locator("form[data-act=uploadDoc]").first();
check(await fm.locator("[name=number]").inputValue() === "A-301" && await fm.locator("[name=revision]").inputValue() === "C" && await fm.locator("[name=title]").inputValue() === "Level 3 floor plan", "Drawing number, revision and title filled from the scan");
await fm.getByRole("button", { name: "Upload" }).click();
check(await pm.waitForSelector("h1:has-text('Level 3 floor plan'), h1:has-text('A-301')", { timeout: 8000 }).then(() => true, () => false), "Drawing uploaded from the scan");

// ---- help chat
await fresh(pm, APP + "#/app");
await pm.getByRole("button", { name: "Ask Setout for help" }).click();
await pm.getByRole("button", { name: "How do I enter a supplier invoice?" }).click();
const reply = pm.locator(".help-msg.assistant").last();
await reply.locator("a").first().waitFor();
check(await reply.locator("a").first().getAttribute("href") === `#/app/projects/${pid}/commercial/bills`, "Help answers with a link to the right project's bills page");
check(/As a Director/.test(await reply.textContent()), "Help knows the person's role");
check(await pm.locator(".help-panel img, .help-panel a[href^='javascript']").count() === 0 && /\[Evil\]/.test(await reply.textContent()), "Help never renders HTML or script links from an answer");
await shot(pm, "ai4-help");
await pm.fill("#help-q", "thanks, and where am I?"); await pm.press("#help-q", "Enter");
await pm.locator(".help-msg.assistant", { hasText: "You're on /app" }).waitFor();
check(await pm.locator(".help-msg").count() === 4, "Conversation continues in the panel");
await pm.locator(".help-msg.assistant a", { hasText: "Bills" }).first().click();
check(/commercial\/bills$/.test(pm.url()), "Help links open the page");
check(await pm.locator(".help-panel").count() === 1, "Help stays open while moving around the app");
const req = await (await fetch("http://localhost:54321/__ai")).json();
check(req.requests.at(-1).messages.length === 3, "Earlier messages are sent so the AI has the conversation");

// ---- settings: switch it off
await pm.goto(APP + "#/app/settings");
check(/2 documents? read|[1-9] documents? read/.test(await pm.locator("section", { hasText: "AI help" }).last().textContent()), "Settings shows AI usage");
await pm.getByRole("button", { name: "Turn AI help off" }).click(); await hasToast(pm, /AI help is off/);
check(await pm.locator(".help-fab").count() === 0, "Help button disappears when AI is off");
await pm.goto(APP + `#/app/projects/${pid}/commercial/bills`);
check(await pm.getByRole("button", { name: "Read with AI" }).count() === 0, "Read with AI buttons disappear when AI is off");
await pm.goto(APP + "#/app/settings");
await pm.getByRole("button", { name: "Turn AI help on" }).click(); await hasToast(pm, /AI help is on/);

// ---- phone: receipt on the site app
const phone = await newPage({ width: 400, height: 860 });
await phone.goto(APP + "#/login");
await phone.fill("[name=email]", "pat@ai-e2e.test"); await phone.fill("[name=password]", "builders123"); await phone.getByRole("button", { name: "Sign in" }).click();
await phone.waitForSelector("main.content, .site-body");
await phone.goto(APP + "#/site/receipt"); await phone.waitForSelector("form[data-act=submitReceipt]");
fm = phone.locator("form[data-act=submitReceipt]");
await fm.locator("[name=photo]").setInputFiles(file("receipt.png"));
await fm.getByRole("button", { name: "Read with AI" }).click();
await fm.locator(".ai-note").waitFor();
check(await fm.locator("[name=supplier]").inputValue() === "Bunnings Warehouse" && await fm.locator("[name=amount]").inputValue() === "86.90" && await fm.locator("[name=date]").inputValue() === "2026-10-21", "Receipt read on the phone");
const fab = await phone.locator(".help-fab").boundingBox(), tabs = await phone.locator(".site-tabs").boundingBox();
check(fab && tabs && fab.y + fab.height <= tabs.y, "Help button sits above the site app tabs");
await shot(phone, "ai5-receipt");
await fm.getByRole("button", { name: "Send to the office" }).click();
check(await hasToast(phone, /receipt|office/i), "Receipt sent");
await phone.context().setOffline(true);
await phone.evaluate(() => window.dispatchEvent(new Event("offline")));
await phone.getByRole("button", { name: "Ask Setout for help" }).click();
check(await phone.locator("#help-q").isDisabled(), "Help says it needs a connection when offline");
await shot(phone, "ai6-help-phone");

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n` + fails.join("\n") : "\nALL PASSED");
process.exit(fails.length ? 1 : 0);
