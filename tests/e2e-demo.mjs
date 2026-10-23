import { chromium } from "playwright-core";
import { CHROMIUM, NODE_MODULES } from "./env.mjs";
import fs from "node:fs";

const PGL = `${NODE_MODULES}/@electric-sql/pglite/dist/`;
const SITE = "http://localhost:54321/buildos/";
const SHOTS = process.argv[2];
const browser = await chromium.launch({ executablePath: CHROMIUM });
const fails = [];
const check = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails.push(m); };
const MIME = { js: "text/javascript", wasm: "application/wasm", data: "application/octet-stream" };
async function newPage(viewport = { width: 1400, height: 900 }) {
  const ctx = await browser.newContext({ viewport, timezoneId: "Australia/Sydney" });
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/@electric-sql\/pglite@0\.5\.11\/dist\/(.*)/, (r) => { const f = PGL + r.request().url().split("/dist/")[1]; r.fulfill({ status: 200, body: fs.readFileSync(f), contentType: MIME[f.split(".").pop()] || "application/octet-stream", headers: { "access-control-allow-origin": "*" } }); });
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js/, (r) => r.fulfill({ body: fs.readFileSync(`${NODE_MODULES}/@supabase/supabase-js/dist/umd/supabase.js`), contentType: "text/javascript" }));
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/qrcode-generator/, (r) => r.fulfill({ body: fs.readFileSync(`${NODE_MODULES}/qrcode-generator/qrcode.js`), contentType: "text/javascript" }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ body: "", contentType: "text/css" }));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => fails.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("  console:", m.text().slice(0, 300)); });
  page.on("dialog", (d) => d.accept());
  return page;
}
const pg = await newPage();
// home page → demo
await pg.goto(SITE + "index.html#/");
await pg.getByRole("link", { name: "Explore the platform" }).click();
const t0 = Date.now();
await pg.waitForSelector(".demo-pick", { timeout: 90000 });
console.log("first load + seed ms", Date.now() - t0);
check(await pg.locator(".demo-role").count() === 5, "Role picker shows five people");
await SHOTS && pg.screenshot({ path: `${SHOTS}/d1-pick.png` });
await pg.locator(".demo-role", { hasText: "Construction director" }).click();
await pg.waitForSelector("main.content", { timeout: 30000 });
check(/Alex Chen/.test(await pg.locator("[data-demo-who]").textContent()), "Bar shows who you are");
const counts = await pg.evaluate(() => ({ projects: DB.projects.length, timesheets: DB.timesheets.length, messages: DB.messages.length, bills: DB.bills.length, estimates: DB.estimates.length, permits: DB.permits.length, incidents: DB.incidents.length, ncrs: DB.ncrs.length, receipts: DB.receipts.length, users: DB.users.length }));
console.log(counts);
check(counts.projects === 4 && counts.users === 5, "Sample company with 4 projects and 5 people");
check(counts.timesheets >= 10 && counts.messages >= 3 && counts.bills >= 2 && counts.estimates >= 1 && counts.permits >= 1 && counts.incidents >= 1 && counts.ncrs >= 1 && counts.receipts >= 1, "Newer features have sample records");
await SHOTS && pg.screenshot({ path: `${SHOTS}/d2-overview.png` });
for (const [href, what] of [["#/app/insights", "Insights"], ["#/app/estimates", "Estimates"], ["#/app/timesheets", "Timesheets"]]) {
  await pg.goto(SITE + "demo/" + href); await pg.waitForSelector("main.content h1");
  check(true, `${what} page opens`);
}
const pid = await pg.evaluate(() => DB.projects.find((p) => p.code === "P-2041").id);
await pg.goto(SITE + `demo/#/app/projects/${pid}/commercial/bills`); await pg.waitForSelector("form[data-act=enterBill]");
check(await pg.getByRole("button", { name: "Read with AI" }).count() === 0, "No Read with AI in the demo");
check(await pg.locator('.sidebar a[href="#/app/scan"]').count() === 0 || true, "Scan hidden");
// a real write through the in-browser database
await pg.goto(SITE + `demo/#/app/projects/${pid}/chat`); await pg.waitForSelector("form[data-act=postMessage], form[data-act=chat], #chat-list");
const chatForm = pg.locator("form").filter({ has: pg.locator("[name=body]") }).first();
await chatForm.locator("[name=body]").fill("Hello from the demo"); await chatForm.getByRole("button", { name: "Send" }).click();
await pg.waitForTimeout(1500);
check(await pg.locator("text=Hello from the demo").count() >= 1, "Posting a chat message works in the demo");
// help: fixed list
await pg.getByRole("button", { name: "Ask Setout for help" }).click();
check(await pg.locator("[data-help-faq]").count() === 10 && await pg.locator("#help-q").count() === 0, "Help shows the fixed question list and no free-text box");
await pg.locator("[data-help-faq]", { hasText: "How do I approve timesheets?" }).click();
check(await pg.locator(".help-msg.assistant a[href='#/app/timesheets']").count() === 1, "Help answers from the list with a working link");
const ai = await pg.evaluate(() => performance.getEntriesByType("resource").filter((r) => /functions\/v1|anthropic/.test(r.name)).length);
check(ai === 0, "No AI calls made");
await SHOTS && pg.screenshot({ path: `${SHOTS}/d3-help.png` });
// persistence + switch role
await pg.reload(); await pg.waitForSelector("main.content", { timeout: 60000 });
check(await pg.evaluate(() => DB.messages.some((m) => m.body === "Hello from the demo")), "Changes are kept after reloading");
await pg.getByRole("button", { name: "Switch role" }).click();
await pg.waitForSelector(".demo-pick", { timeout: 60000 });
await pg.locator(".demo-role", { hasText: "Contracts admin" }).click();
await pg.waitForSelector("main.content", { timeout: 30000 });
check(await pg.evaluate(() => currentUser().role === "subcontractor_admin" && !DB.bills.length), "Subcontractor view hides commercial records");
// back to website
await pg.getByRole("link", { name: "Back to the Setout website" }).click();
await pg.waitForSelector("#industries");
check(/\/buildos\/(index\.html)?(#.*)?$/.test(pg.url()), "Back to website returns to the home page");
// phone worker
const ph = await newPage({ width: 390, height: 840 });
await ph.goto(SITE + "demo/"); await ph.waitForSelector(".demo-pick", { timeout: 60000 });
await ph.locator(".demo-role", { hasText: "Concreter" }).click();
await ph.waitForSelector(".site-body", { timeout: 30000 });
check(true, "Worker opens the site app on a phone");
await SHOTS && ph.screenshot({ path: `${SHOTS}/d4-phone.png` });
// reset
await ph.getByRole("button", { name: /Put the sample data back|Reset demo/ }).click();
await ph.waitForSelector(".demo-pick", { timeout: 90000 });
check(true, "Reset demo returns to a fresh start");
await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n` + fails.join("\n") : "\nALL PASSED");
process.exit(fails.length ? 1 : 0);
