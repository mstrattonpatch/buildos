import { chromium } from "playwright-core";
import { CHROMIUM } from "./env.mjs";
const APP = "http://localhost:54321/buildos/app/";
const SHOTS = process.argv[2];
const browser = await chromium.launch({ executablePath: CHROMIUM });
const fails = [];
const check = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails.push(m); };
async function newPage() {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, timezoneId: "Australia/Sydney" })).newPage();
  page.on("pageerror", (e) => fails.push("pageerror: " + e.message)); page.on("dialog", (d) => d.accept());
  return page;
}
const hasToast = async (page, re) => { try { await page.locator(".toast", { hasText: re }).first().waitFor({ timeout: 8000 }); await page.evaluate(() => document.querySelectorAll(".toast").forEach((x) => x.remove())); return true; } catch { return false; } };
async function signUp(page, name, email) {
  await page.goto(APP + "#/signup");
  await page.fill("[name=full_name]", name); await page.fill("[name=email]", email); await page.fill("[name=password]", "builders123");
  await page.getByRole("button", { name: "Create account" }).click();
}
const fresh = async (page, url) => { await page.goto(url); await page.reload(); await page.waitForSelector("main.content, .site-body"); };

const dir = await newPage();
await signUp(dir, "Dee Director", "dee@access.test");
await dir.fill("[name=name]", "Access Co"); await dir.getByRole("button", { name: "Create company" }).click(); await dir.waitForSelector("main.content");
for (const [n, c] of [["North Tower", "P-N"], ["South Tower", "P-S"]]) {
  await dir.goto(APP + "#/app/projects/new"); await dir.waitForSelector("form[data-act=createProject]"); await dir.fill("[name=name]", n); await dir.fill("[name=code]", c); await dir.getByRole("button", { name: "Create project" }).click(); await dir.waitForSelector(`h1:has-text('${n}')`);
}
await dir.goto(APP + "#/app/settings");
await dir.fill("form[data-act=invite] [name=email]", "pat@access.test"); await dir.selectOption("form[data-act=invite] [name=role]", "project_manager");
await dir.getByRole("button", { name: "Save invitation" }).click(); await hasToast(dir, /Invitation saved/);
const pm = await newPage();
await signUp(pm, "Pat PM", "pat@access.test"); await pm.waitForSelector("main.content");
check(await pm.evaluate(() => DB.projects.length) === 2, "By default the new PM sees both projects");

// switch on
await fresh(dir, APP + "#/app/settings");
const card = dir.locator("section", { hasText: "Project access" });
await card.locator("input[value=assigned]").check(); await card.getByRole("button", { name: "Save" }).click();
check(await hasToast(dir, /only the projects they're added to/), "Director switches to project-only access");
await fresh(pm, APP + "#/app");
check(await pm.evaluate(() => DB.projects.length) === 0, "The PM now sees no projects");
check(await pm.locator("text=You haven't been added to a project yet").count() === 1, "…and is told why");

// add the PM to North Tower
await fresh(dir, APP + "#/app/settings");
await dir.locator("details.li", { hasText: "North Tower" }).locator("summary").click();
const box = dir.locator("details.li", { hasText: "North Tower" }).locator("label", { hasText: "Pat PM" }).locator("input");
await box.check(); await dir.locator("details.li", { hasText: "North Tower" }).getByRole("button", { name: "Save team" }).click();
check(await hasToast(dir, /Project team saved: 1 added/), "Director adds the PM to North Tower");
check(await dir.locator("details.li", { hasText: "North Tower" }).locator("label", { hasText: "Dee Director" }).locator("input").isDisabled(), "Directors are always on every team (shown locked)");
await SHOTS && dir.screenshot({ path: `${SHOTS}/access-settings.png`, fullPage: true });

await fresh(pm, APP + "#/app");
const names = await pm.evaluate(() => DB.projects.map((p) => p.name));
check(names.length === 1 && names[0] === "North Tower", `The PM sees only North Tower (${names.join(", ")})`);
const southId = await dir.evaluate(() => DB.projects.find((p) => p.name === "South Tower").id);
await pm.goto(APP + `#/app/projects/${southId}`); await pm.waitForSelector("main.content");
check(await pm.locator("main h1:has-text('South Tower')").count() === 0, "Opening South Tower's address directly shows nothing");

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n` + fails.join("\n") : "\nALL PASSED");
process.exit(fails.length ? 1 : 0);
