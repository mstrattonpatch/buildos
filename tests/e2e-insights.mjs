import { chromium } from "playwright-core";
import { CHROMIUM } from "./env.mjs";
import fs from "node:fs";
const APP = "http://localhost:54321/buildos/app/";
const SHOTS = process.argv[2];
const browser = await chromium.launch({ executablePath: CHROMIUM });
const fails = [];
const check = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails.push(m); };
const page = await (await browser.newContext({ timezoneId: "Australia/Sydney", viewport: { width: 1400, height: 900 }, acceptDownloads: true })).newPage();
page.on("pageerror", (e) => fails.push("pageerror: " + e.message)); page.on("dialog", (d) => d.accept());
const shot = async (n) => SHOTS && page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
const kpiVal = async (label) => (await page.locator(".kpi", { has: page.locator(".m-label", { hasText: new RegExp(`^${label}$`) }) }).locator(".m-value").textContent()).trim();
const q = async () => new URLSearchParams(await page.evaluate(() => location.hash.split("?")[1] || ""));

await page.goto(APP + "#/signup");
await page.fill("[name=full_name]", "Ivy Insight"); await page.fill("[name=email]", "ivy@ins.test"); await page.fill("[name=password]", "builders123");
await page.getByRole("button", { name: "Create account" }).click();
await page.fill("[name=name]", "Insight Co"); await page.getByRole("button", { name: "Create company" }).click();
await page.getByRole("button", { name: "Load sample projects" }).click();
await page.waitForSelector(".viz-card");
// Some approved hours across projects and days
await page.evaluate(async () => {
  const ids = [];
  const ws = DB.workers.slice(0, 4);
  for (let d = 1; d <= 10; d++) for (const [i, w] of ws.entries()) {
    const p = DB.projects[i % DB.projects.length], date = ymd(new Date(Date.now() - d * 86400000));
    try { ids.push((await rpc("create_timesheet", { p_project: p.id, p: { worker_id: w.id, date, hours: 6 + (i % 3) } })).id); } catch (e) { window.__tsErr = e.message; }
  }
  await rpc("timesheet_action", { p_ids: ids, p_action: "approve" });
  await refresh();
});
console.log("timesheet error:", await page.evaluate(() => window.__tsErr));
await page.getByRole("link", { name: "Insights" }).first().click();
await page.waitForSelector("#ins-body .kpi");
check(/Live/.test(await page.locator("[data-ins-updated]").textContent()), "Insights opens in live mode");
const totalOpen = Number(await kpiVal("Open defects"));
check(totalOpen > 0 && /h$/.test(await kpiVal("Labour hours")), `KPIs show live figures (${totalOpen} open, ${await kpiVal("Labour hours")})`);
await shot("i1-overview");

// cross-filter: click a project bar
const card = page.locator(".viz-card", { hasText: "Open defects by project" });
const row = card.locator(".hb-row").nth(1), name = (await row.locator(".hb-label").textContent()).trim(), n = Number((await row.locator(".hb-val").textContent()).trim());
await row.click(); await page.waitForTimeout(300);
check((await q()).get("p") && Number(await kpiVal("Open defects")) === n, `Clicking ${name} filters every KPI (${n} open)`);
check(await card.locator(".hb-row.xf-off").count() >= 1 && await card.locator(".hb-row[aria-pressed=true]").count() === 1, "The chart that was clicked dims the other bars instead of hiding them");
check(await page.locator(".slicers .chip", { hasText: name }).count() === 1, "Active filter shows as a chip");
await page.locator(".slicers a", { hasText: "Clear filters" }).click(); await page.waitForTimeout(300);
check(Number(await kpiVal("Open defects")) === totalOpen, "Clearing filters restores the totals");

// slicer menu
await page.locator(".slicer summary", { hasText: "Companies" }).click();
await page.locator(".slicer", { hasText: "Companies" }).locator(".slicer-opt input").first().check();
await page.locator(".slicer summary", { hasText: "Companies" }).click(); await page.waitForTimeout(300);
check((await q()).get("c") && await page.locator(".slicers .chip[data-active=true]").count() >= 1, "Company slicer filters the page and is kept in the URL");
await page.goto(APP + "#/app/insights?range=30"); await page.waitForSelector("#ins-body .kpi");

// time cross-filter
await page.locator(".viz-card", { hasText: "Labour hours per" }).locator(".viz-hit.xf").nth(25).click(); await page.waitForTimeout(300);
const b = (await q()).get("b");
check(!!b && await page.locator(".slicers .chip", { hasText: "only" }).count() === 1, `Clicking a column focuses on that ${b?.length === 10 ? "day" : "period"}`);

// matrix sort
await page.goto(APP + "#/app/insights?range=90"); await page.waitForSelector("[data-matrix]");
await page.locator("[data-matrix] th a", { hasText: "Overdue" }).click(); await page.waitForTimeout(300);
const od = (await page.locator("[data-matrix] tbody tr td:nth-child(4)").allTextContents()).map(Number);
check(od.length > 1 && od.every((v, i) => !i || od[i - 1] >= v), `Matrix sorts by a clicked column (${od.join(", ")})`);
const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export table" }).click()]);
check(/Project,Verified %,Open defects/.test(fs.readFileSync(await dl.path(), "utf8").replace(/"/g, "")), "Export downloads the current table");

// quality what-if
await page.getByRole("link", { name: "Quality", exact: true }).last().click(); await page.waitForSelector(".whatif");
const setSlider = async (nm, v) => { await page.locator(`[data-ins-slider][name=${nm}]`).evaluate((el, val) => { el.value = val; el.dispatchEvent(new Event("input", { bubbles: true })); }, v); await page.waitForTimeout(200); };
await setSlider("wraise", 1); await setSlider("wclose", 5);
const res = await page.locator(".whatif-result").textContent();
check(/Clear in \d+ weeks?/.test(res), `Closing 5 and raising 1 a week clears the backlog (${res.trim().slice(0, 40)})`);
await setSlider("wclose", 0.5);
check(/never clears/.test(await page.locator(".whatif-result").textContent()), "Closing fewer than are raised: the backlog never clears");
check((await q()).get("wclose") === "0.5", "What-if values are kept in the URL");
await shot("i2-quality");

// commercial what-if
await page.getByRole("link", { name: "Commercial", exact: true }).last().click(); await page.waitForSelector(".whatif");
const before = await page.locator(".whatif-result b").textContent();
await setSlider("wc", 30);
const after = await page.locator(".whatif-result").textContent();
check(before !== (await page.locator(".whatif-result b").textContent()) && /worse than today's forecast/.test(after), `Cost still to come +30% lowers the margin (${before} → ${after.trim().slice(0, 30)})`);
check(await page.locator("[data-matrix] th", { hasText: "What-if margin" }).count() === 1, "Matrix adds a what-if margin column");
await shot("i3-commercial");

// live refresh picks up a change made elsewhere
await page.getByRole("link", { name: "Overview", exact: true }).last().click(); await page.waitForSelector("#ins-body .kpi");
const open0 = Number(await kpiVal("Open defects"));
await page.evaluate(async () => { const p = DB.projects[0], loc = DB.locations.find((l) => l.projectId === p.id); await sb.rpc("create_defect", { p: { project_id: p.id, title: "Live test defect", location_id: loc.id, trade: "Painting", priority: "low" } }); });
check(Number(await kpiVal("Open defects")) === open0, "A change elsewhere isn't shown until the next refresh");
await page.waitForFunction((n) => { const el = [...document.querySelectorAll(".kpi")].find((k) => k.querySelector(".m-label")?.textContent === "Open defects"); return el && Number(el.querySelector(".m-value").textContent) === n + 1; }, open0, { timeout: 45000 }).catch(() => {});
check(Number(await kpiVal("Open defects")) === open0 + 1, "Live mode picks up the new defect within 30 seconds");

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILURES\n${fails.join("\n")}` : "\nALL PASSED");
process.exit(fails.length ? 1 : 0);
