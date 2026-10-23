import { chromium } from "playwright-core";
import { CHROMIUM } from "./env.mjs";
const APP = "http://localhost:54321/buildos/app/";
const SHOTS = process.argv[2];
const browser = await chromium.launch({ executablePath: CHROMIUM });
const fails = [];
const check = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails.push(m); };
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, timezoneId: "Australia/Sydney" })).newPage();
page.on("pageerror", (e) => fails.push("pageerror: " + e.message)); page.on("dialog", (d) => d.accept());
const hasToast = async (re) => { try { await page.locator(".toast", { hasText: re }).first().waitFor({ timeout: 8000 }); await page.evaluate(() => document.querySelectorAll(".toast").forEach((x) => x.remove())); return true; } catch { return false; } };
const fresh = async (url) => { await page.goto(url); await page.reload(); await page.waitForSelector("main.content"); };

await page.goto(APP + "#/signup");
await page.fill("[name=full_name]", "Ada Admin"); await page.fill("[name=email]", "ada@auto.test"); await page.fill("[name=password]", "builders123");
await page.getByRole("button", { name: "Create account" }).click();
await page.fill("[name=name]", "Auto Co"); await page.getByRole("button", { name: "Create company" }).click(); await page.waitForSelector("main.content");

// An overdue defect, set up through the same calls the app makes.
await page.evaluate(async () => {
  const org = DB.org.id;
  const proj = (await rpc("create_project", { p_org: org, p: { name: "Tower", code: "T1" } })).id;
  const con = (await rpc("create_contractor", { p_org: org, p: { trading_name: "Pour Co" } })).id;
  await rpc("create_location", { p_project: proj, p_building: "A", p_level: "L1", p_zone: "" });
  await loadCompany(org);
  const loc = DB.locations.find((l) => l.projectId === proj).id;
  const due = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
  await rpc("create_defect", { p: { project_id: proj, title: "Cracked slab edge", location_id: loc, contractor_id: con, due_date: due } });
});

await fresh(APP + "#/app/automations");
check(await page.locator("h1:has-text('Automations')").count() === 1, "Admins can open Automations");
check(await page.locator("a.nav[href='#/app/automations']").count() === 1, "…from the side menu");
check(await page.locator("text=Nothing has triggered yet").count() === 1, "No runs yet");

// Turn off the defect rule, check: nothing happens.
const rule = (name) => page.locator(".li", { hasText: name });
await rule("Defect overdue").locator("input[name=enabled]").uncheck(); await rule("Defect overdue").getByRole("button", { name: "Save" }).click();
check(await hasToast(/./), "Turning a rule off saves");
await page.getByRole("button", { name: "Check now" }).click(); await hasToast(/./);
await fresh(APP + "#/app/automations");
check(await page.locator("text=Nothing has triggered yet").count() === 1, "A rule that's off doesn't run");
check(!(await rule("Defect overdue").locator("input[name=enabled]").isChecked()), "…and stays off");

// Back on, with a different warning period for tickets.
await rule("Defect overdue").locator("input[name=enabled]").check(); await rule("Defect overdue").getByRole("button", { name: "Save" }).click(); await hasToast(/./);
await rule("Ticket or licence expiring").locator("input[name=days]").fill("45"); await rule("Ticket or licence expiring").getByRole("button", { name: "Save" }).click(); await hasToast(/./);
await page.getByRole("button", { name: "Check now" }).click(); await hasToast(/./);
await fresh(APP + "#/app/automations");
check(await page.locator("table.register td", { hasText: "Defect overdue" }).count() === 1, "Check now records the overdue defect run");
check(await rule("Ticket or licence expiring").locator("input[name=days]").inputValue() === "45", "The warning period is saved");
await SHOTS && page.screenshot({ path: `${SHOTS}/automations.png`, fullPage: true });

// The bell shows it, and opening the bell marks it read.
const bell = page.locator("details[data-alerts]");
check(await bell.locator("text=is overdue: Cracked slab edge").count() === 1, "The alert is on the bell");
check(await page.evaluate(() => DB.alerts.filter((a) => !a.readAt).length) === 1, "…unread");
await bell.locator("summary").click();
await page.waitForFunction(() => DB.alerts.every((a) => a.readAt), null, { timeout: 8000 }).catch(() => {});
await fresh(APP + "#/app");
check(await page.evaluate(() => DB.alerts.length === 1 && DB.alerts.every((a) => a.readAt)), "Opening the bell marks alerts read (still read after a reload)");

// Checking again doesn't repeat the alert.
await page.goto(APP + "#/app/automations"); await page.waitForSelector("h1:has-text('Automations')");
await page.getByRole("button", { name: "Check now" }).click(); await hasToast(/./);
await fresh(APP + "#/app");
check(await page.evaluate(() => DB.alerts.length) === 1, "Checking again doesn't send the alert twice");

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n` + fails.join("\n") : "\nALL PASSED");
