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

function resolve(path, query) {
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
  const company = {
    "/app": [pageControlCentre, "Company overview"], "/app/projects": [pageProjects, "Projects"], "/app/projects/new": [pageNewProject, "New project"],
    "/app/tasks": [pageTasks, "My tasks"], "/app/people": [pagePeople, "People & contractors"], "/app/reports": [(x) => pageReports(x, query), "Reports"],
    "/app/search": [(x) => pageSearch(x, query), "Search"], "/app/settings": [pageSettings, "Team & roles"], "/app/profile": [pageProfile, "My profile"],
  };
  if (company[path]) return { html: appShell(u, path, company[path][0](u)), title: company[path][1] };
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
    else if (sub === "programme") { html = pageProgramme(u, p, query); title = "Programme"; }
    else if ((mm = sub.match(/^programme\/(.+)$/))) { html = pageTask(u, p, mm[1]); title = "Task"; }
    else if (sub === "commercial") { html = pageCommercial(u, p); title = "Commercial"; }
    else if (sub === "safety") { html = pageSafety(u, p); title = "Safety"; }
    else if ((mm = sub.match(/^safety\/swms\/(.+)$/))) { html = pageSwms(u, p, mm[1]); title = "SWMS"; }
    else if (sub === "workforce") { html = pageWorkforce(u, p); title = "Workforce"; }
    else if (sub === "documents") { html = pageDocuments(u, p, query); title = "Documents"; }
    else if ((mm = sub.match(/^documents\/(.+)$/))) { html = pageDocument(u, p, mm[1]); title = "Document"; }
    else if (sub === "diary") { html = pageDiary(u, p); title = "Site diary"; }
    else if (sub === "reports") html = pagePlaceholder(p, "Project reports", "chart", "Weekly project summary, quality trends, labour hours by trade and cost reports — every metric with a written definition. Planned for a later phase.");
    else if (sub === "handover") html = pagePlaceholder(p, "Handover", "package", "Compile outstanding defects, inspections, certificates and warranties into an audit-ready handover pack. Planned for a later phase.");
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
    toast(res.msg);
    const keep = el.closest("tr")?.id;
    if (res.go) go(res.go);
    else { pendingScroll = keep || null; const y = window.scrollY; render(); if (!keep) window.scrollTo(0, y); }
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
  const pt = e.target.closest("[data-add-point],[data-remove-point]");
  if (pt) {
    const rows = pt.closest("form").querySelector(".pt-rows");
    if ("addPoint" in pt.dataset) { rows.insertAdjacentHTML("beforeend", templatePointRow()); rows.lastElementChild.querySelector("input").focus(); }
    else if (rows.children.length > 1) pt.closest(".pt-row").remove();
    return;
  }
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
