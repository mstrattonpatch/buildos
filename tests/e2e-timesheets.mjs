import { chromium } from "playwright-core";
import { CHROMIUM } from "./env.mjs";
import pg from "pg";
import { PG } from "./env.mjs";
import fs from "node:fs";
const APP = "http://localhost:54321/buildos/app/";
const SHOTS = process.argv[2];
const db = new pg.Pool(PG);
const browser = await chromium.launch({ executablePath: CHROMIUM });
const fails = [];
const check = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails.push(m); };
async function newPage(viewport = { width: 1400, height: 900 }) {
  const page = await (await browser.newContext({ timezoneId: "Australia/Sydney", viewport, acceptDownloads: true })).newPage();
  page.on("pageerror", (e) => fails.push("pageerror: " + e.message));
  page.on("dialog", (d) => d.accept());
  return page;
}
const hasToast = async (page, re) => { try { await page.locator(".toast", { hasText: re }).first().waitFor({ timeout: 8000 }); await page.evaluate(() => document.querySelectorAll(".toast").forEach((x) => x.remove())); return true; } catch { return false; } };
const errIn = (loc) => loc.locator(".form-msg .notice-error").first().textContent({ timeout: 8000 }).catch(() => "");
const shot = async (page, n) => SHOTS && page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
const fresh = async (page, url) => { await page.goto(url); await page.reload(); await page.waitForSelector("main.content, .site-body"); };
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date());
async function signUp(page, name, email) {
  await page.goto(APP + "#/signup");
  await page.fill("[name=full_name]", name); await page.fill("[name=email]", email); await page.fill("[name=password]", "builders123");
  await page.getByRole("button", { name: "Create account" }).click();
}
async function invite(page, email, role, extra = {}) {
  await page.goto(APP + "#/app/settings");
  const fm = page.locator("form[data-act=invite]");
  await fm.locator("[name=email]").fill(email); await fm.locator("[name=role]").selectOption(role);
  if (extra.worker) await fm.locator("[name=worker]").selectOption({ label: extra.worker });
  await fm.getByRole("button", { name: "Save invitation" }).click();
  await hasToast(page, /Invitation saved/);
}
async function addWorker(page, name) {
  await page.goto(APP + "#/app/people");
  await page.fill("#new-worker [name=name]", name); await page.selectOption("#new-worker [name=contractor_id]", { label: "Pour Co" });
  await page.fill("#new-worker [name=white_card]", "WC" + name.length); await page.selectOption("#new-worker [name=inducted_project_id]", { label: "Tower E" });
  await page.getByRole("button", { name: "Add worker" }).click(); await hasToast(page, /Worker added/);
}
async function enterHours(page, o) {
  const fm = page.locator("form[data-act=createTimesheet]");
  if (o.worker) await fm.locator("[name=worker_id]").selectOption({ label: `${o.worker} · Pour Co` });
  if (o.start !== undefined) { await fm.locator("[name=start_time]").fill(o.start); await fm.locator("[name=end_time]").fill(o.end); }
  if (o.brk !== undefined) await fm.locator("[name=break_min]").fill(String(o.brk));
  if (o.hours) await fm.locator("[name=hours]").fill(String(o.hours));
  if (o.code) await fm.locator("[name=cost_code]").fill(o.code);
  await fm.getByRole("button").first().click();
  return fm;
}

// ---- set-up
const pm = await newPage();
await signUp(pm, "Pat Manager", "pat@time.test");
await pm.fill("[name=name]", "Time Co"); await pm.getByRole("button", { name: "Create company" }).click();
await pm.getByRole("link", { name: "New project" }).first().click();
await pm.fill("[name=name]", "Tower E"); await pm.fill("[name=code]", "P-5"); await pm.getByRole("button", { name: "Create project" }).click();
await pm.waitForSelector("h1:has-text('Tower E')");
const pid = await pm.evaluate(() => DB.projects[0].id), B = APP + `#/app/projects/${pid}`;
await pm.goto(APP + "#/app/people");
await pm.fill("#new-contractor [name=trading_name]", "Pour Co"); await pm.getByRole("button", { name: "Add contractor" }).click(); await hasToast(pm, /Contractor added/);
await addWorker(pm, "Wes Worker"); await addWorker(pm, "Olly Other");
await invite(pm, "sue@time.test", "site_supervisor");
await invite(pm, "wes@time.test", "worker", { worker: "Wes Worker" });
const sue = await newPage();
await signUp(sue, "Sue Super", "sue@time.test"); await sue.waitForSelector("text=Today on site");

// ---- supervisor enters hours
await sue.goto(B + "/workforce");
await sue.getByRole("link", { name: "Timesheets" }).click(); await sue.waitForSelector("form[data-act=createTimesheet]");
check(await sue.locator("text=No timesheets this week").count() === 1, "Empty week explains what to do");
let fm = await enterHours(sue, { worker: "Wes Worker", start: "06:58", end: "15:31", brk: 30, code: "lab" });
check(await hasToast(sue, /8 h for Wes Worker .* sent for approval/), "Hours from start/finish/break, rounded to 15 min");
fm = await enterHours(sue, { worker: "Wes Worker", start: "15:00", end: "17:00", brk: 0 });
check(/overlap 15:00–17:00/.test(await errIn(fm)), "Overlapping hours refused");

// ---- worker logs extra hours on their phone
const wes = await newPage({ width: 400, height: 860 });
await signUp(wes, "Wes Worker", "wes@time.test"); await wes.waitForSelector("text=Hi Wes");
check(await wes.locator(".list-card", { hasText: "8 h" }).locator("text=Pending").count() === 1, "Worker sees their pending hours");
await wes.locator("summary", { hasText: "Log hours" }).click();
await enterHours(wes, { start: "16:00", end: "18:00", brk: 0 });
check(await hasToast(wes, /2 h for Wes Worker/), "Worker logs hours from the site app");
await shot(wes, "t3-site-hours");

// ---- approve one, reject the other
await fresh(sue, B + "/workforce/timesheets");
const boxes = sue.locator("form[data-act=tsBulk] input[name=ids]");
check(await boxes.count() === 2, "Both timesheets listed");
await sue.locator("tr", { hasText: "16:00–18:00" }).locator("input[name=ids]").check();
await sue.locator("form[data-act=tsBulk]").getByRole("button", { name: "Reject" }).click();
check(/Say why/.test(await errIn(sue.locator("form[data-act=tsBulk]"))), "Rejecting needs a reason");
await sue.locator("form[data-act=tsBulk] [name=reason]").fill("Not on site after 4 pm");
await sue.locator("form[data-act=tsBulk]").getByRole("button", { name: "Reject" }).click();
check(await hasToast(sue, /1 timesheet rejected/), "Supervisor rejects with a reason");
await sue.locator("tr", { hasText: "06:58–15:31" }).locator("input[name=ids]").check();
await sue.locator("form[data-act=tsBulk]").getByRole("button", { name: "Approve" }).click();
check(await hasToast(sue, /1 timesheet approved · 8 h/), "Supervisor approves");
check(await sue.locator("form[data-act=tsBulk] button[value=process]").count() === 0, "Supervisors can't process");
check(await sue.evaluate(() => document.body.innerHTML.includes('href="#/app/rates"')) === false, "Supervisors don't see rates");
await fresh(wes, APP + "#/site/sign-in");
check(await wes.locator("text=Not on site after 4 pm").count() >= 1, "Worker sees why hours were rejected");

// ---- PM processes: needs rates first
await fresh(pm, APP + "#/app/tasks");
await pm.locator(".task-item", { hasText: "Process 1 approved timesheet" }).click();
await pm.waitForSelector("h1:has-text('Timesheets')");
await pm.locator("tr", { hasText: "06:58–15:31" }).locator("input[name=ids]").check();
await pm.locator("form[data-act=tsBulk]").getByRole("button", { name: "Process", exact: true }).click();
check(/No rate is set up for Wes Worker/.test(await errIn(pm.locator("form[data-act=tsBulk]"))), "Processing without a rate is refused");
await pm.getByRole("link", { name: "Rates" }).first().click(); await pm.waitForSelector("h1:has-text('Rates')");
fm = pm.locator("form[data-act=saveRateCard]").last();
await fm.locator("[name=name]").fill("Labourer"); await fm.locator("[name=cost]").fill("50"); await fm.locator("[name=charge]").fill("80");
await fm.getByRole("button", { name: "Add rate card" }).click();
check(await hasToast(pm, /Labourer saved — cost \$50.00, chargeout \$80.00/), "Rate card added");
const row = pm.locator("tr", { hasText: "Wes Worker" }).first();
await row.locator("[name=rate_card_id]").selectOption({ label: "Labourer" }); await row.getByRole("button", { name: "Save" }).click();
check(await hasToast(pm, /Rate saved for Wes Worker/), "Card assigned to the worker");
check(/\$50\/h cost · \$80\/h charge/.test(await pm.locator("tr", { hasText: "Wes Worker" }).first().textContent()) , "Effective rate shown");
fm = pm.locator("form[data-act=setRate]").last();
await fm.locator("[name=project_id]").selectOption({ label: "Tower E" }); await fm.locator("[name=cost_code]").fill("LAB"); await fm.locator("[name=charge]").fill("95");
await fm.getByRole("button", { name: "Add rate" }).click();
check(await hasToast(pm, /Rate saved for Tower E · LAB/), "Job cost-code chargeout rate added");
await shot(pm, "t2-rates");
await fresh(pm, APP + "#/app/timesheets?status=approved");
await pm.locator("tr", { hasText: "06:58–15:31" }).locator("input[name=ids]").check();
await pm.locator("form[data-act=tsBulk]").getByRole("button", { name: "Process", exact: true }).click();
check(await hasToast(pm, /1 timesheet processed · 8 h · labour cost \$400.00/), "Processed at the card cost rate");
await fresh(pm, APP + "#/app/timesheets");
check(await pm.locator("tr", { hasText: "06:58–15:31" }).locator("text=$400").count() === 1, "Locked cost shown on the timesheet");
await shot(pm, "t1-timesheets");
const [dl] = await Promise.all([pm.waitForEvent("download"), pm.getByRole("button", { name: "Payroll CSV" }).click()]);
const csv = fs.readFileSync(await dl.path(), "utf8");
check(/"Wes Worker","Pour Co","[\d-]+","Tower E","06:58","15:31","30","8","8","0","LAB"/.test(csv) && !/16:00/.test(csv), "Payroll CSV has approved hours only, split ordinary/overtime");
await pm.getByRole("link", { name: "Weekly timesheet" }).first().click();
await pm.waitForSelector("h1:has-text('Weekly timesheet')");
check(await pm.locator("tfoot", { hasText: "Total 8 h" }).count() === 1 && await pm.locator("text=Supervisor signature").count() === 1, "Printable weekly timesheet with totals and sign-off");
await pm.goto(B + "/commercial");
const lab = pm.locator("section", { hasText: "Processed timesheets at their locked rates" });
check((await lab.textContent()).includes("LAB8 h$400$760"), "Commercial shows labour cost and chargeout (job rate $95/h)");
await fresh(sue, APP + "#/app/rates");
check(await sue.locator("text=Rates are only visible to project managers and directors").count() === 1, "Rates page blocked for supervisors");

// ---- timesheets from sign-ins
const olly = (await db.query("select id from workers where name = 'Olly Other'")).rows[0].id;
await db.query(`insert into attendance (org_id, project_id, worker_id, kind, at) select org_id, $1, $2, 'check_in', ($3::date + time '07:01') at time zone 'Australia/Sydney' from projects where id = $1`, [pid, olly, today]);
await db.query(`insert into attendance (org_id, project_id, worker_id, kind, at) select org_id, $1, $2, 'check_out', ($3::date + time '15:29') at time zone 'Australia/Sydney' from projects where id = $1`, [pid, olly, today]);
await fresh(sue, B + "/workforce/timesheets");
await sue.locator("form[data-act=fromSignIns]").getByRole("button", { name: "Create timesheets" }).click();
check(await hasToast(sue, /^1 timesheet created from sign-ins\./), "Timesheet created from the sign-in register");
check(await sue.locator("tr", { hasText: "07:01–15:29" }).locator("text=Sign-in").count() === 1, "Sign-in timesheet listed (8 h after 30 min break)");

await browser.close(); await db.end();
console.log(fails.length ? `\n${fails.length} FAILURES\n${fails.join("\n")}` : "\nALL PASSED");
process.exit(fails.length ? 1 : 0);
