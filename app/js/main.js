// ===================================================== start-up & routing
const AUTH_ROUTES = new Set(["/login", "/signup", "/forgot", "/reset", "/check-email"]);
const appUrl = () => location.href.split("#")[0];
const go = (path) => { if (location.hash === "#" + path) render(); else location.hash = path; };
const currentUser = () => (SESSION && DB ? DB.users.find((u) => u.id === SESSION.user.id) || null : null);

function homeFor(u) {
  const first = listProjects(u)[0];
  if (!first) return "/app";
  return { director: "/app", project_manager: `/app/projects/${first.id}`, site_supervisor: "/site", quality_manager: `/app/projects/${first.id}/quality`, subcontractor_admin: `/app/projects/${first.id}/quality`, worker: "/site/sign-in" }[u.role] || "/app";
}

function parseRoute() {
  const raw = location.hash.slice(1) || "/";
  const [path, qs] = raw.split("?");
  return { path: decodeURIComponent(path).replace(/\/+$/, "") || "/", query: Object.fromEntries(new URLSearchParams(qs || "")) };
}

/** After sign-in: join invited companies, then open the remembered (or first) company. */
async function enterApp(preferOrg) {
  await rpc("accept_invitations");
  await loadMyOrgs();
  if (!MY_ORGS.length) { DB = null; return; }
  const want = preferOrg || prefs.get(ORG_KEY);
  const org = MY_ORGS.find((o) => o.id === want) || MY_ORGS[0];
  prefs.set(ORG_KEY, org.id);
  await loadCompany(org.id);
}

let lastLoad = 0;
async function refresh() {
  if (!SESSION || !DB) return;
  await loadCompany(DB.org.id);
  lastLoad = Date.now();
}

// The QR gate works without an account; its state lives here between renders.
let GATE = { code: null };
async function loadGate(code) {
  try { GATE.info = await rpc("gate_info", { p_code: code }); } catch (e) { GATE.error = e.message; }
  GATE.loading = false;
  if (parseRoute().path === `/gate/${code}`) render();
}
/** Gate calls report "not found" as { error } so failed guesses still count towards the rate limit. */
async function gateRpc(fn, args = {}) {
  const r = await rpc(fn, { p_code: GATE.code, ...args });
  if (r?.error) throw new RuleError(r.error);
  return r;
}
async function gateStatus(workerCode) {
  GATE.status = await gateRpc("gate_worker_status", { p_worker_code: workerCode });
  GATE.workerCode = workerCode;
}

function resolve(path, query) {
  const gm = path.match(/^\/gate\/([^/]+)$/);
  if (gm) return { html: pageGate(gm[1]), title: "Site sign-in" };
  if ((path === "/login" || path === "/signup") && SESSION && DB && currentUser()) { go(homeFor(currentUser())); return null; }
  if (path === "/login") return { html: pageSignIn(), title: "Sign in" };
  if (path === "/signup") return { html: pageSignUp(), title: "Create account" };
  if (path === "/forgot") return { html: pageForgot(), title: "Reset password" };
  if (path === "/reset") return { html: pageReset(), title: "New password" };
  if (path === "/check-email") return { html: pageCheckEmail(query), title: "Check your email" };
  if (!SESSION) { go("/login"); return null; }
  if (!DB) { if (path !== "/welcome") { go("/welcome"); return null; } return { html: pageWelcome(), title: "Set up your company" }; }
  const u = currentUser();
  if (!u) { go("/welcome"); return null; }
  if (path === "/" || path === "/welcome") { go(homeFor(u)); return null; }
  if (path === "/site") return { html: pageSiteToday(u, path), title: "Site app" };
  if (path === "/site/defect") return { html: pageSiteDefect(u), title: "New defect" };
  if (path === "/site/sign-in") return { html: pageSiteSignIn(u, path), title: "Site sign-in" };
  if (path === "/site/drawings") return { html: pageSiteDrawings(u, path, query), title: "Drawings" };
  if (path === "/site/tasks") return { html: pageSiteTasks(u, path), title: "Tasks" };
  if (path === "/site/chat") { if (listProjects(u)[0]) markReadLocal(listProjects(u)[0].id); return { html: pageSiteChat(u, path), title: "Team chat" }; }
  if (path === "/site/contacts") return { html: pageSiteContacts(u, path), title: "Contacts" };
  if (path === "/site/receipt") return { html: pageSiteReceipt(u, path), title: "Receipt" };
  if (path === "/site/note") return { html: pageSiteNote(u, path), title: "Diary note" };
  const company = {
    "/app": [pageControlCentre, "Company overview"], "/app/projects": [pageProjects, "Projects"], "/app/projects/new": [pageNewProject, "New project"],
    "/app/tasks": [pageTasks, "My tasks"], "/app/people": [pagePeople, "People & contractors"], "/app/reports": [(x) => pageReports(x, query), "Reports"],
    "/app/search": [(x) => pageSearch(x, query), "Search"], "/app/settings": [pageSettings, "Team & roles"], "/app/profile": [pageProfile, "My profile"],
  };
  if (company[path]) return { html: appShell(u, path, company[path][0](u)), title: company[path][1] };
  if (path === "/app/timesheets") return { html: appShell(u, path, pageCompanyTimesheets(u, query)), title: "Timesheets" };
  if (path === "/app/timesheets/sheet") return { html: appShell(u, path, pageWeeklySheet(u, query)), title: "Weekly timesheet" };
  if (path === "/app/estimates") return { html: appShell(u, path, pageEstimates(u)), title: "Estimates" };
  const em = path.match(/^\/app\/estimates\/([^/]+)(\/quote)?$/);
  if (em) return { html: appShell(u, path, em[2] ? pageQuote(u, em[1]) : pageEstimate(u, em[1])), title: em[2] ? "Client quote" : "Estimate" };
  if (path === "/app/rates") return { html: appShell(u, path, pageRates(u)), title: "Rates" };
  if (path === "/app/templates") return { html: appShell(u, path, pageTemplates(u)), title: "ITP templates" };
  const tm = path.match(/^\/app\/templates\/([^/]+)$/);
  if (tm) return { html: appShell(u, path, pageTemplate(u, tm[1])), title: "ITP template" };
  const m = path.match(/^\/app\/projects\/([^/]+)(?:\/(.*))?$/);
  if (m) {
    const p = getProject(u, m[1]);
    if (!p) return { html: appShell(u, path, notFound()), title: "Not found" };
    const sub = m[2] || "";
    let html, title = p.name, mm;
    if (sub === "") html = pageProject(u, p);
    else if (sub === "quality") { html = pageQuality(u, p, { q: query.q || "", level: query.level || "", trade: query.trade || "", contractor: query.contractor || "", status: query.status || "" }); title = "Quality"; }
    else if (sub === "quality/new") { html = pageNewDefect(u, p); title = "New defect"; }
    else if ((mm = sub.match(/^quality\/defects\/(.+)$/))) { html = pageDefect(u, p, mm[1]); title = "Defect"; }
    else if ((mm = sub.match(/^quality\/itp\/(.+)$/))) { html = pageItp(u, p, mm[1]); title = "ITP"; }
    else if (sub === "quality/ncrs") { html = pageNcrs(u, p); title = "NCRs"; }
    else if ((mm = sub.match(/^quality\/ncrs\/(.+)$/))) { html = pageNcr(u, p, mm[1]); title = "NCR"; }
    else if (sub === "programme") { html = pageProgramme(u, p, query); title = "Programme"; }
    else if ((mm = sub.match(/^programme\/(.+)$/))) { html = pageTask(u, p, mm[1]); title = "Task"; }
    else if (sub === "commercial") { html = pageCommercial(u, p); title = "Commercial"; }
    else if (sub === "commercial/ledger") { html = pageLedger(u, p); title = "Cost ledger"; }
    else if (sub === "commercial/pos") { html = pagePOs(u, p); title = "Purchase orders"; }
    else if (sub === "commercial/bills") { html = pageBills(u, p); title = "Bills"; }
    else if (sub === "commercial/costs") { html = pageCostsOther(u, p); title = "Receipts & charges"; }
    else if (sub === "commercial/claims") { html = pageClaims(u, p); title = "Claims"; }
    else if ((mm = sub.match(/^commercial\/claims\/(.+)$/))) { html = pageClaim(u, p, mm[1]); title = "Payment claim"; }
    else if (sub === "safety") { html = pageSafety(u, p); title = "Safety"; }
    else if ((mm = sub.match(/^safety\/swms\/(.+)$/))) { html = pageSwms(u, p, mm[1]); title = "SWMS"; }
    else if (sub === "safety/incidents") { html = pageIncidents(u, p); title = "Incidents"; }
    else if ((mm = sub.match(/^safety\/incidents\/(.+)$/))) { html = pageIncident(u, p, mm[1]); title = "Safety report"; }
    else if (sub === "safety/permits") { html = pagePermits(u, p); title = "Permits"; }
    else if ((mm = sub.match(/^safety\/permits\/(.+)$/))) { html = pagePermit(u, p, mm[1]); title = "Permit"; }
    else if (sub === "safety/toolbox") { html = pageToolbox(u, p); title = "Toolbox talks"; }
    else if (sub === "safety/access") { html = pageSiteAccess(u, p); title = "Site access"; }
    else if (sub === "workforce") { html = pageWorkforce(u, p); title = "Workforce"; }
    else if (sub === "chat") { markReadLocal(p.id); html = pageProjectChat(u, p); title = "Team chat"; }
    else if (sub === "from-site") { html = pageFromSite(u, p); title = "From site"; }
    else if (sub === "workforce/muster") { html = pageMuster(u, p); title = "Muster list"; }
    else if (sub === "workforce/timesheets") { html = pageProjectTimesheets(u, p, query); title = "Timesheets"; }
    else if ((mm = sub.match(/^workforce\/timesheets\/(.+)$/))) { html = pageTimesheet(u, p, mm[1]); title = "Timesheet"; }
    else if (sub === "documents") { html = pageDocuments(u, p, query); title = "Documents"; }
    else if ((mm = sub.match(/^documents\/(.+)$/))) { html = pageDocument(u, p, mm[1]); title = "Document"; }
    else if (sub === "diary") { html = pageDiary(u, p); title = "Site diary"; }
    else if (sub === "reports") { html = pageProjectReports(u, p, query); title = "Reports"; }
    else if (sub === "handover") { html = pageHandover(u, p); title = "Handover"; }
    else html = notFound();
    return { html: appShell(u, path, html), title };
  }
  return { html: appShell(u, path, notFound()), title: "Not found" };
}

let pendingScroll = null;
function render() {
  const { path, query } = parseRoute();
  let out;
  try { out = resolve(path, query); }
  catch (e) {
    if (!(e instanceof RuleError)) throw e;
    const u = currentUser();
    out = { html: u ? appShell(u, path, notFound(e.message)) : pageSignIn(), title: "Not allowed" };
  }
  if (!out) return;
  document.getElementById("root").innerHTML = out.html;
  document.title = `${out.title} · BuildOS`;
  if (pendingScroll) { document.getElementById(pendingScroll)?.scrollIntoView(); pendingScroll = null; }
  afterChatRender();
}

// ---- open chat: keep it scrolled to the newest message, mark it read, and check for new messages every 4 s
let chatTimer = null;
function afterChatRender() {
  const list = document.getElementById("chat-list");
  clearInterval(chatTimer); chatTimer = null;
  if (!list || !DB) return;
  const pid = list.dataset.chat;
  list.scrollTop = list.scrollHeight;
  markRead(pid);
  chatTimer = setInterval(async () => {
    if (document.visibilityState !== "visible") return;
    try {
      if (!(await pollMessages(pid))) return;
      const cur = document.getElementById("chat-list");
      if (!cur || cur.dataset.chat !== pid) return;
      cur.outerHTML = chatList(currentUser(), pid);
      document.getElementById("chat-list").scrollTop = 1e9;
      markRead(pid);
    } catch { /* try again next tick */ }
  }, 4000);
}
/** Opening a chat counts as reading it, so its unread badge clears on this render. */
function markReadLocal(pid) {
  const now = new Date().toISOString(), r = DB.chatReads.find((x) => x.projectId === pid);
  if (r) r.readAt = now; else DB.chatReads.push({ projectId: pid, userId: SESSION.user.id, readAt: now });
}
async function markRead(pid) {
  markReadLocal(pid);
  try { await rpc("mark_chat_read", { p_project: pid }); } catch { /* not important */ }
}
window.addEventListener("hashchange", async () => {
  render();
  window.scrollTo(0, 0);
  // Pick up colleagues' changes when moving between pages.
  if (DB && Date.now() - lastLoad > 15000) {
    try { await refresh(); if (!document.querySelector("form[data-act] :is(input, textarea, select):focus")) render(); } catch { /* keep showing what we have */ }
  }
});

function showLoading(msg = "Loading…") {
  document.getElementById("root").innerHTML = `<div class="auth-wrap"><div class="row muted" style="gap:10px">${icon("rotate", 18, "animation:spin 1s linear infinite")} ${esc(msg)}</div></div>`;
}
function showFatal(msg) {
  document.getElementById("root").innerHTML = `<div class="auth-wrap"><div class="card card-pad stack" style="max-width:460px"><h2>Something went wrong</h2><p class="muted">${esc(msg)}</p><div class="row"><button class="btn btn-primary" type="button" onclick="location.reload()">Try again</button><button class="btn" type="button" data-signout>Sign out</button></div></div></div>`;
}

// ===================================================== feedback
function toast(msg, kind = "ok") {
  const el = document.createElement("div");
  el.className = `toast toast-${kind}`;
  el.setAttribute("role", kind === "ok" ? "status" : "alert");
  el.innerHTML = `${icon(kind === "ok" ? "checkcircle" : "alert")}<span>${esc(msg)}</span>`;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add("out"), 3500);
  setTimeout(() => el.remove(), 4000);
}
function formError(formEl, msg) {
  const box = formEl.querySelector(":scope > .form-msg");
  box.innerHTML = `<div class="notice notice-error" role="alert" style="margin-top:10px">${icon("alert")}<span>${esc(msg)}</span></div>`;
}

/** Small previews for the photo picker (uploads happen on submit). */
async function previewPhotos(input, max = 4) {
  const files = [...(input?.files || [])].slice(0, max);
  return Promise.all(files.map((f) => new Promise((res) => {
    const img = new Image(), url = URL.createObjectURL(f);
    img.onload = () => {
      const s = Math.min(1, 360 / Math.max(img.width, img.height)), c = document.createElement("canvas");
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); res(c.toDataURL("image/jpeg", 0.7));
    };
    img.onerror = () => { URL.revokeObjectURL(url); res(""); };
    img.src = url;
  })));
}

// ===================================================== actions
/** "$48,200.50" → 4820050 cents. */
function parseMoney(v) {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
const f = (fd, k) => String(fd.get(k) ?? "").trim();
const templatePayload = (fd, el) => ({
  name: f(fd, "name"), trade: f(fd, "trade"), description: f(fd, "description"),
  points: [...el.querySelectorAll(".pt-row")].map((r) => ({
    name: r.querySelector("[name=pt_name]").value.trim(), type: r.querySelector("[name=pt_type]").value, check_text: r.querySelector("[name=pt_check]").value.trim(),
    evidence_required: parseInt(r.querySelector("[name=pt_photos]").value || "0", 10) || 0, measurement_label: r.querySelector("[name=pt_measure]").value.trim(),
    required_signoffs: parseInt(r.querySelector("[name=pt_signoffs]").value, 10) || 1,
  })).filter((p) => p.name || p.check_text),
});
const swmsPayload = (fd, el) => ({
  title: f(fd, "title"), activity: f(fd, "activity"), notes: f(fd, "notes"), high_risk_categories: fd.getAll("hrcw"), task_ids: fd.getAll("task_ids"),
  hazards: [...el.querySelectorAll(".hz-row")].map((r) => ({ hazard: r.querySelector("[name=hz_hazard]").value.trim(), controls: r.querySelector("[name=hz_controls]").value.trim(), responsible: r.querySelector("[name=hz_responsible]").value.trim() }))
    .filter((h) => h.hazard || h.controls),
});
/** Hours only wins over the (pre-filled) start and finish times. */
const tsPayload = (fd) => {
  const hours = f(fd, "hours");
  return { worker_id: f(fd, "worker_id"), date: f(fd, "date"), start_time: hours ? "" : f(fd, "start_time"), end_time: hours ? "" : f(fd, "end_time"), break_min: hours ? "0" : f(fd, "break_min"), hours, task_id: f(fd, "task_id"), cost_code: f(fd, "cost_code"), note: f(fd, "note") };
};
const taskPayload = (fd) => ({
  name: f(fd, "name"), is_milestone: fd.get("is_milestone") === "on", forecast_start: f(fd, "forecast_start"), forecast_finish: f(fd, "forecast_finish"),
  trade: f(fd, "trade"), contractor_id: f(fd, "contractor_id"), predecessor_ids: fd.getAll("predecessor_ids"), itp_id: f(fd, "itp_id"), swms_id: f(fd, "swms_id"), cost_code: f(fd, "cost_code"),
});

// Each returns a message (or { msg, go, stay, noReload }) or throws RuleError (shown inline).
const ACTIONS = {
  // ---- accounts
  async signIn(fd) {
    const { data, error } = await sb.auth.signInWithPassword({ email: f(fd, "email"), password: String(fd.get("password") || "") });
    if (error) throw new RuleError(/invalid/i.test(error.message) ? "Email or password is incorrect." : /confirm/i.test(error.message) ? "Confirm your email first — check your inbox for the link." : friendlyError(error));
    SESSION = data.session;
    showLoading();
    await enterApp();
    return { msg: "Signed in.", go: DB ? homeFor(currentUser()) : "/welcome", noReload: true };
  },
  async signUp(fd) {
    const email = f(fd, "email"), password = String(fd.get("password") || ""), name = f(fd, "full_name");
    if (!name) throw new RuleError("Enter your full name.");
    if (password.length < 8) throw new RuleError("Use a password of at least 8 characters.");
    const { data, error } = await sb.auth.signUp({ email, password, options: { data: { full_name: name }, emailRedirectTo: appUrl() } });
    if (error) throw new RuleError(friendlyError(error));
    if (!data.session) return { msg: "Account created — confirm your email to continue.", go: `/check-email?email=${encodeURIComponent(email)}`, noReload: true };
    SESSION = data.session;
    await enterApp();
    return { msg: "Welcome to BuildOS.", go: DB ? homeFor(currentUser()) : "/welcome", noReload: true };
  },
  async forgot(fd) {
    const { error } = await sb.auth.resetPasswordForEmail(f(fd, "email"), { redirectTo: appUrl() });
    if (error) throw new RuleError(friendlyError(error));
    return { msg: "If that email has an account, a reset link is on its way.", stay: true };
  },
  async resetPassword(fd) {
    const pw = String(fd.get("password") || "");
    if (pw.length < 8) throw new RuleError("Use a password of at least 8 characters.");
    if (pw !== fd.get("confirm")) throw new RuleError("The two passwords don't match.");
    const { error } = await sb.auth.updateUser({ password: pw });
    if (error) throw new RuleError(friendlyError(error));
    await enterApp();
    return { msg: "Password updated.", go: DB ? homeFor(currentUser()) : "/welcome", noReload: true };
  },
  async createOrg(fd) {
    const r = await rpc("create_organisation", { p_name: f(fd, "name"), p_abn: f(fd, "abn") });
    await enterApp(r.id);
    return { msg: r.message, go: "/app", noReload: true };
  },
  async profile(fd) { return (await rpc("update_my_profile", { p_full_name: f(fd, "full_name"), p_phone: f(fd, "phone") })).message; },
  async password(fd) {
    const pw = String(fd.get("password") || "");
    if (pw.length < 8) throw new RuleError("Use a password of at least 8 characters.");
    if (pw !== fd.get("confirm")) throw new RuleError("The two passwords don't match.");
    const { error } = await sb.auth.updateUser({ password: pw });
    if (error) throw new RuleError(friendlyError(error));
    return { msg: "Password updated.", noReload: true, rerender: true };
  },
  // ---- team
  async invite(fd) {
    return (await rpc("invite_member", { p_org: DB.org.id, p_email: f(fd, "email"), p_role: f(fd, "role"), p_title: f(fd, "title"), p_contractor: f(fd, "contractor") || null, p_worker: f(fd, "worker") || null })).message;
  },
  async updateMember(fd) {
    if (fd.get("remove") === "1") return (await rpc("remove_member", { p_org: DB.org.id, p_user: f(fd, "user") })).message;
    return (await rpc("update_member", { p_org: DB.org.id, p_user: f(fd, "user"), p_role: f(fd, "role"), p_title: f(fd, "title"), p_is_admin: fd.get("is_admin") === "on" })).message;
  },
  async cancelInvite(fd) { return (await rpc("cancel_invitation", { p_id: f(fd, "id") })).message; },
  async loadSample() {
    await rpc("import_sample_data", { p_org: DB.org.id, p: samplePayload(SESSION.user.id) });
    return { msg: "Sample projects loaded.", go: "/app" };
  },
  // ---- set-up records
  async createProject(fd) {
    const cs = f(fd, "contract_sum") ? parseMoney(f(fd, "contract_sum")) : 0;
    if (cs === null) throw new RuleError("Enter the contract sum as a number.");
    const r = await rpc("create_project", { p_org: DB.org.id, p: { name: f(fd, "name"), code: f(fd, "code"), address: f(fd, "address"), client: f(fd, "client"), type: f(fd, "type"), contract_sum: cs, start_date: f(fd, "start_date"), pc_date: f(fd, "pc_date") } });
    return { msg: r.message, go: `/app/projects/${r.id}` };
  },
  async createLocation(fd) { return (await rpc("create_location", { p_project: f(fd, "project"), p_building: f(fd, "building"), p_level: f(fd, "level"), p_zone: f(fd, "zone") })).message; },
  async createContractor(fd) {
    return (await rpc("create_contractor", { p_org: DB.org.id, p: Object.fromEntries(["trading_name", "legal_name", "abn", "trade", "pl_expires", "wc_expires"].map((k) => [k, f(fd, k)])) })).message;
  },
  async createWorker(fd) {
    return (await rpc("create_worker", { p_org: DB.org.id, p: Object.fromEntries(["name", "contractor_id", "phone", "white_card", "inducted_project_id"].map((k) => [k, f(fd, k)])) })).message;
  },
  async induct(fd) { return (await rpc("record_induction", { p_worker: f(fd, "worker"), p_project: f(fd, "project") })).message; },
  async createVariation(fd) {
    const amount = parseMoney(f(fd, "amount"));
    if (amount === null) throw new RuleError("Enter the cost impact as a number.");
    return (await rpc("create_variation", { p_project: f(fd, "project"), p: { title: f(fd, "title"), reason: f(fd, "reason"), amount, time_impact_days: parseInt(f(fd, "days") || "0", 10) || 0 } })).message;
  },
  // ---- programme
  async createTask(fd) {
    return (await rpc("create_task", { p_project: f(fd, "project"), p: taskPayload(fd) })).message;
  },
  async updateTask(fd) { return (await rpc("update_task", { p_task: f(fd, "task"), p: { ...taskPayload(fd), delay_reason: f(fd, "delay_reason") } })).message; },
  async taskProgress(fd) {
    return (await rpc("update_task_progress", { p_task: f(fd, "task"), p_progress: parseInt(f(fd, "progress"), 10), p_blocked: fd.get("blocked") === "on", p_note: f(fd, "note") })).message;
  },
  async deleteTask(fd) {
    const r = await rpc("delete_task", { p_task: f(fd, "task") });
    return { msg: r.message, go: `/app/projects/${f(fd, "project")}/programme` };
  },
  async rebaseline(fd) { return (await rpc("rebaseline_programme", { p_project: f(fd, "project"), p_reason: f(fd, "reason") })).message; },
  // ---- ITPs
  async loadStarters() {
    for (const t of STARTER_TEMPLATES) await rpc("create_itp_template", { p_org: DB.org.id, p: t });
    return `${STARTER_TEMPLATES.length} starter templates added.`;
  },
  async createTemplate(fd, u, el) { return (await rpc("create_itp_template", { p_org: DB.org.id, p: templatePayload(fd, el) })).message; },
  async updateTemplate(fd, u, el) { return (await rpc("update_itp_template", { p_template: f(fd, "template"), p: templatePayload(fd, el) })).message; },
  async archiveTemplate(fd) { const r = await rpc("archive_itp_template", { p_template: f(fd, "template") }); return { msg: r.message, go: "/app/templates" }; },
  async applyTemplate(fd) {
    const r = await rpc("apply_itp_template", { p_template: f(fd, "template"), p_project: f(fd, "project"), p_task: f(fd, "task") || null, p_title: f(fd, "title") });
    return { msg: r.message, go: `/app/projects/${f(fd, "project")}/quality/itp/${r.id}` };
  },
  async submitPoint(fd, u, el) {
    const photos = await uploadPhotos(el.querySelector('[name="photos"]'), 10);
    return (await rpc("submit_itp_point", { p_point: f(fd, "point"), p: { photos, measurement: f(fd, "measurement"), note: f(fd, "note") } })).message;
  },
  // ---- documents
  async uploadDoc(fd, u, el) {
    for (const k of ["number", "title", "revision"]) if (!f(fd, k)) throw new RuleError(k === "number" ? "Enter the document number, e.g. A-102." : `Enter the ${k}.`);
    if (!el.querySelector('[name="file"]')?.files?.length) throw new RuleError("Choose the file to upload.");
    const file = await uploadDocumentWithInfo(el.querySelector('[name="file"]'));
    const r = await rpc("upload_document", { p_project: f(fd, "project"), p: {
      number: f(fd, "number"), title: f(fd, "title"), revision: f(fd, "revision"), category: f(fd, "category"), description: f(fd, "description"),
      contractor_id: f(fd, "contractor_id"), task_id: f(fd, "task_id"), file_path: file.path, file_name: file.name, file_size: file.size, mime_type: file.type,
    } });
    return { msg: r.message, go: `/app/projects/${f(fd, "project")}/documents/${r.id}` };
  },
  async reviewDoc(fd) { return (await rpc("review_document", { p_document: f(fd, "doc"), p_decision: f(fd, "decision"), p_comment: f(fd, "comment") })).message; },
  // ---- workflows
  async createDefect(fd, u, el) {
    const draft = fd.get("mode") === "draft";
    if (!f(fd, "title")) throw new RuleError("Say what's wrong.");
    if (!draft && !f(fd, "locationId")) throw new RuleError("Choose a location.");
    const photos = await uploadPhotos(el.querySelector("[data-photo-input]"));
    const r = await rpc("create_defect", { p: { project_id: f(fd, "projectId"), title: f(fd, "title"), location_id: f(fd, "locationId"), room: f(fd, "room"), trade: f(fd, "trade"), contractor_id: f(fd, "contractorId"), priority: f(fd, "priority"), due_date: f(fd, "dueDate"), photos, draft, client_key: el.dataset.clientKey } });
    return { msg: r.message, go: el.dataset.done.slice(1) };
  },
  async defect(fd, u, el) {
    const type = f(fd, "type"), p = {};
    if (type === "assign") Object.assign(p, { contractor_id: f(fd, "contractorId"), due_date: f(fd, "dueDate") });
    if (type === "reject") p.reason = f(fd, "reason");
    if (type === "submit_for_verification") {
      if (!f(fd, "note")) throw new RuleError("Describe the rectification before submitting.");
      p.note = f(fd, "note");
      p.evidence = await uploadPhotos(el.querySelector('[name="evidence"]'));
    }
    return (await rpc("defect_action", { p_defect: f(fd, "defectId"), p_type: type, p })).message;
  },
  async variation(fd) { return (await rpc("variation_action", { p_variation: f(fd, "variationId"), p_type: f(fd, "type"), p_reason: f(fd, "reason") })).message; },
  async hold(fd) { return (await rpc("itp_point_action", { p_point: f(fd, "pointId"), p_decision: f(fd, "decision"), p_comment: f(fd, "comment") })).message; },
  async swmsReview(fd) { return (await rpc("swms_review", { p_swms: f(fd, "swmsId"), p_decision: f(fd, "decision"), p_comment: f(fd, "comment"), p_review_months: parseInt(f(fd, "months") || "12", 10) })).message; },
  async submitSwms(fd, u, el) {
    const file_path = await uploadDocument(el.querySelector('[name="file"]'));
    const r = await rpc("submit_swms", { p_project: f(fd, "project"), p: { ...swmsPayload(fd, el), contractor_id: f(fd, "contractor_id"), file_path } });
    return { msg: r.message, go: `/app/projects/${f(fd, "project")}/safety/swms/${r.id}` };
  },
  async reviseSwms(fd, u, el) {
    const file_path = await uploadDocument(el.querySelector('[name="file"]'));
    const r = await rpc("revise_swms", { p_swms: f(fd, "swmsId"), p: { ...swmsPayload(fd, el), file_path, requires_reack: fd.get("requires_reack") === "on" } });
    const s = DB.swms.find((x) => x.id === f(fd, "swmsId"));
    return { msg: r.message, go: `/app/projects/${s.projectId}/safety/swms/${r.id}` };
  },
  // ---- estimates & handover
  async createEstimate(fd) {
    const r = await rpc("create_estimate", { p_org: DB.org.id, p: Object.fromEntries(["name", "client", "address", "markup_pct", "valid_until"].map((k) => [k, f(fd, k)])) });
    return { msg: r.message, go: `/app/estimates/${r.id}` };
  },
  async saveEstimate(fd, u, el) {
    const items = [...el.querySelectorAll("[data-rows=items] .est-row")].map((row) => {
      const v = (n) => row.querySelector(`[name=${n}]`).value.trim(), qtyRaw = v("it_qty"), qty = evalQty(qtyRaw);
      if (!v("it_desc")) return null;
      if (Number.isNaN(qty)) throw new RuleError(`Check the quantity for "${v("it_desc")}" — use numbers and + − × ÷ only.`);
      const rate = v("it_rate") ? parseMoney(v("it_rate")) : 0;
      return { category: v("it_cat"), description: v("it_desc"), qty, unit: v("it_unit"), rate, qty_formula: /[*/+()-]/.test(qtyRaw.replace(/^-/, "")) ? qtyRaw : "" };
    }).filter(Boolean);
    const quotes = [...el.querySelectorAll("[data-rows=quotes] .est-row")].map((row) => ({ category: row.querySelector("[name=q_cat]").value.trim(), supplier: row.querySelector("[name=q_supplier]").value.trim(), amount: parseMoney(row.querySelector("[name=q_amount]").value), note: row.querySelector("[name=q_note]").value.trim(), selected: row.querySelector("[name=q_sel]").checked })).filter((q) => q.supplier);
    return (await rpc("save_estimate", { p_estimate: f(fd, "id"), p: { ...Object.fromEntries(["name", "client", "address", "markup_pct", "valid_until", "inclusions", "exclusions", "notes"].map((k) => [k, f(fd, k)])), items, quotes } })).message;
  },
  async estimateAction(fd) {
    const action = f(fd, "action"), r = await rpc("estimate_action", { p_estimate: f(fd, "id"), p_action: action, p: Object.fromEntries(["note", "code", "start_date", "pc_date"].map((k) => [k, f(fd, k)])) });
    if (action === "convert") return { msg: r.message, go: `/app/projects/${r.id}/commercial` };
    if (action === "new_version") return { msg: r.message, go: `/app/estimates/${r.id}` };
    return r.message;
  },
  async saveAssembly(fd) {
    const d = fd.getAll("c_desc"), q = fd.getAll("c_qty"), un = fd.getAll("c_unit"), rt = fd.getAll("c_rate");
    const components = d.map((x, i) => ({ description: String(x).trim(), qty: evalQty(q[i]), unit: String(un[i]).trim(), rate: parseMoney(rt[i]) ?? 0 })).filter((c) => c.description);
    if (components.some((c) => Number.isNaN(c.qty))) throw new RuleError("Check the component quantities.");
    return (await rpc("save_assembly", { p_org: DB.org.id, p_id: null, p: { name: f(fd, "name"), unit: f(fd, "unit"), category: f(fd, "category"), components } })).message;
  },
  async issueHandover(fd) {
    return (await rpc("issue_handover", { p_project: f(fd, "project"), p: { recipient: f(fd, "recipient"), dlp_months: f(fd, "dlp_months"), note: f(fd, "note"), accept_outstanding: fd.get("accept_outstanding") === "on" } })).message;
  },
  // ---- costs & claims
  async budgetLine(fd) {
    const b = f(fd, "budget") ? parseMoney(f(fd, "budget")) : 0, fo = f(fd, "forecast_override") ? parseMoney(f(fd, "forecast_override")) : null;
    if (b === null) throw new RuleError("Enter the budget as a number.");
    return (await rpc("save_budget_line", { p_project: f(fd, "project"), p_id: f(fd, "id") || null, p: { cost_code: f(fd, "cost_code"), description: f(fd, "description"), kind: f(fd, "kind"), budget: b, forecast_override: fo } })).message;
  },
  async createPo(fd) {
    const amount = parseMoney(f(fd, "amount"));
    return (await rpc("create_po", { p_project: f(fd, "project"), p: { contractor_id: f(fd, "contractor_id"), cost_code: f(fd, "cost_code"), description: f(fd, "description"), amount } })).message;
  },
  async poAction(fd) { return (await rpc("po_action", { p_po: f(fd, "id"), p_action: f(fd, "action") })).message; },
  async enterBill(fd, u, el) {
    const amount = parseMoney(f(fd, "amount")), gst = f(fd, "gst") ? parseMoney(f(fd, "gst")) : null;
    if (amount === null) throw new RuleError("Enter the amount (excl. GST).");
    const file = el.querySelector("[name=file]")?.files?.length ? await uploadDocument(el.querySelector("[name=file]")) : "";
    return (await rpc("enter_bill", { p_project: f(fd, "project"), p: { contractor_id: f(fd, "contractor_id"), invoice_number: f(fd, "invoice_number"), invoice_date: f(fd, "invoice_date"), due_date: f(fd, "due_date"), amount, gst, po_id: f(fd, "po_id"), cost_code: f(fd, "cost_code"), description: f(fd, "description"), file_path: file } })).message;
  },
  async billAction(fd) { return (await rpc("bill_action", { p_bill: f(fd, "id"), p_action: f(fd, "action"), p_note: f(fd, "note"), p_paid: null })).message; },
  async submitReceipt(fd, u, el) {
    const amount = parseMoney(f(fd, "amount"));
    if (!el.querySelector("[name=photo]")?.files?.length) throw new RuleError("Take a photo of the receipt.");
    if (!amount) throw new RuleError("Enter the total on the receipt.");
    const [photo] = await uploadPhotos(el.querySelector("[name=photo]"), 1);
    return (await rpc("submit_receipt", { p_project: f(fd, "project"), p: { supplier: f(fd, "supplier"), amount, paid_with: f(fd, "paid_with"), date: f(fd, "date"), note: f(fd, "note"), photo_path: photo } })).message;
  },
  async receiptAction(fd) { return (await rpc("receipt_action", { p_receipt: f(fd, "id"), p_action: f(fd, "action"), p: { cost_code: f(fd, "cost_code"), reason: f(fd, "reason") } })).message; },
  async internalCharge(fd) {
    return (await rpc("add_internal_charge", { p_project: f(fd, "project"), p: { description: f(fd, "description"), cost_code: f(fd, "cost_code"), amount: parseMoney(f(fd, "amount")), date: f(fd, "date") } })).message;
  },
  async backcharge(fd) {
    return (await rpc("raise_backcharge", { p_project: f(fd, "project"), p: { contractor_id: f(fd, "contractor_id"), amount: parseMoney(f(fd, "amount")), reason: f(fd, "reason"), cost_code: f(fd, "cost_code") } })).message;
  },
  async backchargeAction(fd) { return (await rpc("backcharge_action", { p_bc: f(fd, "id"), p_action: f(fd, "action") })).message; },
  async contractSetup(fd) {
    const p = { contract_type: f(fd, "contract_type"), retention_pct: f(fd, "retention_pct"), retention_cap_pct: f(fd, "retention_cap_pct"), fee_pct: f(fd, "fee_pct") };
    const descs = fd.getAll("ci_desc"), vals = fd.getAll("ci_value");
    const items = descs.map((d, i) => ({ description: String(d).trim(), value: parseMoney(vals[i]) })).filter((x) => x.description);
    const cur = DB.contractItems.filter((x) => x.projectId === f(fd, "project")).map((x) => ({ description: x.description, value: x.value }));
    // The schedule locks after the first claim, so only send it when it has actually changed.
    if (p.contract_type === "lump_sum" && JSON.stringify(items) !== JSON.stringify(cur)) p.items = items;
    return (await rpc("save_contract_setup", { p_project: f(fd, "project"), p })).message;
  },
  async createClaim(fd) {
    const items = [], variations = [];
    for (const [k, v] of fd) {
      if (!String(v).trim()) continue;
      const amt = parseMoney(v);
      if (amt === null) throw new RuleError("Enter amounts as numbers.");
      if (k.startsWith("item:")) items.push({ id: k.slice(5), to_date: amt });
      if (k.startsWith("var:")) variations.push({ id: k.slice(4), to_date: amt });
    }
    const r = await rpc("create_claim", { p_project: f(fd, "project"), p: { period_end: f(fd, "period_end"), due_date: f(fd, "due_date"), items, variations } });
    return { msg: r.message, go: `/app/projects/${f(fd, "project")}/commercial/claims/${r.id}` };
  },
  async claimAction(fd) {
    const c = DB.claims.find((x) => x.id === f(fd, "id")), r = await rpc("claim_action", { p_claim: c.id, p_action: f(fd, "action"), p: { amount: f(fd, "amount") ? parseMoney(f(fd, "amount")) : null, note: f(fd, "note"), date: f(fd, "date"), due_date: f(fd, "due_date") } });
    return f(fd, "action") === "delete" ? { msg: r.message, go: `/app/projects/${c.projectId}/commercial/claims` } : r.message;
  },
  // ---- team chat, phone tasks, site notes
  async postMessage(fd, u, el) {
    const pid = f(fd, "project"), input = el.querySelector("[name=photos]");
    if (!f(fd, "body") && !input?.files?.length) throw new RuleError("Write a message or add a photo.");
    const photos = await uploadPhotos(input, 4);
    await rpc("post_message", { p_project: pid, p_body: f(fd, "body"), p_photos: photos });
    await pollMessages(pid);
    return { msg: "Sent.", noReload: true, quiet: true, focus: "[name=body]" };
  },
  async createSiteTask(fd) {
    return (await rpc("create_site_task", { p_project: f(fd, "project"), p: Object.fromEntries(["title", "assignee_id", "due_date", "photos_required", "details", "defect_id", "itp_point_id"].map((k) => [k, f(fd, k)])) })).message;
  },
  async taskDone(fd, u, el) {
    const t = DB.siteTasks.find((x) => x.id === f(fd, "task")), input = el.querySelector("[name=photos]");
    if ((input?.files?.length || 0) < t.photosRequired) throw new RuleError(`Add at least ${t.photosRequired} photo${t.photosRequired > 1 ? "s" : ""} of the finished work.`);
    const photos = await uploadPhotos(input, 10);
    return (await rpc("site_task_action", { p_task: t.id, p_action: "submit", p: { note: f(fd, "note"), photos } })).message;
  },
  async taskCheck(fd) { return (await rpc("site_task_action", { p_task: f(fd, "task"), p_action: f(fd, "action"), p: { note: f(fd, "note") } })).message; },
  async sendSiteNote(fd, u, el) {
    if (!f(fd, "body")) throw new RuleError("Write what happened on site.");
    const photos = await uploadPhotos(el.querySelector("[name=photos]"), 6);
    return (await rpc("send_site_note", { p_project: f(fd, "project"), p_body: f(fd, "body"), p_photos: photos })).message;
  },
  async siteNote(fd) { return (await rpc("site_note_action", { p_note: f(fd, "note"), p_action: f(fd, "action") })).message; },
  // ---- timesheets & rates
  async createTimesheet(fd, u, el) {
    // The site app form has no billable box: workers' hours are billable unless the office says otherwise.
    const p = { ...tsPayload(fd), billable: el.querySelector("[name=billable]") ? fd.get("billable") === "on" : true };
    return (await rpc("create_timesheet", { p_project: f(fd, "project"), p })).message;
  },
  async updateTimesheet(fd, u, el) {
    const t = DB.timesheets.find((x) => x.id === f(fd, "id"));
    if (fd.get("remove") === "1") { const r = await rpc("delete_timesheet", { p_ts: t.id }); return { msg: r.message, go: `/app/projects/${t.projectId}/workforce/timesheets?week=${weekStart(t.date)}` }; }
    const p = tsPayload(fd);
    p.billable = el.querySelector("[name=billable]") ? fd.get("billable") === "on" : t.billable;
    const r = await rpc("update_timesheet", { p_ts: t.id, p });
    return { msg: r.message, go: `/app/projects/${t.projectId}/workforce/timesheets?week=${weekStart(f(fd, "date") || t.date)}` };
  },
  async tsBulk(fd) {
    const ids = fd.getAll("ids");
    if (!ids.length) throw new RuleError("Tick the timesheets first.");
    const cost = f(fd, "cost") ? parseMoney(f(fd, "cost")) : null, charge = f(fd, "charge") ? parseMoney(f(fd, "charge")) : null;
    return (await rpc("timesheet_action", { p_ids: ids, p_action: f(fd, "action"), p_reason: f(fd, "reason"), p_cost: cost, p_charge: charge })).message;
  },
  async fromSignIns(fd) { return (await rpc("timesheets_from_sign_ins", { p_project: f(fd, "project"), p_date: f(fd, "date") })).message; },
  async saveRateCard(fd) {
    const cost = parseMoney(f(fd, "cost")), charge = parseMoney(f(fd, "charge"));
    if (cost === null || charge === null) throw new RuleError("Enter both the cost and chargeout rates per hour.");
    const p = { name: f(fd, "name"), cost_rate: cost, charge_rate: charge };
    if (fd.has("archived")) p.archived = fd.get("archived") === "true";
    return (await rpc("save_rate_card", { p_org: DB.org.id, p_id: f(fd, "id") || null, p })).message;
  },
  async setRate(fd) {
    const money_ = (k) => (f(fd, k) ? parseMoney(f(fd, k)) : null);
    return (await rpc("set_rate_rule", { p_org: DB.org.id, p: { project_id: f(fd, "project_id"), worker_id: f(fd, "worker_id"), cost_code: f(fd, "cost_code"), rate_card_id: f(fd, "rate_card_id"), cost_rate: money_("cost"), charge_rate: money_("charge") } })).message;
  },
  // ---- safety extras
  async createNcr(fd) {
    const r = await rpc("create_ncr", { p_project: f(fd, "project"), p: Object.fromEntries(["title", "requirement", "location", "contractor_id", "containment"].map((k) => [k, f(fd, k)])) });
    return { msg: r.message, go: `/app/projects/${f(fd, "project")}/quality/ncrs/${r.id}` };
  },
  async updateNcr(fd) { return (await rpc("update_ncr", { p_ncr: f(fd, "id"), p: Object.fromEntries(["containment", "root_cause", "corrective_action"].map((k) => [k, f(fd, k)])) })).message; },
  async advanceNcr(fd) { return (await rpc("advance_ncr", { p_ncr: f(fd, "id"), p_note: f(fd, "note") })).message; },
  async requestPermit(fd) {
    const r = await rpc("request_permit", { p_project: f(fd, "project"), p: Object.fromEntries(["type", "location", "valid_from", "valid_to", "contractor_id", "description", "conditions"].map((k) => [k, f(fd, k)])) });
    return { msg: r.message, go: `/app/projects/${f(fd, "project")}/safety/permits/${r.id}` };
  },
  async permitAction(fd) { return (await rpc("permit_action", { p_permit: f(fd, "id"), p_action: f(fd, "action"), p_note: f(fd, "note") })).message; },
  async reportIncident(fd) {
    const at = f(fd, "occurred_at");
    const r = await rpc("report_incident", { p_project: f(fd, "project"), p: { ...Object.fromEntries(["type", "severity", "title", "location", "description", "immediate_action"].map((k) => [k, f(fd, k)])), occurred_at: at ? new Date(at).toISOString() : "", notifiable: fd.get("notifiable") === "on" } });
    return { msg: r.message, go: `/app/projects/${f(fd, "project")}/safety/incidents/${r.id}` };
  },
  async incidentAction(fd) { return (await rpc("incident_action", { p_incident: f(fd, "id"), p_action: f(fd, "action"), p: { root_cause: f(fd, "root_cause"), corrective_action: f(fd, "corrective_action") } })).message; },
  async toolbox(fd) { return (await rpc("record_toolbox_talk", { p_project: f(fd, "project"), p: { topic: f(fd, "topic"), date: f(fd, "date"), notes: f(fd, "notes"), attendees: fd.getAll("attendees") } })).message; },
  async manualIn(fd) { return (await rpc("manual_sign_in", { p_project: f(fd, "project"), p_worker: f(fd, "worker"), p_reason: f(fd, "reason") })).message; },
  async manualOut(fd) { return (await rpc("manual_sign_out", { p_project: f(fd, "project"), p_worker: f(fd, "worker") })).message; },
  async fixMissing(fd) { return (await rpc("fix_missing_sign_outs", { p_project: f(fd, "project") })).message; },
  async visitorOut(fd) { return (await rpc("office_visitor", { p_project: f(fd, "project"), p_action: "sign_out", p: { id: f(fd, "id") } })).message; },
  async resetGate(fd) { return (await rpc("reset_gate_code", { p_project: f(fd, "project") })).message; },
  // ---- the gate (no account)
  async gateWorker(fd) {
    const code = f(fd, "worker_code").replace(/\D/g, "");
    if (code.length !== 6) throw new RuleError("Enter your 6-digit worker code.");
    await gateStatus(code);
    prefs.set("buildos_worker_code", code);
    return { msg: `Hi ${GATE.status.name.split(" ")[0]}.`, noReload: true };
  },
  async gateAck(fd) {
    const r = await gateRpc("gate_worker_action", { p_worker_code: GATE.workerCode, p_action: "acknowledge", p_swms: f(fd, "swms") });
    await gateStatus(GATE.workerCode);
    return { msg: r.message, noReload: true };
  },
  async gateIn() {
    const r = await gateRpc("gate_worker_action", { p_worker_code: GATE.workerCode, p_action: "sign_in" });
    await gateStatus(GATE.workerCode);
    return { msg: r.message, noReload: true };
  },
  async gateOut() {
    const r = await gateRpc("gate_worker_action", { p_worker_code: GATE.workerCode, p_action: "sign_out" });
    await gateStatus(GATE.workerCode);
    return { msg: r.message, noReload: true };
  },
  async gateVisitorIn(fd) {
    const r = await gateRpc("gate_visitor_sign_in", { p: { ...Object.fromEntries(["name", "company", "phone", "purpose", "host", "vehicle_rego"].map((k) => [k, f(fd, k)])), rules_accepted: fd.get("rules_accepted") === "on" } });
    prefs.set(`buildos_visitor_${GATE.code}`, JSON.stringify({ id: r.id, name: f(fd, "name") }));
    GATE.step = "home";
    return { msg: r.message, noReload: true };
  },
  async gateVisitorOut(fd) {
    try { const r = await gateRpc("gate_visitor_sign_out", { p_visitor: f(fd, "visitor") }); return { msg: r.message, noReload: true }; }
    finally { prefs.del(`buildos_visitor_${GATE.code}`); }
  },
  async swmsAck(fd) { return (await rpc("swms_acknowledge", { p_swms: f(fd, "swmsId") })).message; },
  async siteIn(fd) { return (await rpc("site_sign_in", { p_project: f(fd, "projectId") })).message; },
  async siteOut(fd) { return (await rpc("site_sign_out", { p_project: f(fd, "projectId") })).message; },
  async diary(fd) { return (await rpc("submit_diary", { p_project: f(fd, "projectId"), p_weather: f(fd, "weather"), p_notes: f(fd, "notes"), p_delays: f(fd, "delays"), p_date: todayYmd() })).message; },
};

document.addEventListener("submit", async (e) => {
  const el = e.target;
  if (el.matches("[data-search]")) { e.preventDefault(); go(`/app/search?q=${encodeURIComponent(el.q.value)}`); return; }
  if (el.matches("[data-filter]")) {
    e.preventDefault();
    const qs = new URLSearchParams([...new FormData(el)].filter(([, v]) => v)).toString();
    go(el.dataset.filter.slice(1) + (qs ? `?${qs}` : "")); return;
  }
  if (!el.dataset.act) return;
  e.preventDefault();
  const sub = e.submitter;
  if (el.dataset.confirm && (!el.dataset.confirmFor || sub?.value === el.dataset.confirmFor) && !confirm(el.dataset.confirm)) return;
  const fd = new FormData(el, sub);
  // One key per form instance, so a retried submit can't create a duplicate defect.
  el.dataset.clientKey ||= crypto.randomUUID();
  const buttons = el.querySelectorAll("button");
  buttons.forEach((b) => (b.disabled = true));
  const label = sub?.innerHTML;
  if (sub) sub.innerHTML = `${icon("rotate", 15, "animation:spin 1s linear infinite")} Saving…`;
  try {
    const r = await ACTIONS[el.dataset.act](fd, currentUser(), el);
    const res = typeof r === "string" ? { msg: r } : r;
    if (res.stay) { el.innerHTML = `<div class="notice notice-ok">${icon("checkcircle")}<span>${esc(res.msg)}</span></div>`; return; }
    if (!res.noReload) await refresh();
    if (!res.quiet) toast(res.msg);
    const keep = el.closest("tr")?.id;
    if (res.go) go(res.go);
    else { pendingScroll = keep || null; const y = window.scrollY; render(); if (!keep) window.scrollTo(0, y); }
    if (res.focus) document.querySelector(res.focus)?.focus();
  } catch (err) {
    buttons.forEach((b) => (b.disabled = false));
    if (sub) sub.innerHTML = label;
    if (err instanceof RuleError) formError(el, err.message);
    else { console.error(err); formError(el, friendlyError(err)); }
  }
});

document.addEventListener("click", async (e) => {
  const hz = e.target.closest("[data-add-row],[data-remove-row]");
  if (hz) {
    const rows = hz.closest("form").querySelector(".hz-rows");
    if (hz.dataset.addRow) { rows.insertAdjacentHTML("beforeend", hazardRow()); rows.lastElementChild.querySelector("input").focus(); }
    else if (rows.children.length > 1) hz.closest(".hz-row").remove();
    return;
  }
  const est = e.target.closest("[data-add-est],[data-remove-est],[data-insert-asm]");
  if (est) {
    const fm = est.closest("form");
    if ("removeEst" in est.dataset) { const rows = est.closest(".est-rows"); if (rows.children.length > 1) est.closest(".est-row").remove(); else est.closest(".est-row").querySelectorAll("input").forEach((i) => (i.type === "checkbox" ? (i.checked = false) : (i.value = ""))); }
    else if (est.dataset.addEst) { const rows = fm.querySelector(`[data-rows=${est.dataset.addEst}]`); rows.insertAdjacentHTML("beforeend", est.dataset.addEst === "items" ? estRow() : quoteRow()); rows.lastElementChild.querySelector("input").focus(); }
    else {
      // Expand an assembly into priced items: component quantity × how many.
      const a = DB.assemblies.find((x) => x.id === fm.querySelector("[data-asm]").value), n = evalQty(fm.querySelector("[data-asm-qty]").value || "1");
      if (!a || Number.isNaN(n) || !n) { formError(fm, "Choose an assembly and how many."); return; }
      const rows = fm.querySelector("[data-rows=items]");
      [...rows.querySelectorAll(".est-row")].filter((r) => !r.querySelector("[name=it_desc]").value.trim()).forEach((r) => r.remove());
      for (const c of a.components) rows.insertAdjacentHTML("beforeend", estRow({ category: a.category || a.name, description: `${c.description} (${a.name})`, qty: Math.round(c.qty * n * 1000) / 1000, unit: c.unit, rate: c.rate }));
    }
    return;
  }
  const pt = e.target.closest("[data-add-point],[data-remove-point]");
  if (pt) {
    const rows = pt.closest("form").querySelector(".pt-rows");
    if ("addPoint" in pt.dataset) { rows.insertAdjacentHTML("beforeend", templatePointRow()); rows.lastElementChild.querySelector("input").focus(); }
    else if (rows.children.length > 1) pt.closest(".pt-row").remove();
    return;
  }
  const gs = e.target.closest("[data-gate-step],[data-gate-forget]");
  if (gs) {
    if ("gateForget" in gs.dataset) { prefs.del("buildos_worker_code"); GATE.status = null; GATE.step = "worker"; }
    else { GATE.step = gs.dataset.gateStep; if (GATE.step === "home") GATE.status = null; }
    render(); window.scrollTo(0, 0); return;
  }
  if (e.target.closest("[data-print]")) { window.print(); return; }
  const pay = e.target.closest("[data-payroll]");
  if (pay) { exportPayroll(pay.dataset.payroll); return; }
  const tick = e.target.closest("[data-tick-onsite]");
  if (tick) { tick.closest("form").querySelectorAll("input[data-onsite]").forEach((c) => (c.checked = true)); return; }
  const t = e.target.closest("[data-signout],[data-org],[data-export],[data-qr],[data-refresh]");
  document.querySelectorAll("details.menu[open]").forEach((d) => { if (!d.contains(e.target) || t) d.removeAttribute("open"); });
  if (!t) return;
  if ("signout" in t.dataset) { e.preventDefault(); await sb.auth.signOut(); SESSION = null; DB = null; go("/login"); }
  else if (t.dataset.org) { showLoading("Switching company…"); prefs.set(ORG_KEY, t.dataset.org); await loadCompany(t.dataset.org); go(homeFor(currentUser())); }
  else if ("refresh" in t.dataset) { e.preventDefault(); showLoading(); await enterApp(); go(DB ? homeFor(currentUser()) : "/welcome"); }
  else if (t.dataset.export) exportDefects(t.dataset.export);
  else if ("qr" in t.dataset) alert("QR location scanning uses the phone camera — planned for the installable app build.");
});

document.addEventListener("change", async (e) => {
  const el = e.target;
  if (el.matches("[data-switch]")) {
    const { path } = parseRoute(), cur = path.match(/^\/app\/projects\/([^/]+)(\/[^/]+)?/);
    go(el.value ? `/app/projects/${el.value}${cur?.[2] && !/defects|itp|new/.test(path) ? cur[2] : ""}` : "/app");
  }
  if (el.matches("[data-count-files]")) { const box = el.closest("form").querySelector("[data-file-count]"); if (box) box.textContent = el.files.length ? `${el.files.length} photo${el.files.length > 1 ? "s" : ""} attached` : ""; return; }
  if (el.matches("[data-est-calc]")) return;
  if (el.matches("[data-check-all]")) { el.closest("form").querySelectorAll("input[name=ids]").forEach((c) => (c.checked = el.checked)); return; }
  if (el.matches("[data-doc-number]")) {
    // Typing an existing number fills in its title and category.
    const fm = el.closest("form"), d = DB.documents.find((x) => x.number.toLowerCase() === el.value.trim().toLowerCase());
    const title = fm.querySelector("[name=title]"), cat = fm.querySelector("[name=category]");
    if (d) { if (!title.value) title.value = d.title; if (d.category) cat.value = d.category; }
  }
  if (el.matches("[data-photo-input]")) {
    const fm = el.closest("form"), shots = (await previewPhotos(el)).filter(Boolean);
    fm.querySelectorAll("[data-preview]").forEach((p, i) => { if (shots[i]) { p.style.background = `center/cover url(${shots[i]})`; p.textContent = ""; } });
    fm.querySelector("[data-photo-count]").textContent = shots.length ? `${shots.length} photo${shots.length > 1 ? "s" : ""} attached` : "";
  }
});

// Live line totals while editing an estimate.
document.addEventListener("input", (e) => {
  const row = e.target.closest?.(".est-row");
  if (!row || !e.target.matches("[data-est-calc]")) return;
  const q = evalQty(row.querySelector("[name=it_qty]").value), r = parseMoney(row.querySelector("[name=it_rate]").value);
  row.querySelector("[data-line-total]").textContent = Number.isNaN(q) ? "check qty" : r === null ? "" : money(Math.round(q * r));
});

document.addEventListener("keydown", (e) => {
  if (e.key === "/" && !/input|textarea|select/i.test(document.activeElement?.tagName || "")) { const q = document.getElementById("q"); if (q) { e.preventDefault(); q.focus(); } }
});
const refreshOnline = () => document.querySelectorAll("[data-online-pill]").forEach((p) => (p.innerHTML = navigator.onLine ? `<span class="badge badge-green">${icon("check", 12)}Online</span>` : badge("offline")));
window.addEventListener("online", refreshOnline);
window.addEventListener("offline", refreshOnline);

// Pick up colleagues' changes when you come back to the tab.
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible" || !DB || Date.now() - lastLoad < 30000) return;
  if (document.querySelector("form[data-act] input:focus, form[data-act] textarea:focus")) return;
  try { await refresh(); render(); } catch { /* keep showing what we have */ }
});

function downloadCsv(name, rows) {
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([rows.map((r) => r.map(q).join(",")).join("\r\n")], { type: "text/csv" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
/** Approved and processed hours for the week, split into ordinary and overtime. */
function exportPayroll(week) {
  const list = timesheetsIn(week).filter((t) => t.status === "approved" || t.status === "processed"), ot = splitOvertime(list);
  const rows = list.map((t) => ({ t, w: DB.workers.find((x) => x.id === t.workerId) })).sort((a, b) => (a.w?.name ?? "").localeCompare(b.w?.name ?? "") || a.t.date.localeCompare(b.t.date));
  downloadCsv(`Payroll-${week}.csv`, [["Worker", "Company", "Date", "Project", "Start", "Finish", "Unpaid break (min)", "Hours", "Ordinary", "Overtime", "Cost code", "Task", "Billable", "Status"],
    ...rows.map(({ t, w }) => [w?.name, contractorOf(w?.contractorId)?.tradingName, t.date, projName(t.projectId), hm(t.startTime), hm(t.endTime), t.breakMin, Number(t.hours), ot[t.id][0], ot[t.id][1], t.costCode, DB.tasks.find((x) => x.id === t.taskId)?.name, t.billable ? "Yes" : "No", t.status])]);
}

function exportDefects(pid) {
  const u = currentUser(), p = getProject(u, pid), { query } = parseRoute();
  const rows = filterDefects(u, pid, query);
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [["ID", "Title", "Location", "Trade", "Contractor", "Priority", "Due", "Status"].join(","), ...rows.map((d) => [d.ref, d.title, locationLabel(d), d.trade, contractorOf(d.contractorId)?.tradingName, d.priority, d.dueDate, d.status].map(q).join(","))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `${p.code}-defects.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ------------------------------------------------------------- boot
(async function boot() {
  showLoading();
  const rawHash = location.hash;
  let recovery = /type=recovery/.test(rawHash);
  sb.auth.onAuthStateChange((event, session) => {
    SESSION = session;
    if (event === "PASSWORD_RECOVERY") { recovery = true; go("/reset"); }
    if (event === "SIGNED_OUT") { DB = null; MY_ORGS = []; }
  });
  try {
    const { data } = await sb.auth.getSession();
    SESSION = data.session;
    // Links from Supabase emails put tokens or errors in the URL hash; tidy them away.
    if (/access_token=|error_description=|error=/.test(rawHash)) {
      const err = new URLSearchParams(rawHash.slice(1)).get("error_description");
      history.replaceState(null, "", appUrl() + (recovery ? "#/reset" : "#/"));
      if (err) setTimeout(() => toast(err.replace(/\+/g, " "), "error"), 100);
    }
    if (SESSION && !recovery) await enterApp();
    lastLoad = Date.now();
    render();
  } catch (e) {
    console.error(e);
    showFatal(friendlyError(e));
  }
})();
