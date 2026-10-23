import { chromium } from "playwright-core";
import { CHROMIUM } from "./env.mjs";
import pg from "pg";
import { PG } from "./env.mjs";
const APP = "http://localhost:54321/buildos/app/";
const SHOTS = process.argv[2];
const db = new pg.Pool(PG);
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
  await fm.getByRole("button", { name: "Save invitation" }).click();
  await hasToast(page, /Invitation saved/);
}

// ---- set-up
const pm = await newPage();
await signUp(pm, "Pat Manager", "pat@safe.test");
await pm.fill("[name=name]", "Safe Co"); await pm.getByRole("button", { name: "Create company" }).click();
await pm.getByRole("link", { name: "New project" }).first().click();
await pm.fill("[name=name]", "Tower D"); await pm.fill("[name=code]", "P-4"); await pm.getByRole("button", { name: "Create project" }).click();
await pm.waitForSelector("h1:has-text('Tower D')");
const pid = await pm.evaluate(() => DB.projects[0].id);
const B = APP + `#/app/projects/${pid}`;
await pm.goto(APP + "#/app/people");
await pm.fill("#new-contractor [name=trading_name]", "Pour Co"); await pm.getByRole("button", { name: "Add contractor" }).click(); await hasToast(pm, /Contractor added/);
await pm.fill("#new-worker [name=name]", "Wes Worker"); await pm.selectOption("#new-worker [name=contractor_id]", { label: "Pour Co" });
await pm.fill("#new-worker [name=white_card]", "WC9"); await pm.selectOption("#new-worker [name=inducted_project_id]", { label: "Tower D" });
await pm.getByRole("button", { name: "Add worker" }).click(); await hasToast(pm, /Worker added/);
await invite(pm, "sue@safe.test", "site_supervisor");
await invite(pm, "sid@safepour.test", "subcontractor_admin", { contractor: "Pour Co" });
const sue = await newPage();
await signUp(sue, "Sue Super", "sue@safe.test"); await sue.waitForSelector("text=Today on site");
const sid = await newPage();
await signUp(sid, "Sid Sub", "sid@safepour.test"); await sid.waitForSelector("h1:has-text('Quality & inspections')");

// ---- incidents
await sue.goto(B + "/safety/incidents");
check(await sue.locator("nav.subnav a").count() === 5, "Safety has SWMS, incidents, permits, toolbox and site access tabs");
let fm = sue.locator("form[data-act=reportIncident]");
await fm.locator("[name=type]").selectOption("near_miss"); await fm.locator("[name=severity]").selectOption("high");
await fm.getByRole("button", { name: "Submit report" }).click();
check(/Say what happened/.test(await errIn(fm)), "Report needs a description");
await fm.locator("[name=title]").fill("Pallet fell from hoist"); await fm.locator("[name=location]").fill("L3 hoist landing"); await fm.locator("[name=notifiable]").check();
await fm.getByRole("button", { name: "Submit report" }).click();
check(await hasToast(sue, /INC-001 reported\. Notifiable/), "Near miss reported with notifiable warning");
check(await sue.locator(".notice-error", { hasText: "Notifiable incident" }).count() === 1, "Notifiable banner on the report");
fm = sue.locator("form[data-act=incidentAction]");
await fm.getByRole("button", { name: "Close out" }).click();
check(/corrective action/.test(await errIn(fm)), "Can't close without a corrective action");
await fm.locator("[name=corrective_action]").fill("Load restraint check added to hoist SWMS");
await fm.getByRole("button", { name: "Close out" }).click();
check(await hasToast(sue, /INC-001 closed out/), "Report closed out");

// ---- permits
await sue.goto(B + "/safety/permits");
fm = sue.locator("form[data-act=requestPermit]");
await fm.locator("[name=location]").fill("L3 riser"); await fm.locator("[name=contractor_id]").selectOption({ label: "Pour Co" });
await fm.locator("[name=conditions]").fill("Fire watch 60 min after");
await fm.getByRole("button", { name: "Request permit" }).click();
check(await hasToast(sue, /PTW-001 requested/), "Hot-work permit requested");
check(await sue.locator("text=Not yet approved — work must not start").count() === 1 && await sue.locator("form[data-act=permitAction]").count() === 0, "Requester can't approve their own permit");
await fresh(pm, APP + "#/app/tasks");
check(await pm.locator(".task-item", { hasText: "Approve permit PTW-001" }).count() === 1, "Permit approval is in the PM's tasks");
await pm.locator(".task-item", { hasText: "Approve permit PTW-001" }).click();
await pm.locator("form[data-act=permitAction]").getByRole("button", { name: "Approve permit" }).click();
check(await hasToast(pm, /PTW-001 approved/), "PM approves the permit");
await shot(pm, "f1-permit");
await fresh(sue, B + "/safety/permits");
check(await sue.locator("tr", { hasText: "PTW-001" }).locator("text=Live today").count() === 1, "Register shows the permit live today");
await sue.locator("table.register").getByRole("link", { name: "Hot work" }).click();
await sue.locator("form[data-act=permitAction]").getByRole("button", { name: "Close permit" }).click();
check(await hasToast(sue, /PTW-001 closed/), "Requester closes the permit when work is done");

// ---- toolbox
await sue.goto(B + "/safety/toolbox");
fm = sue.locator("form[data-act=toolbox]");
await fm.locator("[name=topic]").fill("Hoist loading");
await fm.getByRole("button", { name: "Save toolbox talk" }).click();
check(/Tick who attended/.test(await errIn(fm)), "Toolbox talk needs attendees");
await fm.locator("label", { hasText: "Wes Worker" }).locator("input").check();
await fm.getByRole("button", { name: "Save toolbox talk" }).click();
check(await hasToast(sue, /1 attendee/), "Toolbox talk recorded");

// ---- NCR
await sue.goto(B + "/quality/ncrs");
fm = sue.locator("form[data-act=createNcr]");
await fm.locator("[name=title]").fill("Slab cover short"); await fm.locator("[name=requirement]").fill("S-201 note 4: 40 mm cover"); await fm.locator("[name=contractor_id]").selectOption({ label: "Pour Co" });
await fm.getByRole("button", { name: "Raise NCR" }).click();
check(await hasToast(sue, /NCR-001 raised/), "NCR raised");
await sue.locator("form[data-act=advanceNcr]").getByRole("button").click();
check(/containment/.test(await errIn(sue.locator("form[data-act=advanceNcr]"))), "Containment needed before corrective action");
await sue.locator("form[data-act=updateNcr] [name=containment]").fill("Pour stopped, area tagged out");
await sue.locator("form[data-act=updateNcr]").getByRole("button", { name: "Save" }).click(); await hasToast(sue, /updated/);
await sue.locator("form[data-act=advanceNcr]").getByRole("button", { name: "Start corrective action" }).click();
check(await hasToast(sue, /moved to corrective action/), "NCR moves to corrective action");
await fresh(sid, APP + "#/app/tasks");
await sid.locator(".task-item", { hasText: "Respond to NCR-001" }).click();
fm = sid.locator("form[data-act=updateNcr]");
check(await fm.locator("[name=containment]").count() === 0, "Subcontractor only answers root cause and corrective action");
await fm.locator("[name=root_cause]").fill("Bar chairs crushed by foot traffic"); await fm.locator("[name=corrective_action]").fill("Replace chairs, re-check cover before pour");
await fm.getByRole("button", { name: "Save" }).click();
check(await hasToast(sid, /NCR-001 updated/), "Subcontractor responds to the NCR");
await fresh(sue, B + "/quality/ncrs");
await sue.locator("table.register").getByRole("link", { name: "Slab cover short" }).click();
await sue.locator("form[data-act=advanceNcr]").getByRole("button", { name: "Ready for verification" }).click(); await hasToast(sue, /ready for verification/);
await sue.locator("form[data-act=advanceNcr]").getByRole("button", { name: "Verify and close" }).click();
check(/other than the person who raised/.test(await errIn(sue.locator("form[data-act=advanceNcr]"))), "Raiser can't close their own NCR");
await fresh(pm, APP + "#/app/tasks");
await pm.locator(".task-item", { hasText: "Verify and close NCR-001" }).click();
await pm.locator("form[data-act=advanceNcr] [name=note]").fill("Cover re-checked, 42–48 mm");
await pm.locator("form[data-act=advanceNcr]").getByRole("button", { name: "Verify and close" }).click();
check(await hasToast(pm, /NCR-001 verified and closed/), "PM verifies and closes the NCR");

// ---- gate poster
await fresh(sue, B + "/safety/access");
check(await sue.locator(".qr-box svg").count() === 1, "QR poster rendered");
const wcode = await sue.evaluate(() => DB.workers[0].workerCode);
check(/^\d{6}$/.test(wcode) && await sue.locator("td.mono", { hasText: wcode }).count() === 1, "Worker codes listed for the office");
const gate = await sue.locator(".qr-poster p.mono").textContent();
await shot(sue, "f2-poster");
check(await sid.evaluate(() => document.body.innerHTML.includes("Site access")) === false, "Subcontractor has no site access tab");

// ---- anonymous visitor and worker at the gate
const phone = await newPage({ width: 400, height: 860 });
await phone.goto(gate.trim());
await phone.waitForSelector("text=I'm a visitor");
check(await phone.locator("h1", { hasText: "Tower D" }).count() === 1, "Gate opens without an account");
await phone.getByRole("button", { name: "I'm a visitor" }).click();
fm = phone.locator("form[data-act=gateVisitorIn]");
await fm.locator("[name=name]").fill("Vic Visitor"); await fm.locator("[name=company]").fill("Council"); await fm.locator("[name=purpose]").fill("Inspection"); await fm.locator("[name=host]").fill("Sue");
await fm.getByRole("button", { name: "Sign in" }).click();
check(/site rules/.test(await errIn(fm)), "Visitors must accept the site rules");
await fm.locator("[name=rules_accepted]").check();
await fm.getByRole("button", { name: "Sign in" }).click();
check(await hasToast(phone, /Welcome, Vic/), "Visitor signs in at the gate");
check(await phone.locator("text=you're signed in as a visitor").count() === 1, "Phone remembers the visitor for sign-out");
await shot(phone, "f3-gate");
const wes = await newPage({ width: 400, height: 860 });
await wes.goto(gate.trim()); await wes.getByRole("button", { name: "I'm working on site" }).click();
fm = wes.locator("form[data-act=gateWorker]");
await fm.locator("[name=worker_code]").fill(wcode === "000000" ? "111111" : "000000");
await fm.getByRole("button", { name: "Continue" }).click();
check(/wasn't found/.test(await errIn(fm)), "Wrong worker code refused");
await fm.locator("[name=worker_code]").fill(wcode); await fm.getByRole("button", { name: "Continue" }).click();
await wes.waitForSelector("h1:has-text('Hi Wes')");
await wes.getByRole("button", { name: "Sign in to site" }).click();
check(await hasToast(wes, /signed in, Wes/), "Worker signs in at the gate with their code");

// ---- office: register, muster, manual sign-in, missing sign-outs
await fresh(sue, B + "/workforce");
check(await sue.locator("tr", { hasText: "Wes Worker" }).locator("text=/^In /").count() === 1, "Gate sign-in shows in the register");
check(await sue.locator("section", { hasText: "Visitors on site" }).locator("text=Vic Visitor").count() === 1, "Visitor shows as on site");
await sue.getByRole("link", { name: "Muster list" }).click(); await sue.waitForSelector("h1:has-text('Emergency muster list')");
check(await sue.locator("h2", { hasText: "Workers (1)" }).count() === 1 && await sue.locator("h2", { hasText: "Visitors (1)" }).count() === 1, "Muster list has everyone on site");
await shot(sue, "f4-muster");
await sue.goto(B + "/workforce");
await sue.locator("tr", { hasText: "Wes Worker" }).getByRole("button", { name: "Sign out" }).click(); await hasToast(sue, /signed out/);
fm = sue.locator("tr", { hasText: "Wes Worker" }).locator("form[data-act=manualIn]");
await fm.getByRole("button", { name: "Sign in" }).click();
check(/reason/.test(await errIn(fm)), "Manual sign-in needs a reason");
await fm.locator("[name=reason]").fill("Phone flat"); await fm.getByRole("button", { name: "Sign in" }).click();
check(await hasToast(sue, /Wes Worker signed in/), "Supervisor signs a worker in by hand");
check(await sue.locator("tr", { hasText: "Wes Worker" }).locator("text=(by hand)").count() === 1, "Manual sign-in is labelled");
await db.query("update attendance set at = at - interval '1 day' where project_id = $1", [pid]);
await fresh(sue, B + "/workforce");
check(await sue.locator(".notice", { hasText: "1 missing sign-out" }).count() === 1, "Missing sign-out flagged");
await sue.getByRole("button", { name: "Record sign-out at 3:30 pm" }).click();
check(await hasToast(sue, /1 missing sign-out recorded/), "Missing sign-out recorded at 3:30 pm");

// ---- visitor leaves
await phone.getByRole("button", { name: /Sign out/ }).click();
check(await hasToast(phone, /Thanks for visiting/), "Visitor signs out from their phone");
check(await phone.locator("text=you're signed in as a visitor").count() === 0, "Phone forgets the visitor after sign-out");
await phone.goto(APP + "#/gate/not-a-code"); await phone.waitForSelector("text=Can't open the gate");
check(true, "Invalid gate code explained");

await browser.close(); await db.end();
console.log(fails.length ? `\n${fails.length} FAILURES\n${fails.join("\n")}` : "\nALL PASSED");
process.exit(fails.length ? 1 : 0);
