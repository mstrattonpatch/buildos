import { chromium } from "playwright-core";
import { CHROMIUM } from "./env.mjs";
const APP = "http://localhost:54321/buildos/app/";
const PDF = new URL("./fixtures/swms.pdf", import.meta.url).pathname;
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
const shot = async (page, n) => SHOTS && page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
const ymd = (o) => { const d = new Date(); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
async function signUp(page, name, email) {
  await page.goto(APP + "#/signup");
  await page.fill("[name=full_name]", name); await page.fill("[name=email]", email); await page.fill("[name=password]", "builders123");
  await page.getByRole("button", { name: "Create account" }).click();
}
async function invite(page, email, role, extra = {}) {
  await page.goto(APP + "#/app/settings");
  const fm = page.locator("form[data-act=invite]");
  await fm.locator("[name=email]").fill(email); await fm.locator("[name=role]").selectOption(role);
  if (extra.contractor) await fm.locator("[name=contractor]").selectOption({ label: extra.contractor });
  if (extra.worker) await fm.locator("[name=worker]").selectOption({ label: extra.worker });
  await fm.getByRole("button", { name: "Save invitation" }).click();
  await hasToast(page, /Invitation saved/);
}

// ---- PM sets up
const pm = await newPage();
await signUp(pm, "Pat Manager", "pat@swms.test");
await pm.fill("[name=name]", "SWMS Co"); await pm.getByRole("button", { name: "Create company" }).click();
await pm.getByRole("link", { name: "New project" }).first().click();
await pm.fill("[name=name]", "Tower B"); await pm.fill("[name=code]", "P-2"); await pm.getByRole("button", { name: "Create project" }).click();
await pm.waitForSelector("h1:has-text('Tower B')");
const pid = await pm.evaluate(() => DB.projects[0].id);
await pm.goto(APP + "#/app/people");
await pm.fill("#new-contractor [name=trading_name]", "Pour Co"); await pm.getByRole("button", { name: "Add contractor" }).click(); await hasToast(pm, /Contractor added/);
await pm.fill("#new-worker [name=name]", "Wes Worker"); await pm.selectOption("#new-worker [name=contractor_id]", { label: "Pour Co" });
await pm.fill("#new-worker [name=white_card]", "WC9"); await pm.selectOption("#new-worker [name=inducted_project_id]", { label: "Tower B" });
await pm.getByRole("button", { name: "Add worker" }).click(); await hasToast(pm, /Worker added/);
await pm.goto(APP + `#/app/projects/${pid}/programme`);
const tf = pm.locator("form[data-act=createTask]");
await tf.locator("[name=name]").fill("L4 slab pour"); await tf.locator("[name=is_milestone]").check(); await tf.locator("[name=forecast_start]").fill(ymd(3));
await tf.getByRole("button", { name: "Add to programme" }).click(); await hasToast(pm, /Milestone added/);
await invite(pm, "sid@pour.test", "subcontractor_admin", { contractor: "Pour Co" });
await invite(pm, "wes@pour.test", "worker", { worker: "Wes Worker" });

// ---- Subcontractor submits
const sid = await newPage();
await signUp(sid, "Sid Sub", "sid@pour.test");
await sid.waitForSelector("h1:has-text('Quality & inspections')");
await sid.goto(APP + `#/app/projects/${pid}/safety`);
check(await sid.locator("text=No SWMS yet").count() === 1, "Empty SWMS register explains what to do");
const sf = sid.locator("form[data-act=submitSwms]");
check(await sf.locator("input[disabled]").inputValue() === "Pour Co", "Subcontractor submits for their own company (fixed)");
await sf.locator("[name=title]").fill("Concrete placement");
await sf.locator("[name=activity]").fill("Pumping and placing L4 slab");
await sf.locator("label", { hasText: "Risk of a fall of more than 2 metres" }).locator("input").check();
await sf.locator("label", { hasText: "movement of powered mobile plant" }).locator("input").check();
await sf.locator(".hz-row").first().locator("[name=hz_hazard]").fill("Pump boom near power lines");
await sf.getByRole("button", { name: "Submit for review" }).click();
check(/controls for "Pump boom near power lines"/.test(await errIn(sf)), "Hazard without controls is refused");
await sf.locator(".hz-row").first().locator("[name=hz_controls]").fill("Spotter; 4 m exclusion zone");
await sf.getByRole("button", { name: "Add hazard" }).click();
await sf.locator(".hz-row").nth(1).locator("[name=hz_hazard]").fill("Fall from slab edge");
await sf.locator(".hz-row").nth(1).locator("[name=hz_controls]").fill("Edge protection checked before pour");
await sf.locator("label", { hasText: "L4 slab pour" }).locator("input").check();
await sf.locator("[name=file]").setInputFiles(PDF);
await sf.getByRole("button", { name: "Submit for review" }).click();
check(await hasToast(sid, /SWMS-01 submitted for review/), "SWMS submitted with document and hazards");
await sid.waitForSelector("h1:has-text('SWMS-01 v1')");
check(await sid.getByRole("link", { name: "Open document" }).count() === 1, "Uploaded document is linked");
check(await sid.locator("text=Fall from slab edge").count() === 1, "Hazards listed");

// ---- PM requests changes
await pm.goto(APP + "#/app/tasks");
await pm.reload(); await pm.waitForSelector(".task-item");
check(await pm.locator(".task-item", { hasText: "Review SWMS · Concrete placement v1" }).count() === 1, "Review appears in the PM's tasks");
await pm.locator(".task-item", { hasText: "Review SWMS" }).click();
const rf = pm.locator("form[data-act=swmsReview]");
await rf.getByRole("button", { name: "Request changes" }).click();
check(/what needs to change/.test(await errIn(rf)), "Requesting changes needs a comment");
await rf.locator("[name=comment]").fill("Add concrete washout controls");
await rf.getByRole("button", { name: "Request changes" }).click();
check(await hasToast(pm, /returned for changes/), "Changes requested");

// ---- Sub revises
await sid.goto(APP + "#/app/tasks"); await sid.reload(); await sid.waitForSelector(".task-item");
await sid.locator(".task-item", { hasText: "Revise SWMS" }).click();
await sid.waitForSelector("form[data-act=reviseSwms]");
check(await sid.locator("text=Add concrete washout controls").count() >= 1, "Subcontractor sees the reviewer's comment");
const vf = sid.locator("form[data-act=reviseSwms]");
check(await vf.locator(".hz-row").count() === 2, "Revision form is pre-filled");
await vf.getByRole("button", { name: "Add hazard" }).click();
await vf.locator(".hz-row").nth(2).locator("[name=hz_hazard]").fill("Concrete washout");
await vf.locator(".hz-row").nth(2).locator("[name=hz_controls]").fill("Bunded washout bay at gate 2");
await vf.getByRole("button", { name: "Submit revision" }).click();
check(await hasToast(sid, /SWMS-01 v2 submitted/), "Revision v2 submitted");

// ---- PM approves v2
await pm.waitForTimeout(15500);
await pm.goto(APP + `#/app/projects/${pid}/safety`);
await pm.waitForTimeout(1500); // background refresh picks up the revision
await pm.locator("table.register").getByRole("link", { name: "Concrete placement" }).click();
await pm.waitForSelector("h1:has-text('v2')");
await pm.locator("form[data-act=swmsReview]").getByRole("button", { name: "Approve" }).click();
check(await hasToast(pm, /v2 approved/), "PM approves v2");
check(await pm.locator("text=0 of 1 inducted workers").count() === 1, "Acknowledgement tracking shows 0 of 1");
await shot(pm, "s1-swms");

// ---- Worker reads, acknowledges, signs in
const wes = await newPage({ width: 400, height: 860 });
await signUp(wes, "Wes Worker", "wes@pour.test");
await wes.waitForSelector("text=Hi Wes");
check(await wes.getByRole("button", { name: "Sign in to site" }).isDisabled(), "Worker can't sign in before acknowledging");
await wes.locator("summary", { hasText: "Read the SWMS" }).click();
check(await wes.locator("text=Bunded washout bay at gate 2").count() === 1, "Worker reads the actual hazards and controls");
check(await wes.getByRole("link", { name: "Open the full document" }).count() === 1, "Worker can open the full document");
await wes.getByRole("button", { name: /acknowledge/ }).click(); await hasToast(wes, /Acknowledged/);
await wes.getByRole("button", { name: "Sign in to site" }).click();
check(await hasToast(wes, /signed in/), "Worker signs in after acknowledging v2");

// ---- Revision v3 (re-acknowledge) keeps v2 in force until approved
await sid.goto(APP + `#/app/projects/${pid}/safety`); await sid.reload(); await sid.waitForSelector("table.register");
await sid.locator("table.register").getByRole("link", { name: "Concrete placement" }).click();
await sid.waitForSelector("form[data-act=reviseSwms]");
await sid.locator("form[data-act=reviseSwms] [name=activity]").fill("Pumping and placing L4 and L5 slabs");
await sid.locator("form[data-act=reviseSwms]").getByRole("button", { name: "Submit revision" }).click();
check(await hasToast(sid, /v3 submitted/), "Revision v3 submitted");
await pm.waitForTimeout(15500);
await pm.goto(APP + `#/app/projects/${pid}/safety`);
await pm.waitForTimeout(1500);
const row = pm.locator("tr", { hasText: "Concrete placement" });
check(/v2 in force/.test(await row.textContent()) && /v3 awaiting review/.test(await row.textContent()), "Register shows v2 in force and v3 awaiting review");
await row.getByRole("link", { name: "v3 awaiting review" }).click();
await pm.locator("form[data-act=swmsReview]").getByRole("button", { name: "Approve" }).click();
check(await hasToast(pm, /Workers must acknowledge the new version/), "Approving v3 requires workers to acknowledge again");
await wes.reload(); await wes.waitForSelector("text=Hi Wes");
check(await wes.locator(".req-list", { hasText: "SWMS · Concrete placement v3" }).locator("text=Needs signing").count() === 1, "Worker now needs to sign v3");
await pm.goto(APP + `#/app/projects/${pid}`);
check(await pm.locator(".ready-row", { hasText: "SWMS · Concrete placement v3" }).locator("text=Approved").count() === 1, "Readiness uses the version in force");

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILURES\n${fails.join("\n")}` : "\nALL PASSED");
process.exit(fails.length ? 1 : 0);
