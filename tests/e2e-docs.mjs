import { chromium } from "playwright-core";
import { CHROMIUM } from "./env.mjs";
const APP = "http://localhost:54321/buildos/app/";
const PDF = new URL("./fixtures/swms.pdf", import.meta.url).pathname;
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
const errIn = (loc) => loc.locator(".form-msg .notice-error").first().textContent({ timeout: 8000 });
async function signUp(page, name, email) {
  await page.goto(APP + "#/signup");
  await page.fill("[name=full_name]", name); await page.fill("[name=email]", email); await page.fill("[name=password]", "builders123");
  await page.getByRole("button", { name: "Create account" }).click();
}
async function upload(page, o) {
  const fm = page.locator("form[data-act=uploadDoc]");
  if (o.file) await fm.locator("[name=file]").setInputFiles(o.file);
  if (o.number) { await fm.locator("[name=number]").fill(o.number); await fm.locator("[name=number]").dispatchEvent("change"); }
  if (o.revision) await fm.locator("[name=revision]").fill(o.revision);
  if (o.title) await fm.locator("[name=title]").fill(o.title);
  if (o.category) await fm.locator("[name=category]").selectOption(o.category);
  if (o.note) await fm.locator("[name=description]").fill(o.note);
  await fm.getByRole("button", { name: /^Upload/ }).click();
  return fm;
}

const pm = await newPage();
await signUp(pm, "Pat Manager", "pat@docs.test");
await pm.fill("[name=name]", "Docs Co"); await pm.getByRole("button", { name: "Create company" }).click();
await pm.getByRole("link", { name: "New project" }).first().click();
await pm.fill("[name=name]", "Tower C"); await pm.fill("[name=code]", "P-3"); await pm.getByRole("button", { name: "Create project" }).click();
await pm.waitForSelector("h1:has-text('Tower C')");
const pid = await pm.evaluate(() => DB.projects[0].id);
await pm.goto(APP + "#/app/settings");
await pm.fill("form[data-act=invite] [name=email]", "sue@docs.test"); await pm.selectOption("form[data-act=invite] [name=role]", "site_supervisor");
await pm.getByRole("button", { name: "Save invitation" }).click(); await hasToast(pm, /Invitation saved/);

const sue = await newPage();
await signUp(sue, "Sue Super", "sue@docs.test");
await sue.waitForSelector("text=Today on site");
await sue.goto(APP + `#/app/projects/${pid}/documents`);
check(await sue.locator("text=No documents yet").count() === 1, "Empty register explains what to do");
let fm = await upload(sue, { number: "a-102", revision: "3", title: "General arrangement — L2 to L4", category: "Architectural" });
check(/Choose the file/.test(await errIn(fm)), "Upload without a file is refused");
await upload(sue, { file: PDF, number: "a-102", revision: "3", title: "General arrangement — L2 to L4", category: "Architectural" });
check(await hasToast(sue, /A-102 rev 3 uploaded for review/), "Drawing uploaded for review (number normalised)");
await sue.waitForSelector("h1:has-text('A-102 rev 3')");
check(await sue.locator("text=In review — not yet for construction").count() === 1, "In-review warning shown");
check(await sue.locator("iframe.doc-preview").count() === 1, "PDF preview shown");
check(await sue.locator("form[data-act=reviewDoc]").count() === 0, "Supervisor can't approve drawings");

// PM approves
await pm.goto(APP + "#/app/tasks"); await pm.reload(); await pm.waitForSelector(".task-item");
check(await pm.locator(".task-item", { hasText: "Review A-102 rev 3" }).count() === 1, "Review appears in the PM's tasks");
await pm.locator(".task-item", { hasText: "Review A-102 rev 3" }).click();
await pm.locator("form[data-act=reviewDoc]").getByRole("button", { name: /Approve/ }).click();
check(await hasToast(pm, /A-102 rev 3 is now current/), "PM issues rev 3 for construction");

// New revision from the document page; old stays current until approved
await sue.goto(APP + `#/app/projects/${pid}/documents`); await sue.reload(); await sue.waitForSelector("table.register");
await sue.locator("table.register").getByRole("link", { name: "General arrangement — L2 to L4" }).click();
await sue.waitForSelector("form[data-act=uploadDoc]");
check(await sue.locator("form[data-act=uploadDoc] [name=title]").inputValue() === "General arrangement — L2 to L4", "New-revision form is pre-filled");
await upload(sue, { file: PDF, revision: "4", note: "Grid C stair moved" });
check(await hasToast(sue, /Rev 3 stays current until it's approved/), "Rev 4 uploaded; rev 3 stays current");
await sue.goto(APP + `#/app/projects/${pid}/documents`);
const row = sue.locator("tr", { hasText: "A-102" });
check(/^\s*3\s*$/.test(await row.locator("td").nth(2).textContent()) && /Rev 4 in review/.test(await row.textContent()), "Register shows rev 3 current and rev 4 in review");

// Minutes issue immediately; photo preview
await upload(sue, { file: PHOTO, number: "MIN-01", revision: "1", title: "Site meeting minutes", category: "Minutes" });
check(await hasToast(sue, /MIN-01 rev 1 issued/), "Minutes issued straight away");
check(await sue.locator("img.doc-preview-img").count() === 1, "Image preview shown");

// PM approves rev 4 → rev 3 superseded
await pm.waitForTimeout(15500);
await pm.goto(APP + `#/app/projects/${pid}/documents`); await pm.reload(); await pm.waitForSelector("main.content");
await pm.getByRole("link", { name: "Rev 4 in review" }).click({ timeout: 15000 });
await pm.locator("form[data-act=reviewDoc]").getByRole("button", { name: /Approve/ }).click();
check(await hasToast(pm, /rev 4 is now current; rev 3 superseded/), "Approving rev 4 supersedes rev 3");
await pm.getByRole("link", { name: "3", exact: true }).click();
await pm.waitForSelector("h1:has-text('A-102 rev 3')");
check(await pm.locator("text=Superseded — don't build from this revision").count() === 1, "Superseded revision clearly flagged");
await pm.goto(APP + `#/app/projects/${pid}/documents?cat=Minutes`);
check(await pm.locator("table.register tbody tr").count() === 1, "Category filter works");
await pm.goto(APP + "#/app/search?q=A-102");
check(await pm.locator("text=A-102 rev 4").count() === 1 && await pm.locator("text=A-102 rev 3").count() === 0, "Search finds the current revision, not superseded ones");

// Site app drawings
const phone = await newPage({ width: 400, height: 860 });
await phone.goto(APP + "#/login");
await phone.fill("[name=email]", "sue@docs.test"); await phone.fill("[name=password]", "builders123");
await phone.getByRole("button", { name: "Sign in" }).click();
await phone.waitForSelector("text=Today on site");
await phone.getByRole("link", { name: "Drawings" }).click();
await phone.waitForSelector("text=Drawings & documents");
check(await phone.locator(".list-card >> text=A-102 · rev 4").count() === 1 && await phone.locator("text=rev 3").count() === 0, "Site app lists current revisions only");
check(await phone.locator(".notice", { hasText: "new revision" }).count() === 1, "Site app flags the new revision this week");
if (SHOTS) { await phone.screenshot({ path: `${SHOTS}/d2-site.png`, fullPage: true }); await pm.goto(APP + `#/app/projects/${pid}/documents`); await pm.screenshot({ path: `${SHOTS}/d1-register.png`, fullPage: true }); }

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILURES\n${fails.join("\n")}` : "\nALL PASSED");
process.exit(fails.length ? 1 : 0);
