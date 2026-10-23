import { chromium } from "playwright-core";
import { CHROMIUM } from "./env.mjs";
const APP = "http://localhost:54321/buildos/app/";
const PHOTO = new URL("./fixtures/photo.png", import.meta.url).pathname;
const SHOTS = process.argv[2];
const browser = await chromium.launch({ executablePath: CHROMIUM });
const fails = [];
const check = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails.push(m); };
async function newCtx(viewport = { width: 1400, height: 900 }) {
  const ctx = await browser.newContext({ timezoneId: "Australia/Sydney", viewport });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => fails.push("pageerror: " + e.message)); page.on("dialog", (d) => d.accept());
  return [ctx, page];
}
const hasToast = async (page, re, timeout = 8000) => { try { await page.locator(".toast", { hasText: re }).first().waitFor({ timeout }); await page.evaluate(() => document.querySelectorAll(".toast").forEach((x) => x.remove())); return true; } catch { return false; } };
const errIn = (loc) => loc.locator(".form-msg .notice-error").first().textContent({ timeout: 8000 }).catch(() => "");
const syncBar = (page) => page.locator("[data-sync-bar]:not([hidden])").first().textContent({ timeout: 5000 }).catch(() => "");
async function signUp(page, name, email) {
  await page.goto(APP + "#/signup");
  await page.fill("[name=full_name]", name); await page.fill("[name=email]", email); await page.fill("[name=password]", "builders123");
  await page.getByRole("button", { name: "Create account" }).click();
}

const [, pm] = await newCtx();
await signUp(pm, "Pat Manager", "pat@off.test");
await pm.fill("[name=name]", "Offline Co"); await pm.getByRole("button", { name: "Create company" }).click();
await pm.getByRole("link", { name: "New project" }).first().click();
await pm.fill("[name=name]", "Tower O"); await pm.fill("[name=code]", "P-O"); await pm.getByRole("button", { name: "Create project" }).click();
await pm.waitForSelector("h1:has-text('Tower O')");
const pid = await pm.evaluate(() => DB.projects[0].id);
await pm.goto(APP + "#/app/settings");
await pm.fill("form[data-act=invite] [name=email]", "sue@off.test"); await pm.selectOption("form[data-act=invite] [name=role]", "site_supervisor");
await pm.getByRole("button", { name: "Save invitation" }).click(); await hasToast(pm, /Invitation saved/);

const [ctx, sue] = await newCtx({ width: 400, height: 860 });
await signUp(sue, "Sue Super", "sue@off.test"); await sue.waitForSelector("text=Today on site");
await sue.evaluate(() => navigator.serviceWorker.ready);
await sue.reload(); await sue.waitForSelector("text=Today on site");
check(await sue.evaluate(() => !!navigator.serviceWorker.controller), "Service worker controls the app");

// ---- offline: capture a defect and a diary note
await ctx.setOffline(true);
await sue.goto(APP + "#/site/defect"); await sue.waitForSelector("form[data-act=createDefect]");
let fm = sue.locator("form[data-act=createDefect]");
await fm.locator("[name=title]").fill("Cracked tile at lift lobby"); await fm.locator("[name=locationId]").selectOption({ index: 1 });
await fm.locator("[data-photo-input]").setInputFiles(PHOTO);
await fm.getByRole("button", { name: /Raise|Save|Create/ }).last().click();
check(await hasToast(sue, /No signal — saved on this phone/), "Defect saved on the phone with no signal");
check(/Offline · 1 waiting to send/.test(await syncBar(sue)), "Sync bar shows it's waiting");
await sue.goto(APP + "#/site/note");
fm = sue.locator("form[data-act=sendSiteNote]");
await fm.locator("[name=body]").fill("Crane stood down for wind 10–11 am"); await fm.getByRole("button", { name: "Send to the site diary" }).click();
await hasToast(sue, /saved on this phone/);
await sue.goto(APP + `#/app/projects/${pid}/diary`);
for (const n of ["L2 tiling", "Second entry for the same day"]) { await sue.locator("form[data-act=diary] [name=notes]").fill(n); await sue.locator("form[data-act=diary]").getByRole("button", { name: "Submit diary" }).click(); await hasToast(sue, /saved on this phone/); }
check(/Offline · 4 waiting to send/.test(await syncBar(sue)), "Four items waiting");
await sue.goto(APP + `#/app/projects/${pid}/safety/permits`);
fm = sue.locator("form[data-act=requestPermit]");
await fm.locator("[name=location]").fill("Roof"); await fm.getByRole("button", { name: "Request permit" }).click();
check(/You're offline\. This needs a live connection/.test(await errIn(fm)), "Requests that need a live check aren't saved offline");

// ---- reopen the app with no signal
await sue.reload(); await sue.waitForSelector(".site-body, main.content", { timeout: 15000 });
check(/Offline/.test(await syncBar(sue)), "App reopens offline from the device");
await sue.goto(APP + "#/site/outbox"); await sue.waitForSelector("text=Outbox");
check(await sue.locator(".list-card .li", { hasText: "Waiting" }).count() === 4, "Outbox lists the four saved items");
await SHOTS && sue.screenshot({ path: `${SHOTS}/o1-outbox.png`, fullPage: true });

// ---- back online: everything sends; the duplicate diary is refused and kept
await ctx.setOffline(false);
await sue.evaluate(() => window.dispatchEvent(new Event("online")));
check(await hasToast(sue, /3 saved items sent · 1 couldn't be sent/, 20000), "Back online: items sent, one refused");
await sue.goto(APP + "#/site/outbox"); await sue.waitForSelector("text=Outbox");
check(await sue.locator(".li", { hasText: "Site diary" }).locator("text=already submitted").count() === 1, "The refused item stays, with the server's reason");
await pm.goto(APP + `#/app/projects/${pid}/quality`); await pm.reload(); await pm.waitForSelector("table.register");
check(await pm.locator("tr", { hasText: "Cracked tile at lift lobby" }).count() === 1, "Defect reached the office");
const photos = await pm.evaluate(() => DB.defects.find((d) => d.title === "Cracked tile at lift lobby")?.photos.length);
check(photos === 1, "Its photo came with it");
await pm.goto(APP + `#/app/projects/${pid}/from-site`);
check(await pm.locator(".task-card", { hasText: "Crane stood down" }).count() === 1, "Diary note reached the office");
check(await pm.evaluate(() => DB.diary.length) === 1, "Only one diary entry was created");
check(await pm.evaluate(() => DB.siteNotes.length) === 1, "Nothing was sent twice when the signal came back");

// ---- sign out wipes the device
await sue.goto(APP + "#/app/profile"); await sue.waitForSelector("main.content");
await sue.locator("main button[data-signout]").click();
await sue.waitForSelector("form[data-act=signIn]");
const left = await sue.evaluate(() => new Promise((res) => { const r = indexedDB.open("buildos-offline", 1); r.onsuccess = () => { const t = r.result.transaction(["outbox", "kv"]); const a = t.objectStore("outbox").count(), b = t.objectStore("kv").count(); t.oncomplete = () => res(a.result + b.result); }; r.onerror = () => res(-1); }));
check(left === 0, `Nothing from the account is left on the device after sign-out (${left})`);

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILURES\n${fails.join("\n")}` : "\nALL PASSED");
process.exit(fails.length ? 1 : 0);
