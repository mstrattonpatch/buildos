// ===================================================== UI components
// One status language shared by every module: icon + word, never colour alone.
const STATUS = {
  draft: ["grey", "dashed", "Draft"], open: ["outline", "circle", "Open"], assigned: ["outline", "circle", "Assigned"],
  not_started: ["grey", "dashed", "Not started"], pending: ["grey", "dashed", "Pending"],
  rectifying: ["blue", "clock", "Rectifying"], in_progress: ["blue", "clock", "In progress"], in_review: ["blue", "clock", "In review"],
  under_review: ["blue", "clock", "Under review"], submitted: ["blue", "clock", "Submitted"], ready_for_verification: ["blue", "clock", "In review"],
  awaiting_verification: ["blue", "clock", "Awaiting verification"], approved: ["green", "check", "Approved"], released: ["green", "check", "Released"],
  verified: ["green", "check", "Verified"], current: ["green", "check", "Current"], complete: ["green", "check", "Complete"],
  certified: ["green", "check", "Certified"], paid: ["green", "check", "Paid"], included_in_claim: ["green", "check", "In claim"],
  closed: ["green", "check", "Closed"], superseded: ["grey", "dashed", "Superseded"], overdue: ["amber", "alert", "Overdue"],
  expiring: ["amber", "alert", "Expiring"], changes_requested: ["amber", "alert", "Changes requested"], rejected: ["red", "xcircle", "Rejected"],
  expired: ["red", "xcircle", "Expired"], blocked: ["red-solid", "lock", "Blocked"], hold: ["red-solid", "lock", "Hold point"], offline: ["dashed", "cloudoff", "Offline"],
};
const badge = (status, label) => { const [t, i, l] = STATUS[status] || ["grey", "circle", status]; return `<span class="badge badge-${t}">${icon(i, 13, "stroke-width:2.6")}${esc(label ?? l)}</span>`; };
const sampleTag = () => `<span class="sample-tag" title="Illustrative figures">Sample data</span>`;
const logo = (light = false, size = 26) => `<span class="row" style="gap:9px;font-weight:700;font-size:17px;color:${light ? "#fff" : "var(--ink)"}"><svg width="${size}" height="${size}" viewBox="0 0 26 26" aria-hidden="true"><rect width="26" height="26" rx="6" fill="${light ? "#27815F" : "#182E27"}"/><rect x="6" y="7" width="10" height="2.6" rx="1.3" fill="#fff"/><rect x="6" y="11.7" width="14" height="2.6" rx="1.3" fill="#fff" opacity=".85"/><rect x="6" y="16.4" width="7" height="2.6" rx="1.3" fill="#fff" opacity=".7"/></svg><span class="brand-text">BuildOS</span></span>`;
function metric(label, value, note, tone, href) {
  const n = note ? `<div class="m-note ${tone === "amber" ? "amber-text" : tone === "red" ? "red-text" : ""}">${tone === "amber" ? icon("alert", 12) : tone === "red" ? icon("lock", 12) : ""}${esc(note)}</div>` : "";
  const body = `<div class="m-label">${esc(label)}</div><div class="m-value">${esc(value)}</div>${n}`;
  return href ? `<a class="metric" href="${href}">${body}</a>` : `<div class="metric">${body}</div>`;
}
const emptyState = (ic, title, body, action = "") => `<div class="empty"><div class="icon">${icon(ic, 20)}</div><h3>${esc(title)}</h3><p class="muted small" style="margin:4px 0 14px;max-width:420px">${esc(body)}</p>${action}</div>`;
function pageHeader({ crumbs, title, meta, actions }) {
  return `<div class="page-header"><div style="min-width:0">${crumbs ? `<nav class="crumbs small muted" aria-label="Breadcrumb">${crumbs.map(([h, l], i) => `${i ? " › " : ""}<a href="${h}">${esc(l)}</a>`).join("")}</nav>` : ""}<h1>${title}</h1>${meta ? `<div class="page-meta muted">${meta}</div>` : ""}</div>${actions ? `<div class="row wrap page-actions">${actions}</div>` : ""}</div>`;
}
const stepper = (steps, current) => { const idx = steps.findIndex(([s]) => s === current); return `<ol class="stepper" aria-label="Workflow">${steps.map(([s, l], i) => `<li class="row" style="gap:6px">${i ? '<span class="sep">›</span>' : ""}<span class="step" data-state="${i < idx ? "done" : i === idx ? "current" : "todo"}">${l}</span></li>`).join("")}</ol>`; };
const taskList = (items) => items.length ? `<div class="stack" style="gap:8px">${items.map((t) => `<a href="${t.href}" class="task-item" data-tone="${t.tone}"><div style="font-weight:600;font-size:13.5px">${esc(t.title)}</div><div class="muted small">${esc(t.sub)}</div></a>`).join("")}</div>` : `<p class="muted small">Nothing waiting on you. Nice.</p>`;
const photoTile = (path, extra = "") => { const src = DB.photoUrls[path]; return `<div class="photo-ph" style="${src ? `background:center/cover url('${src}');` : ""}${extra}">${src ? "" : path === "sample" ? "Sample" : ""}</div>`; };
const crumbsFor = (p) => [["#/app/projects", "Projects"], [`#/app/projects/${p.id}`, p.name]];
/** A form whose submit is handled by ACTIONS[act]. Errors show inline; success re-renders with a toast. */
const form = (act, inner, attrs = "") => `<form data-act="${act}" ${attrs} novalidate>${inner}<div class="form-msg"></div></form>`;
const hidden = (n, v) => `<input type="hidden" name="${n}" value="${esc(v)}">`;

// --------------------------------------------------------------- gantt
function taskTone(t) {
  if (t.status === "blocked") return ["var(--red)", "blocked"];
  if (t.status === "complete") return ["#9fb8ab", "complete"];
  if (t.forecastFinish > t.baselineFinish) return ["var(--amber)", "at risk"];
  if (t.status === "in_progress") return ["var(--green)", "in progress"];
  return [t.forecastStart <= todayYmd() ? "var(--blue)" : "#c9cfc8", "starting"];
}
function gantt(tasks, fromOffset = -2, days = 14, opts = {}) {
  const start = startOfDay(new Date()); start.setDate(start.getDate() + fromOffset);
  const idx = (s) => Math.round((D(s) - start) / 86400000);
  const P = (i) => `${(Math.max(0, Math.min(days, i)) / days) * 100}%`;
  const today = -fromOffset;
  const cols = Array.from({ length: days }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return d; });
  const head = cols.map((d, i) => `<span data-today="${i === today}" style="visibility:${d.getDay() % 6 ? "visible" : "hidden"}">${days > 20 ? (d.getDay() === 1 ? d.getDate() : "") : `${d.toLocaleDateString("en-AU", { weekday: "narrow" })} ${d.getDate()}`}</span>`).join("");
  const rows = tasks.map((t) => {
    const s = idx(t.forecastStart), f = idx(t.forecastFinish) + 1, bs = idx(t.baselineStart), bf = idx(t.baselineFinish) + 1, [c, l] = taskTone(t);
    const crit = opts.critical?.get(t.id)?.critical ? " crit" : "";
    const bars = t.isMilestone ? `<span class="g-ms${crit}" style="left:calc(${P(s + 0.5)} - 6px);background:${c}"></span>`
      : `${f > 0 && s < days ? `<span class="g-bar${crit}" style="left:${P(s)};width:calc(${P(f)} - ${P(s)});background:${c}"></span>` : ""}${bf > 0 && bs < days ? `<span class="g-base" style="left:${P(bs)};width:calc(${P(bf)} - ${P(bs)})"></span>` : ""}`;
    const label = opts.link ? `<a href="${opts.link}/${t.id}" class="rowlink">${esc(t.name)}</a>` : esc(t.name);
    return `<div class="g-name" style="font-weight:${t.isMilestone ? 700 : 500}" title="${esc(t.name)}">${label}</div><div class="g-track" aria-label="${esc(t.name)}: ${l}"><span class="g-today" style="left:${P(today + 0.5)}"></span>${bars}</div>`;
  }).join("");
  return `<div class="gantt"><div></div><div class="g-head" style="grid-template-columns:repeat(${days},1fr)">${head}</div>${rows}</div>`;
}
const ganttKey = (crit = false) => `<div class="row wrap small muted" style="gap:14px;margin-top:12px">${crit ? '<span class="row" style="gap:5px"><i class="key crit-key"></i>Critical path</span>' : ""}<span class="row" style="gap:5px"><i class="key" style="background:var(--green)"></i>In progress</span><span class="row" style="gap:5px"><i class="key" style="background:var(--amber)"></i>At risk (forecast past baseline)</span><span class="row" style="gap:5px"><i class="key" style="background:var(--blue)"></i>Starting</span><span class="row" style="gap:5px"><i class="key" style="background:var(--red);width:9px;height:9px;transform:rotate(45deg)"></i>Milestone blocked</span><span class="row" style="gap:5px"><i class="key" style="background:#c9cfc8;height:3px"></i>Baseline</span></div>`;

// ===================================================== internal app shell
const companyNav = [["#/app", "Overview", "grid", true], ["#/app/projects", "Projects", "folder", true], ["#/app/tasks", "My tasks", "listchecks", false, "tasks"], ["#/app/people", "People & contractors", "users"], ["#/app/templates", "ITP templates", "clipboard"], ["#/app/reports", "Reports", "chart"]];
const projectNav = (id, money) => { const b = `#/app/projects/${id}`; return [[b, "Overview", "home", true], [`${b}/programme`, "Programme", "calendar"], [`${b}/quality`, "Quality", "clipboard", false, "defects"], [`${b}/safety`, "Safety", "shield"], [`${b}/workforce`, "Workforce & time", "hardhat"], [`${b}/documents`, "Documents", "file"], ...(money ? [[`${b}/commercial`, "Commercial", "dollar"]] : []), [`${b}/diary`, "Site diary", "notebook"], [`${b}/reports`, "Reports", "chart"], [`${b}/handover`, "Handover", "package"]]; };
const isActive = (cur, href, exact) => { const h = href.slice(1); return exact ? cur === h : cur === h || cur.startsWith(h + "/"); };
function navLink([href, label, ic, exact, countKey], cur, counts) {
  const c = countKey ? counts[countKey] : 0;
  return `<a class="nav" href="${href}" title="${label}"${isActive(cur, href, exact) ? ' aria-current="page"' : ""}>${icon(ic, 17)}<span class="nav-text">${label}</span>${c ? `<span class="count ${countKey === "defects" ? "quiet" : ""}">${c}</span>` : ""}</a>`;
}
function appShell(u, route, inner) {
  const projects = listProjects(u), pid = route.match(/^\/app\/projects\/([^/?]+)/)?.[1];
  const project = projects.find((p) => p.id === pid);
  const counts = { tasks: myTasks(u).length, defects: project ? openDefects(u, project.id).length : 0 };
  const side = project
    ? `<a class="nav" href="#/app" title="Company overview">${icon("arrowleft", 16)}<span class="nav-text small">Company overview</span></a>
       <div class="proj-card"><div class="label">Project</div><div style="color:#fff;font-weight:600;font-size:13.5px">${esc(project.name)}</div><div class="mono" style="font-size:11.5px;color:#8fa59b">${project.code}</div></div>
       ${projectNav(project.id, can(u, "commercial.view")).map((n) => navLink(n, route, counts)).join("")}
       <div class="bottom"><a class="nav" href="#/app/settings" title="Settings">${icon("settings", 17)}<span class="nav-text">Project settings</span></a></div>`
    : `<div class="nav-label">Company</div>${companyNav.map((n) => navLink(n, route, counts)).join("")}
       <div class="nav-label">Recent projects</div>${projects.map((p) => `<a class="nav" href="#/app/projects/${p.id}" title="${esc(p.name)}"><span class="recent-dot"></span><span class="nav-text">${esc(p.name)}</span></a>`).join("")}
       <div class="bottom"><a class="nav" href="#/app/settings" title="Company settings">${icon("settings", 17)}<span class="nav-text">Company settings</span></a></div>`;
  const qBase = project || projects[0] ? `#/app/projects/${project?.id ?? projects[0].id}` : "#/app/projects/new";
  const notes = notifications(u);
  const tabs = [["#/app", "Overview", "grid", true], [project ? `#/app/projects/${project.id}` : "#/app/projects", "Project", "home", !!project], [`${qBase}/quality`, "Quality", "clipboard"], ["#/app/tasks", "My tasks", "listchecks"], ["#/site", "Site app", "phone"]];
  return `<div class="shell">
    <div class="sidebar-col"><aside class="sidebar" aria-label="Main navigation"><a href="#/app" class="brand">${logo(true)}</a><div class="org-name" title="${esc(DB.org.name)}">${esc(DB.org.name)}</div>${side}</aside></div>
    <div class="main">
      <header class="topbar">
        <label><span class="sr-only">Switch project</span><select class="select-plain" data-switch>${`<option value="">All projects</option>`}${projects.map((p) => `<option value="${p.id}"${p.id === pid ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
        <form class="search" data-search role="search">${icon("search")}<label class="sr-only" for="q">Search</label><input id="q" name="q" class="input" placeholder="Search projects, defects, drawings, workers…"><kbd>/</kbd></form>
        <div class="spacer"></div>
        <details class="menu"><summary class="btn btn-primary">${icon("plus")} <span class="hide-sm">New</span></summary><div class="menu-panel">
          <div class="menu-label label">Quick create</div>
          ${projects.length ? `<a href="${qBase}/quality/new">${icon("clipboard")} Defect</a><a href="${qBase}/diary">${icon("notebook")} Site diary entry</a>${can(u, "variation.create") ? `<a href="${qBase}/commercial#new-variation">${icon("dollar")} Variation</a>` : ""}` : ""}
          ${can(u, "project.manage") ? `<a href="#/app/projects/new">${icon("folder")} Project</a>` : ""}${can(u, "people.manage") ? `<a href="#/app/people">${icon("users")} Contractor or worker</a>` : ""}
        </div></details>
        <details class="menu"><summary class="icon-btn" aria-label="Notifications (${notes.length})">${icon("bell", 17)}${notes.length ? '<span class="pip"></span>' : ""}</summary><div class="menu-panel" style="width:340px;max-width:90vw">
          <div class="menu-label label">Notifications</div>${notes.map((n) => `<a href="${n.href}" style="align-items:flex-start"><span style="width:8px;height:8px;border-radius:4px;margin-top:6px;flex:none;background:var(--${n.tone})"></span><span><b style="font-weight:600">${esc(n.title)}</b><br><span class="muted small">${esc(n.sub)}</span></span></a>`).join("") || '<p class="muted small" style="padding:8px 10px">All clear.</p>'}
        </div></details>
        <details class="menu"><summary class="avatar" aria-label="Account">${u.initials}</summary><div class="menu-panel" style="width:290px;max-width:90vw">
          <div style="padding:8px 10px"><b>${esc(u.name)}</b><div class="muted small">${esc(u.title)} · ${esc(DB.org.name)}</div></div>
          ${MY_ORGS.length > 1 ? `<div class="menu-label label">Switch company</div>${MY_ORGS.map((o) => `<button class="menu-item" type="button" data-org="${o.id}"${o.id === DB.org.id ? ' aria-current="true" style="background:var(--canvas)"' : ""}>${icon("folder")} ${esc(o.name)}</button>`).join("")}` : ""}
          <hr style="border:0;border-top:1px solid var(--border);margin:6px 0">
          <a href="#/app/profile">${icon("user")} My profile</a>
          <a href="#/app/settings">${icon("users")} Team &amp; roles</a>
          <a href="#/site">${icon("phone")} Open site app</a>
          <button class="menu-item" type="button" data-signout>${icon("logout")} Sign out</button>
        </div></details>
      </header>
      <main class="content">${inner}</main>
    </div>
    <nav class="bottom-tabs" aria-label="Primary">${tabs.map(([h, l, ic, ex]) => `<a href="${h}"${isActive(route, h, ex) ? ' aria-current="page"' : ""}>${icon(ic, 20)}${l}</a>`).join("")}</nav>
  </div>`;
}

// ===================================================== control centre
function pageControlCentre(u) {
  if (!listProjects(u).length) return pageGettingStarted(u);
  const projects = listProjects(u), showMoney = can(u, "commercial.view"), so = awaitingSignOff(), comp = complianceExpiring(30);
  const swmsToReview = DB.swms.filter((s) => s.status === "submitted" || s.status === "in_review").length;
  const out = DB.claims.filter((c) => ["submitted", "assessed", "certified"].includes(c.status)), owed = (c) => (c.certified ?? c.claimed) - (c.paid ?? 0);
  const pastDue = out.filter((c) => D(c.dueDate) < startOfDay(new Date()));
  const pos = projects.map((p) => ({ p, c: projectCommercial(u, p.id) }));
  const tot = pos.reduce((a, { c }) => c ? { o: a.o + c.originalContract, ap: a.ap + c.approvedVariations, cm: a.cm + c.committed, ac: a.ac + c.actual, ex: a.ex + c.variationExposure } : a, { o: 0, ap: 0, cm: 0, ac: 0, ex: 0 });
  const tasks = myTasks(u);
  const rows = pos.map(({ p, c }) => {
    const pr = progressOf(p), nm = nextMilestoneOf(p), behind = pr.planned - pr.verified;
    return `<tr><td><a class="rowlink" href="#/app/projects/${p.id}">${esc(p.name)}</a><div class="muted small"><span class="mono" style="font-size:12px">${p.code}</span> · ${p.type}</div></td>
      <td><div class="bar" style="margin-top:6px"><span class="planned" style="width:${pr.planned}%"></span><span class="actual" style="width:${pr.verified}%"></span></div><div class="small ${behind > 0 ? "amber-text" : "green-text"}" style="margin-top:5px">${pr.verified}% verified · ${behind > 0 ? `${behind}% behind` : "on track"}</div></td>
      ${showMoney && c ? `<td class="num">${money(c.revisedContract, { compact: true })}</td><td class="num ${c.forecastFinalCost > c.revisedContract ? "red-text" : ""}">${money(c.forecastFinalCost, { compact: true })}</td><td class="num ${c.forecastMarginPct < 0 ? "red-text" : ""}">${pct(c.forecastMarginPct)}</td>` : ""}
      <td class="small">${esc(nm.name)} · ${dayMonth(nm.date)}</td></tr>`;
  }).join("");
  return `${pageHeader({ title: "Company overview", meta: `<span>${longToday()} · ${projects.length} active projects</span>`, actions: `<a class="btn" href="#/app/reports">Reports</a>${can(u, "project.manage") ? '<a class="btn btn-dark" href="#/app/projects/new">New project</a>' : ""}` })}
  <div class="metrics">
    ${metric("Workers on site now", onSiteNow().length, `${comp.filter((c) => c.days <= 14).length} compliance warnings`, "amber", "#/app/people")}
    ${metric("Open defects", openDefects(u).length, `${overdueDefects(u).length} overdue`, "amber", "#/app/reports")}
    ${metric("Awaiting sign-off", so.total, `${so.holdsBlocking.length} hold points blocking`, "red", "#/app/tasks")}
    ${metric("Safety actions", swmsToReview, `${swmsToReview} SWMS to review`, null, "#/app/tasks")}
    ${showMoney ? metric("Claims outstanding", money(sum(out, owed), { compact: true }), `${money(sum(pastDue, owed), { compact: true })} past due date`) : ""}
  </div>
  <div class="cc-grid">
    <div class="stack-lg" style="min-width:0">
      <section class="card"><div class="card-head"><h2>Portfolio</h2><div class="spacer"></div><span class="row small muted" style="gap:14px"><span class="row" style="gap:5px"><i class="key" style="background:#c9cfc8"></i> Planned</span><span class="row" style="gap:5px"><i class="key" style="background:var(--green)"></i> Verified on site</span></span></div>
        <div class="table-wrap"><table class="register"><thead><tr><th>Project</th><th style="min-width:170px">Progress</th>${showMoney ? '<th class="right">Contract</th><th class="right">Forecast cost</th><th class="right">Margin</th>' : ""}<th>Next milestone</th></tr></thead><tbody>${rows}</tbody></table></div>
        ${showMoney ? `<p class="small muted" style="padding:10px 20px 14px;border-top:1px solid var(--border)">Margin = contract incl. approved variations − forecast final cost, before overheads. Unapproved variations are shown separately as exposure.</p>` : ""}
      </section>
      <div class="two-col">
        ${showMoney ? `<section class="card"><div class="card-head"><h2>Commercial position</h2></div><div class="card-body"><dl class="kv"><dt>Original contracts</dt><dd>${money(tot.o, { compact: true })}</dd><dt>Approved variations</dt><dd>${money(tot.ap, { compact: true, sign: true })}</dd><dt>Committed costs</dt><dd>${money(tot.cm, { compact: true })}</dd><dt>Actual costs to date</dt><dd>${money(tot.ac, { compact: true })}</dd></dl><div class="row amber-text small" style="margin-top:12px;font-weight:600">${icon("alert", 14)} Variation exposure (unapproved)<span class="spacer"></span><span class="mono">${money(tot.ex, { compact: true })}</span></div></div></section>` : ""}
        <section class="card"><div class="card-head"><h2>Compliance expiring</h2><div class="spacer"></div><a class="link small" href="#/app/people">View all</a></div><div class="card-body stack" style="gap:10px">${comp.slice(0, 4).map((c) => `<a href="#/app/people" class="row" style="align-items:flex-start"><div style="min-width:0"><div style="font-weight:600;font-size:13.5px">${esc(c.who)} — ${esc(c.what)}</div><div class="muted small">${c.sub}</div></div><span class="spacer"></span><span class="badge ${c.days < 0 ? "badge-red" : "badge-amber"}">${c.days < 0 ? "Expired" : `${c.days} days`}</span></a>`).join("")}</div></section>
      </div>
    </div>
    <div class="stack-lg">
      <section class="card"><div class="card-head"><h2>My tasks</h2><div class="spacer"></div><span class="small muted">${tasks.length} open</span></div><div class="card-body">${taskList(tasks.slice(0, 4))}<a class="link small" href="#/app/tasks" style="display:inline-block;margin-top:12px">See all tasks →</a></div></section>
      <section class="card"><div class="card-head"><h2>Recent activity</h2></div><div class="card-body"><ul class="timeline">${DB.audit.slice(0, 6).map((a) => `<li><span class="dot ${/fail|reject/i.test(a.action) ? "red" : /released|approved|closed|verified/i.test(a.action) ? "green" : "blue"}"></span><div><b style="font-weight:600">${esc(a.action)}</b>${a.detail ? ` · ${esc(a.detail)}` : ""}<div class="muted small">${esc(projName(a.projectId))} · ${timeAgo(a.at)}</div></div></li>`).join("")}</ul></div></section>
    </div>
  </div>`;
}

// ===================================================== project overview
function pageProject(u, p) {
  const base = `#/app/projects/${p.id}`, showMoney = can(u, "commercial.view"), c = projectCommercial(u, p.id);
  const open = openDefects(u, p.id), od = overdueDefects(u, p.id), so = awaitingSignOff(p.id), here = onSiteNow(p.id);
  const tasks = DB.tasks.filter((t) => t.projectId === p.id);
  const ms = tasks.filter((t) => t.isMilestone && t.status !== "complete").sort((a, b) => a.forecastStart.localeCompare(b.forecastStart))[0];
  const ready = ms ? readiness(p.id, ms.id) : null;
  const claim = DB.claims.filter((x) => x.projectId === p.id && x.status === "draft").sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  const diary = DB.diary.find((x) => x.projectId === p.id);
  // "What needs my attention today" — assembled from every module.
  const attn = [];
  for (const { itp, point } of so.points.filter((x) => x.point.type === "hold")) {
    const t = tasks.find((t) => t.id === itp.taskId);
    attn.push(["red", "lock", `<b>${itp.ref} ${esc(point.name.toLowerCase())} hold point</b> not released${t ? ` — ${esc(t.name.toLowerCase())} is ${shortDate(t.forecastStart)}` : ""}`, "Review", `${base}/quality/itp/${itp.id}`]);
  }
  for (const v of listVariations(u, p.id).filter((v) => v.status === "under_review" || v.status === "submitted")) attn.push(["amber", "alert", `<b>${v.ref} ${esc(v.title)}</b> · ${money(v.amount)} awaiting approval`, "Approve", `${base}/commercial`]);
  const byTrade = {};
  for (const d of od) (byTrade[d.trade] ||= []).push(d);
  for (const [trade, list] of Object.entries(byTrade)) attn.push(["amber", "alert", `<b>${list.length} ${esc(trade.toLowerCase())} defect${list.length > 1 ? "s" : ""}</b> overdue`, "Open", `${base}/quality?status=overdue&trade=${encodeURIComponent(trade)}`]);
  for (const s of DB.swms.filter((s) => s.projectId === p.id && s.status === "approved")) {
    const missing = DB.workers.filter((w) => w.contractorId === s.contractorId && w.inductedProjectIds.includes(p.id) && !s.acknowledgedBy.includes(w.id)).length;
    if (missing) attn.push(["blue", "clock", `<b>SWMS · ${esc(s.title)} v${s.version}</b> needs worker acknowledgement (${missing})`, "Chase", `${base}/safety/swms/${s.id}`]);
  }
  for (const d of DB.documents.filter((x) => x.projectId === p.id && x.status === "in_review")) attn.push(["blue", "file", `<b>${d.number} rev ${d.revision}</b> uploaded — review before it becomes current`, "Review", `${base}/documents`]);
  const cnt = (s) => ready?.items.filter((i) => i.state === s).length ?? 0;
  const tone = { red: "var(--red)", amber: "var(--amber)", blue: "var(--blue)" };
  return `<section class="card card-pad"><div class="page-header"><div>
      <div class="row wrap" style="gap:10px"><h1>${esc(p.name)}</h1><span class="badge badge-green"><span style="width:7px;height:7px;border-radius:4px;background:var(--green)"></span>${cap(p.status === "dlp" ? "defect liability" : p.status)}</span></div>
      <div class="page-meta"><span>${esc(p.address)}</span><span>Client: <b>${esc(p.client)}</b></span><span>PM: <b>${esc(userById(p.pmId)?.name)}</b></span>${showMoney ? `<span>Contract: <b>${money(c.revisedContract, { compact: true })}</b></span>` : ""}<span>PC: <b>${D(p.pcDate).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}</b></span></div>
    </div><div class="row wrap"><a class="btn" href="${base}/reports">Weekly report</a><a class="btn btn-dark" href="${base}/diary">Today's site diary</a></div></div></section>
  <div class="metrics">
    ${metric("Programme", `${progressOf(p).verified}%`, `${progressOf(p).planned}% planned`, progressOf(p).planned > progressOf(p).verified ? "amber" : null, `${base}/programme`)}
    ${metric("Open defects", open.length, `${od.length} overdue`, od.length ? "amber" : null, `${base}/quality`)}
    ${metric("Awaiting sign-off", so.total, `${so.holdsBlocking.length} hold point${so.holdsBlocking.length === 1 ? "" : "s"}`, so.holdsBlocking.length ? "red" : null, `${base}/quality`)}
    ${metric("On site now", here.length, `${companiesOnSite(p.id)} companies`, null, `${base}/workforce`)}
    ${showMoney ? metric("Budget variance", money(c.budget - c.forecastFinalCost, { compact: true, sign: true }), "Budget − forecast final cost", null, `${base}/commercial`) + metric("Next claim", claim?.ref ?? "—", claim ? `Due ${dayMonth(claim.dueDate)}` : "None drafted", null, `${base}/commercial`) : ""}
  </div>
  <div class="po-grid">
    <section class="card"><div class="card-head"><h2>Needs your attention today</h2><div class="spacer"></div><span class="small muted">${attn.length} items</span></div><div class="card-body stack" style="gap:8px">
      ${attn.map(([t, ic, body, cta, href]) => `<a href="${href}" class="attn"${t === "red" ? ' data-tone="red"' : ""}><span class="attn-icon" style="color:${tone[t]}">${icon(ic)}</span><span>${body}</span><span class="attn-cta">${cta}</span></a>`).join("") || '<p class="muted">Nothing needs you right now.</p>'}
    </div></section>
    ${ready ? `<section class="card"><div class="card-head"><h2>Readiness · ${esc(ready.task.name)}</h2><div class="spacer"></div><span class="small muted">${shortDate(ready.task.forecastStart)}</span></div><div class="card-body">
      <div class="seg"><span style="flex:${cnt("ready")};background:var(--green)"></span><span style="flex:${cnt("action")};background:var(--amber)"></span><span style="flex:${cnt("blocking")};background:var(--red)"></span></div>
      <p class="small muted" style="margin:8px 0 4px">${cnt("ready")} of ${ready.items.length} ready · ${cnt("action")} need${cnt("action") === 1 ? "s" : ""} action · ${cnt("blocking")} blocking</p>
      ${ready.items.map((it) => `<a href="${it.href}" class="ready-row"><span>${esc(it.label)}</span><span class="state ${it.state === "ready" ? "green-text" : it.state === "blocking" ? "red-text" : "amber-text"}">${icon(it.state === "ready" ? "check" : it.state === "blocking" ? "lock" : "alert", 13)}${esc(it.detail)}</span></a>`).join("")}
      <p class="small muted" style="margin-top:10px">Readiness shows the facts. Authorising the pour stays with the responsible person.</p>
    </div></section>` : ""}
  </div>
  <div class="po-grid">
    <section class="card"><div class="card-head"><h2>Two-week lookahead</h2><div class="spacer"></div><a class="link small" href="${base}/programme">Open programme →</a></div><div class="card-body">${gantt(tasks.filter((t) => t.status !== "complete"))}${ganttKey()}</div></section>
    <section class="card"><div class="card-head"><h2>Latest site diary</h2><div class="spacer"></div>${diary ? `<span class="small muted">${shortDate(diary.date)}</span>` : ""}</div><div class="card-body">
      ${diary ? `<div class="row wrap small muted" style="gap:16px;margin-bottom:8px"><span>${esc(diary.weather)}</span><span>${diary.workersOnSite} workers</span><span>${diary.companiesOnSite} companies</span>${badge("submitted")}</div><p>${esc(diary.notes)}${diary.delays ? ` Delay: ${esc(diary.delays)}` : ""}</p><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:14px"><div class="photo-ph"></div><div class="photo-ph"></div><div class="photo-ph" style="background:#dfe5e1;color:var(--muted)">+9 photos</div></div>`
        : `<p class="muted">No diary yet. <a class="link" href="${base}/diary">Start today's entry</a></p>`}
    </div></section>
  </div>`;
}

// ===================================================== quality
function filterDefects(u, pid, f) {
  return listDefects(u, pid).filter((d) => {
    const l = locationOf(d.locationId);
    if (f.level && l?.level !== f.level) return false;
    if (f.trade && d.trade !== f.trade) return false;
    if (f.contractor && d.contractorId !== f.contractor) return false;
    if (f.status === "overdue") { if (!isOverdue(d)) return false; }
    else if (f.status === "open") { if (d.status === "closed" || d.status === "draft") return false; }
    else if (f.status && d.status !== f.status) return false;
    if (f.q && !`${d.ref} ${d.title}`.toLowerCase().includes(f.q.toLowerCase())) return false;
    return true;
  });
}
function pageQuality(u, p, f) {
  const base = `#/app/projects/${p.id}`, rows = filterDefects(u, p.id, f), all = listDefects(u, p.id), so = awaitingSignOff(p.id);
  const itps = DB.itps.filter((i) => i.projectId === p.id), pts = itps.flatMap((i) => i.points), rel = pts.filter((x) => x.status === "released").length;
  const levels = uniq(all.map((d) => locationOf(d.locationId)?.level).filter(Boolean)).sort();
  const trades = uniq(all.map((d) => d.trade)).sort();
  const cons = uniq(all.map((d) => d.contractorId).filter(Boolean)).map(contractorOf);
  const qs = (patch) => { const s = new URLSearchParams(Object.entries({ ...f, ...patch }).filter(([, v]) => v)).toString(); return `${base}/quality${s ? `?${s}` : ""}`; };
  const chipLabel = (k, v) => k === "contractor" ? contractorOf(v)?.tradingName : k === "level" ? `Level ${v.replace("L", "")}` : k === "trade" ? `Trade: ${v}` : k === "status" ? `Status: ${words(v)}` : `“${v}”`;
  const sel = (name, label, opts) => `<label><span class="sr-only">${label}</span><select name="${name}" class="input" style="height:34px;width:auto;padding-right:28px"><option value="">${label}: any</option>${opts.map(([v, l]) => `<option value="${esc(v)}"${f[name] === v ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
  const table = rows.length ? `<div class="table-wrap"><table class="register"><thead><tr><th>ID</th><th>Title</th><th>Location</th><th>Contractor</th><th>Due</th><th>Status</th></tr></thead><tbody>${rows.map((d) => { const late = isOverdue(d), h = `${base}/quality/defects/${d.id}`; return `<tr><td><a class="mono link" href="${h}">${d.ref}</a></td><td><a class="rowlink" href="${h}">${esc(d.title)}</a><div class="muted small">${esc(d.trade)} · ${d.priority} priority</div></td><td class="small">${esc(locationLabel(d))}</td><td class="small">${contractorOf(d.contractorId) ? esc(contractorOf(d.contractorId).tradingName) : '<span class="muted">Unassigned</span>'}</td><td class="small ${late ? "amber-text" : ""}" style="font-weight:${late ? 700 : 400};white-space:nowrap">${dueLabel(d.dueDate)}</td><td>${badge(late ? "overdue" : d.status)}</td></tr>`; }).join("")}</tbody></table></div>`
    : emptyState("clipboard", "No defects match", "Try removing a filter, or raise a new defect from site in a few seconds.", `<a class="btn" href="${base}/quality">Clear filters</a>`);
  return `${pageHeader({ crumbs: crumbsFor(p), title: "Quality &amp; inspections", actions: `<button class="btn" type="button" data-export="${p.id}">${icon("download", 15)} Export register</button>${can(u, "defect.create") ? `<a class="btn btn-dark" href="${base}/quality/new">New defect</a>` : ""}` })}
  <div class="metrics">
    ${metric("Open defects", openDefects(u, p.id).length, null, null, `${base}/quality?status=open`)}
    ${metric("Overdue defects", overdueDefects(u, p.id).length, "Past due date", "amber", `${base}/quality?status=overdue`)}
    ${metric("Awaiting approval", so.total, "Inspections & verifications", null, `${base}/quality?status=ready_for_verification`)}
    ${metric("ITP completion", `${pts.length ? Math.round((rel / pts.length) * 100) : 0}%`, `${rel} of ${pts.length} points released`)}
    ${metric("Hold points blocking", so.holdsBlocking.length, "Work must not proceed", so.holdsBlocking.length ? "red" : null)}
  </div>
  <section class="card">
    <div class="card-head" style="flex-wrap:wrap"><h2>Defect register</h2><span class="muted small">${rows.length} shown</span><div class="spacer"></div><div class="row wrap" style="gap:6px">${Object.entries(f).filter(([, v]) => v).map(([k, v]) => `<a class="chip" href="${qs({ [k]: "" })}">${esc(chipLabel(k, v))} ${icon("x", 13)}</a>`).join("")}</div></div>
    <form class="row wrap" data-filter="${base}/quality" style="padding:0 20px 14px;gap:8px">
      <input name="q" value="${esc(f.q)}" class="input" placeholder="Search ID or title" aria-label="Search" style="width:200px;height:34px">
      ${sel("level", "Level", levels.map((l) => [l, l]))}${sel("trade", "Trade", trades.map((t) => [t, t]))}${sel("contractor", "Contractor", cons.map((c) => [c.id, c.tradingName]))}${sel("status", "Status", [["open", "All open"], ["overdue", "Overdue"], ["draft", "Draft"], ["assigned", "Assigned"], ["rectifying", "Rectifying"], ["ready_for_verification", "In review"], ["closed", "Closed"]])}
      <button class="btn" type="submit" style="height:34px">+ Filter</button>
    </form>${table}
  </section>
  <section class="card card-pad"><div class="row wrap" style="margin-bottom:10px"><h2>Locations</h2><span class="spacer"></span><span class="small muted">${DB.locations.filter((l) => l.projectId === p.id).length} on this project</span></div>
    <div class="row wrap" style="gap:6px;margin-bottom:12px">${DB.locations.filter((l) => l.projectId === p.id).map((l) => `<span class="tag">${esc([l.building, l.level, l.zone].filter(Boolean).join(" › "))}</span>`).join("")}</div>
    ${can(u, "defect.assign") ? form("createLocation", `${hidden("project", p.id)}<div class="row wrap" style="gap:8px"><input name="building" class="input" placeholder="Building (e.g. B)" style="width:150px;height:34px"><input name="level" class="input" placeholder="Level (e.g. L3)" style="width:150px;height:34px"><input name="zone" class="input" placeholder="Zone / unit (e.g. Units 301–308)" style="width:230px;height:34px"><button class="btn" style="height:34px">Add location</button></div>`) : ""}
  </section>
  <section class="card" id="inspections"><div class="card-head"><h2>Inspection &amp; test plans</h2><div class="spacer"></div><a class="link small" href="#/app/templates">Company templates →</a></div>
    ${can(u, "itp.manage") ? (DB.itpTemplates.length ? `<div style="padding:0 20px 16px">${form("applyTemplate", `${hidden("project", p.id)}<div class="row wrap" style="gap:8px;align-items:flex-end">
      <label class="field"><span>Template</span><select name="template" class="input" style="height:36px">${DB.itpTemplates.map((t) => `<option value="${t.id}">${esc(t.name)} · v${t.version} · ${t.points.length} points</option>`).join("")}</select></label>
      <label class="field"><span>For programme task <span class="muted">(optional)</span></span><select name="task" class="input" style="height:36px"><option value="">—</option>${DB.tasks.filter((t) => t.projectId === p.id && t.status !== "complete").map((t) => `<option value="${t.id}">${esc(t.name)} · ${dayMonth(t.forecastStart)}</option>`).join("")}</select></label>
      <label class="field"><span>Title <span class="muted">(optional)</span></span><input name="title" class="input" placeholder="e.g. L4 slab — concrete" style="height:36px"></label>
      <button class="btn btn-primary" style="height:36px">Add ITP</button></div>`)}</div>` : `<p class="small muted" style="padding:0 20px 16px">No templates yet — <a class="link" href="#/app/templates">create one or load the starter set</a>, then add it here.</p>`) : ""}
    ${itps.length ? "" : '<p class="muted small" style="padding:0 20px 18px">No inspection plans on this project yet.</p>'}<div class="table-wrap"${itps.length ? "" : ' hidden'}><table class="register"><thead><tr><th>Ref</th><th>Title</th><th>Points</th><th>Hold points</th><th>Status</th></tr></thead><tbody>${itps.map((i) => {
      const holds = i.points.filter((x) => x.type === "hold"), openH = holds.filter((x) => x.status !== "released"), h = `${base}/quality/itp/${i.id}`;
      const st = i.points.some((x) => x.status === "rejected") ? "rejected" : i.points.some((x) => x.status === "submitted") ? "in_review" : i.points.some((x) => x.status === "pending") ? "open" : "complete";
      return `<tr><td><a class="mono link" href="${h}">${i.ref}</a></td><td><a class="rowlink" href="${h}">${esc(i.title)}</a><div class="muted small">Template v${i.templateVersion}</div></td><td class="small">${i.points.filter((x) => x.status === "released").length} / ${i.points.length} released</td><td>${!holds.length ? '<span class="muted small">—</span>' : openH.length ? badge("hold", `${openH.length} hold`) : badge("released")}</td><td>${badge(st)}</td></tr>`;
    }).join("")}</tbody></table></div>
  </section>`;
}

function defectFormHtml(u, p, mobile = false) {
  const locs = DB.locations.filter((l) => l.projectId === p.id);
  const cons = DB.contractors;
  const big = mobile ? ' style="height:48px;font-size:16px"' : "";
  const assign = can(u, "defect.assign");
  return form("createDefect", `${hidden("projectId", p.id)}<div class="stack" style="gap:14px">
    <div class="row" style="justify-content:space-between"><span class="label">Photos first</span><span data-online-pill>${navigator.onLine ? `<span class="badge badge-green">${icon("check", 12)}Online</span>` : badge("offline")}</span></div>
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:8px">
      <div class="photo-ph" data-preview="0" style="min-height:${mobile ? 170 : 150}px">Take or add a photo</div>
      <div style="display:grid;gap:8px"><div class="photo-ph" data-preview="1" style="min-height:0;background:#dfe5e1"></div>
        <label class="photo-ph" style="min-height:0;background:#fff;border:1.5px dashed #a9b1aa;color:var(--muted);cursor:pointer">${icon("plus", 22)}<span class="sr-only">Add photos</span><input type="file" name="photos" accept="image/*" capture="environment" multiple hidden data-photo-input></label></div>
    </div>
    <span class="small muted" data-photo-count></span>
    <label class="field"><span>What's wrong? <span class="req">*</span></span><input name="title" class="input" placeholder="e.g. Membrane lap short at shower hob"${big}></label>
    <div class="field"><span>Location <span class="req">*</span></span>
      <div class="row"><select name="locationId" class="input" aria-label="Location"${big}><option value="">Building › Level › Zone</option>${locs.map((l) => `<option value="${l.id}">${esc(`${l.building} › ${l.level} › ${l.zone}`)}</option>`).join("")}</select><button type="button" class="icon-btn" style="width:48px;height:${mobile ? 48 : 40}px;flex:none" title="Scan room QR code" data-qr>${icon("qr", 18)}</button></div>
      <input name="room" class="input" placeholder="Room / unit (optional)"${big}></div>
    <label class="field"><span>Trade</span><select name="trade" class="input"${big}><option value="">General</option>${uniq(DB.contractors.map((c) => c.trade)).map((t) => `<option>${esc(t)}</option>`).join("")}</select></label>
    ${assign ? `<fieldset class="field" style="border:0;padding:0;margin:0"><legend style="font-size:13px;font-weight:600;margin-bottom:6px">Responsible contractor</legend><div class="row wrap" style="gap:6px">${cons.map((c) => `<label class="chip chip-radio" style="height:${mobile ? 44 : 32}px;cursor:pointer"><input type="radio" name="contractorId" value="${c.id}" class="sr-only">${esc(mobile ? c.tradingName.split(" ")[0] : c.tradingName)}</label>`).join("")}</div></fieldset>` : ""}
    <div class="form-grid" style="grid-template-columns:1fr 1fr"><label class="field"><span>Priority</span><select name="priority" class="input"${big}><option value="low">Low</option><option value="medium">Medium</option><option value="high" selected>High</option><option value="critical">Critical</option></select></label><label class="field"><span>Due</span><input type="date" name="dueDate" class="input" min="${todayYmd()}"${big}></label></div>
    ${assign ? '<p class="small muted" style="margin-top:-6px">Pick a contractor and due date to assign it now; otherwise it\'s raised as Open.</p>' : ""}
    <div class="row" style="gap:10px"><button type="submit" name="mode" value="draft" class="btn ${mobile ? "btn-lg" : ""}" style="flex:${mobile ? 1 : "none"}">Save draft</button><button type="submit" name="mode" value="submit" class="btn btn-primary ${mobile ? "btn-lg" : ""}" style="flex:${mobile ? 1.4 : "none"}">${assign ? "Raise &amp; assign" : "Raise defect"}</button></div>
  </div>`, `data-done="${mobile ? "#/site" : `#/app/projects/${p.id}/quality`}"`);
}
function pageNewDefect(u, p) {
  assertCan(u, "defect.create");
  return `${pageHeader({ crumbs: [[`#/app/projects/${p.id}`, p.name], [`#/app/projects/${p.id}/quality`, "Quality"]], title: "New defect" })}<section class="card card-pad" style="max-width:680px">${defectFormHtml(u, p)}</section>`;
}

function pageDefect(u, p, id) {
  const d = getDefect(u, id);
  if (!d || d.projectId !== p.id) return notFound();
  const base = `#/app/projects/${p.id}`, late = isOverdue(d), isSub = u.role === "subcontractor_admin" && u.contractorId === d.contractorId, site = u.role === "site_supervisor" || u.role === "project_manager";
  const kv = (k, v) => `<dt class="muted">${k}</dt><dd style="text-align:left;font-family:inherit">${v}</dd>`;
  const task = DB.tasks.find((t) => t.id === d.taskId), itp = DB.itps.find((i) => i.id === d.itpId);
  const panels = [];
  const H = hidden("defectId", d.id);
  if (d.status === "draft" && can(u, "defect.create")) panels.push(`<section class="card card-pad"><h2 style="margin-bottom:6px">Draft</h2><p class="muted small" style="margin-bottom:12px">Drafts aren't in the open register yet. Submit it when the details are right.</p>${form("defect", H + hidden("type", "submit") + '<button class="btn btn-primary">Submit defect</button>')}</section>`);
  if ((d.status === "open" || d.status === "assigned") && can(u, "defect.assign")) panels.push(`<section class="card card-pad"><h2 style="margin-bottom:12px">${d.status === "open" ? "Assign" : "Reassign"}</h2>${form("defect", `${H}${hidden("type", "assign")}<div class="stack"><label class="field"><span>Responsible contractor <span class="req">*</span></span><select name="contractorId" class="input"><option value="">Select…</option>${DB.contractors.map((c) => `<option value="${c.id}"${c.id === d.contractorId ? " selected" : ""}>${esc(c.tradingName)}</option>`).join("")}</select></label><label class="field"><span>Due date <span class="req">*</span></span><input type="date" name="dueDate" class="input" value="${d.dueDate ?? ""}" min="${todayYmd()}"></label><button class="btn btn-primary">Assign</button></div>`)}</section>`);
  if (d.status === "assigned" && (isSub || site)) panels.push(`<section class="card card-pad"><h2 style="margin-bottom:6px">Start rectification</h2><p class="muted small" style="margin-bottom:12px">Let the site team know the crew is on it.</p>${form("defect", H + hidden("type", "start_rectification") + '<button class="btn">Mark as rectifying</button>')}</section>`);
  if ((d.status === "rectifying" || d.status === "assigned") && (isSub || site)) panels.push(`<section class="card card-pad"><h2 style="margin-bottom:12px">Submit for verification</h2>${form("defect", `${H}${hidden("type", "submit_for_verification")}<div class="stack"><label class="field"><span>What was done <span class="req">*</span></span><textarea name="note" class="input" placeholder="e.g. Membrane relapped 150mm up hob, cured 24h"></textarea></label><label class="field"><span>Completion photos <span class="req">*</span></span><input type="file" name="evidence" accept="image/*" multiple class="input" style="padding-top:7px"></label><button class="btn btn-dark">Submit for review</button></div>`)}</section>`);
  if (d.status === "ready_for_verification" && can(u, "defect.verify")) panels.push(`<section class="card card-pad"><h2 style="margin-bottom:6px">Verify repair</h2><p class="muted small" style="margin-bottom:12px">Closing needs your sign-off on the evidence. Rejecting sends it back to rectification.</p>
    ${form("defect", H + hidden("type", "verify") + '<button class="btn btn-primary">Verify &amp; close</button>', `data-confirm="Verify and close ${d.ref}? This is recorded against your name."`)}
    <div style="margin-top:14px">${form("defect", `${H}${hidden("type", "reject")}<div class="stack"><label class="field"><span>Reason for rejecting</span><textarea name="reason" class="input" placeholder="What still needs fixing?"></textarea></label><button class="btn btn-danger">Request changes</button></div>`)}</div></section>`);
  if (d.status === "closed") panels.push(`<section class="card card-pad"><h2 style="margin-bottom:6px">Closed</h2><p class="muted small">Verified by ${esc(userById(d.verifiedBy)?.name ?? "reviewer")}. The record stays in the register for audit and the defect liability period.</p></section>`);
  if (!panels.length) panels.push(`<section class="card card-pad"><p class="muted small">Nothing for you to do here as ${ROLE_LABEL[u.role].toLowerCase()}.</p></section>`);
  return `${pageHeader({ crumbs: [[base, p.name], [`${base}/quality`, "Quality"]], title: `<span class="mono" style="font-size:20px;color:var(--muted);margin-right:10px">${d.ref}</span>${esc(d.title)}`, meta: `<span class="row" style="gap:8px">${late ? badge("overdue") : ""}${badge(d.status)}</span>` })}
  <section class="card card-pad">${stepper(DEFECT_STEPS, d.status === "draft" ? "open" : d.status)}</section>
  <div class="cc-grid">
    <div class="stack-lg" style="min-width:0">
      <section class="card"><div class="card-head"><h2>Details</h2></div><div class="card-body">
        <dl class="kv" style="grid-template-columns:180px 1fr">${kv("Location", esc(locationLabel(d)))}${kv("Trade", esc(d.trade))}${kv("Responsible contractor", esc(contractorOf(d.contractorId)?.tradingName ?? "Unassigned"))}${kv("Priority", cap(d.priority))}${kv("Due", `<span class="${late ? "amber-text" : ""}">${dueLabel(d.dueDate)}</span>`)}${kv("Raised", `${esc(userById(d.raisedBy)?.name)} · ${dateTime(d.raisedAt)}`)}${task ? kv("Programme task", `<a class="link" href="${base}/programme">${esc(task.name)}</a>`) : ""}${itp ? kv("ITP", `<a class="link" href="${base}/quality/itp/${itp.id}">${itp.ref}</a>`) : ""}</dl>
        <h3 style="margin:18px 0 8px">Photos</h3>${d.photos.length ? `<div class="photo-grid">${d.photos.map((s) => photoTile(s, "min-height:96px")).join("")}</div>` : '<p class="muted small">No photos attached.</p>'}
        ${d.rectificationNote ? `<h3 style="margin:18px 0 8px">Rectification</h3><p>${esc(d.rectificationNote)}</p><div class="photo-grid" style="margin-top:8px">${d.evidencePhotos.map((s) => photoTile(s, "min-height:96px;background-color:#a9c3b6")).join("")}</div>` : ""}
      </div></section>
      <section class="card"><div class="card-head"><h2>History</h2></div><div class="card-body"><ul class="timeline">
        ${auditFor(d.id).filter((a) => a.action !== "Defect raised").map((a) => `<li><span class="dot ${/closed|verified/i.test(a.action) ? "green" : /reject/i.test(a.action) ? "red" : "blue"}"></span><div><b style="font-weight:600">${esc(a.action)}</b> by ${esc(userById(a.actorId)?.name)}${a.detail ? ` · ${esc(a.detail)}` : ""} · <span class="muted">${dateTime(a.at)}</span>${a.from && a.to && a.from !== a.to ? `<div class="muted small">${words(a.from)} → ${words(a.to)}</div>` : ""}</div></li>`).join("")}
        <li><span class="dot"></span><div><b style="font-weight:600">Defect raised</b> by ${esc(userById(d.raisedBy)?.name)} · <span class="muted">${dateTime(d.raisedAt)}</span></div></li>
      </ul></div></section>
    </div>
    <aside class="stack-lg">${panels.join("")}</aside>
  </div>`;
}

function pointCard(u, itp, pt, n) {
  const blocker = holdBlocking(itp, pt), signs = currentSignoffs(pt), approvals = signs.filter((x) => x.decision === "approve");
  const mine = pt.submittedBy === u.id && (pt.type === "hold" || pt.type === "witness"), signed = signs.some((x) => x.userId === u.id);
  const reqs = [pt.evidenceRequired ? `${pt.evidenceRequired} photo${pt.evidenceRequired > 1 ? "s" : ""}` : "", pt.measurementLabel ? esc(pt.measurementLabel) : "", pt.requiredSignoffs > 1 ? "2 sign-offs" : ""].filter(Boolean);
  const lastReject = [...pt.signoffs].reverse().find((x) => x.decision === "reject");
  let action = "";
  if ((pt.status === "pending" || pt.status === "rejected") && can(u, "itp.submit")) {
    action = blocker ? `<div class="notice notice-info no-print">${icon("lock")}<span>Waiting on hold point <b>${esc(blocker.name)}</b> to be released.</span></div>`
      : form("submitPoint", `${hidden("point", pt.id)}<div class="stack" style="gap:8px">
        <label class="field"><span>Photos${pt.evidenceRequired ? ` <span class="req">*</span> <span class="muted">(at least ${pt.evidenceRequired})</span>` : ' <span class="muted">(optional)</span>'}</span><input type="file" name="photos" accept="image/*" capture="environment" multiple class="input" style="padding-top:7px"></label>
        ${pt.measurementLabel ? `<label class="field"><span>${esc(pt.measurementLabel)} <span class="req">*</span></span><input name="measurement" class="input" inputmode="decimal" style="max-width:200px"></label>` : ""}
        <label class="field"><span>Note</span><input name="note" class="input" placeholder="What was checked"></label>
        <div><button class="btn btn-primary">${pt.status === "rejected" ? "Resubmit" : "Submit for sign-off"}</button></div></div>`, 'class="no-print"');
  } else if (pt.status === "submitted" && canSignOff(u, pt)) {
    action = mine ? `<p class="small muted no-print">You submitted this — another authorised person must sign it off.</p>`
      : signed ? `<p class="small muted no-print">You've signed this off. Waiting for a second person.</p>`
      : form("hold", `${hidden("pointId", pt.id)}<div class="row wrap" style="gap:8px"><input name="comment" class="input" placeholder="Comment (required to reject)" style="height:36px;max-width:320px"><button class="btn btn-primary" name="decision" value="release">${pt.type === "hold" ? "Release hold point" : "Accept"}</button><button class="btn btn-danger" name="decision" value="reject">Reject</button></div>`,
        `class="no-print" data-confirm="${pt.type === "hold" ? "Release this hold point" : "Accept this point"}? Your name and the time are recorded." data-confirm-for="release"`);
  } else if (pt.status === "submitted") action = '<p class="small muted no-print">Awaiting an authorised reviewer.</p>';
  return `<section class="card point-card" data-status="${pt.status}"><div class="card-pad stack" style="gap:10px">
    <div class="row wrap" style="gap:10px;align-items:flex-start"><span class="pt-num">${n}</span><div style="flex:1;min-width:200px"><h3>${esc(pt.name)}</h3><p class="small muted">${esc(pt.check ?? "")}</p></div>
      ${pt.type === "hold" ? badge("hold", "Hold point") : `<span class="tag">${POINT_TYPES[pt.type]}</span>`}${badge(pt.status)}</div>
    ${reqs.length ? `<div class="small muted">Needs: ${reqs.join(" · ")}</div>` : ""}
    ${pt.status !== "pending" && (pt.submittedAt || pt.evidence) ? `<div class="small">${pt.submittedAt ? `Submitted by <b>${esc(userById(pt.submittedBy)?.name ?? "—")}</b> · ${dateTime(pt.submittedAt)}` : `${pt.evidence} photo${pt.evidence === 1 ? "" : "s"} on record`}${pt.measurementValue ? ` · ${esc(pt.measurementLabel ?? "Measured")}: <b>${esc(pt.measurementValue)}</b>` : ""}${pt.submitNote ? `<div class="muted">${esc(pt.submitNote)}</div>` : ""}</div>` : ""}
    ${pt.photos.length ? `<div class="photo-grid">${pt.photos.map((ph) => photoTile(ph, "min-height:90px")).join("")}</div>` : ""}
    ${pt.status === "rejected" && lastReject ? `<div class="notice notice-error">${icon("xcircle")}<span>Rejected by ${esc(userById(lastReject.userId)?.name ?? "—")}: ${esc(lastReject.comment ?? "")}</span></div>` : ""}
    ${pt.status === "submitted" && pt.requiredSignoffs > 1 ? `<div class="small"><b>${approvals.length} of ${pt.requiredSignoffs}</b> sign-offs${approvals.length ? ` — ${approvals.map((x) => esc(userById(x.userId)?.name ?? "—")).join(", ")}` : ""}</div>` : ""}
    ${pt.status === "released" ? `<div class="small green-text">${icon("check", 13)} Released by ${esc(userById(pt.releasedBy)?.name ?? "—")}${pt.releasedAt ? ` · ${dateTime(pt.releasedAt)}` : ""}${pt.requiredSignoffs > 1 ? ` (${approvals.map((x) => esc(userById(x.userId)?.name ?? "—")).join(" + ")})` : ""}</div>` : ""}
    ${action}
  </div></section>`;
}

function pageItp(u, p, id) {
  const itp = DB.itps.find((i) => i.id === id && i.projectId === p.id);
  if (!itp) return notFound();
  const base = `#/app/projects/${p.id}`, task = DB.tasks.find((t) => t.id === itp.taskId), tpl = DB.itpTemplates.find((t) => t.id === itp.templateId);
  const done = itp.points.filter((x) => x.status === "released").length, total = itp.points.length;
  const openHolds = itp.points.filter((x) => x.type === "hold" && x.status !== "released");
  const due = task ? daysBetween(new Date(), D(task.forecastStart)) : null;
  return `${pageHeader({ crumbs: [[base, p.name], [`${base}/quality`, "Quality"]], title: `<span class="mono" style="font-size:20px;color:var(--muted);margin-right:10px">${itp.ref}</span>${esc(itp.title)}`,
    meta: `<span>${tpl ? `From template <b>${esc(tpl.name)}</b> v${itp.templateVersion}${tpl.version > itp.templateVersion ? ` <span class="muted">(template is now v${tpl.version}; this ITP keeps its version)</span>` : ""}` : `Template v${itp.templateVersion}`}</span>${task ? `<span>Task: <a class="link" href="${base}/programme/${task.id}">${esc(task.name)}</a> · ${dayMonth(task.forecastStart)}</span>` : ""}<span><b>${done} of ${total}</b> points released</span>`,
    actions: `<button class="btn no-print" type="button" onclick="window.print()">${icon("download", 15)} Print / save PDF</button>` })}
  <div class="bar" style="height:8px"><span class="actual" style="width:${total ? (done / total) * 100 : 0}%"></span></div>
  ${openHolds.length ? `<div class="notice ${due !== null && due <= 2 ? "notice-error" : "notice-warn"}">${icon("lock")}<span><b>${openHolds.length} hold point${openHolds.length > 1 ? "s" : ""} open.</b> Work covered by a hold point must not proceed until a designated person releases it${task ? ` — ${esc(task.name)} ${due < 0 ? "has started" : due === 0 ? "starts today" : `starts in ${due} day${due > 1 ? "s" : ""}`}` : ""}. BuildOS records who released it; it doesn't replace contractual requirements.</span></div>` : done === total && total ? `<div class="notice notice-ok">${icon("checkcircle")}<span>All points released. Quality acceptance is recorded — it doesn't by itself mark the work complete or approve payment.</span></div>` : ""}
  <div class="stack">${itp.points.map((pt, n) => pointCard(u, itp, pt, n + 1)).join("")}</div>
  <section class="card print-only"><div class="card-pad small">Printed ${dateTime(new Date().toISOString())} by ${esc(u.name)} · ${esc(DB.org.name)} · ${esc(p.name)} (${esc(p.code)})</div></section>`;
}

// ===================================================== ITP templates
const templatePointRow = (pt = {}) => `<div class="pt-row">
  <input name="pt_name" class="input" placeholder="Point, e.g. Reinforcement" value="${esc(pt.name ?? "")}" aria-label="Point name">
  <select name="pt_type" class="input" aria-label="Type">${Object.entries(POINT_TYPES).map(([k, l]) => `<option value="${k}"${(pt.type ?? "inspection") === k ? " selected" : ""}>${l}</option>`).join("")}</select>
  <input name="pt_check" class="input pt-wide" placeholder="Acceptance criteria, e.g. Bar size, spacing and cover to S-201" value="${esc(pt.checkText ?? pt.check_text ?? "")}" aria-label="Acceptance criteria">
  <label class="pt-small"><span class="small muted">Min photos</span><input name="pt_photos" type="number" min="0" max="10" class="input" value="${pt.evidenceRequired ?? pt.evidence_required ?? 0}"></label>
  <label class="pt-small"><span class="small muted">Measurement</span><input name="pt_measure" class="input" placeholder="e.g. Cover (mm)" value="${esc(pt.measurementLabel ?? pt.measurement_label ?? "")}"></label>
  <label class="pt-small"><span class="small muted">Sign-offs</span><select name="pt_signoffs" class="input"><option value="1">1 person</option><option value="2"${(pt.requiredSignoffs ?? pt.required_signoffs) === 2 ? " selected" : ""}>2 people</option></select></label>
  <button type="button" class="icon-btn" data-remove-point title="Remove point" aria-label="Remove point">${icon("x", 15)}</button>
</div>`;

function templateForm(act, t = null) {
  return form(act, `${t ? hidden("template", t.id) : ""}<div class="form-grid">
    <label class="field"><span>Template name <span class="req">*</span></span><input name="name" class="input" value="${esc(t?.name ?? "")}" placeholder="e.g. Concrete slab"></label>
    <label class="field"><span>Trade</span><input name="trade" class="input" value="${esc(t?.trade ?? "")}" placeholder="e.g. Concrete"></label>
    <label class="field full"><span>Description</span><input name="description" class="input" value="${esc(t?.description ?? "")}"></label>
    <div class="field full"><span>Inspection points, in order</span>
      <p class="small muted">Hold points stop later points being submitted until released. Hold and witness points need a director, PM or quality manager to sign off.</p>
      <div class="pt-rows">${(t?.points?.length ? t.points : [{}]).map(templatePointRow).join("")}</div>
      <div><button type="button" class="btn" data-add-point>${icon("plus", 15)} Add point</button></div></div>
    <div class="full"><button class="btn btn-primary">${t ? "Save as new version" : "Create template"}</button></div></div>`);
}

function pageTemplates(u) {
  const manage = can(u, "itp.manage"), list = DB.itpTemplates;
  const uses = (t) => DB.itps.filter((i) => i.templateId === t.id).length;
  return `${pageHeader({ title: "ITP templates", meta: "<span>Build an inspection and test plan once, reuse it on every project.</span>" })}
  ${list.length ? `<section class="card"><div class="table-wrap"><table class="register"><thead><tr><th>Template</th><th>Trade</th><th>Points</th><th>Hold points</th><th>Version</th><th>Used on</th></tr></thead><tbody>
    ${list.map((t) => `<tr><td><a class="rowlink" href="#/app/templates/${t.id}">${esc(t.name)}</a><div class="muted small">${esc(t.description ?? "")}</div></td><td class="small">${esc(t.trade ?? "—")}</td><td class="small">${t.points.length}</td><td class="small">${t.points.filter((x) => x.type === "hold").length}</td><td class="mono">v${t.version}</td><td class="small">${uses(t)} ITP${uses(t) === 1 ? "" : "s"}</td></tr>`).join("")}
  </tbody></table></div></section>`
    : `<section class="card">${emptyState("clipboard", "No templates yet", 'Start from the starter set (concrete slab, wet-area waterproofing, fire stopping) or build your own.', manage ? form("loadStarters", '<button class="btn btn-primary">Load starter templates</button>') : "")}</section>`}
  ${manage ? `<section class="card card-pad" id="new-template"><h2 style="margin-bottom:12px">New template</h2>${templateForm("createTemplate")}</section>` : ""}`;
}

function pageTemplate(u, id) {
  const t = DB.itpTemplates.find((x) => x.id === id);
  if (!t) return notFound("That template doesn't exist or has been archived.");
  const manage = can(u, "itp.manage"), used = DB.itps.filter((i) => i.templateId === t.id);
  return `${pageHeader({ crumbs: [["#/app/templates", "ITP templates"]], title: esc(t.name), meta: `<span>Version <b>${t.version}</b></span><span>${t.points.length} points</span><span>Used on ${used.length} ITP${used.length === 1 ? "" : "s"}</span>` })}
  ${manage ? `<section class="card card-pad"><h2 style="margin-bottom:4px">Edit template</h2><p class="small muted" style="margin-bottom:12px">Saving creates version ${t.version + 1}. ITPs already on projects keep the version they were created from.</p>${templateForm("updateTemplate", t)}</section>
    <section class="card card-pad"><h2 style="margin-bottom:6px">Archive</h2><p class="small muted" style="margin-bottom:12px">Hides the template so it can't be added to new projects. Existing ITPs are unaffected.</p>${form("archiveTemplate", hidden("template", t.id) + '<button class="btn btn-danger">Archive template</button>', `data-confirm="Archive ${esc(t.name)}?"`)}</section>`
    : `<section class="card"><div class="table-wrap"><table class="register"><thead><tr><th>#</th><th>Point</th><th>Type</th><th>Acceptance criteria</th></tr></thead><tbody>${t.points.map((pt, n) => `<tr><td>${n + 1}</td><td style="font-weight:600">${esc(pt.name)}</td><td>${POINT_TYPES[pt.type]}</td><td class="small">${esc(pt.checkText ?? "")}</td></tr>`).join("")}</tbody></table></div></section>`}`;
}

// ===================================================== other project modules
const VIEWS = { "2w": ["2 weeks", -2, 14], "6w": ["6 weeks", -7, 42], "12w": ["12 weeks", -7, 84], all: ["Whole programme"] };

function predecessorPicker(projectTasks, self, selected = []) {
  // Hide this task and anything that already depends on it (that would be a loop).
  const blocked = new Set(self ? [self.id] : []);
  let grew = true;
  while (grew) { grew = false; for (const t of projectTasks) if (!blocked.has(t.id) && t.predecessorIds.some((x) => blocked.has(x))) { blocked.add(t.id); grew = true; } }
  const opts = projectTasks.filter((t) => !blocked.has(t.id));
  if (!opts.length) return '<p class="muted small">No other tasks to link yet.</p>';
  return `<div class="pick-list">${opts.map((t) => `<label class="row small" style="gap:8px"><input type="checkbox" name="predecessor_ids" value="${t.id}"${selected.includes(t.id) ? " checked" : ""}>${t.isMilestone ? "◆ " : ""}${esc(t.name)} <span class="muted">· finishes ${dayMonth(t.forecastFinish)}</span></label>`).join("")}</div>`;
}

function taskFields(p, projectTasks, t = null) {
  const v = (k) => esc(t?.[k] ?? "");
  const opt = (list, sel, label) => `<option value="">—</option>${list.map((x) => `<option value="${x.id}"${x.id === sel ? " selected" : ""}>${esc(label(x))}</option>`).join("")}`;
  return `<div class="form-grid task-form">
    <label class="field full"><span>Name <span class="req">*</span></span><input name="name" class="input" value="${v("name")}" placeholder="e.g. L4 slab — reo &amp; formwork"></label>
    <label class="row small full" style="gap:8px"><input type="checkbox" name="is_milestone"${t?.isMilestone ? " checked" : ""}> This is a milestone (a single date, e.g. "L4 slab pour" or "Practical completion")</label>
    <label class="field"><span><span class="when-task">Start</span><span class="when-ms">Milestone date</span> <span class="req">*</span></span><input type="date" name="forecast_start" class="input" value="${v("forecastStart")}"></label>
    <label class="field finish-field"><span>Finish <span class="req">*</span></span><input type="date" name="forecast_finish" class="input" value="${v("forecastFinish")}"></label>
    <label class="field"><span>Trade</span><input name="trade" class="input" value="${v("trade")}" placeholder="e.g. Concrete"></label>
    <label class="field"><span>Contractor</span><select name="contractor_id" class="input">${opt(DB.contractors, t?.contractorId, (c) => c.tradingName)}</select></label>
    <div class="field full"><span>Must finish first <span class="muted">(predecessors — finish-to-start)</span></span>${predecessorPicker(projectTasks, t, t?.predecessorIds ?? [])}</div>
    <label class="field"><span>Linked ITP</span><select name="itp_id" class="input">${opt(DB.itps.filter((i) => i.projectId === p.id), t?.itpId, (i) => `${i.ref} · ${i.title}`)}</select></label>
    <label class="field"><span>Linked SWMS</span><select name="swms_id" class="input">${opt(DB.swms.filter((x) => x.projectId === p.id), t?.swmsId, (x) => `${x.ref} · ${x.title}`)}</select></label>
    <label class="field"><span>Cost code</span><input name="cost_code" class="input" value="${v("costCode")}" placeholder="e.g. 02-CON"></label>
    ${t ? `<label class="field"><span>Delay reason <span class="muted">(needed if the finish moves later)</span></span><input name="delay_reason" class="input" placeholder="e.g. Wet weather, late steel delivery"></label>` : "<span></span>"}
  </div>`;
}

function pageProgramme(u, p, q = {}) {
  const base = `#/app/projects/${p.id}`, tasks = DB.tasks.filter((t) => t.projectId === p.id).sort((a, b) => a.forecastStart.localeCompare(b.forecastStart) || a.forecastFinish.localeCompare(b.forecastFinish));
  const cp = criticalPath(tasks), pr = progressOf(p), manage = can(u, "project.manage");
  const view = VIEWS[q.view] ? q.view : "6w";
  let from, days;
  if (view === "all" && tasks.length) {
    const first = Math.min(...tasks.map((t) => dayNo(t.forecastStart)), ...tasks.map((t) => dayNo(t.baselineStart || t.forecastStart)));
    const last = Math.max(...tasks.map((t) => dayNo(t.forecastFinish)));
    from = first - dayNo(todayYmd()); days = Math.max(14, last - first + 3);
  } else [, from, days] = VIEWS[view === "all" ? "6w" : view];
  const end = tasks.length ? tasks.reduce((a, t) => (t.forecastFinish > a ? t.forecastFinish : a), tasks[0].forecastFinish) : null;
  const late = end && p.pcDate ? daysBetween(D(p.pcDate), D(end)) : 0;
  const critCount = [...cp.values()].filter((x) => x.critical).length;
  const rows = tasks.map((t) => {
    const slip = t.baselineFinish ? daysBetween(D(t.baselineFinish), D(t.forecastFinish)) : 0, c = cp.get(t.id), clash = dependencyClashes(t, tasks), itp = DB.itps.find((i) => i.id === t.itpId);
    return `<tr><td><a class="rowlink" href="${base}/programme/${t.id}" style="font-weight:${t.isMilestone ? 700 : 600}">${t.isMilestone ? "◆ " : ""}${esc(t.name)}</a><div class="muted small">${esc(t.trade ?? "")}${clash.length ? ` <span class="amber-text">${icon("alert", 12)} starts before ${esc(clash[0].name)} finishes</span>` : ""}</div></td>
      <td class="small">${esc(contractorOf(t.contractorId)?.tradingName ?? "—")}</td>
      <td class="small" style="white-space:nowrap">${dayMonth(t.forecastStart)}${t.isMilestone ? "" : ` – ${dayMonth(t.forecastFinish)}`}</td>
      <td class="num ${slip > 0 ? "amber-text" : ""}">${slip > 0 ? `+${slip}d` : slip < 0 ? `${slip}d` : "—"}</td>
      <td class="num">${t.status === "complete" ? "—" : c?.critical ? '<span class="crit-text">0d</span>' : `${c?.float ?? 0}d`}</td>
      <td class="num">${t.progress}%</td>
      <td class="small">${itp ? `<a class="link" href="${base}/quality/itp/${itp.id}">${itp.ref}</a>` : "—"}</td>
      <td>${badge(t.status)}</td></tr>`;
  }).join("");
  return `${pageHeader({ crumbs: crumbsFor(p), title: "Programme &amp; tasks",
    meta: `<span>Planned <b>${pr.planned}%</b></span><span>Progress on site <b>${pr.verified}%</b></span>${end ? `<span>Forecast finish <b>${dayMonth(end)}</b>${p.pcDate ? ` <span class="${late > 0 ? "amber-text" : "green-text"}">(${late > 0 ? `${late}d after` : late < 0 ? `${-late}d before` : "on"} PC)</span>` : ""}</span>` : ""}${p.pcDate ? `<span>PC <b>${dayMonth(p.pcDate)}</b></span>` : ""}`,
    actions: manage ? `<a class="btn btn-dark" href="${base}/programme#new-task">Add task</a>` : "" })}
  ${tasks.length ? `<section class="card"><div class="card-head" style="flex-wrap:wrap"><h2>Gantt</h2><div class="spacer"></div><div class="row wrap" style="gap:6px">${Object.entries(VIEWS).map(([k, [l]]) => `<a class="chip" data-active="${k === view}" href="${base}/programme?view=${k}">${l}</a>`).join("")}</div></div>
    <div class="card-body">${gantt(tasks, from, days, { critical: cp, link: `${base}/programme` })}${ganttKey(true)}
    <p class="small muted" style="margin-top:8px">${critCount} task${critCount === 1 ? "" : "s"} on the critical path — any delay to these pushes out the finish date. Float is how many days a task can slip without delaying completion.</p></div></section>
  <section class="card"><div class="table-wrap"><table class="register"><thead><tr><th>Task</th><th>Contractor</th><th>Forecast</th><th class="right">Slip</th><th class="right">Float</th><th class="right">Progress</th><th>Quality</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div></section>`
    : `<section class="card">${emptyState("calendar", "No programme yet", "Add the project's tasks and milestones. Link tasks that must finish first, and the critical path is worked out for you.")}</section>`}
  ${manage ? `<section class="card card-pad" id="new-task"><h2 style="margin-bottom:12px">Add a task or milestone</h2>${form("createTask", `${hidden("project", p.id)}${taskFields(p, tasks)}<div style="margin-top:14px"><button class="btn btn-primary">Add to programme</button></div>`)}</section>` : ""}
  ${manage && tasks.length ? `<section class="card card-pad"><h2 style="margin-bottom:4px">Re-baseline</h2><p class="muted small" style="margin-bottom:12px">Copies every current forecast date into the baseline — for example after an extension of time is approved. The old baseline stays in the history.</p>${form("rebaseline", `${hidden("project", p.id)}<div class="row wrap" style="gap:8px"><input name="reason" class="input" placeholder="Reason, e.g. EOT 2 approved" style="max-width:340px;height:36px"><button class="btn">Re-baseline programme</button></div>`, 'data-confirm="Replace the baseline for every task with today\'s forecast dates?"')}</section>` : ""}
  <p class="small muted">Physical progress, ITP sign-off and claim entitlement are tracked separately: a task can be complete while its ITP is unsigned.</p>`;
}

function pageTask(u, p, id) {
  const t = DB.tasks.find((x) => x.id === id && x.projectId === p.id);
  if (!t) return notFound();
  const base = `#/app/projects/${p.id}`, tasks = DB.tasks.filter((x) => x.projectId === p.id), cp = criticalPath(tasks).get(t.id);
  const manage = can(u, "project.manage"), siteTeam = manage || can(u, "diary.submit");
  const slip = t.baselineFinish ? daysBetween(D(t.baselineFinish), D(t.forecastFinish)) : 0, clash = dependencyClashes(t, tasks);
  const preds = tasks.filter((x) => t.predecessorIds.includes(x.id)), succs = tasks.filter((x) => x.predecessorIds.includes(t.id));
  const itp = DB.itps.find((i) => i.id === t.itpId), swms = DB.swms.find((s) => s.id === t.swmsId), defects = DB.defects.filter((d) => d.taskId === t.id);
  const kv = (k, v) => `<dt class="muted">${k}</dt><dd style="text-align:left;font-family:inherit">${v}</dd>`;
  const link = (x) => `<a class="link" href="${base}/programme/${x.id}">${x.isMilestone ? "◆ " : ""}${esc(x.name)}</a> <span class="muted small">(${dayMonth(x.forecastFinish)})</span>`;
  const openHolds = itp?.points.filter((x) => x.type === "hold" && x.status !== "released").length ?? 0;
  return `${pageHeader({ crumbs: [[base, p.name], [`${base}/programme`, "Programme"]], title: `${t.isMilestone ? "◆ " : ""}${esc(t.name)}`,
    meta: `<span class="row wrap" style="gap:8px">${badge(t.status)}${cp?.critical ? '<span class="badge badge-red">Critical path</span>' : ""}${t.isMilestone ? '<span class="tag">Milestone</span>' : ""}</span>` })}
  ${clash.length ? `<div class="notice notice-warn">${icon("alert")}<span>Starts before ${clash.map((x) => `<b>${esc(x.name)}</b> finishes (${dayMonth(x.forecastFinish)})`).join(", ")}. Move the start date or remove the link.</span></div>` : ""}
  ${openHolds ? `<div class="notice notice-error">${icon("lock")}<span><b>${itp.ref}</b> has ${openHolds} hold point${openHolds > 1 ? "s" : ""} not released. Work covered by a hold point must not proceed until it's released.</span></div>` : ""}
  <div class="cc-grid">
    <div class="stack-lg" style="min-width:0">
      <section class="card"><div class="card-head"><h2>Dates</h2></div><div class="card-body"><dl class="kv" style="grid-template-columns:180px 1fr">
        ${kv("Forecast", `${dayMonth(t.forecastStart)}${t.isMilestone ? "" : ` – ${dayMonth(t.forecastFinish)} · ${durationDays(t)} days`}`)}
        ${kv("Baseline", t.baselineStart ? `${dayMonth(t.baselineStart)}${t.isMilestone ? "" : ` – ${dayMonth(t.baselineFinish)}`}` : "—")}
        ${kv("Slip vs baseline", slip > 0 ? `<span class="amber-text">${slip} days late</span>` : slip < 0 ? `${-slip} days early` : "On baseline")}
        ${kv("Float", t.status === "complete" ? "—" : cp?.critical ? '<span class="crit-text">None — on the critical path</span>' : `${cp?.float ?? 0} days`)}
        ${kv("Actual", t.actualStart ? `Started ${dayMonth(t.actualStart)}${t.actualFinish ? ` · finished ${dayMonth(t.actualFinish)}` : ""}` : "Not started")}
        ${t.delayReason ? kv("Last delay reason", esc(t.delayReason)) : ""}
      </dl></div></section>
      <section class="card"><div class="card-head"><h2>Links</h2></div><div class="card-body"><dl class="kv" style="grid-template-columns:180px 1fr">
        ${kv("Contractor", esc(contractorOf(t.contractorId)?.tradingName ?? "—"))}${kv("Trade", esc(t.trade ?? "—"))}${kv("Cost code", esc(t.costCode ?? "—"))}
        ${kv("Must finish first", preds.map(link).join("<br>") || "—")}${kv("Waiting on this", succs.map(link).join("<br>") || "—")}
        ${kv("ITP", itp ? `<a class="link" href="${base}/quality/itp/${itp.id}">${itp.ref} · ${esc(itp.title)}</a>` : "—")}
        ${kv("SWMS", swms ? `${esc(swms.ref)} · ${esc(swms.title)} v${swms.version} ${badge(swms.status)}` : "—")}
        ${kv("Defects", defects.length ? defects.map((d) => `<a class="link" href="${base}/quality/defects/${d.id}">${d.ref}</a>`).join(", ") : "—")}
      </dl></div></section>
      <section class="card"><div class="card-head"><h2>History</h2></div><div class="card-body"><ul class="timeline">${auditFor(t.id).map((a) => `<li><span class="dot ${/delay|blocked/i.test(a.action) ? "amber" : /complete/i.test(a.action) ? "green" : "blue"}"></span><div><b style="font-weight:600">${esc(a.action)}</b> by ${esc(userById(a.actorId)?.name ?? "—")} · <span class="muted">${dateTime(a.at)}</span>${a.detail ? `<div class="muted small">${esc(a.detail)}</div>` : ""}</div></li>`).join("") || '<li class="muted small">No changes recorded yet.</li>'}</ul></div></section>
    </div>
    <aside class="stack-lg">
      ${siteTeam ? `<section class="card card-pad"><h2 style="margin-bottom:12px">Update progress</h2>${form("taskProgress", `${hidden("task", t.id)}<div class="stack">
        <label class="field"><span>Physical progress</span><div class="row"><input type="range" name="progress" min="0" max="100" step="5" value="${t.progress}" class="range" oninput="this.nextElementSibling.textContent=this.value+'%'"><b style="min-width:44px;text-align:right">${t.progress}%</b></div></label>
        <label class="row small" style="gap:8px"><input type="checkbox" name="blocked"${t.status === "blocked" ? " checked" : ""}> Work is blocked</label>
        <label class="field"><span>Note <span class="muted">(say what's blocking it)</span></span><input name="note" class="input" placeholder="e.g. Waiting on hold point release"></label>
        <button class="btn btn-primary">Save progress</button></div>`)}</section>` : ""}
      ${manage ? `<section class="card card-pad"><h2 style="margin-bottom:12px">Edit task</h2>${form("updateTask", `${hidden("task", t.id)}${taskFields(p, tasks, t)}<div style="margin-top:14px"><button class="btn btn-dark">Save changes</button></div>`)}</section>
        ${t.progress === 0 ? `<section class="card card-pad"><h2 style="margin-bottom:6px">Remove task</h2><p class="muted small" style="margin-bottom:12px">Only possible while no progress is recorded. Links from other tasks are removed too.</p>${form("deleteTask", `${hidden("task", t.id)}${hidden("project", p.id)}<button class="btn btn-danger">Remove from programme</button>`, `data-confirm="Remove ${esc(t.name)} from the programme?"`)}</section>` : ""}` : ""}
    </aside>
  </div>`;
}

function pageCommercial(u, p) {
  const c = projectCommercial(u, p.id);
  if (!c) return notFound("Commercial records aren't available to your role.");
  const lines = DB.budgetLines.filter((l) => l.projectId === p.id), vars = listVariations(u, p.id), claims = DB.claims.filter((x) => x.projectId === p.id);
  return `${pageHeader({ crumbs: crumbsFor(p), title: `Commercial &amp; finance`, meta: `<span>All figures excl. GST. Your variation approval limit: <b>${moneyLimit(VARIATION_LIMIT[u.role])}</b></span>` })}
  <div class="metrics">
    ${metric("Original contract", money(c.originalContract, { compact: true }))}${metric("Approved variations", money(c.approvedVariations, { compact: true, sign: true }))}${metric("Approved contract value", money(c.revisedContract, { compact: true }))}
    ${metric("Committed costs", money(c.committed, { compact: true }), c.forecastFinalCost ? `${pct((c.committed / c.forecastFinalCost) * 100, 0)} of forecast` : "No budget yet")}${metric("Actual costs", money(c.actual, { compact: true }))}${metric("Forecast final cost", money(c.forecastFinalCost, { compact: true }))}
    ${metric("Forecast gross margin", pct(c.forecastMarginPct), money(c.forecastMargin, { compact: true }), c.forecastMargin < 0 ? "red" : null)}${metric("Variation exposure", money(c.variationExposure, { compact: true }), "Unapproved — not in contract value", "amber")}
  </div>
  <p class="small muted" style="margin-top:-8px">Margin = approved contract value − forecast final cost, before company overheads. Unapproved variations never increase the contract sum; they appear only as exposure.</p>
  ${can(u, "variation.create") ? `<section class="card card-pad" id="new-variation"><h2 style="margin-bottom:12px">New variation</h2>${form("createVariation", `${hidden("project", p.id)}<div class="form-grid">
    <label class="field full"><span>Description <span class="req">*</span></span><input name="title" class="input" placeholder="e.g. Extra steel — L4 transfer beam"></label>
    <label class="field"><span>Cost impact (excl. GST) <span class="req">*</span></span><input name="amount" class="input" inputmode="decimal" placeholder="e.g. 48,200"></label>
    <label class="field"><span>Time impact (days)</span><input name="days" class="input" type="number" min="0" value="0"></label>
    <label class="field full"><span>Reason</span><input name="reason" class="input" placeholder="e.g. Client instruction, latent condition"></label>
    <div class="full"><button class="btn btn-primary">Submit for approval</button></div></div>`)}</section>` : ""}
  <section class="card" id="variations"><div class="card-head" style="flex-wrap:wrap"><h2>Variations</h2><div class="spacer"></div><span class="small muted">Draft → Submitted → Under review → Approved / Rejected → In claim</span></div>
    <div class="table-wrap"><table class="register"><thead><tr><th>Ref</th><th>Description</th><th>Raised</th><th class="right">Proposed</th><th class="right">Approved</th><th>Status</th><th style="min-width:240px">Action</th></tr></thead><tbody>
    ${vars.length ? "" : '<tr><td colspan="7" class="muted small">No variations yet.</td></tr>'}${vars.map((v) => `<tr id="${v.id}"><td class="mono">${v.ref}</td><td>${esc(v.title)}<div class="muted small">${esc(v.reason)}</div></td><td class="small">${dayMonth(v.raisedAt)}</td><td class="num">${money(v.amount)}</td><td class="num">${v.approvedAmount !== undefined ? money(v.approvedAmount) : "—"}</td><td>${badge(v.status)}</td><td>
      ${(v.status === "submitted" || v.status === "under_review") && can(u, "variation.approve") ? form("variation", `${hidden("variationId", v.id)}<div class="stack" style="gap:6px"><input name="reason" class="input" placeholder="Reason (to reject)" style="height:32px"><div class="row"><button class="btn btn-primary" name="type" value="approve">Approve</button><button class="btn btn-danger" name="type" value="reject">Reject</button></div></div>`, `data-confirm="Approve ${v.ref} for ${money(v.amount)}? This updates the approved contract value." data-confirm-for="approve"`)
        : v.status === "approved" && can(u, "variation.approve") ? form("variation", `${hidden("variationId", v.id)}<button class="btn" name="type" value="include_in_claim">Include in next claim</button>`)
        : `<span class="small muted">${v.approvedBy ? `Approved by ${esc(userById(v.approvedBy)?.name)}` : "—"}</span>`}
    </td></tr>`).join("")}</tbody></table></div></section>
  <section class="card"><div class="card-head"><h2>Budget by cost code</h2></div><div class="table-wrap"><table class="register"><thead><tr><th>Code</th><th>Description</th><th class="right">Budget</th><th class="right">Committed</th><th class="right">Actual</th><th class="right">Forecast final</th><th class="right">Variance</th></tr></thead><tbody>
    ${lines.map((l) => { const v = l.originalBudget - l.forecastFinal; return `<tr><td class="mono">${l.costCode}</td><td>${esc(l.description)}</td><td class="num">${money(l.originalBudget)}</td><td class="num">${money(l.committed)}</td><td class="num">${money(l.actual)}</td><td class="num">${money(l.forecastFinal)}</td><td class="num ${v < 0 ? "red-text" : ""}">${money(v, { sign: true })}</td></tr>`; }).join("")}
    </tbody><tfoot><tr><td></td><td>Total</td><td class="num">${money(c.budget)}</td><td class="num">${money(c.committed)}</td><td class="num">${money(c.actual)}</td><td class="num">${money(c.forecastFinalCost)}</td><td class="num">${money(c.budget - c.forecastFinalCost, { sign: true })}</td></tr></tfoot></table></div></section>
  <section class="card"><div class="card-head" style="flex-wrap:wrap"><h2>Progress claims</h2><div class="spacer"></div><span class="small muted">Submitted, certified and paid are tracked separately</span></div><div class="table-wrap"><table class="register"><thead><tr><th>Ref</th><th>Period end</th><th>Due</th><th class="right">Claimed</th><th class="right">Certified</th><th class="right">Paid</th><th>Status</th></tr></thead><tbody>
    ${claims.map((x) => `<tr><td class="mono">${x.ref}</td><td class="small">${dayMonth(x.periodEnd)}</td><td class="small ${D(x.dueDate) < startOfDay(new Date()) && x.status !== "paid" ? "amber-text" : ""}">${dayMonth(x.dueDate)}</td><td class="num">${money(x.claimed)}</td><td class="num">${x.certified !== undefined ? money(x.certified) : "—"}</td><td class="num">${x.paid !== undefined ? money(x.paid) : "—"}</td><td>${badge(x.status)}</td></tr>`).join("")}
    </tbody></table></div></section>
  <div class="notice notice-warn">${icon("alert")}<span>A completed task or signed ITP doesn't automatically entitle a contractor to payment. Security-of-payment deadlines need specialist legal review before they're automated.</span></div>`;
}

const hazardRow = (h = {}) => `<div class="hz-row">
  <input name="hz_hazard" class="input" placeholder="Hazard, e.g. Pump boom near power lines" value="${esc(h.hazard ?? "")}" aria-label="Hazard">
  <input name="hz_controls" class="input" placeholder="Controls, e.g. Spotter; 4 m exclusion zone" value="${esc(h.controls ?? "")}" aria-label="Controls">
  <input name="hz_responsible" class="input" placeholder="Responsible" value="${esc(h.responsible ?? "")}" aria-label="Responsible">
  <button type="button" class="icon-btn" data-remove-row title="Remove hazard" aria-label="Remove hazard">${icon("x", 15)}</button>
</div>`;

function swmsFields(u, p, s = null) {
  const sub = u.role === "subcontractor_admin";
  const tasks = DB.tasks.filter((t) => t.projectId === p.id && t.status !== "complete");
  return `<div class="form-grid">
    <label class="field"><span>Title <span class="req">*</span></span><input name="title" class="input" value="${esc(s?.title ?? "")}" placeholder="e.g. Concrete placement"></label>
    ${s ? `<label class="field"><span>Contractor</span><input class="input" value="${esc(contractorOf(s.contractorId)?.tradingName ?? "")}" disabled></label>`
      : sub ? `<label class="field"><span>Contractor</span><input class="input" value="${esc(contractorOf(u.contractorId)?.tradingName ?? "")}" disabled></label>`
      : `<label class="field"><span>Contractor <span class="req">*</span></span><select name="contractor_id" class="input"><option value="">Select…</option>${DB.contractors.map((c) => `<option value="${c.id}">${esc(c.tradingName)}</option>`).join("")}</select></label>`}
    <label class="field full"><span>Work activity <span class="req">*</span></span><input name="activity" class="input" value="${esc(s?.activity ?? "")}" placeholder="e.g. Concrete pumping and placement, L4 slab"></label>
    <div class="field full"><span>High-risk construction work</span><div class="hrcw-grid">${HRCW.map((h) => `<label class="row small" style="gap:8px;align-items:flex-start"><input type="checkbox" name="hrcw" value="${esc(h)}"${s?.highRiskCategories.includes(h) ? " checked" : ""}> ${esc(h)}</label>`).join("")}</div></div>
    <div class="field full"><span>Hazards &amp; controls <span class="req">*</span></span><div class="hz-rows">${(s?.hazards?.length ? s.hazards : [{}]).map(hazardRow).join("")}</div><div><button type="button" class="btn" data-add-row="hazard">${icon("plus", 15)} Add hazard</button></div></div>
    ${tasks.length ? `<div class="field full"><span>Covers these programme tasks</span><div class="pick-list">${tasks.map((t) => `<label class="row small" style="gap:8px"><input type="checkbox" name="task_ids" value="${t.id}"${s && t.swmsId === s.id ? " checked" : ""}>${esc(t.name)} <span class="muted">· ${dayMonth(t.forecastStart)}</span></label>`).join("")}</div></div>` : ""}
    <label class="field"><span>SWMS document <span class="muted">(PDF, Word or photo${s?.filePath ? " — leave empty to keep the current file" : ""})</span></span><input type="file" name="file" accept=".pdf,.doc,.docx,image/*" class="input" style="padding-top:7px"></label>
    <label class="field"><span>Notes</span><input name="notes" class="input" value="${esc(s?.notes ?? "")}"></label>
    ${s ? `<label class="row small full" style="gap:8px;align-items:flex-start"><input type="checkbox" name="requires_reack" checked><span>Workers must acknowledge this version again <span class="muted">(untick only for a minor correction that doesn't change the method)</span></span></label>` : ""}
  </div>`;
}

function pageSafety(u, p) {
  const base = `#/app/projects/${p.id}`, series = swmsSeries(p.id);
  const visible = series.filter((x) => u.role !== "subcontractor_admin" || x.latest.contractorId === u.contractorId || x.current);
  const rows = visible.map(({ current, pending, latest }) => {
    const s = current || latest;
    const crew = DB.workers.filter((w) => w.contractorId === s.contractorId && w.inductedProjectIds.includes(p.id));
    const due = current?.reviewDue ? daysBetween(new Date(), D(current.reviewDue)) : null;
    return `<tr><td><a class="rowlink mono" href="${base}/safety/swms/${s.id}">${esc(s.ref)}</a></td>
      <td><a class="rowlink" href="${base}/safety/swms/${s.id}">${esc(s.title)}</a><div class="muted small">${esc(s.activity ?? "")}</div></td>
      <td class="small">${esc(contractorOf(s.contractorId)?.tradingName ?? "—")}</td>
      <td class="small">${current ? `v${current.version} in force` : "—"}${pending ? `<div><a class="link" href="${base}/safety/swms/${pending.id}">v${pending.version} ${pending.status === "changes_requested" ? "needs changes" : "awaiting review"}</a></div>` : ""}</td>
      <td class="small">${current ? `${current.acknowledgedBy.length} of ${crew.length} workers` : "—"}</td>
      <td class="small ${due !== null && due <= 14 ? (due < 0 ? "red-text" : "amber-text") : ""}">${current?.reviewDue ? dayMonth(current.reviewDue) : "—"}</td>
      <td>${current ? badge("approved") : badge(latest.status)}</td></tr>`;
  }).join("");
  return `${pageHeader({ crumbs: crumbsFor(p), title: "Safety &amp; compliance", actions: can(u, "swms.submit") ? `<a class="btn btn-dark" href="${base}/safety#new-swms">Submit a SWMS</a>` : "" })}
  <section class="card"><div class="card-head" style="flex-wrap:wrap"><h2>SWMS register</h2><div class="spacer"></div><span class="small muted">Submit → review → approve → workers acknowledge the version in force</span></div>
  ${visible.length ? `<div class="table-wrap"><table class="register"><thead><tr><th>Ref</th><th>Activity</th><th>Contractor</th><th>Version</th><th>Acknowledged</th><th>Review due</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : emptyState("shield", "No SWMS yet", "Contractors submit a Safe Work Method Statement for high-risk work. Once approved, their workers must acknowledge it before signing in to site.")}</section>
  ${can(u, "swms.submit") ? `<section class="card card-pad" id="new-swms"><h2 style="margin-bottom:12px">Submit a SWMS</h2>${form("submitSwms", `${hidden("project", p.id)}${swmsFields(u, p)}<div style="margin-top:14px"><button class="btn btn-primary">Submit for review</button></div>`)}</section>` : ""}
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">
    <section class="card">${emptyState("filewarn", "Permits to work", "Configurable permit types and approvers per project. A permit is never issued just because a form is complete. Planned for a later phase.")}</section>
    <section class="card">${emptyState("octagon", "Incidents & observations", "Hazard, near-miss and incident reports with investigation and corrective actions. Planned for a later phase.")}</section>
    <section class="card">${emptyState("listchecks", "Toolbox talks", "Record talks and attendance, linked to the day's site diary. Planned for a later phase.")}</section>
  </div>`;
}

function pageSwms(u, p, id) {
  const s = DB.swms.find((x) => x.id === id && x.projectId === p.id);
  if (!s) return notFound();
  const base = `#/app/projects/${p.id}`, series = swmsSeries(p.id).find((x) => x.versions.some((v) => v.id === s.id));
  const isSub = u.role === "subcontractor_admin", ownSub = isSub && u.contractorId === s.contractorId;
  const crew = DB.workers.filter((w) => w.contractorId === s.contractorId && w.inductedProjectIds.includes(p.id));
  const tasks = DB.tasks.filter((t) => t.swmsId === s.id);
  const canRevise = can(u, "swms.submit") && (!isSub || ownSub) && s.status !== "superseded" && !(series.pending && series.pending.id !== s.id);
  const reviewable = can(u, "swms.review") && (s.status === "submitted" || s.status === "in_review");
  const fileUrl = s.filePath ? DB.fileUrls[s.filePath] : null;
  const worker = u.workerId ? DB.workers.find((w) => w.id === u.workerId) : null;
  return `${pageHeader({ crumbs: [[base, p.name], [`${base}/safety`, "Safety"]], title: `<span class="mono" style="font-size:20px;color:var(--muted);margin-right:10px">${esc(s.ref)} v${s.version}</span>${esc(s.title)}`,
    meta: `<span class="row wrap" style="gap:8px">${badge(s.status)}<span>${esc(contractorOf(s.contractorId)?.tradingName ?? "")}</span></span>` })}
  ${s.status === "superseded" && series.current ? `<div class="notice notice-info">${icon("clock")}<span>This version has been replaced. <a class="link" href="${base}/safety/swms/${series.current.id}">View v${series.current.version}, the version in force</a>.</span></div>` : ""}
  ${s.status === "changes_requested" ? `<div class="notice notice-warn">${icon("alert")}<span><b>Changes requested</b> by ${esc(userById(s.reviewedBy)?.name ?? "reviewer")}: ${esc(s.reviewComment ?? "")}</span></div>` : ""}
  ${(s.status === "submitted" || s.status === "in_review") && series.current ? `<div class="notice notice-info">${icon("clock")}<span>Waiting for review. Until it's approved, <a class="link" href="${base}/safety/swms/${series.current.id}">v${series.current.version}</a> stays in force.${s.requiresReack ? " Once approved, workers must acknowledge this version before signing in." : " It's marked as a minor change, so acknowledgements will carry over."}</span></div>` : ""}
  <div class="cc-grid">
    <div class="stack-lg" style="min-width:0">
      <section class="card"><div class="card-head"><h2>Work method</h2>${fileUrl ? `<div class="spacer"></div><a class="btn" href="${fileUrl}" target="_blank" rel="noopener">${icon("file", 15)} Open document</a>` : ""}</div><div class="card-body stack">
        <p>${esc(s.activity ?? "")}</p>
        ${s.highRiskCategories.length ? `<div class="row wrap" style="gap:6px">${s.highRiskCategories.map((h) => `<span class="badge badge-amber">${icon("alert", 12)}${esc(h)}</span>`).join("")}</div>` : ""}
        ${s.hazards.length ? `<div class="table-wrap"><table class="register"><thead><tr><th>Hazard</th><th>Controls</th><th>Responsible</th></tr></thead><tbody>${s.hazards.map((h) => `<tr><td style="font-weight:600">${esc(h.hazard)}</td><td class="small">${esc(h.controls)}</td><td class="small">${esc(h.responsible ?? "—")}</td></tr>`).join("")}</tbody></table></div>` : '<p class="muted small">No hazards recorded on this version.</p>'}
        ${s.notes ? `<p class="small muted">${esc(s.notes)}</p>` : ""}
        ${tasks.length ? `<p class="small">Covers: ${tasks.map((t) => `<a class="link" href="${base}/programme/${t.id}">${esc(t.name)}</a>`).join(", ")}</p>` : ""}
      </div></section>
      ${s.status === "approved" ? `<section class="card"><div class="card-head"><h2>Worker acknowledgements</h2><div class="spacer"></div><span class="small muted">${s.acknowledgedBy.length} of ${crew.length} inducted workers</span></div><div class="card-body">
        ${crew.length ? `<div class="table-wrap"><table class="register"><tbody>${crew.map((w) => { const a = s.acks.find((x) => x.workerId === w.id); return `<tr><td style="font-weight:600">${esc(w.name)}</td><td>${a ? badge("approved", `Acknowledged ${dayMonth(a.acknowledgedAt)}`) : badge("pending", "Not yet — can't sign in")}</td></tr>`; }).join("")}</tbody></table></div>`
          : '<p class="muted small">No workers from this company are inducted to the project yet.</p>'}
      </div></section>` : ""}
      <section class="card"><div class="card-head"><h2>Version history</h2></div><div class="table-wrap"><table class="register"><thead><tr><th>Version</th><th>Submitted</th><th>Reviewed</th><th>Status</th></tr></thead><tbody>
        ${series.versions.map((v) => `<tr${v.id === s.id ? ' style="background:#fafbf9"' : ""}><td><a class="link" href="${base}/safety/swms/${v.id}">v${v.version}</a>${v.id === s.id ? ' <span class="muted small">(this)</span>' : ""}${v.requiresReack || v.version === 1 ? "" : '<div class="muted small">minor change</div>'}</td>
          <td class="small">${esc(userById(v.submittedBy)?.name ?? "—")}<div class="muted">${v.submittedAt ? dateTime(v.submittedAt) : ""}</div></td>
          <td class="small">${v.reviewedBy ? `${esc(userById(v.reviewedBy)?.name ?? "—")}<div class="muted">${dateTime(v.reviewedAt)}${v.reviewComment ? ` · ${esc(v.reviewComment)}` : ""}</div>` : "—"}</td><td>${badge(v.status)}</td></tr>`).join("")}
      </tbody></table></div></section>
    </div>
    <aside class="stack-lg">
      ${reviewable ? `<section class="card card-pad"><h2 style="margin-bottom:12px">Review</h2>${form("swmsReview", `${hidden("swmsId", s.id)}<div class="stack">
        <label class="field"><span>Review again in</span><select name="months" class="input"><option value="12">12 months</option><option value="6">6 months</option><option value="3">3 months</option><option value="0">No periodic review</option></select></label>
        <label class="field"><span>Comment <span class="muted">(required to request changes)</span></span><textarea name="comment" class="input"></textarea></label>
        <div class="row wrap"><button class="btn btn-primary" name="decision" value="approve">Approve</button><button class="btn btn-danger" name="decision" value="changes">Request changes</button></div></div>`,
        `data-confirm="Approve ${esc(s.ref)} v${s.version}?${series.current && s.requiresReack ? " Workers will have to acknowledge it before signing in." : ""}" data-confirm-for="approve"`)}</section>` : ""}
      ${worker && worker.contractorId === s.contractorId && s.status === "approved" ? (s.acknowledgedBy.includes(worker.id) ? `<section class="card card-pad"><p class="green-text">${icon("check")} You've acknowledged this version.</p></section>`
        : `<section class="card card-pad"><h2 style="margin-bottom:6px">Acknowledge</h2><p class="muted small" style="margin-bottom:12px">Confirm you've read and understood this SWMS. You'll need to before signing in to site.</p>${form("swmsAck", hidden("swmsId", s.id) + '<button class="btn btn-primary">I\'ve read it — acknowledge</button>')}</section>`) : ""}
      ${canRevise ? `<section class="card card-pad"><h2 style="margin-bottom:4px">Submit a revision</h2><p class="muted small" style="margin-bottom:12px">Creates v${Math.max(...series.versions.map((v) => v.version)) + 1} for review.${s.status === "approved" ? ` v${s.version} stays in force until it's approved.` : ""}</p>${form("reviseSwms", `${hidden("swmsId", s.id)}${swmsFields(u, p, s)}<div style="margin-top:14px"><button class="btn btn-dark">Submit revision</button></div>`, 'class="aside-form"')}</section>` : ""}
    </aside>
  </div>`;
}

function pageWorkforce(u, p) {
  const here = onSiteNow(p.id), hereIds = new Set(here.map((e) => e.workerId));
  const workers = DB.workers.filter((w) => w.inductedProjectIds.includes(p.id) || hereIds.has(w.id) || DB.tasks.some((t) => t.projectId === p.id && t.contractorId === w.contractorId));
  const rows = workers.map((w) => ({ w, r: workerRequirements(w.id, p.id), inAt: here.find((e) => e.workerId === w.id)?.at })).sort((a, b) => a.r.eligible - b.r.eligible);
  const comps = uniq(workers.map((w) => w.contractorId)).map(contractorOf);
  return `${pageHeader({ crumbs: crumbsFor(p), title: "Workforce &amp; site access" })}
  <div class="metrics">${metric("On site now", here.length, `${companiesOnSite(p.id)} companies`)}${metric("Can't sign in", rows.filter((x) => !x.r.eligible).length, "Exact requirement shown below", "amber")}${metric("Companies engaged", comps.length)}</div>
  <section class="card"><div class="card-head" style="flex-wrap:wrap"><h2>Site register &amp; eligibility</h2><div class="spacer"></div><span class="small muted">A check-in is attendance, not an approved timesheet</span></div>
  <div class="table-wrap"><table class="register"><thead><tr><th>Worker</th><th>Company</th><th>On site</th><th>Requirements</th></tr></thead><tbody>
  ${rows.map(({ w, r, inAt }) => { const issues = r.reqs.filter((x) => x.severity !== "ok"); return `<tr><td style="font-weight:600">${esc(w.name)}</td><td class="small">${esc(contractorOf(w.contractorId)?.tradingName)}</td><td class="small">${inAt ? badge("current", `In ${timeOf(inAt)}`) : '<span class="muted">Not on site</span>'}</td><td class="small">${issues.length ? `<div class="row wrap" style="gap:6px">${issues.map((x) => badge(x.severity === "blocking" ? "rejected" : "expiring", `${x.label} — ${x.detail}`)).join("")}</div>` : badge("verified", "All requirements met")}</td></tr>`; }).join("")}
  </tbody></table></div></section>
  <section class="card"><div class="card-head"><h2>Contractor compliance</h2></div><div class="table-wrap"><table class="register"><thead><tr><th>Company</th><th>Trade</th><th>Public liability</th><th>Workers comp</th></tr></thead><tbody>
  ${comps.map((c) => `<tr><td style="font-weight:600">${esc(c.tradingName)}<div class="muted small">ABN ${c.abn}</div></td><td class="small">${esc(c.trade)}</td>${c.insurances.map((ins) => insBadge(ins)).map((b) => `<td>${b}</td>`).join("")}</tr>`).join("")}
  </tbody></table></div></section>
  <p class="small muted">Timesheets (separate payroll and charge-out rates, supervisor approval) are planned for phase 3.</p>`;
}
function insBadge(ins, withType = false) {
  const d = daysBetween(new Date(), D(ins.expires)), t = withType ? `${ins.type} · ` : "";
  return badge(d < 0 ? "expired" : d <= 30 ? "expiring" : "verified", d < 0 ? `${t}Expired ${dayMonth(ins.expires)}` : d <= 30 ? `${t}Expires ${dayMonth(ins.expires)}` : `${t}Current to ${dayMonth(ins.expires)}`);
}

function pageDocuments(u, p) {
  const docs = DB.documents.filter((d) => d.projectId === p.id).sort((a, b) => a.number.localeCompare(b.number) || b.revision.localeCompare(a.revision));
  const pending = docs.filter((d) => d.status === "in_review");
  return `${pageHeader({ crumbs: crumbsFor(p), title: "Documents &amp; drawings" })}
  ${pending.length ? `<div class="notice notice-warn">${icon("alert")}<span>${pending.map((d) => `${d.number} rev ${d.revision}`).join(", ")} ${pending.length > 1 ? "are" : "is"} in review. The previous revision stays current until review is complete, then it's labelled superseded and kept for audit.</span></div>` : ""}
  <section class="card"><div class="table-wrap"><table class="register"><thead><tr><th>Number</th><th>Title</th><th>Category</th><th>Rev</th><th>Uploaded</th><th>Status</th></tr></thead><tbody>
  ${docs.map((d) => `<tr${d.status === "superseded" ? ' style="opacity:.6"' : ""}><td class="mono">${d.number}</td><td>${esc(d.title)}</td><td class="small">${d.category}</td><td class="mono">${d.revision}</td><td class="small">${esc(userById(d.uploadedBy)?.name)} · ${dayMonth(d.uploadedAt)}</td><td>${badge(d.status)}</td></tr>`).join("")}
  </tbody></table></div></section>
  <p class="small muted">File storage, previews and drawing markup come with the backend build.</p>`;
}

function pageDiary(u, p) {
  const entries = DB.diary.filter((x) => x.projectId === p.id), done = entries.some((e) => e.date === todayYmd());
  const insp = DB.audit.filter((a) => a.projectId === p.id && a.recordType === "itp_point" && ymd(new Date(a.at)) === todayYmd()).length;
  const formHtml = done ? `<p class="muted">Today's diary is submitted. Changes go in as amendments, so the original record is never overwritten.</p>`
    : can(u, "diary.submit") ? form("diary", `${hidden("projectId", p.id)}<div class="stack"><label class="field"><span>Weather &amp; conditions</span><input name="weather" class="input" value="${esc(p.weather ?? "")}"></label><label class="field"><span>Work completed &amp; areas <span class="req">*</span></span><textarea name="notes" class="input" placeholder="What happened on site today?"></textarea></label><label class="field"><span>Delays &amp; disruptions</span><input name="delays" class="input" placeholder="Cause and duration"></label><button class="btn btn-dark">Submit diary</button></div>`)
    : `<p class="muted">Only the site team can submit the diary.</p>`;
  return `${pageHeader({ crumbs: crumbsFor(p), title: "Site diary", meta: `<span>${longToday()}</span>` })}
  <div class="po-grid">
    <section class="card card-pad"><h2 style="margin-bottom:4px">Today</h2><p class="muted small" style="margin-bottom:14px">Pulled in automatically: <b>${onSiteNow(p.id).length} workers</b> checked in, <b>${insp}</b> inspection sign-offs today.</p>${formHtml}</section>
    <section class="card"><div class="card-head"><h2>Previous entries</h2></div><div class="card-body stack">
      ${entries.map((e) => `<div style="border-bottom:1px solid var(--border);padding-bottom:12px"><div class="row wrap small muted" style="gap:12px"><b style="color:var(--ink)">${shortDate(e.date)}</b><span>${esc(e.weather)}</span><span>${e.workersOnSite} workers · ${e.companiesOnSite} companies</span>${badge("submitted")}</div><p style="margin-top:6px">${esc(e.notes)}</p>${e.delays ? `<p class="small amber-text" style="margin-top:4px">Delay: ${esc(e.delays)}</p>` : ""}<p class="small muted" style="margin-top:4px">By ${esc(userById(e.authorId)?.name)}</p></div>`).join("") || '<p class="muted">No entries yet.</p>'}
    </div></section>
  </div>`;
}
const pagePlaceholder = (p, title, ic, body) => `${pageHeader({ crumbs: crumbsFor(p), title })}<section class="card">${emptyState(ic, "Coming in a later phase", body)}</section>`;

// ===================================================== company pages
function pageProjects(u) {
  if (!listProjects(u).length) return pageGettingStarted(u);
  return `${pageHeader({ title: "Projects", meta: `<span>${listProjects(u).length} active</span>`, actions: can(u, "project.manage") ? '<a class="btn btn-dark" href="#/app/projects/new">New project</a>' : "" })}
  <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">${listProjects(u).map((p) => { const c = projectCommercial(u, p.id), pr = progressOf(p), nm = nextMilestoneOf(p); return `<a href="#/app/projects/${p.id}" class="card card-pad stack" style="gap:10px"><div><h2>${esc(p.name)}</h2><div class="muted small"><span class="mono" style="font-size:12px">${p.code}</span> · ${p.type} · ${esc(p.address)}</div></div><div class="bar"><span class="planned" style="width:${pr.planned}%"></span><span class="actual" style="width:${pr.verified}%"></span></div><div class="row wrap small muted" style="gap:14px"><span>${pr.verified}% verified</span><span>${openDefects(u, p.id).length} open defects</span>${c ? `<span>${money(c.revisedContract, { compact: true })}</span>` : ""}<span>PM ${esc(userById(p.pmId)?.name)}</span></div><div class="small">Next: <b>${esc(nm.name)}</b> · ${dayMonth(nm.date)}</div></a>`; }).join("")}</div>
`;
}
const pageTasks = (u) => `${pageHeader({ title: "My tasks", meta: `<span>${myTasks(u).length} open · everything assigned to you as ${ROLE_LABEL[u.role].toLowerCase()}, across every module</span>` })}<section class="card card-pad">${taskList(myTasks(u))}</section>`;
function pagePeople(u) {
  const manage = can(u, "people.manage"), projects = listProjects(u);
  const conOpts = DB.contractors.map((c) => `<option value="${c.id}">${esc(c.tradingName)}</option>`).join("");
  const forms = manage ? `<div class="two-col">
    <section class="card card-pad" id="new-contractor"><h2 style="margin-bottom:12px">Add a contractor</h2>${form("createContractor", `<div class="form-grid">
      <label class="field"><span>Trading name <span class="req">*</span></span><input name="trading_name" class="input" placeholder="e.g. AquaSeal Waterproofing"></label>
      <label class="field"><span>Trade</span><input name="trade" class="input" placeholder="e.g. Waterproofing"></label>
      <label class="field"><span>Legal name</span><input name="legal_name" class="input" placeholder="… Pty Ltd"></label>
      <label class="field"><span>ABN</span><input name="abn" class="input"></label>
      <label class="field"><span>Public liability expires</span><input type="date" name="pl_expires" class="input"></label>
      <label class="field"><span>Workers comp expires</span><input type="date" name="wc_expires" class="input"></label>
      <div class="full"><button class="btn btn-primary">Add contractor</button></div></div>`)}</section>
    <section class="card card-pad" id="new-worker"><h2 style="margin-bottom:12px">Add a worker</h2>${DB.contractors.length ? form("createWorker", `<div class="form-grid">
      <label class="field"><span>Full name <span class="req">*</span></span><input name="name" class="input"></label>
      <label class="field"><span>Company <span class="req">*</span></span><select name="contractor_id" class="input"><option value="">Select…</option>${conOpts}</select></label>
      <label class="field"><span>Mobile</span><input name="phone" class="input" type="tel"></label>
      <label class="field"><span>White Card number</span><input name="white_card" class="input" placeholder="Leave blank if not sighted yet"></label>
      <label class="field full"><span>Site induction completed for</span><select name="inducted_project_id" class="input"><option value="">Not inducted yet</option>${projects.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select></label>
      <p class="small muted full" style="margin-top:-4px">Entering a White Card number records that you sighted the original card.</p>
      <div class="full"><button class="btn btn-primary">Add worker</button></div></div>`) : '<p class="muted small">Add the worker\'s company first.</p>'}</section>
  </div>` : "";
  const induct = manage && DB.workers.length && projects.length ? `<section class="card card-pad"><h2 style="margin-bottom:12px">Record a site induction</h2>${form("induct", `<div class="row wrap" style="gap:8px;align-items:flex-end">
    <label class="field"><span>Worker</span><select name="worker" class="input">${DB.workers.map((w) => `<option value="${w.id}">${esc(w.name)}</option>`).join("")}</select></label>
    <label class="field"><span>Project</span><select name="project" class="input">${projects.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select></label>
    <button class="btn">Record induction</button></div>`)}</section>` : "";
  return `${pageHeader({ title: "People &amp; contractors", meta: `<span>${DB.contractors.length} companies · ${DB.workers.length} workers — one central profile, reused across projects</span>` })}
  ${forms}
  <section class="card"><div class="card-head"><h2>Contractors</h2></div>${DB.contractors.length ? `<div class="table-wrap"><table class="register"><thead><tr><th>Company</th><th>Trade</th><th>Workers</th><th>Insurances</th></tr></thead><tbody>
  ${DB.contractors.map((c) => `<tr><td style="font-weight:600">${esc(c.tradingName)}<div class="muted small">${esc(c.legalName)}${c.abn ? ` · ABN ${esc(c.abn)}` : ""}</div></td><td class="small">${esc(c.trade ?? "")}</td><td class="small">${DB.workers.filter((w) => w.contractorId === c.id).length}</td><td><div class="row wrap" style="gap:6px">${c.insurances.map((i) => insBadge(i, true)).join("") || '<span class="muted small">None recorded</span>'}</div></td></tr>`).join("")}
  </tbody></table></div>` : emptyState("users", "No contractors yet", "Add the companies working on your projects. Their workers, defects and SWMS link back to them.")}</section>
  <section class="card"><div class="card-head" style="flex-wrap:wrap"><h2>Worker credential wallets</h2><div class="spacer"></div><span class="small muted">Uploaded ≠ verified: each credential shows its verification state</span></div>${DB.workers.length ? `<div class="table-wrap"><table class="register"><thead><tr><th>Worker</th><th>Company</th><th>Inducted to</th><th>Credentials</th></tr></thead><tbody>
  ${DB.workers.map((w) => `<tr><td style="font-weight:600">${esc(w.name)}</td><td class="small">${esc(contractorOf(w.contractorId)?.tradingName ?? "—")}</td><td class="small">${w.inductedProjectIds.map(projName).filter(Boolean).map(esc).join(", ") || '<span class="muted">—</span>'}</td><td><div class="row wrap" style="gap:6px">${DB.credentials.filter((c) => c.workerId === w.id).map((c) => { const d = c.expires ? daysBetween(new Date(), D(c.expires)) : Infinity; return badge(d < 0 ? "expired" : c.status !== "verified" ? c.status : d <= 30 ? "expiring" : "verified", `${c.type}${c.expires ? ` · ${dayMonth(c.expires)}` : ""}`); }).join("") || '<span class="muted small">None recorded</span>'}</div></td></tr>`).join("")}
  </tbody></table></div>` : emptyState("hardhat", "No workers yet", "Add workers so they can sign in to site with their credentials checked at the gate.")}</section>
  ${induct}`;
}

function pageReports(u, q) {
  const view = q.view || "defects", rows = listDefects(u).filter((d) => d.status !== "closed" && d.status !== "draft" && (view !== "overdue" || isOverdue(d)));
  return `${pageHeader({ title: "Reports", meta: "<span>Company-wide registers. Open defects = every defect not closed or draft, across all active projects.</span>", actions: `<a class="chip" data-active="${view === "defects"}" href="#/app/reports">All open defects</a><a class="chip" data-active="${view === "overdue"}" href="#/app/reports?view=overdue">Overdue only</a>` })}
  <section class="card"><div class="table-wrap"><table class="register"><thead><tr><th>ID</th><th>Title</th><th>Project</th><th>Location</th><th>Contractor</th><th>Due</th><th>Status</th></tr></thead><tbody>
  ${rows.map((d) => `<tr><td><a class="mono link" href="#/app/projects/${d.projectId}/quality/defects/${d.id}">${d.ref}</a></td><td>${esc(d.title)}</td><td class="small">${esc(projName(d.projectId))}</td><td class="small">${esc(locationLabel(d))}</td><td class="small">${esc(contractorOf(d.contractorId)?.tradingName ?? "—")}</td><td class="small">${dueLabel(d.dueDate)}</td><td>${badge(isOverdue(d) ? "overdue" : d.status)}</td></tr>`).join("")}
  </tbody></table></div></section>`;
}
function pageSearch(u, q) {
  const r = search(u, q.q || "");
  return `${pageHeader({ title: q.q ? `Results for “${esc(q.q)}”` : "Search", meta: "<span>Projects, defects, documents, workers and variations — only what your role can see.</span>" })}
  <section class="card">${r.length ? `<div class="table-wrap"><table class="register"><tbody>${r.map(([k, t, s, h]) => `<tr><td style="width:110px"><span class="tag">${k}</span></td><td><a class="rowlink" href="${h}">${esc(t)}</a></td><td class="small muted">${esc(s)}</td></tr>`).join("")}</tbody></table></div>` : emptyState("search", q.q ? "Nothing found" : "Search everything", q.q ? "Try a record ID like DEF-0142, a drawing number like A-102, or a worker's name." : "Type in the search bar above.")}</section>`;
}
function pageSettings(u) {
  const admin = u.isAdmin;
  const roleOpts = (sel) => Object.entries(ROLE_LABEL).map(([k, l]) => `<option value="${k}"${k === sel ? " selected" : ""}>${l}</option>`).join("");
  const appUrl = location.href.split("#")[0];
  const members = DB.users.map((x) => `<tr><td style="font-weight:600">${esc(x.name)}${x.id === u.id ? ' <span class="muted small">(you)</span>' : ""}<div class="muted small">${esc(x.email ?? "")}</div></td><td>${admin ? form("updateMember", `${hidden("user", x.id)}<div class="row wrap" style="gap:6px"><select name="role" class="input" style="height:32px;width:auto">${roleOpts(x.role)}</select><input name="title" class="input" value="${esc(x.title)}" style="height:32px;width:150px" aria-label="Job title"><label class="row small" style="gap:4px"><input type="checkbox" name="is_admin"${x.isAdmin ? " checked" : ""}> Admin</label><button class="btn" style="height:32px">Save</button>${x.id !== u.id ? `<button class="btn btn-danger" style="height:32px" name="remove" value="1">Remove</button>` : ""}</div>`, x.id !== u.id ? `data-confirm="Remove ${esc(x.name)} from ${esc(DB.org.name)}?" data-confirm-for="1"` : "") : `${ROLE_LABEL[x.role]}${x.isAdmin ? " · Admin" : ""}<div class="muted small">${esc(x.title)}</div>`}</td><td class="mono">${VARIATION_LIMIT[x.role] === undefined ? "—" : moneyLimit(VARIATION_LIMIT[x.role])}</td></tr>`).join("");
  const invites = DB.invitations.map((i) => `<tr><td>${esc(i.email)}</td><td>${ROLE_LABEL[i.role]}<div class="muted small">${esc(i.title)}</div></td><td class="small">${dayMonth(i.createdAt)}</td><td>${form("cancelInvite", hidden("id", i.id) + '<button class="btn" style="height:32px">Cancel</button>')}</td></tr>`).join("");
  return `${pageHeader({ title: "Team &amp; roles", meta: `<span>${esc(DB.org.name)}${DB.org.abn ? ` · ABN ${esc(DB.org.abn)}` : ""}</span>` })}
  ${admin ? `<section class="card card-pad"><h2 style="margin-bottom:4px">Invite someone</h2><p class="muted small" style="margin-bottom:12px">Save the invitation here, then ask them to sign up at <span class="mono">${esc(appUrl)}</span> with the same email. They join automatically.</p>
    ${form("invite", `<div class="form-grid">
      <label class="field"><span>Email <span class="req">*</span></span><input name="email" type="email" class="input" autocomplete="off"></label>
      <label class="field"><span>Role <span class="req">*</span></span><select name="role" class="input">${roleOpts("site_supervisor")}</select></label>
      <label class="field"><span>Job title</span><input name="title" class="input" placeholder="e.g. Site supervisor"></label>
      <label class="field"><span>Their company <span class="muted">(subcontractor admins)</span></span><select name="contractor" class="input"><option value="">—</option>${DB.contractors.map((c) => `<option value="${c.id}">${esc(c.tradingName)}</option>`).join("")}</select></label>
      <label class="field"><span>Their worker profile <span class="muted">(workers)</span></span><select name="worker" class="input"><option value="">—</option>${DB.workers.map((w) => `<option value="${w.id}">${esc(w.name)}</option>`).join("")}</select></label>
      <div class="full"><button class="btn btn-primary">Save invitation</button></div></div>`)}</section>` : ""}
  <section class="card"><div class="card-head" style="flex-wrap:wrap"><h2>Members</h2><div class="spacer"></div><span class="small muted">The database checks roles on every action</span></div><div class="table-wrap"><table class="register"><thead><tr><th>Person</th><th>Role</th><th>Variation approval limit</th></tr></thead><tbody>${members}</tbody></table></div></section>
  ${admin && DB.invitations.length ? `<section class="card"><div class="card-head"><h2>Pending invitations</h2></div><div class="table-wrap"><table class="register"><thead><tr><th>Email</th><th>Role</th><th>Sent</th><th></th></tr></thead><tbody>${invites}</tbody></table></div></section>` : ""}
  ${admin ? "" : '<p class="small muted">Only company admins can invite people or change roles.</p>'}`;
}

function pageProfile(u) {
  return `${pageHeader({ title: "My profile" })}
  <div class="two-col">
    <section class="card card-pad"><h2 style="margin-bottom:12px">Your details</h2>${form("profile", `<div class="stack">
      <label class="field"><span>Full name <span class="req">*</span></span><input name="full_name" class="input" value="${esc(u.name)}" autocomplete="name"></label>
      <label class="field"><span>Mobile</span><input name="phone" class="input" type="tel" value="${esc(u.phone ?? "")}" autocomplete="tel"></label>
      <label class="field"><span>Email</span><input class="input" value="${esc(SESSION.user.email)}" disabled></label>
      <div><button class="btn btn-primary">Save profile</button></div></div>`)}</section>
    <section class="card card-pad"><h2 style="margin-bottom:12px">Change password</h2>${form("password", `<div class="stack">
      <label class="field"><span>New password</span><input name="password" type="password" class="input" autocomplete="new-password" minlength="8"></label>
      <label class="field"><span>Confirm new password</span><input name="confirm" type="password" class="input" autocomplete="new-password"></label>
      <div><button class="btn">Update password</button></div></div>`)}</section>
  </div>
  <section class="card"><div class="card-head"><h2>Your companies</h2></div><div class="table-wrap"><table class="register"><tbody>${MY_ORGS.map((o) => `<tr><td style="font-weight:600">${esc(o.name)}</td><td>${ROLE_LABEL[o.role]}${o.isAdmin ? " · Admin" : ""}</td><td class="right">${o.id === DB.org.id ? '<span class="muted small">Current</span>' : `<button class="btn" type="button" data-org="${o.id}" style="height:32px">Switch</button>`}</td></tr>`).join("")}</tbody></table></div></section>
  <div><button class="btn btn-danger" type="button" data-signout>${icon("logout", 15)} Sign out</button></div>`;
}

function pageGettingStarted(u) {
  const steps = [
    ["folder", "Create your first project", "Name, code, client and contract value. A first location is added so you can raise defects straight away.", can(u, "project.manage") ? '<a class="btn btn-primary" href="#/app/projects/new">New project</a>' : ""],
    ["users", "Add contractors and workers", "The companies on site, their insurances, and workers with White Cards and inductions.", can(u, "people.manage") ? '<a class="btn" href="#/app/people">People &amp; contractors</a>' : ""],
    ["user", "Invite your team", "Project managers, supervisors, subbies and workers each see what their role needs.", u.isAdmin ? '<a class="btn" href="#/app/settings">Team &amp; roles</a>' : ""],
  ];
  return `${pageHeader({ title: `Welcome to BuildOS, ${esc(u.name.split(" ")[0])}`, meta: `<span>${esc(DB.org.name)} has no projects yet.</span>` })}
  <div class="pillars" style="margin-top:0">${steps.map(([ic, t, b, a]) => `<section class="card card-pad stack"><span class="li-icon" style="background:var(--green-tint);color:var(--green-text)">${icon(ic, 20)}</span><h3>${t}</h3><p class="muted small">${b}</p><div>${a}</div></section>`).join("")}</div>
  ${u.isAdmin ? `<section class="card card-pad stack"><h2>Just exploring?</h2><p class="muted small">Load the sample project set (Riverside Apartments and three others) into this company to try every screen with realistic data. You can only do this while the company has no projects.</p><div>${form("loadSample", '<button class="btn">Load sample projects</button>', 'data-confirm="Load four sample projects with made-up contractors, workers and figures into this company?"')}</div></section>` : ""}`;
}

function pageNewProject(u) {
  assertCan(u, "project.manage");
  return `${pageHeader({ crumbs: [["#/app/projects", "Projects"]], title: "New project" })}
  <section class="card card-pad" style="max-width:760px">${form("createProject", `<div class="form-grid">
    <label class="field"><span>Project name <span class="req">*</span></span><input name="name" class="input" placeholder="e.g. Riverside Apartments"></label>
    <label class="field"><span>Project code <span class="req">*</span></span><input name="code" class="input" placeholder="e.g. P-2050"></label>
    <label class="field full"><span>Site address</span><input name="address" class="input"></label>
    <label class="field"><span>Client</span><input name="client" class="input"></label>
    <label class="field"><span>Type</span><select name="type" class="input"><option>Residential</option><option>Commercial</option><option>Industrial</option><option>Civil</option></select></label>
    <label class="field"><span>Contract sum (excl. GST)</span><input name="contract_sum" class="input" inputmode="decimal" placeholder="e.g. 18,000,000"></label>
    <span></span>
    <label class="field"><span>Start date</span><input type="date" name="start_date" class="input"></label>
    <label class="field"><span>Practical completion</span><input type="date" name="pc_date" class="input"></label>
    <p class="small muted full">You'll be set as the project manager. Locations, budgets and the programme can be added after.</p>
    <div class="full"><button class="btn btn-primary">Create project</button></div></div>`)}</section>`;
}

const notFound = (msg = "That page or record doesn't exist, or your role can't see it.") => `<section class="card">${emptyState("search", "Not found", msg, '<a class="btn" href="#/app">Back to overview</a>')}</section>`;

// ===================================================== mobile site app
const siteTabs = (route) => { const fp = DB.projects[0]; const t = (h, l, ic) => `<a href="${h}"${route === h.slice(1) ? ' aria-current="page"' : ""}>${icon(ic, 21)}${l}</a>`; return `<nav class="site-tabs" aria-label="Site app">${t("#/site", "Today", "calendar")}${t("#/app/tasks", "Tasks", "listchecks")}<a href="#/site/defect" aria-label="Raise defect"><span class="fab">${icon("plus", 26)}</span></a>${t(fp ? `#/app/projects/${fp.id}/documents` : "#/app", "Drawings", "file")}${t("#/site/sign-in", "Me", "user")}</nav>`; };
const siteWrap = (inner) => `<div class="site-wrap"><div class="site">${inner}</div></div>`;
function pageSiteToday(u, route) {
  const p = listProjects(u)[0];
  if (!p) return siteWrap(`<div class="site-body" style="padding-top:40px"><h1 style="font-size:24px">No projects yet</h1><p class="muted">Once a project is set up it shows here.</p><a class="btn btn-lg btn-block" href="#/app">Go to the office app</a></div>`);
  const todays = DB.itps.filter((i) => i.projectId === p.id).flatMap((i) => i.points.filter((pt) => pt.status === "submitted" || (pt.status === "pending" && pt.type !== "test")).slice(0, 1).map((pt) => ({ i, pt })));
  return siteWrap(`<header class="site-hero">
    <div class="row" style="justify-content:space-between"><a href="#/app/projects/${p.id}" class="pill">${esc(p.name)} ▾</a><span class="small row" style="gap:6px;color:#b9cac2" data-online-pill-site><span style="width:8px;height:8px;border-radius:4px;background:#5fd39f"></span>Live</span></div>
    <p class="small" style="margin-top:14px;color:#b9cac2">${longToday()} · ${esc(p.weather)}</p><h1 style="font-size:26px;color:#fff">Today on site</h1>
    <div class="site-stats"><div><b>${onSiteNow(p.id).length}</b><span>On site</span></div><div><b>${todays.length}</b><span>Inspections</span></div><div><b style="color:#f1b56b">${overdueDefects(u, p.id).length}</b><span>Overdue</span></div></div>
  </header>
  <div class="site-body">
    <div class="big-actions"><a href="#/site/defect" class="big-action primary">${icon("camera", 22)}Raise defect</a><a href="#/app/projects/${p.id}/quality" class="big-action">${icon("clipboard", 22)}Inspect</a><a href="#/site/sign-in" class="big-action">${icon("qr", 22)}Site sign-in</a><a href="#/app/projects/${p.id}/diary" class="big-action">${icon("notebook", 22)}Site diary</a></div>
    <div class="label">Inspections today</div>
    <div class="list-card">${todays.map(({ i, pt }) => `<a href="#/app/projects/${p.id}/quality/itp/${i.id}"><span class="li-icon" style="background:${pt.type === "hold" ? "var(--red-tint)" : "var(--blue-tint)"};color:${pt.type === "hold" ? "var(--red)" : "var(--blue)"}">${icon(pt.type === "hold" ? "lock" : "clock", 18)}</span><span style="flex:1;min-width:0"><b style="display:block;font-size:15px">${esc(pt.type === "hold" ? `${i.title.split("—")[0].trim()} ${pt.name.toLowerCase()}` : i.title.split("·")[0].trim())}</b><span class="muted small">${i.ref} · ${pt.type === "hold" ? "Hold point" : pt.type} · ${pt.status === "submitted" ? "awaiting release" : "to do"}</span></span><span class="muted">${icon("chevron", 18)}</span></a>`).join("") || '<div class="li muted">No inspections today.</div>'}</div>
  </div>${siteTabs(route)}`);
}
function pageSiteDefect(u) {
  const p = listProjects(u)[0];
  if (!p) return pageSiteToday(u, "/site");
  return siteWrap(`<div class="site-top"><a href="#/site" class="link">Cancel</a><b>New defect</b><span style="width:52px"></span></div><div class="site-body">${can(u, "defect.create") ? defectFormHtml(u, p, true) : '<p class="muted">Your role can\'t raise defects.</p>'}</div>`);
}
function pageSiteSignIn(u, route) {
  const p = listProjects(u)[0];
  if (!p) return pageSiteToday(u, route);
  if (!u.workerId) return siteWrap(`<div class="site-body" style="padding-top:40px"><h1 style="font-size:24px">Worker sign-in</h1><p class="muted">This is the screen a worker sees after scanning the gate QR code. To try it, add a worker on <a class="link" href="#/app/people">People &amp; contractors</a>, then invite their email as a <b>Worker</b> from <a class="link" href="#/app/settings">Team &amp; roles</a> and sign in as them.</p><a class="link" href="#/site">← Back to site app</a></div>${siteTabs(route)}`);
  const r = workerRequirements(u.workerId, p.id), w = r.worker;
  const onSite = onSiteNow(p.id).some((e) => e.workerId === w.id);
  const unacked = DB.swms.filter((s) => s.projectId === p.id && s.contractorId === w.contractorId && s.status === "approved" && !s.acknowledgedBy.includes(w.id));
  return siteWrap(`<div class="site-body" style="padding-top:22px">
    <div><div class="muted small row" style="gap:4px">${icon("mappin", 14)}${esc(p.name)} · Gate 1</div><h1 style="font-size:26px">Hi ${esc(w.name.split(" ")[0])}</h1></div>
    ${unacked.map((s) => `<div class="callout stack" style="gap:10px"><div class="row" style="gap:10px"><span style="color:var(--amber)">${icon("alert", 22)}</span><b style="font-size:17px">One step before sign-in</b></div><p>Read and acknowledge the <b>${esc(s.title)} SWMS (v${s.version})</b>. It changed since you last signed it.</p><details><summary class="link" style="cursor:pointer">Read the SWMS</summary><div class="small stack" style="margin-top:8px;gap:6px"><p><b>Activity:</b> ${esc(s.activity)}</p>${s.highRiskCategories.length ? `<p><b>High-risk work:</b> ${esc(s.highRiskCategories.join(", "))}</p>` : ""}${s.hazards.length ? s.hazards.map((h) => `<p><b>${esc(h.hazard)}:</b> ${esc(h.controls)}</p>`).join("") : "<p><b>Key controls:</b> exclusion zone around the pump boom; spotter for truck movements; edge protection checked before pour; harness when within 2m of an open edge.</p>"}${s.filePath && DB.fileUrls[s.filePath] ? `<p><a class="link" href="${DB.fileUrls[s.filePath]}" target="_blank" rel="noopener">Open the full document</a></p>` : ""}</div></details>${form("swmsAck", hidden("swmsId", s.id) + '<button class="btn btn-dark btn-lg btn-block">I\'ve read it — acknowledge</button>')}</div>`).join("")}
    <div class="label">Your site requirements</div>
    <div class="req-list">${r.reqs.map((x) => `<div class="li"><span>${esc(x.label)}</span><b class="${x.severity === "ok" ? "green-text" : x.severity === "warning" ? "amber-text" : "red-text"}">${icon(x.severity === "ok" ? "check" : x.severity === "warning" ? "alert" : "xcircle", 14)}${esc(x.detail)}</b></div>`).join("")}</div>
    ${r.reqs.some((x) => x.severity === "warning" && /licence/i.test(x.label)) ? '<p class="small muted">A licence is expiring soon — send your supervisor a photo of the renewed card.</p>' : ""}
    ${onSite ? `<div class="notice notice-ok">${icon("checkcircle")}You're signed in to site.</div>${form("siteOut", hidden("projectId", p.id) + '<button class="btn btn-lg btn-block">Sign out of site</button>')}`
      : form("siteIn", hidden("projectId", p.id) + `<button class="btn ${r.eligible ? "btn-primary" : ""} btn-lg btn-block"${r.eligible ? "" : " disabled"}>Sign in to site</button>`)}
    <p class="small muted" style="text-align:center">No account needed · linked to ${esc(contractorOf(w.contractorId)?.tradingName)}</p>
  </div>${siteTabs(route)}`);
}
