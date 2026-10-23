import { chromium } from "playwright-core";
import { CHROMIUM } from "./env.mjs";
const APP = "http://localhost:54321/buildos/app/";
const SHOTS = process.argv[2];
const browser = await chromium.launch({ executablePath: CHROMIUM });
const fails = [];
const check = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails.push(m); };
const page = await (await browser.newContext({ timezoneId: "Australia/Sydney", viewport: { width: 1400, height: 900 } })).newPage();
page.on("pageerror", (e) => fails.push("pageerror: " + e.message));
page.on("dialog", (d) => d.accept());
const hasToast = async (re) => { try { await page.locator(".toast", { hasText: re }).first().waitFor({ timeout: 8000 }); await page.evaluate(() => document.querySelectorAll(".toast").forEach((x) => x.remove())); return true; } catch { return false; } };
const formErr = () => page.locator(".form-msg .notice-error").first().textContent({ timeout: 8000 });
const shot = (n) => SHOTS && page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });

await page.goto(APP + "#/signup");
await page.fill("[name=full_name]", "Pat Manager"); await page.fill("[name=email]", "pat@prog.test"); await page.fill("[name=password]", "builders123");
await page.getByRole("button", { name: "Create account" }).click();
await page.fill("[name=name]", "Prog Co"); await page.getByRole("button", { name: "Create company" }).click();
await page.getByRole("link", { name: "New project" }).first().click();
await page.fill("[name=name]", "Harbour Tower"); await page.fill("[name=code]", "P-3001");
const ymd = (o) => { const d = new Date(); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
await page.fill("[name=pc_date]", ymd(20));
await page.getByRole("button", { name: "Create project" }).click();
await page.waitForSelector("h1:has-text('Harbour Tower')");
const pid = await page.evaluate(() => DB.projects[0].id);

await page.goto(APP + `#/app/projects/${pid}/programme`);
check(await page.locator("text=No programme yet").count() === 1, "Empty programme shows a helpful empty state");
const add = async (name, start, finish, preds = [], milestone = false) => {
  const fm = page.locator("form[data-act=createTask]");
  await fm.locator("[name=name]").fill(name);
  if (milestone) await fm.locator("[name=is_milestone]").check();
  await fm.locator("[name=forecast_start]").fill(start);
  if (!milestone) await fm.locator("[name=forecast_finish]").fill(finish);
  for (const p of preds) await fm.locator("label", { hasText: p }).locator("input").check();
  await fm.getByRole("button", { name: "Add to programme" }).click();
  return hasToast(milestone ? /Milestone added/ : /Task added/);
};
check(await add("Formwork", ymd(-3), ymd(3)), "Task added");
check(await add("Reo placement", ymd(4), ymd(7), ["Formwork"]), "Dependent task added");
check(await add("L5 slab pour", ymd(8), "", ["Reo placement"], true), "Milestone added");
check(await add("Hydraulics rough-in", ymd(0), ymd(2)), "Parallel task added");
const fm = page.locator("form[data-act=createTask]");
await fm.locator("[name=name]").fill("Bad dates"); await fm.locator("[name=forecast_start]").fill(ymd(5)); await fm.locator("[name=forecast_finish]").fill(ymd(1));
await fm.getByRole("button", { name: "Add to programme" }).click();
check(/before the start/.test(await formErr()), "Finish before start is refused");

const rows = await page.locator("table.register tbody tr").count();
check(rows === 4, `Programme table lists 4 tasks (${rows})`);
check(/3 tasks on the critical path/.test(await page.locator(".card-body").first().textContent()), "Critical path: formwork → reo → pour");
const hydroFloat = await page.locator("tr", { hasText: "Hydraulics rough-in" }).locator("td").nth(4).textContent();
check(hydroFloat.trim() === "6d", `Parallel task has float (${hydroFloat.trim()})`);
await shot("p1-programme");
await page.getByRole("link", { name: "Whole programme" }).click();
check(await page.locator(".gantt .g-bar").count() >= 3, "Whole-programme view renders");

// Edit: push reo out without / with a reason
await page.locator("table.register").getByRole("link", { name: "Reo placement" }).click();
await page.waitForSelector("h1:has-text('Reo placement')");
const ef = page.locator("form[data-act=updateTask]");
check(await ef.locator(".pick-list label", { hasText: "L5 slab pour" }).count() === 0, "Picker hides tasks that would create a loop");
await ef.locator("[name=forecast_finish]").fill(ymd(9));
await ef.getByRole("button", { name: "Save changes" }).click();
check(/add a delay reason/.test(await formErr()), "Delaying a task without a reason is refused");
await ef.locator("[name=delay_reason]").fill("Steel delivery late");
await ef.getByRole("button", { name: "Save changes" }).click();
check(await hasToast(/delay recorded/), "Delay recorded with reason");
check(/2 days late/.test(await page.locator("dl").first().textContent()), "Slip against baseline shown");
await page.goto(APP + `#/app/projects/${pid}/programme`);
const pourRow = page.locator("tr", { hasText: "L5 slab pour" });
check(await pourRow.locator("text=starts before Reo placement finishes").count() === 1, "Milestone now flagged as starting before its predecessor finishes");

// Progress
await page.locator("table.register").getByRole("link", { name: "Formwork" }).click();
await page.locator("form[data-act=taskProgress] [name=progress]").fill("100");
await page.locator("form[data-act=taskProgress]").getByRole("button", { name: "Save progress" }).click();
check(await hasToast(/100%, complete/), "Progress to 100% marks the task complete");
check(await page.locator("text=Finished").count() > 0 || /finished/.test(await page.locator("dl").first().textContent()), "Actual finish date recorded");
check(await page.locator("form[data-act=deleteTask]").count() === 0, "Can't remove a task with progress");
await shot("p2-task");

// Remove parallel task, then re-baseline
await page.goto(APP + `#/app/projects/${pid}/programme`);
await page.locator("table.register").getByRole("link", { name: "Hydraulics rough-in" }).click();
await page.getByRole("button", { name: "Remove from programme" }).click();
check(await hasToast(/removed/), "Task removed");
await page.waitForSelector("h1:has-text('Programme')");
await page.locator("form[data-act=rebaseline] [name=reason]").fill("EOT 1 approved");
await page.getByRole("button", { name: "Re-baseline programme" }).click();
check(await hasToast(/Baseline reset for 3 tasks/), "Programme re-baselined");
const slip = await page.locator("tr", { hasText: "Reo placement" }).locator("td").nth(3).textContent();
check(slip.trim() === "—", "Slip cleared after re-baseline");

// Overview uses the programme
await page.goto(APP + `#/app/projects/${pid}`);
const prog = await page.locator(".metric", { hasText: "Programme" }).locator(".m-value").textContent();
check(/^\d+%$/.test(prog) && prog !== "0%", `Project progress calculated from tasks (${prog})`);
check(await page.locator("text=Readiness · L5 slab pour").count() === 1, "Next milestone drives the readiness card");
await shot("p3-overview");

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILURES\n${fails.join("\n")}` : "\nALL PASSED");
process.exit(fails.length ? 1 : 0);
