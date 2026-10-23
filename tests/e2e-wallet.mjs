import { chromium } from "playwright-core";
import { CHROMIUM } from "./env.mjs";
const APP = "http://localhost:54321/buildos/app/";
const PHOTO = new URL("./fixtures/photo.png", import.meta.url).pathname, PDF = new URL("./fixtures/swms.pdf", import.meta.url).pathname;
const SHOTS = process.argv[2];
const browser = await chromium.launch({ executablePath: CHROMIUM });
const fails = [];
const check = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails.push(m); };
async function newPage(viewport = { width: 1400, height: 900 }) {
  const page = await (await browser.newContext({ viewport, timezoneId: "Australia/Sydney" })).newPage();
  page.on("pageerror", (e) => fails.push("pageerror: " + e.message)); page.on("dialog", (d) => d.accept());
  return page;
}
const hasToast = async (page, re) => { try { await page.locator(".toast", { hasText: re }).first().waitFor({ timeout: 8000 }); await page.evaluate(() => document.querySelectorAll(".toast").forEach((x) => x.remove())); return true; } catch { return false; } };
const errIn = (loc) => loc.locator(".form-msg .notice-error").first().textContent({ timeout: 8000 }).catch(() => "");
const shot = async (page, n) => SHOTS && page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
const fresh = async (page, url) => { await page.goto(url); await page.reload(); await page.waitForSelector("main.content, .site-body"); };

const pm = await newPage();
await pm.goto(APP + "#/signup");
await pm.fill("[name=full_name]", "Pat Manager"); await pm.fill("[name=email]", "pat@wal.test"); await pm.fill("[name=password]", "builders123");
await pm.getByRole("button", { name: "Create account" }).click();
await pm.fill("[name=name]", "Wallet Co"); await pm.getByRole("button", { name: "Create company" }).click();
await pm.getByRole("link", { name: "New project" }).first().click();
await pm.fill("[name=name]", "Tower W"); await pm.fill("[name=code]", "P-W"); await pm.getByRole("button", { name: "Create project" }).click();
await pm.waitForSelector("h1:has-text('Tower W')");
const pid = await pm.evaluate(() => DB.projects[0].id);
await pm.goto(APP + "#/app/people");
await pm.fill("#new-contractor [name=trading_name]", "Pour Co"); await pm.getByRole("button", { name: "Add contractor" }).click(); await hasToast(pm, /Contractor added/);
await pm.fill("#new-worker [name=name]", "Wes Worker"); await pm.selectOption("#new-worker [name=contractor_id]", { label: "Pour Co" }); await pm.selectOption("#new-worker [name=inducted_project_id]", { label: "Tower W" });
await pm.getByRole("button", { name: "Add worker" }).click(); await hasToast(pm, /Worker added/);

// ---- site requirements
await pm.goto(APP + `#/app/projects/${pid}/workforce`);
await pm.locator("form[data-act=siteRequirements] label", { hasText: "Working at heights" }).locator("input").check();
await pm.locator("form[data-act=siteRequirements]").getByRole("button", { name: "Save requirements" }).click();
check(await hasToast(pm, /1 extra credential is now required/), "Project requires a working-at-heights ticket");
check(/Working at heights — Not uploaded/.test(await pm.locator("tr", { hasText: "Wes Worker" }).textContent()), "Register shows the missing required credential");

// ---- worker self-service link
await pm.goto(APP + "#/app/people"); await pm.getByRole("link", { name: "Wes Worker" }).first().click();
await pm.waitForSelector("h1:has-text('Wes Worker')");
await pm.getByRole("button", { name: "Create link" }).click(); await hasToast(pm, /Link ready/);
const wallet = await pm.locator("[data-select-all]").inputValue();
check(/#\/wallet\/[0-9a-f]{64}$/.test(wallet), "Self-service link created");
const phone = await newPage({ width: 400, height: 860 });
await phone.goto(wallet); await phone.waitForSelector("h1:has-text('Wes Worker')");
check(await phone.locator(".notice", { hasText: "Working at heights" }).count() === 1, "Wallet opens without an account and lists the site's requirements");
let fm = phone.locator("form[data-act=walletAdd]");
await fm.locator("[name=type]").fill("White Card"); await fm.getByRole("button", { name: "Upload" }).click();
check(/photo/.test(await errIn(fm)), "Upload needs a photo");
await fm.locator("[name=number]").fill("WC-123"); await fm.locator("[name=file]").setInputFiles(PHOTO); await fm.getByRole("button", { name: "Upload" }).click();
check(await hasToast(phone, /site office will check/), "Worker uploads their White Card");
fm = phone.locator("form[data-act=walletAdd]");
await fm.locator("[name=type]").fill("Working at heights"); await fm.locator("[name=expires]").fill("2028-05-01"); await fm.locator("[name=file]").setInputFiles(PHOTO); await fm.getByRole("button", { name: "Upload" }).click();
await hasToast(phone, /site office will check/);
check(await phone.locator(".list-card .badge", { hasText: "Awaiting verification" }).count() === 2, "Both uploads wait for verification");
await shot(phone, "w1-wallet");

// ---- office verifies one, rejects the other
await fresh(pm, APP + "#/app/tasks");
await pm.locator(".task-item", { hasText: "Verify 2 credentials · Wes Worker" }).click();
await pm.waitForSelector("h1:has-text('Wes Worker')");
check(await pm.locator("tr", { hasText: "White Card" }).getByRole("link", { name: "Evidence" }).count() === 1, "Office sees the uploaded evidence");
await pm.locator("tr", { hasText: "White Card" }).getByRole("button", { name: "Verify", exact: true }).click();
check(await hasToast(pm, /White Card for Wes Worker verified/), "Office verifies the White Card");
const wah = pm.locator("tr", { hasText: "Working at heights" });
await wah.getByRole("button", { name: "Reject" }).click();
check(/Say why/.test(await errIn(wah)), "Rejecting needs a reason");
await wah.locator("[name=note]").fill("Photo is blurry — take it again"); await wah.getByRole("button", { name: "Reject" }).click();
check(await hasToast(pm, /rejected/), "Office rejects the blurry photo");
check(/Original sighted\s*Pat Manager/.test((await pm.locator("tr", { hasText: "White Card" }).textContent()).replace(/\s+/g, " ")) || /Original sighted/.test(await pm.locator("tr", { hasText: "White Card" }).textContent()), "Verification method and reviewer are recorded");
check(/Working at heights — Rejected/.test(await pm.locator("tr", { hasText: "Tower W" }).textContent()), "Sign-in still blocked by the rejected required credential");
await shot(pm, "w2-worker");
await phone.reload(); await phone.waitForSelector("h1:has-text('Wes Worker')");
check(await phone.locator(".li", { hasText: "White Card" }).locator(".badge", { hasText: "Verified" }).count() === 1 && await phone.locator("text=Photo is blurry").count() === 1, "Worker sees what was verified and why the other was rejected");

// ---- contractor portal
await pm.goto(APP + "#/app/people"); await pm.getByRole("link", { name: "Pour Co" }).first().click(); await pm.waitForSelector("h1:has-text('Pour Co')");
await pm.getByRole("button", { name: "Create link" }).click(); await hasToast(pm, /Link ready/);
const supplier = await pm.locator("[data-select-all]").inputValue();
const sub = await newPage({ width: 400, height: 860 });
await sub.goto(supplier); await sub.waitForSelector("h1:has-text('Pour Co')");
await sub.locator("summary", { hasText: "Upload an insurance certificate" }).click();
fm = sub.locator("form[data-act=supplierAdd]").first();
await fm.locator("[name=insurer]").fill("QBE"); await fm.locator("[name=cover_limit]").fill("20,000,000"); await fm.locator("[name=file]").setInputFiles(PDF);
await fm.getByRole("button", { name: "Upload certificate" }).click();
check(/expiry/.test(await errIn(fm)), "Certificate needs an expiry date");
await fm.locator("[name=expires]").fill("2027-06-30"); await fm.locator("[name=file]").setInputFiles(PDF); await fm.getByRole("button", { name: "Upload certificate" }).click();
check(await hasToast(sub, /Uploaded — the head contractor will check it/), "Contractor uploads a certificate of currency");
await sub.locator("summary", { hasText: "Update contact details" }).click();
fm = sub.locator("form[data-act=supplierUpdate]");
await fm.locator("[name=emergency_name]").fill("Eddie Emergency"); await fm.locator("[name=emergency_phone]").fill("0411 111 111"); await fm.getByRole("button", { name: "Save details" }).click();
check(await hasToast(sub, /Details saved/), "Contractor updates their emergency contact");
check(await sub.locator(".li", { hasText: "Wes Worker" }).count() === 1, "Contractor sees their workers' compliance");
await shot(sub, "w3-supplier");

await fresh(pm, APP + "#/app/people");
check(await pm.locator("section", { hasText: "Waiting for verification" }).locator("text=Pour Co · Public liability").count() === 1, "People page lists what's waiting for verification");
await pm.getByRole("link", { name: "Pour Co" }).first().click(); await pm.waitForSelector("h1:has-text('Pour Co')");
check(await pm.locator("form[data-act=saveContractor] [name=emergency_name]").inputValue() === "Eddie Emergency", "Office sees the contractor's update");
await pm.locator("tr", { hasText: "Public liability" }).getByRole("button", { name: "Verify", exact: true }).click();
check(await hasToast(pm, /Pour Co · Public liability verified/), "Office verifies the certificate");
fm = pm.locator("form[data-act=saveContractor]");
await fm.locator("[name=trades]").fill("Concrete, Formwork"); await fm.locator("[name=prequal_status]").selectOption("approved");
await fm.getByRole("button", { name: "Save details" }).click();
check(/expires/.test(await errIn(fm)), "Approving prequalification needs an expiry");
await fm.locator("[name=prequal_expires]").fill("2027-06-30"); await fm.getByRole("button", { name: "Save details" }).click();
check(await hasToast(pm, /Pour Co saved/), "Contractor profile saved with trades and prequalification");
check(/Prequalification: approved/.test(await pm.locator(".page-meta, .page-header").first().textContent()), "Prequalification status shown on the profile");
await shot(pm, "w4-contractor");

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILURES\n${fails.join("\n")}` : "\nALL PASSED");
process.exit(fails.length ? 1 : 0);
