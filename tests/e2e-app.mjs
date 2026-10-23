import { chromium } from "playwright-core";
import { CHROMIUM } from "./env.mjs";
const APP = "http://localhost:54321/buildos/app/";
const PHOTO = new URL("./fixtures/photo.png", import.meta.url).pathname;
const SHOTS = process.argv[2];
const browser = await chromium.launch({ executablePath: CHROMIUM });
const fails = [];
const check = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails.push(m); };

async function newUser(viewport = { width: 1400, height: 900 }) {
  const ctx = await browser.newContext({ timezoneId: "Australia/Sydney", viewport });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => fails.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|fonts|status of 400/.test(m.text())) fails.push("console: " + m.text()); });
  page.on("dialog", (d) => d.accept());
  return page;
}
const hasToast = async (page, re) => { try { await page.locator(".toast", { hasText: re }).first().waitFor({ timeout: 8000 }); await page.evaluate(() => document.querySelectorAll(".toast").forEach((x) => x.remove())); return true; } catch { return false; } };
const toast = async (page) => { const t = page.locator(".toast").last(); await t.waitFor({ timeout: 8000 }); const s = await t.textContent(); await page.evaluate(() => document.querySelectorAll(".toast").forEach((x) => x.remove())); return s; };
const formErr = (page) => page.locator(".form-msg .notice-error").first().textContent({ timeout: 8000 });
const shot = (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
async function signUp(page, name, email) {
  await page.goto(APP);
  await page.waitForSelector("text=Sign in to Setout");
  await page.getByRole("link", { name: "Create an account" }).click();
  await page.fill("[name=full_name]", name);
  await page.fill("[name=email]", email);
  await page.fill("[name=password]", "builders123");
  await page.getByRole("button", { name: "Create account" }).click();
}

// ---- Alice: sign up, create company, project, people, defect
const alice = await newUser();
await alice.goto(APP);
check(await alice.locator("text=Sign in to Setout").count() === 1, "Signed-out visitors see the sign-in screen");
await shot(alice, "01-sign-in");
await signUp(alice, "Alice Chen", "alice@chen.test");
await alice.waitForSelector("text=Set up your company");
await shot(alice, "02-welcome");
check(true, "New account with no company goes to company set-up");
await alice.fill("[name=name]", "Chen Builders");
await alice.getByRole("button", { name: "Create company" }).click();
await alice.waitForSelector("text=Welcome to Setout, Alice");
await shot(alice, "03-getting-started");
check(true, "Company created; getting-started screen shown");

await alice.getByRole("link", { name: "New project" }).first().click();
await alice.fill("[name=name]", "Riverside Apartments");
await alice.fill("[name=code]", "P-2041");
await alice.fill("[name=contract_sum]", "18,000,000");
await alice.getByRole("button", { name: "Create project" }).click();
await alice.waitForSelector("h1:has-text('Riverside Apartments')");
check(/Contract: \$18\.00m/.test(await alice.locator(".page-meta").first().textContent()), "Project created with contract sum");

await alice.goto(APP + "#/app/people");
await alice.fill("#new-contractor [name=trading_name]", "AquaSeal Waterproofing");
await alice.fill("#new-contractor [name=trade]", "Waterproofing");
await alice.fill("#new-contractor [name=pl_expires]", "2030-01-01");
await alice.getByRole("button", { name: "Add contractor" }).click();
check(await hasToast(alice, /Contractor added/), "Contractor added");
await alice.fill("#new-worker [name=name]", "Will Worker");
await alice.selectOption("#new-worker [name=contractor_id]", { label: "AquaSeal Waterproofing" });
await alice.fill("#new-worker [name=white_card]", "WC12345");
await alice.selectOption("#new-worker [name=inducted_project_id]", { label: "Riverside Apartments" });
await alice.getByRole("button", { name: "Add worker" }).click();
check(await hasToast(alice, /Worker added/), "Worker added with White Card and induction");

const pid = await alice.evaluate(() => DB.projects[0].id);
await alice.goto(APP + `#/app/projects/${pid}/quality`);
const lf = alice.locator("form[data-act=createLocation]"); await lf.locator("[name=building]").fill("B"); await lf.locator("[name=level]").fill("L3"); await lf.locator("[name=zone]").fill("Unit 304");
await alice.getByRole("button", { name: "Add location" }).click();
check(await hasToast(alice, /Location added/), "Location added");

await alice.goto(APP + `#/app/projects/${pid}/quality/new`);
await alice.locator("[data-photo-input]").setInputFiles(PHOTO);
await alice.fill("[name=title]", "Membrane lap short at shower hob");
await alice.selectOption("[name=locationId]", { label: "B › L3 › Unit 304" });
await alice.locator("label.chip-radio", { hasText: "AquaSeal" }).click();
await alice.fill("[name=dueDate]", "2030-01-05");
await alice.getByRole("button", { name: "Raise & assign" }).click();
check(await hasToast(alice, /DEF-0001 raised and assigned/), "Defect raised and assigned (with photo upload)");
await alice.getByRole("link", { name: "Membrane lap short at shower hob" }).click();
await alice.waitForSelector(".photo-grid");
check((await alice.locator(".photo-grid .photo-ph").first().getAttribute("style")).includes("/object/sign/photos/"), "Photo shown via a signed private link");

// invitations
await alice.goto(APP + "#/app/settings");
await alice.fill("[name=email]", "sam@aquaseal.test");
await alice.selectOption("form[data-act=invite] [name=role]", "subcontractor_admin");
await alice.getByRole("button", { name: "Save invitation" }).click();
check(/Link a subcontractor admin/.test(await formErr(alice)), "Invite validation: subcontractor needs their company");
await alice.selectOption("form[data-act=invite] [name=contractor]", { label: "AquaSeal Waterproofing" });
await alice.getByRole("button", { name: "Save invitation" }).click();
check(await hasToast(alice, /Invitation saved/), "Subcontractor invited");
await alice.fill("[name=email]", "will@aquaseal.test");
await alice.selectOption("form[data-act=invite] [name=role]", "worker");
await alice.selectOption("form[data-act=invite] [name=worker]", { label: "Will Worker" });
await alice.getByRole("button", { name: "Save invitation" }).click();
await hasToast(alice, /Invitation saved/);
await shot(alice, "04-team");

// ---- Sam (subcontractor): joins via invite, rectifies
const sam = await newUser();
await signUp(sam, "Sam Sub", "sam@aquaseal.test");
await sam.waitForSelector("h1:has-text('Quality & inspections')");
check(true, "Invited subcontractor joins automatically and lands on Quality");
check(await sam.locator("a.nav", { hasText: "Commercial" }).count() === 0, "Subcontractor has no Commercial menu");
await sam.getByRole("link", { name: "Membrane lap short at shower hob" }).click();
await sam.getByRole("button", { name: "Mark as rectifying" }).click();
await hasToast(sam, /rectification started/);
await sam.fill("[name=note]", "Relapped 150mm up hob");
await sam.locator("[name=evidence]").setInputFiles(PHOTO);
await sam.getByRole("button", { name: "Submit for review" }).click();
check(await hasToast(sam, /submitted for verification/), "Subcontractor submits rectification with evidence photo");
await sam.goto(APP + `#/app/projects/${pid}/commercial`);
check(await sam.locator("text=Not found").count() === 1, "Subcontractor can't open Commercial");

// ---- Alice verifies, variations, diary
await alice.goto(APP + `#/app/projects/${pid}/quality`);
await alice.reload();
await alice.getByRole("link", { name: "Membrane lap short at shower hob" }).click();
await alice.getByRole("button", { name: "Verify & close" }).click();
check(await hasToast(alice, /verified and closed/), "Builder verifies and closes the defect");
await alice.goto(APP + `#/app/projects/${pid}/commercial`);
await alice.fill("#new-variation [name=title]", "Extra steel — L4 transfer beam");
await alice.fill("#new-variation [name=amount]", "48,200");
await alice.getByRole("button", { name: "Submit for approval" }).click();
check(await hasToast(alice, /VAR-001 submitted/), "Variation submitted");
await alice.locator("form[data-act=variation]").getByRole("button", { name: "Approve" }).click();
check(await hasToast(alice, /approved/), "Director approves variation");
check((await alice.locator(".metric", { hasText: "Approved contract value" }).locator(".m-value").textContent()) === "$18.05m", "Approved contract value updated");
await alice.goto(APP + `#/app/projects/${pid}/diary`);
await alice.fill("[name=notes]", "Waterproofing L3 complete");
await alice.getByRole("button", { name: "Submit diary" }).click();
check(await hasToast(alice, /Diary submitted/), "Diary submitted");

// ---- Will (worker): signs in to site
const will = await newUser({ width: 400, height: 860 });
await signUp(will, "Will Worker", "will@aquaseal.test");
await will.waitForSelector("text=Hi Will");
await will.getByRole("button", { name: "Sign in to site" }).click();
check(await hasToast(will, /signed in/), "Worker signs in to site");
await shot(will, "05-worker");

// ---- Profile & sign out / sign in
await alice.goto(APP + "#/app/profile");
await alice.fill("form[data-act=profile] [name=full_name]", "Alice Chen-Smith");
await alice.getByRole("button", { name: "Save profile" }).click();
check(await hasToast(alice, /Profile saved/), "Profile updated");
await alice.locator("summary.avatar").click();
await alice.locator(".menu-panel [data-signout]").click();
await alice.waitForSelector("text=Sign in to Setout");
await alice.fill("[name=email]", "alice@chen.test");
await alice.fill("[name=password]", "wrong-password");
await alice.getByRole("button", { name: "Sign in" }).click();
check(/incorrect/.test(await formErr(alice)), "Wrong password is refused");
await alice.fill("[name=password]", "builders123");
await alice.getByRole("button", { name: "Sign in" }).click();
await alice.waitForSelector("text=Company overview");
check(true, "Signs back in; data still there");
check(await alice.locator("text=Riverside Apartments").count() > 0, "Project persisted in the database");
await shot(alice, "06-control-centre");

// ---- Bob: separate company, loads sample data, can't see Alice's
const bob = await newUser();
await signUp(bob, "Bob Other", "bob@other.test");
await bob.waitForSelector("text=Set up your company");
await bob.fill("[name=name]", "Other Co");
await bob.getByRole("button", { name: "Create company" }).click();
await bob.getByRole("button", { name: "Load sample projects" }).click();
check(await hasToast(bob, /Sample projects loaded/), "Sample projects load into a new company");
check(await bob.locator("text=Harbour St Fit-out").count() > 0, "Sample portfolio visible");
check(await bob.locator("text=Chen Builders").count() === 0 && (await bob.evaluate(() => DB.projects.length)) === 4, "Bob sees only his own company's projects");
const riv = await bob.evaluate(() => DB.projects.find((p) => p.code === "P-2041").id);
await bob.goto(APP + `#/app/projects/${riv}`);
await bob.waitForSelector("text=Needs your attention today");
await shot(bob, "07-sample-overview");
await bob.goto(APP + `#/app/projects/${riv}/quality/itp/` + (await bob.evaluate(() => DB.itps.find((i) => i.ref === "ITP-07").id)));
await bob.getByRole("button", { name: "Release hold point" }).click();
check(await hasToast(bob, /released/), "Sample hold point released");

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILURES\n${fails.join("\n")}` : "\nALL PASSED");
process.exit(fails.length ? 1 : 0);
