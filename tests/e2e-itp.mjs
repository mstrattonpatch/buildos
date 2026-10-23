import { chromium } from "playwright-core";
import { CHROMIUM } from "./env.mjs";
const APP = "http://localhost:54321/buildos/app/";
const PHOTO = new URL("./fixtures/photo.png", import.meta.url).pathname;
const SHOTS = process.argv[2];
const browser = await chromium.launch({ executablePath: CHROMIUM });
const fails = [];
const check = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails.push(m); };
async function newPage() {
  const page = await (await browser.newContext({ timezoneId: "Australia/Sydney", viewport: { width: 1400, height: 900 } })).newPage();
  page.on("pageerror", (e) => fails.push("pageerror: " + e.message));
  page.on("dialog", (d) => d.accept());
  return page;
}
const hasToast = async (page, re) => { try { await page.locator(".toast", { hasText: re }).first().waitFor({ timeout: 8000 }); await page.evaluate(() => document.querySelectorAll(".toast").forEach((x) => x.remove())); return true; } catch { return false; } };
const errIn = (loc) => loc.locator(".form-msg .notice-error").first().textContent({ timeout: 8000 });
const ymd = (o) => { const d = new Date(); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
async function signUp(page, name, email) {
  await page.goto(APP + "#/signup");
  await page.fill("[name=full_name]", name); await page.fill("[name=email]", email); await page.fill("[name=password]", "builders123");
  await page.getByRole("button", { name: "Create account" }).click();
}
const card = (page, name) => page.locator(".point-card", { has: page.locator("h3", { hasText: name }) });

const pm = await newPage();
await signUp(pm, "Pat Manager", "pat@itp.test");
await pm.fill("[name=name]", "ITP Co"); await pm.getByRole("button", { name: "Create company" }).click();
await pm.getByRole("link", { name: "New project" }).first().click();
await pm.fill("[name=name]", "Tower A"); await pm.fill("[name=code]", "P-1");
await pm.getByRole("button", { name: "Create project" }).click();
await pm.waitForSelector("h1:has-text('Tower A')");
const pid = await pm.evaluate(() => DB.projects[0].id);
await pm.goto(APP + `#/app/projects/${pid}/programme`);
const tf = pm.locator("form[data-act=createTask]");
await tf.locator("[name=name]").fill("L4 slab pour"); await tf.locator("[name=is_milestone]").check(); await tf.locator("[name=forecast_start]").fill(ymd(1));
await tf.getByRole("button", { name: "Add to programme" }).click();
await hasToast(pm, /Milestone added/);

// Templates
await pm.goto(APP + "#/app/templates");
await pm.getByRole("button", { name: "Load starter templates" }).click();
check(await hasToast(pm, /3 starter templates added/), "Starter templates loaded");
check(await pm.locator("table.register tbody tr").count() === 3, "Three templates listed");
const nf = pm.locator("form[data-act=createTemplate]");
await nf.locator("[name=name]").fill("Blockwork");
await nf.getByRole("button", { name: "Create template" }).click();
check(/at least one|needs a name/.test(await errIn(nf)), "Template with no points refused");
await pm.getByRole("link", { name: "Concrete slab" }).click();
const ef = pm.locator("form[data-act=updateTemplate]");
await ef.waitFor();
check(await ef.locator(".pt-row").count() === 6, "Template editor shows its 6 points");
await ef.getByRole("button", { name: "Add point" }).click();
await ef.locator(".pt-row").last().locator("[name=pt_name]").fill("Saw cutting");
await ef.getByRole("button", { name: "Save as new version" }).click();
check(await hasToast(pm, /version 2/), "Editing a template saves version 2");
await shot(pm, "i1-template");

// Add ITP to the project
await pm.goto(APP + `#/app/projects/${pid}/quality`);
const af = pm.locator("form[data-act=applyTemplate]");
await af.locator("[name=template]").selectOption({ label: "Concrete slab · v2 · 7 points" });
await af.locator("[name=task]").selectOption({ index: 1 });
await af.getByRole("button", { name: "Add ITP" }).click();
check(await hasToast(pm, /ITP-01 added from Concrete slab v2/), "ITP added to the project from the template");
await pm.waitForSelector("text=0 of 7");
check(await pm.locator(".notice", { hasText: "hold points open" }).count() === 1, "Open hold points warned (task starts soon)");
check(await card(pm, "Pre-pour services").locator("text=Waiting on hold point").count() === 1, "Points after a hold point are locked");

// Submit formwork: needs 1 photo
const fw = card(pm, "Formwork");
await fw.getByRole("button", { name: "Submit for sign-off" }).click();
check(/at least 1 photo/.test(await errIn(fw)), "Submitting without the required photo is refused");
await fw.locator("[name=photos]").setInputFiles(PHOTO);
await fw.getByRole("button", { name: "Submit for sign-off" }).click();
check(await hasToast(pm, /submitted for sign-off/), "Formwork submitted with photo");
const reo = card(pm, "Reinforcement");
await reo.locator("[name=photos]").setInputFiles([PHOTO, PHOTO]);
await reo.getByRole("button", { name: "Submit for sign-off" }).click();
check(/Cover \(mm\)/.test(await errIn(reo)), "Measurement required");
await reo.locator("[name=photos]").setInputFiles([PHOTO, PHOTO]);
await reo.locator("[name=measurement]").fill("40");
await reo.getByRole("button", { name: "Submit for sign-off" }).click();
check(await hasToast(pm, /submitted/), "Reinforcement hold point submitted");
check(await card(pm, "Reinforcement").locator("text=You submitted this").count() === 1, "Submitter can't release their own hold point");
check((await card(pm, "Reinforcement").locator(".photo-grid .photo-ph").first().getAttribute("style")).includes("/object/sign/photos/"), "Point photos shown via signed links");

// Quality manager signs off
await pm.goto(APP + "#/app/settings");
await pm.fill("form[data-act=invite] [name=email]", "quinn@itp.test");
await pm.selectOption("form[data-act=invite] [name=role]", "quality_manager");
await pm.getByRole("button", { name: "Save invitation" }).click();
await hasToast(pm, /Invitation saved/);
const qm = await newPage();
await signUp(qm, "Quinn Quality", "quinn@itp.test");
await qm.waitForSelector("h1:has-text('Quality & inspections')");
await qm.goto(APP + "#/app/tasks");
check(await qm.locator(".task-item", { hasText: "Release hold point · ITP-01 Reinforcement" }).count() === 1, "Hold point appears in the quality manager's tasks");
const itpId = await qm.evaluate(() => DB.itps[0].id);
await qm.goto(APP + `#/app/projects/${pid}/quality/itp/${itpId}`);
await card(qm, "Reinforcement").getByRole("button", { name: "Release hold point" }).click();
check(await hasToast(qm, /Reinforcement: released/), "Quality manager releases the hold point");
await card(qm, "Formwork").getByRole("button", { name: "Accept" }).click();
check(await hasToast(qm, /Formwork: released/), "Inspection accepted");

// Now pre-pour is unlocked; PM submits, QM rejects → defect + blocked task
await pm.waitForTimeout(15500); // older than the refresh threshold
await pm.goto(APP + `#/app/projects/${pid}/quality/itp/${itpId}`);
const pre = card(pm, "Pre-pour services");
await pre.locator("[name=photos]").setInputFiles(PHOTO);
await pre.getByRole("button", { name: "Submit for sign-off" }).click();
check(await hasToast(pm, /submitted/), "Next point unlocked after release and submitted");
await qm.reload();
await qm.waitForSelector(".point-card");
const qpre = card(qm, "Pre-pour services");
await qpre.locator("[name=comment]").fill("Sleeve missing at grid C4");
await qpre.getByRole("button", { name: "Reject" }).click();
check(await hasToast(qm, /rejected — DEF-0001 raised and task flagged/), "Rejecting a hold point raises a defect and flags the task");
check(await card(qm, "Pre-pour services").locator("text=Sleeve missing at grid C4").count() === 1, "Rejection reason shown on the point");
await qm.goto(APP + `#/app/projects/${pid}/quality`);
check(await qm.locator("text=Pre-pour services & embeds failed").count() === 1, "Failed-inspection defect is in the register");
await qm.goto(APP + `#/app/projects/${pid}/programme`);
check(await qm.locator("tr", { hasText: "L4 slab pour" }).locator(".badge", { hasText: "Blocked" }).count() === 1, "Programme task shows Blocked");

// Template revised after ITP created → ITP keeps its version
await pm.goto(APP + "#/app/templates");
await pm.getByRole("link", { name: "Concrete slab" }).click();
await pm.locator("form[data-act=updateTemplate]").getByRole("button", { name: "Save as new version" }).click();
await hasToast(pm, /version 3/);
await pm.goto(APP + `#/app/projects/${pid}/quality/itp/${itpId}`);
check(await pm.locator("text=template is now v3; this ITP keeps its version").count() === 1, "ITP keeps its template version after the template changes");
check(await pm.getByRole("button", { name: "Print / save PDF" }).count() === 1, "Print / PDF available");
await pm.emulateMedia({ media: "print" });
check(await pm.locator(".sidebar-col").isHidden(), "Print layout hides navigation");
await pm.emulateMedia({ media: "screen" });
await shot(pm, "i2-itp");

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILURES\n${fails.join("\n")}` : "\nALL PASSED");
process.exit(fails.length ? 1 : 0);
async function shot(page, n) { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true }); }
