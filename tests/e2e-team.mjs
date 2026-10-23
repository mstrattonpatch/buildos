import { chromium } from "playwright-core";
import { CHROMIUM } from "./env.mjs";
const APP = "http://localhost:54321/buildos/app/";
const PHOTO = new URL("./fixtures/photo.png", import.meta.url).pathname;
const SHOTS = process.argv[2];
const browser = await chromium.launch({ executablePath: CHROMIUM });
const fails = [];
const check = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails.push(m); };
async function newPage(viewport = { width: 1400, height: 900 }) {
  const page = await (await browser.newContext({ viewport, timezoneId: "Australia/Sydney" })).newPage();
  page.on("pageerror", (e) => fails.push("pageerror: " + e.message));
  page.on("dialog", (d) => d.accept());
  return page;
}
const hasToast = async (page, re) => { try { await page.locator(".toast", { hasText: re }).first().waitFor({ timeout: 8000 }); await page.evaluate(() => document.querySelectorAll(".toast").forEach((x) => x.remove())); return true; } catch { return false; } };
const errIn = (loc) => loc.locator(".form-msg .notice-error").first().textContent({ timeout: 8000 }).catch(() => "");
const shot = async (page, n) => SHOTS && page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
const fresh = async (page, url) => { await page.goto(url); await page.reload(); await page.waitForSelector("main.content, .site-body"); };
const seen = async (loc, ms = 9000) => { try { await loc.first().waitFor({ timeout: ms }); return true; } catch { return false; } };
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

// ---- set-up
const pm = await newPage();
await signUp(pm, "Pat Manager", "pat@team.test");
await pm.fill("[name=name]", "Team Co"); await pm.getByRole("button", { name: "Create company" }).click();
await pm.getByRole("link", { name: "New project" }).first().click();
await pm.fill("[name=name]", "Tower F"); await pm.fill("[name=code]", "P-6"); await pm.getByRole("button", { name: "Create project" }).click();
await pm.waitForSelector("h1:has-text('Tower F')");
const pid = await pm.evaluate(() => DB.projects[0].id), B = APP + `#/app/projects/${pid}`;
await pm.goto(APP + "#/app/people");
await pm.fill("#new-contractor [name=trading_name]", "Pour Co"); await pm.getByRole("button", { name: "Add contractor" }).click(); await hasToast(pm, /Contractor added/);
await pm.fill("#new-worker [name=name]", "Wes Worker"); await pm.selectOption("#new-worker [name=contractor_id]", { label: "Pour Co" });
await pm.fill("#new-worker [name=white_card]", "WC9"); await pm.selectOption("#new-worker [name=inducted_project_id]", { label: "Tower F" });
await pm.getByRole("button", { name: "Add worker" }).click(); await hasToast(pm, /Worker added/);
await invite(pm, "sue@team.test", "site_supervisor");
await invite(pm, "wes@team.test", "worker", { worker: "Wes Worker" });
const sue = await newPage();
await signUp(sue, "Sue Super", "sue@team.test"); await sue.waitForSelector("text=Today on site");
const wes = await newPage({ width: 400, height: 860 });
await signUp(wes, "Wes Worker", "wes@team.test"); await wes.waitForSelector("text=Hi Wes");

// ---- chat both ways, live
await sue.goto(B + "/chat"); await sue.waitForSelector("#chat-list");
let fm = sue.locator("form[data-act=postMessage]");
await fm.getByRole("button", { name: "Send" }).click();
check(/Write a message/.test(await errIn(fm)), "Empty message refused");
await sue.locator("form[data-act=postMessage] [name=body]").fill("Concrete truck 20 min late — hold the pump crew");
await sue.locator("form[data-act=postMessage]").getByRole("button", { name: "Send" }).click();
check(await seen(sue.locator(".chat-msg.mine", { hasText: "Concrete truck 20 min late" })), "Supervisor's message appears in the chat");
await fresh(wes, APP + "#/site");
check(await wes.locator(".site-tabs .tab-n").count() === 1, "Phone chat tab shows an unread badge");
await wes.locator(".site-tabs").getByRole("link", { name: /Chat/ }).click();
check(await seen(wes.locator(".chat-msg", { hasText: "Concrete truck 20 min late" })), "Worker sees the message on their phone");
await wes.locator("form[data-act=postMessage] [name=body]").fill("Got it, pump crew on standby");
await wes.locator("form[data-act=postMessage] [name=photos]").setInputFiles(PHOTO);
await wes.locator("form[data-act=postMessage]").getByRole("button", { name: "Send" }).click();
check(await seen(wes.locator(".chat-msg.mine .thumb")), "Worker sends a reply with a photo");
check(await seen(sue.locator(".chat-msg:not(.mine)", { hasText: "pump crew on standby" }), 12000), "Reply arrives in the office chat without reloading");
await shot(wes, "c1-site-chat");

// ---- task to a phone: done → sent back → done → accepted
await fresh(sue, B + "/chat");
fm = sue.locator("form[data-act=createSiteTask]");
await fm.locator("[name=title]").fill("Clean up L2 slab edge"); await fm.locator("[name=assignee_id]").selectOption({ label: "Wes Worker · Worker" });
await fm.locator("[name=photos_required]").selectOption("1");
await fm.getByRole("button", { name: "Send to their phone" }).click();
check(await hasToast(sue, /T-001 sent to Wes Worker's phone/), "Supervisor gives the worker a task");
check(await seen(sue.locator(".chat-event", { hasText: "gave Wes Worker a task: Clean up L2 slab edge" })), "Task is announced in the chat");
await fresh(wes, APP + "#/site/tasks");
check(await wes.locator(".site-tabs .tab-n").first().textContent() === "1", "Tasks tab shows 1");
await wes.locator("summary", { hasText: "Mark done" }).click();
fm = wes.locator("form[data-act=taskDone]");
await fm.locator("[name=note]").fill("Swept and bagged");
await fm.getByRole("button", { name: "Send for checking" }).click();
check(/at least 1 photo/.test(await errIn(fm)), "Photo required to finish the task");
await fm.locator("[name=photos]").setInputFiles(PHOTO);
await fm.getByRole("button", { name: "Send for checking" }).click();
check(await hasToast(wes, /T-001 marked done/), "Worker marks the task done with a photo");
await fresh(sue, B + "/from-site");
check(await sue.locator("a.nav", { hasText: "From site" }).locator(".count").textContent() === "1", "From site shows a count");
fm = sue.locator("form[data-act=taskCheck]");
await fm.locator("[name=note]").fill("Rubbish still at grid C");
await fm.getByRole("button", { name: "Send back" }).click();
check(await hasToast(sue, /T-001 sent back/), "Supervisor sends it back with a note");
await fresh(wes, APP + "#/site/tasks");
check(await wes.locator("text=Rubbish still at grid C").count() >= 1, "Worker sees why it was sent back");
await wes.locator("summary", { hasText: "Mark done" }).click();
await wes.locator("form[data-act=taskDone] [name=photos]").setInputFiles(PHOTO);
await wes.locator("form[data-act=taskDone]").getByRole("button", { name: "Send for checking" }).click(); await hasToast(wes, /marked done/);
await fresh(pm, APP + "#/app/tasks");
await pm.locator(".task-item", { hasText: "Check T-001" }).click();
await pm.locator("form[data-act=taskCheck]").getByRole("button", { name: "Accept" }).click();
check(await hasToast(pm, /T-001 accepted/), "PM accepts the finished work");

// ---- send a defect to someone's phone
await sue.evaluate(async (p) => { await rpc("create_location", { p_project: p, p_building: "A", p_level: "L2", p_zone: "Units 201–204" }); }, pid);
await fresh(sue, B + "/quality/new");
fm = sue.locator("form[data-act=createDefect]");
await fm.locator("[name=title]").fill("Cracked tile at entry");
await fm.locator("[name=locationId]").selectOption({ index: 1 });
await fm.getByRole("button", { name: /Raise|Save|Create/ }).last().click();
await sue.getByRole("link", { name: /^DEF-/ }).first().click(); await sue.waitForSelector("h1:has-text('Cracked tile')");
await sue.locator("summary", { hasText: "Send to someone's phone" }).click();
fm = sue.locator("form[data-act=createSiteTask]");
check(/^Fix DEF-\d+ · Cracked tile at entry$/.test(await fm.locator("[name=title]").inputValue()), "Task pre-filled from the defect");
await fm.locator("[name=assignee_id]").selectOption({ label: "Wes Worker · Worker" });
await fm.getByRole("button", { name: "Send to their phone" }).click();
check(await hasToast(sue, /T-002 sent/), "Defect sent to the worker's phone");
await fresh(wes, APP + "#/site/tasks");
check(await wes.locator(".task-card", { hasText: "Cracked tile" }).getByRole("link", { name: /Open DEF-/ }).count() === 1, "Phone task links back to the defect");

// ---- site note → diary
await wes.goto(APP + "#/site"); await wes.getByRole("link", { name: "Diary note" }).click();
fm = wes.locator("form[data-act=sendSiteNote]");
await fm.locator("[name=body]").fill("Crane stood down 10–11 am for wind"); await fm.locator("[name=photos]").setInputFiles(PHOTO);
await fm.getByRole("button", { name: "Send to the site diary" }).click();
check(await hasToast(wes, /Note sent to the site diary/), "Worker sends a diary note from site");
await fresh(sue, B + "/diary");
check(await sue.locator(".notice", { hasText: "1 site note from phones waiting" }).count() === 1, "Diary page points to the waiting note");
await sue.goto(B + "/from-site");
await sue.locator("form[data-act=siteNote]").getByRole("button", { name: "Add to diary" }).click();
check(await hasToast(sue, /Added to the .* diary/), "Supervisor adds it to the diary");
await sue.goto(B + "/diary");
check(await sue.locator(".site-note", { hasText: "Crane stood down" }).locator(".thumb").count() === 1, "Note and photo shown with today's diary");
await sue.locator("form[data-act=diary] [name=notes]").fill("L2 tiling, L4 formwork");
await sue.locator("form[data-act=diary]").getByRole("button", { name: "Submit diary" }).click(); await hasToast(sue, /Diary submitted/);
check(await sue.locator(".site-note", { hasText: "Crane stood down" }).count() === 1, "Submitted diary entry keeps the site note");

// ---- contacts
await wes.goto(APP + "#/site/contacts");
check(await wes.locator(".li", { hasText: "Sue Super" }).count() === 1 && await wes.locator(".li", { hasText: "Pat Manager" }).count() === 1, "Contacts list the team");
await shot(sue, "c2-diary");
await sue.goto(B + "/chat"); await sue.waitForSelector("#chat-list"); await shot(sue, "c3-chat");
check(await sue.locator("a.nav", { hasText: "Team chat" }).locator(".count").count() === 0, "Open chat shows no unread badge");

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILURES\n${fails.join("\n")}` : "\nALL PASSED");
process.exit(fails.length ? 1 : 0);
