// ===================================================== Insights (interactive dashboard)
// A Power BI-style view of live data: slicers (date range, project, company, trade) scope
// every visual; clicking a bar cross-filters the rest; matrices sort; what-if sliders
// recompute the projections; the page refreshes itself every 30 seconds while open.
// All state is in the URL, so a filtered view can be bookmarked or shared.

const INS_TABS = { overview: "Overview", quality: "Quality", labour: "Labour", commercial: "Commercial" };
const INS_PRESETS = [["7", "Last 7 days"], ["30", "Last 30 days"], ["90", "Last 90 days"], ["182", "Last 6 months"], ["fy", "This financial year"]];
let INS = null;                 // current state (parsed from the URL)
let insTimer = null, insLoadedAt = 0;

const fyStart = () => { const d = D(todayYmd()); return ymd(new Date(d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1, 6, 1)); };
const setOf = (v) => new Set(String(v || "").split(",").filter(Boolean));
function parseInsights(q) {
  const range = q.range || (q.from ? "" : "90"), to = q.to || todayYmd();
  const from = range === "fy" ? fyStart() : range ? addDays(todayYmd(), -(Number(range) - 1)) : q.from || addDays(to, -89);
  return { tab: INS_TABS[q.tab] ? q.tab : "overview", range, from, to: range ? todayYmd() : to, p: setOf(q.p), c: setOf(q.c), t: setOf(q.t), b: q.b || "",
    dim: q.dim || "project", sort: q.sort || "", live: q.live !== "0",
    wc: q.wc !== undefined ? Number(q.wc) : 0, wv: q.wv !== undefined ? Number(q.wv) : 0, wclose: q.wclose !== undefined ? Number(q.wclose) : null, wraise: q.wraise !== undefined ? Number(q.wraise) : null };
}
function insightsQuery(s = INS) {
  const o = { tab: s.tab, ...(s.range ? { range: s.range } : { from: s.from, to: s.to }), p: [...s.p].join(","), c: [...s.c].join(","), t: [...s.t].join(","), b: s.b, dim: s.dim, sort: s.sort,
    live: s.live ? "" : "0", wc: s.wc || "", wv: s.wv || "", wclose: s.wclose ?? "", wraise: s.wraise ?? "" };
  return new URLSearchParams(Object.entries(o).filter(([, v]) => v !== "" && v != null)).toString();
}
const insHref = (patch = {}) => `#/app/insights?${insightsQuery({ ...INS, ...patch })}`;

// ---- time buckets: days up to a month, weeks up to six months, then months
function insBuckets(from, to) {
  const days = Math.round((D(to) - D(from)) / 86400000) + 1;
  if (days <= 31) return daysBetweenYmd(from, to).map((d) => ({ key: d, label: dayTick(d), from: d, to: d }));
  if (days <= 190) { const out = []; for (let w = weekStart(from); w <= to; w = addDays(w, 7)) out.push({ key: w, label: dayTick(w), from: w < from ? from : w, to: addDays(w, 6) > to ? to : addDays(w, 6) }); return out; }
  const out = []; let d = D(from); d = new Date(d.getFullYear(), d.getMonth(), 1);
  while (ymd(d) <= to) { const s = ymd(d), e = ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0)); out.push({ key: s.slice(0, 7), label: d.toLocaleDateString("en-AU", { month: "short", year: "2-digit" }), from: s < from ? from : s, to: e > to ? to : e }); d = new Date(d.getFullYear(), d.getMonth() + 1, 1); }
  return out;
}
const bucketWord = (bs) => (bs[0] && bs[0].from === bs[0].to ? "day" : bs.length && bs[0].key.length === 7 ? "month" : "week");

/** Everything the visuals need, scoped by the slicers. prev = the same-length period just before. */
function insightsFacts(u, s) {
  const bucket = s.b ? insBuckets(s.from, s.to).find((x) => x.key === s.b) : null;
  const from = bucket?.from ?? s.from, to = bucket?.to ?? s.to, span = Math.round((D(to) - D(from)) / 86400000) + 1;
  const pFrom = addDays(from, -span), pTo = addDays(from, -1);
  const projects = listProjects(u).filter((p) => !s.p.size || s.p.has(p.id)), pids = new Set(projects.map((p) => p.id));
  const coOf = (w) => DB.workers.find((x) => x.id === w)?.contractorId;
  const defects = listDefects(u).filter((d) => pids.has(d.projectId) && d.status !== "draft" && (!s.c.size || s.c.has(d.contractorId ?? "")) && (!s.t.size || s.t.has(d.trade || "General")));
  const raisedOn = (d) => ymd(new Date(d.raisedAt));
  const ts = liveTs().filter((t) => pids.has(t.projectId) && (!s.c.size || s.c.has(coOf(t.workerId) ?? "")));
  const within = (d, a, b) => d && d >= a && d <= b;
  const pts = DB.itps.filter((i) => pids.has(i.projectId)).flatMap((i) => i.points.map((x) => ({ ...x, projectId: i.projectId })));
  const inc = DB.incidents.filter((x) => pids.has(x.projectId));
  return {
    from, to, pFrom, pTo, projects, pids, defects, ts, coOf,
    open: defects.filter((d) => d.status !== "closed"), overdue: defects.filter((d) => isOverdue(d)),
    raised: defects.filter((d) => within(raisedOn(d), from, to)), raisedPrev: defects.filter((d) => within(raisedOn(d), pFrom, pTo)),
    closed: defects.filter((d) => d.status === "closed" && within(closedOn(d), from, to)), closedPrev: defects.filter((d) => d.status === "closed" && within(closedOn(d), pFrom, pTo)),
    hours: ts.filter((t) => within(t.date, from, to)), hoursPrev: ts.filter((t) => within(t.date, pFrom, pTo)),
    released: pts.filter((x) => x.status === "released" && within(x.releasedAt?.slice(0, 10), from, to)), releasedPrev: pts.filter((x) => x.status === "released" && within(x.releasedAt?.slice(0, 10), pFrom, pTo)),
    incidents: inc.filter((x) => within(x.occurredAt.slice(0, 10), from, to)), incidentsPrev: inc.filter((x) => within(x.occurredAt.slice(0, 10), pFrom, pTo)),
    spent: (rng) => sum(projects, (p) => sum(costEvents(p.id).filter(([d]) => within(d, rng[0], rng[1])), (e) => e[1])),
    raisedOn, within,
  };
}

/** KPI tile with the change against the previous period. upGood: is an increase good? */
function kpi(label, value, cur, prev, { fmt = fmtCount, upGood = true, note = "" } = {}) {
  let delta = "";
  if (prev !== undefined) {
    const d = cur - prev, good = d === 0 ? null : (d > 0) === upGood;
    delta = `<div class="kpi-delta ${good === null ? "" : good ? "up-good" : "up-bad"}">${d === 0 ? "No change" : `${d > 0 ? "▲" : "▼"} ${fmt(Math.abs(d))}`} <span class="muted">vs previous period</span></div>`;
  }
  return `<div class="metric kpi"><div class="m-label">${esc(label)}</div><div class="m-value">${esc(value)}</div>${delta}${note ? `<div class="m-note">${esc(note)}</div>` : ""}</div>`;
}

/** Sortable matrix. cols: [{ key, label, fmt, num }]. rows: [{ key, label, href, [col]: value }]. */
function matrix(rows, cols, sort, totals = true) {
  const [sk, sd] = (sort || "").split(":"), sorted = [...rows];
  if (sk) sorted.sort((a, b) => (typeof a[sk] === "string" ? String(a[sk]).localeCompare(String(b[sk])) : (a[sk] ?? 0) - (b[sk] ?? 0)) * (sd === "asc" ? 1 : -1));
  const head = cols.map((c) => { const on = sk === c.key, next = on && sd !== "asc" ? "asc" : "desc"; return `<th${c.num ? ' class="right"' : ""}><a class="sort-h" href="${insHref({ sort: `${c.key}:${next}` })}" aria-sort="${on ? (sd === "asc" ? "ascending" : "descending") : "none"}">${esc(c.label)}${on ? (sd === "asc" ? " ▲" : " ▼") : ""}</a></th>`; }).join("");
  const body = sorted.map((r) => `<tr>${cols.map((c, i) => { const v = r[c.key], txt = c.fmt ? c.fmt(v, r) : v ?? "—"; return `<td${c.num ? ' class="num"' : ""}${c.tone?.(v, r) ? ` class="num ${c.tone(v, r)}"` : ""}>${i === 0 && r.href ? `<a class="rowlink" href="${r.href}">${esc(txt)}</a>` : esc(txt)}</td>`; }).join("")}</tr>`).join("");
  const tot = totals && rows.length > 1 ? `<tfoot><tr>${cols.map((c, i) => `<td${c.num ? ' class="num"' : ""}>${i === 0 ? "Total" : c.sum ? esc(c.fmt ? c.fmt(c.sum(rows)) : c.sum(rows)) : ""}</td>`).join("")}</tr></tfoot>` : "";
  return `<div class="table-wrap"><table class="register ins-matrix" data-matrix><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${cols.length}" class="muted small">Nothing matches the filters.</td></tr>`}</tbody>${tot}</table></div>`;
}
const sumBy = (k) => (rows) => sum(rows, (r) => r[k] || 0);
const pctOf = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);

// ---- the page
function pageInsights(u, q) {
  INS = parseInsights(q);
  const s = INS, money_ = can(u, "commercial.view"), tabs = Object.entries(INS_TABS).filter(([k]) => k !== "commercial" || money_);
  if (s.tab === "commercial" && !money_) s.tab = "overview";
  const projects = listProjects(u), cos = DB.contractors, trades = uniq(DB.defects.map((d) => d.trade || "General")).sort();
  const pick = (dim, label, items) => `<details class="menu slicer"><summary class="btn btn-sm">${label}${s[dim].size ? ` <b class="count">${s[dim].size}</b>` : ""} ▾</summary><div class="menu-panel" style="width:260px;max-height:320px;overflow:auto">
    ${items.map(([k, l]) => `<label class="row small slicer-opt" style="gap:8px"><input type="checkbox" data-ins-toggle="${dim}" value="${esc(k)}"${s[dim].has(k) ? " checked" : ""}> ${esc(l)}</label>`).join("") || '<p class="small muted" style="padding:8px">None yet.</p>'}</div></details>`;
  const chip = (dim, k, l) => `<a class="chip" data-active="true" href="${insHref({ [dim]: new Set([...s[dim]].filter((x) => x !== k)) })}">${esc(l)} ${icon("x", 12)}</a>`;
  const chips = [...[...s.p].map((k) => chip("p", k, projName(k) || "Project")), ...[...s.c].map((k) => chip("c", k, contractorOf(k)?.tradingName ?? "No company")), ...[...s.t].map((k) => chip("t", k, k)),
    ...(s.b ? [`<a class="chip" data-active="true" href="${insHref({ b: "" })}">${esc(insBuckets(s.from, s.to).find((x) => x.key === s.b)?.label ?? s.b)} only ${icon("x", 12)}</a>`] : [])];
  return `${pageHeader({ title: "Insights", meta: `<span class="row wrap" style="gap:8px"><span class="live-dot${s.live ? " on" : ""}"></span><span data-ins-updated>${s.live ? "Live — refreshes every 30 seconds" : "Paused"}</span> · <a class="link small" href="${insHref({ live: !s.live })}">${s.live ? "Pause" : "Go live"}</a></span>`,
    actions: `<button class="btn" type="button" data-ins-export>${icon("download", 15)} Export table</button>` })}
  <nav class="subnav">${tabs.map(([k, l]) => `<a href="${insHref({ tab: k, sort: "" })}"${k === s.tab ? ' aria-current="page"' : ""}>${l}</a>`).join("")}</nav>
  <div class="slicers">
    <div class="row wrap" style="gap:6px">${INS_PRESETS.map(([k, l]) => `<a class="chip" data-active="${s.range === k}" href="${insHref({ range: k, b: "" })}">${l}</a>`).join("")}
      <form class="row" data-ins-range style="gap:6px"><input type="date" name="from" class="input" value="${s.from}" style="height:30px;width:140px" aria-label="From"><input type="date" name="to" class="input" value="${s.to}" style="height:30px;width:140px" aria-label="To"><button class="btn btn-sm">Apply</button></form></div>
    <div class="row wrap" style="gap:6px">${pick("p", "Projects", projects.map((p) => [p.id, p.name]))}${pick("c", "Companies", cos.map((c) => [c.id, c.tradingName]))}${pick("t", "Trades", trades.map((t) => [t, t]))}
      ${chips.join("")}${chips.length ? `<a class="link small" href="${insHref({ p: new Set(), c: new Set(), t: new Set(), b: "" })}">Clear filters</a>` : '<span class="small muted">Tip: click any bar to filter everything else by it.</span>'}</div>
  </div>
  <div id="ins-body">${insightsBody(u)}</div>`;
}

function insightsBody(u) {
  const s = INS, f = insightsFacts(u, s), bs = insBuckets(s.from, s.to), word = bucketWord(bs);
  // A visual never filters itself: the chart that drives a slicer is drawn without that slicer, and its other bars dim.
  const fx = { p: insightsFacts(u, { ...s, p: new Set() }), c: insightsFacts(u, { ...s, c: new Set() }), t: insightsFacts(u, { ...s, t: new Set() }) };
  const inB = (d, b) => d && d >= b.from && d <= b.to;
  const timeXf = { xf: "b", keys: bs.map((b) => b.key), selected: new Set(s.b ? [s.b] : []) };
  const byProject = (fn) => fx.p.projects.map((p) => [p.id, p.name, fn(p.id)]);
  const pXf = (rows) => ({ xf: "p", keys: rows.map((r) => r[0]), selected: s.p });
  const note = `${fullDate(f.from)} – ${fullDate(f.to)}`;
  const tr = (s.t.size ? " · trade filter applies to defects only" : "");
  if (s.tab === "overview") {
    const openP = byProject((id) => fx.p.open.filter((d) => d.projectId === id).length), hrsC = topN(tally(fx.c.hours, (t) => f.coOf(t.workerId) ?? "", (t) => Number(t.hours)), 6);
    const rows = f.projects.map((p) => ({ key: p.id, label: p.name, href: `#/app/projects/${p.id}`, open: f.open.filter((d) => d.projectId === p.id).length, overdue: f.overdue.filter((d) => d.projectId === p.id).length,
      raised: f.raised.filter((d) => d.projectId === p.id).length, closed: f.closed.filter((d) => d.projectId === p.id).length, hours: hoursOf(f.hours.filter((t) => t.projectId === p.id)), progress: progressOf(p).verified }));
    return `<div class="metrics">${kpi("Open defects", f.open.length, f.open.length)}${kpi("Overdue defects", f.overdue.length, f.overdue.length)}${kpi("Defects closed", f.closed.length, f.closed.length, f.closedPrev.length)}
      ${kpi("Labour hours", fmtHours(hoursOf(f.hours)), hoursOf(f.hours), hoursOf(f.hoursPrev), { fmt: fmtHours })}${kpi("Inspections released", f.released.length, f.released.length, f.releasedPrev.length)}${kpi("Safety reports", f.incidents.length, f.incidents.length, f.incidentsPrev.length, { upGood: false })}</div>
    <div class="viz-grid">
      ${vizCard(`Labour hours per ${word}`, `${note}${s.b ? "" : " · click a column to focus on it"}`, columns({ labels: bs.map((b) => b.label), tableHead: word, fmt: fmtHours, series: [{ name: "Hours", values: bs.map((b) => hoursOf(f.ts.filter((t) => inB(t.date, b)))) }], ...timeXf }))}
      ${vizCard("Open defects by project", `Now${tr}`, hbars({ cats: openP.map((r) => r[1]), series: [{ name: "Open defects", values: openP.map((r) => r[2]) }], ...pXf(openP) }))}
      ${vizCard("Hours by company", note, hbars({ cats: hrsC.map((e) => (e[0] === "Other" ? "Other" : contractorOf(e[0])?.tradingName ?? "—")), series: [{ name: "Hours", values: hrsC.map((e) => e[1]) }], fmt: fmtHours, xf: "c", keys: hrsC.map((e) => (e[0] === "Other" ? null : e[0])), selected: s.c }))}
      ${vizCard(`Defects raised vs closed per ${word}`, note, columns({ labels: bs.map((b) => b.label), tableHead: word, series: [{ name: "Raised", values: bs.map((b) => f.defects.filter((d) => inB(f.raisedOn(d), b)).length) }, { name: "Closed", values: bs.map((b) => f.defects.filter((d) => d.status === "closed" && inB(closedOn(d), b)).length) }], ...timeXf }))}
    </div>
    <section class="card"><div class="card-head"><h2>By project</h2><div class="spacer"></div><span class="small muted">Click a heading to sort · click a project to open it</span></div>
      ${matrix(rows, [{ key: "label", label: "Project" }, { key: "progress", label: "Verified %", num: true, fmt: (v) => `${v}%` }, { key: "open", label: "Open defects", num: true, sum: sumBy("open") }, { key: "overdue", label: "Overdue", num: true, sum: sumBy("overdue"), tone: (v) => (v ? "amber-text" : "") },
        { key: "raised", label: "Raised", num: true, sum: sumBy("raised") }, { key: "closed", label: "Closed", num: true, sum: sumBy("closed") }, { key: "hours", label: "Hours", num: true, fmt: (v) => fmtHours(v || 0), sum: sumBy("hours") }], s.sort || "open:desc")}</section>`;
  }
  if (s.tab === "quality") {
    const byTrade = topN(tally(fx.t.open, (d) => d.trade || "General"), 8), byCo = topN(tally(fx.c.open, (d) => d.contractorId ?? ""), 8);
    const age = (d) => Math.max(0, Math.round((D(todayYmd()) - D(f.raisedOn(d))) / 86400000)), bands = [["0–7 days", 0, 7], ["8–14 days", 8, 14], ["15–30 days", 15, 30], ["Over 30 days", 31, 1e9]];
    // what-if: weekly raise and close rates (default: average of the last 4 weeks) → backlog projection
    const w4 = addDays(todayYmd(), -27), closeAvg = Math.round((f.defects.filter((d) => d.status === "closed" && f.within(closedOn(d), w4, todayYmd())).length / 4) * 10) / 10, raiseAvg = Math.round((f.defects.filter((d) => f.within(f.raisedOn(d), w4, todayYmd())).length / 4) * 10) / 10;
    const closeR = s.wclose ?? closeAvg, raiseR = s.wraise ?? raiseAvg, net = closeR - raiseR;
    const proj = [f.open.length]; for (let i = 1; i <= 12; i++) proj.push(Math.max(0, Math.round((proj[i - 1] - net) * 10) / 10));
    const clearWeeks = net > 0 ? Math.ceil(f.open.length / net) : null;
    const rows = [...uniq(f.defects.map((d) => (s.dim === "company" ? d.contractorId ?? "" : s.dim === "trade" ? d.trade || "General" : d.projectId)))].map((k) => {
      const ds = f.defects.filter((d) => (s.dim === "company" ? (d.contractorId ?? "") === k : s.dim === "trade" ? (d.trade || "General") === k : d.projectId === k)), op = ds.filter((d) => d.status !== "closed");
      return { key: k, label: s.dim === "company" ? contractorOf(k)?.tradingName ?? "Unassigned" : s.dim === "trade" ? k : projName(k), href: s.dim === "project" ? `#/app/projects/${k}/quality` : null,
        open: op.length, overdue: op.filter((d) => isOverdue(d)).length, raised: ds.filter((d) => f.within(f.raisedOn(d), f.from, f.to)).length, closed: ds.filter((d) => d.status === "closed" && f.within(closedOn(d), f.from, f.to)).length, avgAge: op.length ? Math.round(sum(op, age) / op.length) : 0 };
    });
    return `<div class="metrics">${kpi("Open defects", f.open.length, f.open.length)}${kpi("Overdue", f.overdue.length, f.overdue.length)}${kpi("Raised", f.raised.length, f.raised.length, f.raisedPrev.length, { upGood: false })}${kpi("Closed", f.closed.length, f.closed.length, f.closedPrev.length)}
      ${kpi("Close rate", `${pctOf(f.closed.length, f.raised.length)}%`, pctOf(f.closed.length, f.raised.length), pctOf(f.closedPrev.length, f.raisedPrev.length), { fmt: (v) => `${Math.round(v)}%`, note: "Closed ÷ raised in the period" })}</div>
    <div class="viz-grid">
      ${vizCard(`Raised vs closed per ${word}`, note, columns({ labels: bs.map((b) => b.label), tableHead: word, series: [{ name: "Raised", values: bs.map((b) => f.defects.filter((d) => inB(f.raisedOn(d), b)).length) }, { name: "Closed", values: bs.map((b) => f.defects.filter((d) => d.status === "closed" && inB(closedOn(d), b)).length) }], ...timeXf }))}
      ${vizCard("Open defects by trade", "Click to filter", hbars({ cats: byTrade.map((e) => e[0]), series: [{ name: "Open", values: byTrade.map((e) => e[1]) }], xf: "t", keys: byTrade.map((e) => (e[0] === "Other" ? null : e[0])), selected: s.t }))}
      ${vizCard("Open defects by company", "Click to filter", hbars({ cats: byCo.map((e) => (e[0] === "Other" ? "Other" : contractorOf(e[0])?.tradingName ?? "Unassigned")), series: [{ name: "Open", values: byCo.map((e) => e[1]) }], xf: "c", keys: byCo.map((e) => (e[0] === "Other" ? null : e[0])), selected: s.c }))}
      ${vizCard("Age of open defects", "Days since raised", hbars({ cats: bands.map((b) => b[0]), series: [{ name: "Open defects", values: bands.map(([, a, z]) => f.open.filter((d) => age(d) >= a && age(d) <= z).length) }] }))}
    </div>
    <section class="card card-pad whatif"><div class="row wrap" style="gap:8px;margin-bottom:10px"><h2>What if</h2><span class="small muted">Change the weekly rates to see when the open defects would be cleared. Starts from the last 4 weeks: ${closeAvg} closed and ${raiseAvg} raised a week.</span></div>
      <div class="whatif-grid"><div class="stack" style="gap:14px">
        ${slider("wclose", "Defects closed per week", closeR, 0, Math.max(20, Math.ceil(closeAvg * 3)), 0.5, (v) => `${v}`)}
        ${slider("wraise", "New defects raised per week", raiseR, 0, Math.max(20, Math.ceil(raiseAvg * 3)), 0.5, (v) => `${v}`)}
        <div class="whatif-result">${clearWeeks === null ? `<b class="red-text">The backlog never clears</b><span class="small muted">More defects are raised than closed each week.</span>` : `<b>Clear in ${clearWeeks} week${clearWeeks === 1 ? "" : "s"}</b><span class="small muted">around ${fullDate(addDays(todayYmd(), clearWeeks * 7))}</span>`}</div>
        ${s.wclose != null || s.wraise != null ? `<a class="link small" href="${insHref({ wclose: null, wraise: null })}">Reset to actual rates</a>` : ""}</div>
        <div>${lines({ labels: proj.map((_, i) => (i ? dayTick(addDays(todayYmd(), i * 7)) : "Now")), tableHead: "Week", series: [{ name: "Projected open defects", values: proj }] })}</div></div></section>
    <section class="card"><div class="card-head" style="flex-wrap:wrap"><h2>Breakdown</h2><div class="spacer"></div><div class="row" style="gap:6px">${[["project", "By project"], ["company", "By company"], ["trade", "By trade"]].map(([k, l]) => `<a class="chip" data-active="${s.dim === k}" href="${insHref({ dim: k, sort: "" })}">${l}</a>`).join("")}</div></div>
      ${matrix(rows, [{ key: "label", label: s.dim === "company" ? "Company" : s.dim === "trade" ? "Trade" : "Project" }, { key: "open", label: "Open", num: true, sum: sumBy("open") }, { key: "overdue", label: "Overdue", num: true, sum: sumBy("overdue"), tone: (v) => (v ? "amber-text" : "") }, { key: "raised", label: "Raised", num: true, sum: sumBy("raised") }, { key: "closed", label: "Closed", num: true, sum: sumBy("closed") }, { key: "avgAge", label: "Avg age (days)", num: true }], s.sort || "open:desc")}</section>`;
  }
  if (s.tab === "labour") {
    const cost = can(u, "rates.manage"), topCo = topN(tally(f.hours, (t) => f.coOf(t.workerId) ?? "", (t) => Number(t.hours)), 4).map((e) => e[0]);
    const hrsP = byProject((id) => hoursOf(fx.p.hours.filter((t) => t.projectId === id)));
    const rows = uniq(f.hours.map((t) => t.workerId)).map((w) => { const list = f.hours.filter((t) => t.workerId === w); return { key: w, label: workerName(w), company: contractorOf(f.coOf(w))?.tradingName ?? "—", hours: hoursOf(list), days: uniq(list.map((t) => t.date)).length, cost: sum(list, (t) => labourCost(t)), billable: hoursOf(list.filter((t) => t.billable)) }; });
    return `<div class="metrics">${kpi("Labour hours", fmtHours(hoursOf(f.hours)), hoursOf(f.hours), hoursOf(f.hoursPrev), { fmt: fmtHours })}${kpi("People", uniq(f.hours.map((t) => t.workerId)).length, uniq(f.hours.map((t) => t.workerId)).length, uniq(f.hoursPrev.map((t) => t.workerId)).length)}
      ${kpi("Billable share", `${pctOf(hoursOf(f.hours.filter((t) => t.billable)), hoursOf(f.hours))}%`, pctOf(hoursOf(f.hours.filter((t) => t.billable)), hoursOf(f.hours)))}${cost ? kpi("Labour cost (processed)", fmtMoneyShort(sum(f.hours, labourCost)), sum(f.hours, labourCost), sum(f.hoursPrev, labourCost), { fmt: fmtMoneyShort, upGood: false }) : ""}</div>
    <div class="viz-grid">
      ${vizCard(`Hours per ${word} by company`, note, columns({ labels: bs.map((b) => b.label), tableHead: word, fmt: fmtHours, stacked: true, ...timeXf,
        series: topCo.map((k, i) => ({ name: k === "Other" ? "Other" : contractorOf(k)?.tradingName ?? "—", color: k === "Other" ? OTHER_COLOR : SERIES[i], values: bs.map((b) => hoursOf(f.ts.filter((t) => inB(t.date, b) && (k === "Other" ? !topCo.slice(0, -1).includes(f.coOf(t.workerId) ?? "") : (f.coOf(t.workerId) ?? "") === k)))) })) }))}
      ${vizCard("Hours by project", "Click to filter", hbars({ cats: hrsP.map((r) => r[1]), series: [{ name: "Hours", values: hrsP.map((r) => r[2]) }], fmt: fmtHours, ...pXf(hrsP) }))}
    </div>
    <section class="card"><div class="card-head"><h2>People</h2><div class="spacer"></div><span class="small muted">Approved and processed timesheets</span></div>
      ${matrix(rows, [{ key: "label", label: "Person" }, { key: "company", label: "Company" }, { key: "hours", label: "Hours", num: true, fmt: (v) => fmtHours(v || 0), sum: sumBy("hours") }, { key: "days", label: "Days", num: true }, { key: "billable", label: "Billable hours", num: true, fmt: (v) => fmtHours(v || 0), sum: sumBy("billable") }, ...(cost ? [{ key: "cost", label: "Labour cost", num: true, fmt: (v) => money(v || 0), sum: sumBy("cost") }] : [])], s.sort || "hours:desc")}</section>`;
  }
  // commercial (PMs and directors)
  const wi = (p) => { const c = projectCommercial(u, p.id), remaining = Math.max(0, c.forecastFinalCost - c.actual);
    const wiCost = c.actual + Math.round(remaining * (1 + s.wc / 100)), wiContract = c.revisedContract + Math.round(c.variationExposure * (s.wv / 100));
    return { key: p.id, label: p.name, href: `#/app/projects/${p.id}/commercial`, contract: c.revisedContract, cost: c.forecastFinalCost, actual: c.actual, margin: c.forecastMargin, marginPct: c.forecastMarginPct, exposure: c.variationExposure,
      wiContract, wiCost, wiMargin: wiContract - wiCost, wiMarginPct: wiContract ? ((wiContract - wiCost) / wiContract) * 100 : 0 }; };
  const base = f.projects.map(wi), all = fx.p.projects.map(wi);
  const T = (k) => sum(base, (r) => r[k]), tm = T("contract") ? (T("margin") / T("contract")) * 100 : 0, wtm = T("wiContract") ? (T("wiMargin") / T("wiContract")) * 100 : 0;
  const spentB = bs.map((b) => sum(f.projects, (p) => sum(costEvents(p.id).filter(([d]) => inB(d, b)), (e) => e[1])));
  const changed = s.wc || s.wv;
  return `<div class="metrics">${kpi("Contract value", fmtMoneyShort(T("contract")), T("contract"))}${kpi("Forecast final cost", fmtMoneyShort(T("cost")), T("cost"))}${kpi("Forecast margin", `${pct(tm)}`, tm, undefined, { note: fmtMoneyShort(T("margin")) })}
    ${kpi("Cost spent in period", fmtMoneyShort(f.spent([f.from, f.to])), f.spent([f.from, f.to]), f.spent([f.pFrom, f.pTo]), { fmt: fmtMoneyShort, upGood: false })}${kpi("Variation exposure", fmtMoneyShort(T("exposure")), T("exposure"), undefined, { note: "Unapproved" })}</div>
  <section class="card card-pad whatif"><div class="row wrap" style="gap:8px;margin-bottom:10px"><h2>What if</h2><span class="small muted">Try a change to the cost still to come, or assume some unapproved variations get approved. Nothing is saved.</span></div>
    <div class="whatif-grid"><div class="stack" style="gap:14px">
      ${slider("wc", "Cost still to come", s.wc, -20, 30, 1, (v) => `${v > 0 ? "+" : ""}${v}%`)}
      ${slider("wv", "Unapproved variations approved", s.wv, 0, 100, 5, (v) => `${v}%`)}
      <div class="whatif-result"><b>Margin ${pct(wtm)}</b><span class="small muted">${changed ? `${fmtMoneyShort(T("wiMargin") - T("margin"))} ${T("wiMargin") >= T("margin") ? "better" : "worse"} than today's forecast (${pct(tm)})` : "Same as today's forecast"}</span></div>
      ${changed ? `<a class="link small" href="${insHref({ wc: 0, wv: 0 })}">Reset</a>` : ""}</div>
      <div>${hbars({ cats: all.map((r) => r.label), series: [{ name: "Forecast margin %", values: all.map((r) => Math.round(r.marginPct * 10) / 10) }, { name: "What-if margin %", values: all.map((r) => Math.round(r.wiMarginPct * 10) / 10) }], fmt: (v) => `${v}%`, ...pXf(all.map((r) => [r.key])) })}
        ${all.some((r) => r.wiMarginPct < 0) ? `<p class="small red-text" style="margin-top:6px">${icon("alert", 13)} ${all.filter((r) => r.wiMarginPct < 0).map((r) => esc(r.label)).join(", ")} would make a loss.</p>` : ""}</div></div></section>
  <div class="viz-grid">${vizCard(`Cost spent per ${word}`, `${note} · bills, receipts, charges and labour`, columns({ labels: bs.map((b) => b.label), tableHead: word, fmt: fmtMoneyShort, series: [{ name: "Cost", values: spentB }], ...timeXf }))}
    ${vizCard("Contract vs forecast cost", "Click to filter", hbars({ cats: all.map((r) => r.label), series: [{ name: "Contract value", values: all.map((r) => r.contract) }, { name: "Forecast final cost", values: all.map((r) => r.cost) }], fmt: fmtMoneyShort, ...pXf(all.map((r) => [r.key])) }))}</div>
  <section class="card"><div class="card-head"><h2>By project</h2></div>
    ${matrix(base, [{ key: "label", label: "Project" }, { key: "contract", label: "Contract", num: true, fmt: (v) => money(v), sum: sumBy("contract") }, { key: "actual", label: "Actual cost", num: true, fmt: (v) => money(v), sum: sumBy("actual") }, { key: "cost", label: "Forecast cost", num: true, fmt: (v) => money(v), sum: sumBy("cost") },
      { key: "marginPct", label: "Margin", num: true, fmt: (v) => pct(v), tone: (v) => (v < 0 ? "red-text" : "") }, ...(changed ? [{ key: "wiMarginPct", label: "What-if margin", num: true, fmt: (v) => pct(v), tone: (v) => (v < 0 ? "red-text" : "") }] : []), { key: "exposure", label: "Exposure", num: true, fmt: (v) => money(v), sum: sumBy("exposure") }], s.sort || "contract:desc")}</section>`;
}
const slider = (name, label, value, min, max, step, fmt) => `<label class="whatif-slider"><span class="row" style="justify-content:space-between"><span class="small">${label}</span><b class="small" data-slider-val="${name}">${esc(fmt(value))}</b></span>
  <input type="range" name="${name}" min="${min}" max="${max}" step="${step}" value="${value}" data-ins-slider data-fmt="${name === "wc" ? "signedpct" : name === "wv" ? "pct" : "num"}" aria-label="${esc(label)}"></label>`;

// ---- interactions
function insUpdate(patch, { full = true } = {}) {
  Object.assign(INS, patch);
  history.replaceState(null, "", `${appUrl()}#/app/insights?${insightsQuery()}`);
  if (full) render();
  else { const body = document.getElementById("ins-body"); if (body) body.innerHTML = insightsBody(currentUser()); }
}
function insToggle(dim, key) {
  if (!key) return;
  const set = new Set(INS[dim]);
  if (dim === "b") { insUpdate({ b: INS.b === key ? "" : key }); return; }
  set.has(key) ? set.delete(key) : set.add(key);
  insUpdate({ [dim]: set });
}
document.addEventListener("click", (e) => {
  const x = e.target.closest?.("[data-xf]");
  if (x && document.getElementById("ins-body")?.contains(x)) { e.preventDefault(); insToggle(x.dataset.xf, x.dataset.key); return; }
  if (e.target.closest?.("[data-ins-export]")) exportInsights();
});
document.addEventListener("keydown", (e) => {
  const x = e.target.closest?.("[data-xf]");
  if (x && (e.key === "Enter" || e.key === " ") && document.getElementById("ins-body")?.contains(x)) { e.preventDefault(); insToggle(x.dataset.xf, x.dataset.key); }
});
document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.matches?.("[data-ins-toggle]")) { const set = new Set(INS[t.dataset.insToggle]); t.checked ? set.add(t.value) : set.delete(t.value); INS[t.dataset.insToggle] = set; history.replaceState(null, "", `${appUrl()}#/app/insights?${insightsQuery()}`); const b = document.getElementById("ins-body"); if (b) b.innerHTML = insightsBody(currentUser()); }
  if (t.matches?.("[data-ins-slider]")) insUpdate({}, { full: true });
});
// Slicer menus apply as you tick; the page re-renders (chips etc.) when the menu closes.
document.addEventListener("toggle", (e) => { if (e.target.matches?.(".slicer") && !e.target.open && INS) render(); }, true);
document.addEventListener("input", (e) => {
  const t = e.target;
  if (!t.matches?.("[data-ins-slider]")) return;
  const v = Number(t.value), fmt = t.dataset.fmt === "signedpct" ? `${v > 0 ? "+" : ""}${v}%` : t.dataset.fmt === "pct" ? `${v}%` : `${v}`;
  document.querySelectorAll(`[data-slider-val="${t.name}"]`).forEach((el) => (el.textContent = fmt));
  // Sliders recompute the visuals as you drag (the slider itself stays put).
  Object.assign(INS, { [t.name]: v });
  history.replaceState(null, "", `${appUrl()}#/app/insights?${insightsQuery()}`);
  const holder = t.closest(".whatif");
  const body = document.getElementById("ins-body"), y = window.scrollY;
  if (!body || !holder) return;
  const keep = t.name, val = t.value;
  body.innerHTML = insightsBody(currentUser());
  const again = body.querySelector(`[data-ins-slider][name="${keep}"]`);
  if (again) { again.value = val; again.focus({ preventScroll: true }); }
  window.scrollTo(0, y);
});
document.addEventListener("submit", (e) => {
  if (!e.target.matches?.("[data-ins-range]")) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const fd = new FormData(e.target), from = String(fd.get("from")), to = String(fd.get("to"));
  if (!from || !to || from > to) { toast("Choose a start date before the end date.", "error"); return; }
  insUpdate({ range: "", from, to, b: "" });
}, true);

function exportInsights() {
  const t = document.querySelector("[data-matrix]");
  if (!t) return;
  const rows = [...t.querySelectorAll("tr")].map((tr) => [...tr.children].map((c) => c.textContent.replace(/[▲▼]/g, "").trim()));
  downloadCsv(`BuildOS-insights-${INS.tab}-${INS.from}-to-${INS.to}.csv`, rows);
}

/** Live mode: reload the company's data every 30 s while the page is open and visible, then redraw the visuals. */
function afterInsightsRender() {
  clearInterval(insTimer); insTimer = null;
  if (!document.getElementById("ins-body") || !INS?.live) return;
  insLoadedAt = Date.now();
  const stamp = () => { const el = document.querySelector("[data-ins-updated]"); if (el) el.textContent = `Live — updated ${Math.round((Date.now() - insLoadedAt) / 1000)} s ago`; };
  insTimer = setInterval(async () => {
    if (document.visibilityState !== "visible" || !document.getElementById("ins-body")) return;
    if (Date.now() - insLoadedAt >= 30000) {
      if (document.querySelector("[data-ins-slider]:active, .slicer[open]")) return;
      try { await refresh(); insLoadedAt = Date.now(); const b = document.getElementById("ins-body"); if (b) { const y = window.scrollY; b.innerHTML = insightsBody(currentUser()); window.scrollTo(0, y); } } catch { /* keep the last view */ }
    }
    stamp();
  }, 5000);
}
