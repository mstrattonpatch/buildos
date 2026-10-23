// Screenshots of every page (from the demo). Usage: node tests/capture.mjs [output folder]; needs the mock server running (tests/run.sh mock).
import { chromium } from "playwright-core";
import { CHROMIUM, NODE_MODULES } from "./env.mjs";
import fs from "node:fs";

const PGL = `${NODE_MODULES}/@electric-sql/pglite/dist/`, OUT = process.argv[2] || new URL("./screens/", import.meta.url).pathname;
for (const d of ["shots", "full"]) fs.mkdirSync(`${OUT}/${d}`, { recursive: true });
const SITE = "http://localhost:54321/buildos/";
const MIME = { js: "text/javascript", wasm: "application/wasm" };
const browser = await chromium.launch({ executablePath: CHROMIUM });
const shots = [];
let n = 0;
async function ctx(viewport, hideBar = false) {
  const c = await browser.newContext({ viewport, timezoneId: "Australia/Sydney", deviceScaleFactor: 2 });
  if (hideBar) await c.addInitScript(() => document.addEventListener("DOMContentLoaded", () => { const st = document.createElement("style"); st.textContent = ":root{--demo-bar:0px!important}.demo-bar{display:none!important}"; document.head.appendChild(st); }));
  await c.route(/cdn\.jsdelivr\.net\/npm\/@electric-sql\/pglite@0\.5\.11\/dist\/(.*)/, (r) => { const f = PGL + r.request().url().split("/dist/")[1]; r.fulfill({ body: fs.readFileSync(f), contentType: MIME[f.split(".").pop()] || "application/octet-stream" }); });
  await c.route(/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js/, (r) => r.fulfill({ body: fs.readFileSync(`${NODE_MODULES}/@supabase/supabase-js/dist/umd/supabase.js`), contentType: "text/javascript" }));
  await c.route(/cdn\.jsdelivr\.net\/npm\/qrcode-generator/, (r) => r.fulfill({ body: fs.readFileSync(`${NODE_MODULES}/qrcode-generator/qrcode.js`), contentType: "text/javascript" }));
  const p = await c.newPage(); p.on("dialog", (d) => d.accept()); p.on("pageerror", (e) => console.log("pageerror", e.message));
  return p;
}
async function asRole(roleText, viewport = { width: 1440, height: 900 }) {
  const p = await ctx(viewport, true);
  await p.goto(SITE + "demo/"); await p.waitForSelector(".demo-pick", { timeout: 90000 });
  await p.locator(".demo-role", { hasText: roleText }).click();
  await p.waitForSelector("main.content, .site-body", { timeout: 30000 });
  return p;
}
async function shot(p, section, title, route, role, { base = "demo/", full = true, before } = {}) {
  if (route !== null) { await p.goto(SITE + base + route); }
  await p.waitForSelector("main.content, .site-body, .auth-wrap, .pub, .demo-pick", { timeout: 30000 }).catch(() => {});
  if (before) await before(p);
  await p.waitForTimeout(900);
  await p.evaluate(() => { window.hideVizTip?.(); document.querySelectorAll(".toast").forEach((t) => t.remove()); window.scrollTo(0, 0); });
  const file = `${String(++n).padStart(3, "0")}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.png`;
  await p.screenshot({ path: `${OUT}/shots/${file}` });
  if (full) await p.screenshot({ path: `${OUT}/full/${file}`, fullPage: true });
  const vp = p.viewportSize();
  shots.push({ file, section, title, route: "#" + (route ?? "").split("#")[1], role, phone: vp.width < 600 });
  console.log(n, title);
}
const ids = (p) => p.evaluate(async () => {
  const u = currentUser(), pr = DB.projects.find((x) => x.code === "P-2041");
  const pick = (arr, f = () => true) => arr.find(f)?.id;
  return { pid: pr.id, gate: pr.gateCode, task: pick(DB.tasks, (t) => t.projectId === pr.id && !t.isMilestone), defect: pick(DB.defects, (d) => d.projectId === pr.id && d.status === "ready_for_verification") || pick(DB.defects, (d) => d.projectId === pr.id),
    itp: pick(DB.itps, (i) => i.projectId === pr.id), ncr: pick(DB.ncrs), claim: pick(DB.claims, (c) => c.projectId === pr.id), swms: pick(DB.swms, (s) => s.projectId === pr.id), incident: pick(DB.incidents), permit: pick(DB.permits),
    ts: pick(DB.timesheets, (t) => t.projectId === pr.id), doc: pick(DB.documents, (d) => d.projectId === pr.id), worker: DB.workers.find((w) => w.name === "Sam Okafor")?.id, contractor: DB.contractors.find((c) => c.tradingName === "Solid Pour Concreting")?.id,
    estimate: pick(DB.estimates), template: pick(DB.itpTemplates) };
});

// ---------------- office app, director
const d = await asRole("Construction director");
const I = await ids(d);
const P = `#/app/projects/${I.pid}`;
const office = [
  ["Company", "Company overview", "#/app"], ["Company", "Projects", "#/app/projects"], ["Company", "New project", "#/app/projects/new"], ["Company", "My tasks", "#/app/tasks"],
  ["Company", "Search", "#/app/search?q=slab"], ["Company", "Insights · Overview", "#/app/insights"], ["Company", "Insights · Quality", "#/app/insights?tab=quality"], ["Company", "Insights · Labour", "#/app/insights?tab=labour"], ["Company", "Insights · Commercial", "#/app/insights?tab=commercial"],
  ["Company", "Company reports", "#/app/reports"],
  ["People", "People & contractors", "#/app/people"], ["People", "Worker profile & credential wallet", `#/app/people/workers/${I.worker}`], ["People", "Contractor profile", `#/app/people/contractors/${I.contractor}`],
  ["Time & rates", "Timesheets (company)", "#/app/timesheets"], ["Time & rates", "Weekly timesheet", `#/app/timesheets/sheet?worker=${I.worker}`], ["Time & rates", "Rates", "#/app/rates"],
  ["Estimating", "Estimates", "#/app/estimates"], ["Estimating", "Estimate", `#/app/estimates/${I.estimate}`], ["Estimating", "Client quote", `#/app/estimates/${I.estimate}/quote`],
  ["Quality", "ITP templates", "#/app/templates"], ["Quality", "ITP template", `#/app/templates/${I.template}`],
  ["Project", "Project overview", P], ["Project", "Programme", `${P}/programme`], ["Project", "Programme task", `${P}/programme/${I.task}`],
  ["Quality", "Quality & defects", `${P}/quality`], ["Quality", "New defect", `${P}/quality/new`], ["Quality", "Defect", `${P}/quality/defects/${I.defect}`], ["Quality", "ITP", `${P}/quality/itp/${I.itp}`],
  ["Quality", "NCRs", `${P}/quality/ncrs`], ["Quality", "NCR", `${P}/quality/ncrs/${I.ncr}`],
  ["Safety", "SWMS", `${P}/safety`], ["Safety", "SWMS detail", `${P}/safety/swms/${I.swms}`], ["Safety", "Incidents & hazards", `${P}/safety/incidents`], ["Safety", "Safety report", `${P}/safety/incidents/${I.incident}`],
  ["Safety", "Permits to work", `${P}/safety/permits`], ["Safety", "Permit", `${P}/safety/permits/${I.permit}`], ["Safety", "Toolbox talks", `${P}/safety/toolbox`], ["Safety", "Site access & visitors", `${P}/safety/access`],
  ["Workforce", "Site register", `${P}/workforce`], ["Workforce", "Project timesheets", `${P}/workforce/timesheets`], ["Workforce", "Timesheet", `${P}/workforce/timesheets/${I.ts}`], ["Workforce", "Muster list", `${P}/workforce/muster`],
  ["Team", "Team chat & tasks", `${P}/chat`], ["Team", "From site", `${P}/from-site`],
  ["Documents", "Documents & drawings", `${P}/documents`], ["Documents", "Document", `${P}/documents/${I.doc}`],
  ["Commercial", "Commercial overview", `${P}/commercial`], ["Commercial", "Cost ledger", `${P}/commercial/ledger`], ["Commercial", "Purchase orders", `${P}/commercial/pos`], ["Commercial", "Bills", `${P}/commercial/bills`],
  ["Commercial", "Receipts & charges", `${P}/commercial/costs`], ["Commercial", "Claims", `${P}/commercial/claims`], ["Commercial", "Payment claim", `${P}/commercial/claims/${I.claim}`],
  ["Diary & reports", "Site diary", `${P}/diary`], ...["weekly", "client", "cost", "quality", "diary"].map((k) => ["Diary & reports", `Project report · ${k}`, `${P}/reports?preset=${k}${k === "cost" ? "&view=internal" : ""}`]),
  ["Handover", "Handover", `${P}/handover`],
  ["Settings", "Team & roles", "#/app/settings"], ["Settings", "My profile", "#/app/profile"],
];
for (const [sec, t, r] of office) { if (r.includes("undefined")) { console.log("skip", t); continue; } await shot(d, sec, t, "index.html" + r, "Director"); }
await shot(d, "Company", "Notifications", "index.html#/app", "Director", { full: false, before: async (p) => { await p.locator("details.menu summary.icon-btn").click(); } });
await shot(d, "Company", "Quick create menu", "index.html#/app", "Director", { full: false, before: async (p) => { await p.locator("details.menu summary.btn-primary").click(); } });
await shot(d, "Help", "Help: common questions (demo)", "index.html#/app", "Director", { full: false, before: async (p) => { await p.getByRole("button", { name: "Ask Setout for help" }).click(); await p.locator("[data-help-faq]").nth(4).click(); } });
await d.evaluate(() => { HELP.open = false; HELP.messages = []; renderHelp(); });
// links for anonymous pages
const wallet = await d.evaluate(async (w) => (await rpc("portal_link", { p_kind: "worker", p_id: w })).token, I.worker);
const supplier = await d.evaluate(async (c) => (await rpc("portal_link", { p_kind: "contractor", p_id: c })).token, I.contractor);
// self-service pages (no account) — opened in the same browser so they reach this demo's data
for (const [t, r] of [["QR gate sign-in (no account)", `#/gate/${I.gate}`], ["Worker wallet link (no account)", `#/wallet/${wallet}`], ["Contractor link (no account)", `#/supplier/${supplier}`]]) {
  await d.setViewportSize({ width: 390, height: 844 });
  await shot(d, "No-account pages", t, "index.html" + r, "Anyone with the link");
}
await d.setViewportSize({ width: 1440, height: 900 });

// ---------------- other roles
const sub = await asRole("Contracts admin");
const Isub = await sub.evaluate(() => DB.projects[0]?.id);
await shot(sub, "Other roles", "Subcontractor: overview", "index.html#/app", "Subcontractor admin");
await shot(sub, "Other roles", "Subcontractor: quality", `index.html#/app/projects/${Isub}/quality`, "Subcontractor admin");
const qm = await asRole("Quality manager");
await shot(qm, "Other roles", "Quality manager: My tasks", "index.html#/app/tasks", "Quality manager");

// ---------------- site app on phones
const phone = { width: 390, height: 844 };
const wk = await asRole("Concreter", phone);
for (const [t, r] of [["Site app: Today (worker)", "#/site"], ["Site app: Raise a defect", "#/site/defect"], ["Site app: Site sign-in", "#/site/sign-in"], ["Site app: Drawings", "#/site/drawings"], ["Site app: Tasks", "#/site/tasks"], ["Site app: Team chat", "#/site/chat"], ["Site app: Contacts", "#/site/contacts"], ["Site app: Receipt", "#/site/receipt"], ["Site app: Diary note", "#/site/note"], ["Site app: Outbox (offline)", "#/site/outbox"]])
  await shot(wk, "Site app (phone)", t, "index.html" + r, "Worker");
const sup = await asRole("Site supervisor", phone);
await shot(sup, "Site app (phone)", "Site app: Today (supervisor)", "index.html#/site", "Site supervisor");

// ---------------- demo start, website, sign-in pages
const pick = await ctx({ width: 1440, height: 900 });
await pick.goto(SITE + "demo/"); await pick.waitForSelector(".demo-pick", { timeout: 90000 });
await shot(pick, "Website & sign-in", "Demo: choose a role", null, "Visitor");
const web = await ctx({ width: 1440, height: 900 });
for (const [t, r] of [["Website: home", "#/"], ["Website: pricing", "#/pricing"], ["Website: security", "#/security"], ["Website: book a demo", "#/demo"]]) await shot(web, "Website & sign-in", t, "index.html" + r, "Visitor", { base: "" });
for (const [t, r] of [["Sign in", "#/login"], ["Create account", "#/signup"], ["Reset password", "#/forgot"]]) await shot(web, "Website & sign-in", t, "index.html" + r, "Visitor", { base: "app/" });

fs.writeFileSync(`${OUT}/shots.json`, JSON.stringify(shots, null, 1));
await browser.close();
console.log("done", shots.length);
