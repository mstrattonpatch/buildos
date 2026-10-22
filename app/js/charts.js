// ===================================================== charts
// Small, dependency-free charts. Every chart has a legend (2+ series), a hover/focus
// tooltip and a "Show as table" view, so no value depends on colour or hovering alone.
// Series colours are a validated colour-blind-safe order (blue, orange, aqua, yellow);
// two of them are under 3:1 on white, which the legend + table view make up for.

const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"];
const OTHER_COLOR = "#c3c2b7";
const GRID = "#e1e0d9", AXIS = "#c3c2b7";

/** Clean axis ticks from 0 to just above max (steps of 1, 2, 2.5 or 5 × 10ⁿ). */
function niceTicks(max, count = 4, whole = false) {
  if (!(max > 0)) return [0, 1];
  const raw = max / count, mag = 10 ** Math.floor(Math.log10(raw));
  // Counts get whole-number steps only (no 2.5 steps that round to 3, 5, 8).
  const step = Math.max(whole ? 1 : 0, [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw && (!whole || Number.isInteger(s))) ?? 10 * mag);
  const out = [];
  for (let v = 0; v < max + step * 0.999; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}
const fmtMoneyShort = (c) => money(c, { compact: true });
const fmtHours = (h) => `${Math.round(h * 10) / 10} h`;
const fmtCount = (n) => String(Math.round(n));

const tipAttr = (title, rows) => `data-tip="${esc(JSON.stringify({ t: title, r: rows }))}" tabindex="0"`;
const legend = (series) => series.length < 2 ? "" : `<div class="viz-legend">${series.map((s) => `<span><i style="background:${s.color}"${s.line ? ' class="line-key"' : ""}></i>${esc(s.name)}</span>`).join("")}</div>`;
function vizTable(head, rows) {
  return `<details class="viz-table no-print-closed"><summary>Show as table</summary><div class="table-wrap"><table class="register small"><thead><tr>${head.map((h, i) => `<th${i ? ' class="right"' : ""}>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="num"' : ""}>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details>`;
}
/** A chart card: title, optional note, the chart, legend and table view. */
const vizCard = (title, sub, body, extra = "") => `<section class="card viz-card"><div class="viz-head"><h3>${title}</h3>${sub ? `<span class="small muted">${sub}</span>` : ""}</div>${body}${extra}</section>`;
const vizEmpty = (msg) => `<p class="small muted viz-empty">${esc(msg)}</p>`;

/**
 * Horizontal bars by category (HTML, so labels stay crisp). series: [{ name, values, color }].
 * Grouped when there is more than one series. Value printed at each bar's tip.
 */
function hbars({ cats, series, fmt = fmtCount, max }) {
  if (!cats.length) return vizEmpty("Nothing to show yet.");
  series = series.map((s, i) => ({ color: SERIES[i], ...s }));
  const top = max ?? (Math.max(...series.flatMap((s) => s.values), 0) || 1);
  const rows = cats.map((c, ci) => `<div class="hb-row" ${tipAttr(c, series.map((s) => [s.name, fmt(s.values[ci]), s.color]))}><div class="hb-label">${esc(c)}</div><div class="hb-bars">${series.map((s) => {
    const v = s.values[ci] || 0, w = Math.max(0, Math.min(78, (v / top) * 78));
    return `<div class="hb-track"><span class="hb-bar" style="width:${w}%;background:${s.color}"></span><span class="hb-val">${esc(fmt(v))}</span></div>`;
  }).join("")}</div></div>`).join("");
  return `<div class="hb">${rows}</div>${legend(series)}${vizTable(["", ...series.map((s) => s.name)], cats.map((c, ci) => [c, ...series.map((s) => fmt(s.values[ci] || 0))]))}`;
}

/** Shared frame for column and line charts: y gridlines + ticks, x labels, a crosshair. */
function frame(labels, top, fmt, W = 400, H = 200) {
  const L = 44, R = 10, T = 12, B = 24, pw = W - L - R, ph = H - T - B, ticks = niceTicks(top, 4, fmt === fmtCount), ymax = ticks.at(-1) || 1;
  const y = (v) => T + ph - (v / ymax) * ph, step = pw / Math.max(1, labels.length), every = Math.ceil(labels.length / 6);
  const grid = ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="${t ? GRID : AXIS}" stroke-width="1"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end" class="viz-tick">${esc(fmt(t))}</text>`).join("");
  const xl = labels.map((l, i) => (i % every ? "" : `<text x="${L + step * i + step / 2}" y="${H - 8}" text-anchor="middle" class="viz-tick">${esc(l)}</text>`)).join("");
  return { L, T, pw, ph, step, y, W, H, chrome: grid + xl, cross: `<line class="viz-cross" x1="0" x2="0" y1="${T}" y2="${T + ph}" stroke="${AXIS}" stroke-width="1" visibility="hidden"/>` };
}
/** One transparent hit column per x position; it carries the tooltip for every series there. */
const hitCols = (f, labels, series, fmt, titles = labels) => labels.map((l, i) => `<rect class="viz-hit" x="${f.L + f.step * i}" y="${f.T}" width="${f.step}" height="${f.ph}" fill="transparent" data-cx="${f.L + f.step * i + f.step / 2}" ${tipAttr(titles[i], series.map((s) => [s.name, fmt(s.values[i] || 0), s.color]))}/>`).join("");
const roundTop = (x, y, w, h, r) => (h <= 0 ? "" : h < r ? `M${x},${y + h}V${y}H${x + w}V${y + h}Z` : `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`);

/** Columns over time. Grouped by default; stacked: true stacks the series with 2px gaps. */
function columns({ labels, series, fmt = fmtCount, stacked = false, tableHead = "", titles = labels }) {
  if (!labels.length || series.every((s) => s.values.every((v) => !v))) return vizEmpty("Nothing recorded in this period.");
  series = series.map((s, i) => ({ color: SERIES[i], ...s }));
  const top = stacked ? Math.max(...labels.map((_, i) => sum(series, (s) => s.values[i] || 0))) : Math.max(...series.flatMap((s) => s.values));
  const f = frame(labels, top, fmt);
  const band = Math.min(f.step * 0.7, stacked ? 24 : 24 * series.length + 2 * (series.length - 1));
  const marks = labels.map((_, i) => {
    const x0 = f.L + f.step * i + (f.step - band) / 2;
    if (stacked) {
      let acc = 0;
      const segs = series.map((s, si) => ({ s, v: s.values[i] || 0, si })).filter((x) => x.v > 0);
      return segs.map(({ s, v }, k) => {
        const yTop = f.y(acc + v), yBot = f.y(acc) - (acc ? 2 : 0); acc += v;
        return k === segs.length - 1 ? `<path d="${roundTop(x0, yTop, band, yBot - yTop, 4)}" fill="${s.color}"/>` : `<rect x="${x0}" y="${yTop}" width="${band}" height="${Math.max(0, yBot - yTop)}" fill="${s.color}"/>`;
      }).join("");
    }
    const bw = (band - 2 * (series.length - 1)) / series.length;
    return series.map((s, si) => { const v = s.values[i] || 0, yy = f.y(v); return `<path d="${roundTop(x0 + si * (bw + 2), yy, bw, f.T + f.ph - yy, 4)}" fill="${s.color}"/>`; }).join("");
  }).join("");
  return `<div class="viz-svg"><svg viewBox="0 0 ${f.W} ${f.H}" preserveAspectRatio="xMinYMid meet" role="img" aria-label="Column chart">${f.chrome}${marks}${f.cross}${hitCols(f, labels, series, fmt, titles)}</svg></div>${legend(series)}${vizTable([tableHead, ...series.map((s) => s.name)], labels.map((l, i) => [titles[i], ...series.map((s) => fmt(s.values[i] || 0))]))}`;
}

/** Lines over time; the last point of each series is marked and labelled. ref = { name, value } draws a reference rule. */
function lines({ labels, series, fmt = fmtCount, ref = null, tableHead = "" }) {
  if (labels.length < 2) return vizEmpty("Not enough history yet.");
  series = series.map((s, i) => ({ color: SERIES[i], line: true, ...s }));
  const top = Math.max(...series.flatMap((s) => s.values), ref?.value ?? 0);
  const f = frame(labels, top, fmt), x = (i) => f.L + f.step * i + f.step / 2;
  const paths = series.map((s) => {
    const d = s.values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${f.y(v || 0).toFixed(1)}`).join("");
    const li = s.values.length - 1, lv = s.values[li] || 0;
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${x(li)}" cy="${f.y(lv)}" r="4" fill="${s.color}" stroke="#fff" stroke-width="2"/><text x="${x(li) - 8}" y="${f.y(lv) - 10}" text-anchor="end" class="viz-label">${esc(fmt(lv))}</text>`;
  }).join("");
  const rule = ref ? `<line x1="${f.L}" x2="${f.W - 12}" y1="${f.y(ref.value)}" y2="${f.y(ref.value)}" stroke="#52514e" stroke-width="1"/><text x="${f.L + 4}" y="${f.y(ref.value) - 6}" class="viz-label">${esc(ref.name)} ${esc(fmt(ref.value))}</text>` : "";
  return `<div class="viz-svg"><svg viewBox="0 0 ${f.W} ${f.H}" preserveAspectRatio="xMinYMid meet" role="img" aria-label="Line chart">${f.chrome}${rule}${paths}${f.cross}${hitCols(f, labels, series, fmt)}</svg></div>${legend(series)}${vizTable([tableHead, ...series.map((s) => s.name)], labels.map((l, i) => [l, ...series.map((s) => fmt(s.values[i] || 0))]))}`;
}

/** The top n categories by value, the rest folded into "Other" (never a generated colour). */
function topN(entries, n = 6) {
  const sorted = [...entries].sort((a, b) => b[1] - a[1]);
  if (sorted.length <= n) return sorted;
  return [...sorted.slice(0, n - 1), ["Other", sum(sorted.slice(n - 1), (e) => e[1])]];
}
const tally = (list, key, val = () => 1) => { const m = new Map(); for (const x of list) m.set(key(x), (m.get(key(x)) || 0) + val(x)); return [...m.entries()]; };

// ---- tooltip (one for the page; text set with textContent)
(function vizTooltip() {
  const tip = document.createElement("div");
  tip.className = "viz-tip"; tip.setAttribute("role", "tooltip"); tip.hidden = true;
  document.addEventListener("DOMContentLoaded", () => document.body.appendChild(tip));
  let cur = null;
  const show = (el, x, y) => {
    let d; try { d = JSON.parse(el.dataset.tip); } catch { return; }
    if (cur !== el) {
      tip.replaceChildren();
      const h = document.createElement("div"); h.className = "viz-tip-t"; h.textContent = d.t; tip.appendChild(h);
      for (const [name, val, color] of d.r) {
        const row = document.createElement("div"), key = document.createElement("i"), v = document.createElement("b"), n = document.createElement("span");
        key.style.background = color; v.textContent = val; n.textContent = name;
        row.append(key, v, n); tip.appendChild(row);
      }
      cur = el;
    }
    tip.hidden = false;
    const r = tip.getBoundingClientRect(), left = Math.min(window.innerWidth - r.width - 8, x + 14), top = y - r.height - 12 < 4 ? y + 16 : y - r.height - 12;
    tip.style.left = `${Math.max(8, left)}px`; tip.style.top = `${top}px`;
    const cross = el.closest("svg")?.querySelector(".viz-cross");
    if (cross && el.dataset.cx) { cross.setAttribute("x1", el.dataset.cx); cross.setAttribute("x2", el.dataset.cx); cross.setAttribute("visibility", "visible"); }
    el.classList.add("viz-on");
  };
  const hide = () => {
    tip.hidden = true;
    if (cur) { cur.classList.remove("viz-on"); cur.closest("svg")?.querySelector(".viz-cross")?.setAttribute("visibility", "hidden"); }
    cur = null;
  };
  document.addEventListener("pointermove", (e) => { const el = e.target.closest?.("[data-tip]"); if (el) show(el, e.clientX, e.clientY); else if (cur) hide(); });
  document.addEventListener("focusin", (e) => { const el = e.target.closest?.("[data-tip]"); if (el) { const b = el.getBoundingClientRect(); show(el, b.left + b.width / 2, b.top); } });
  document.addEventListener("focusout", hide);
  window.addEventListener("scroll", hide, { passive: true });
  window.addEventListener("hashchange", hide);
  window.hideVizTip = hide;
})();

// ===================================================== dashboard data
const daysBetweenYmd = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };
const weekStarts = (n, end = todayYmd()) => { const last = weekStart(end); return Array.from({ length: n }, (_, i) => addDays(last, -7 * (n - 1 - i))); };
const dayTick = (d) => D(d).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
const closedOn = (d) => { const a = DB.audit.find((x) => x.recordId === d.id && x.toStatus === "closed"); return a ? ymd(new Date(a.at)) : null; };
const hoursOf = (list) => sum(list, (t) => Number(t.hours));
const liveTs = (pid) => DB.timesheets.filter((t) => (!pid || t.projectId === pid) && (t.status === "approved" || t.status === "processed"));
/** Dated cost events for a project (approved bills, receipts, internal charges, processed labour, less agreed backcharges). */
function costEvents(pid) {
  return [
    ...DB.bills.filter((b) => b.projectId === pid && (b.status === "approved" || b.status === "paid")).map((b) => [b.invoiceDate, b.amount]),
    ...DB.receipts.filter((x) => x.projectId === pid && x.status === "approved").map((x) => [x.date, x.amount]),
    ...DB.internalCharges.filter((x) => x.projectId === pid).map((x) => [x.date, x.amount]),
    ...DB.timesheets.filter((t) => t.projectId === pid && t.status === "processed").map((t) => [t.date, labourCost(t)]),
    ...DB.backcharges.filter((x) => x.projectId === pid && x.status === "agreed").map((x) => [ymd(new Date(x.decidedAt || x.raisedAt)), -x.amount]),
  ];
}
/** Cumulative actual cost by week (opening figures on budget lines count from the start). */
function cumulativeCost(pid, weeks = 12) {
  const ws = weekStarts(weeks), ev = costEvents(pid), opening = sum(DB.budgetLines.filter((l) => l.projectId === pid), (l) => l.actual || 0);
  let base = opening + sum(ev.filter(([d]) => d < ws[0]), (e) => e[1]);
  return { labels: ws.map(dayTick), values: ws.map((w) => (base += sum(ev.filter(([d]) => d >= w && d <= addDays(w, 6)), (e) => e[1]))) };
}

function companyDashboard(u) {
  const projects = listProjects(u), money_ = can(u, "commercial.view"), cards = [];
  if (money_) {
    const pos = projects.map((p) => ({ p, c: projectCommercial(u, p.id) })).filter((x) => x.c);
    cards.push(vizCard("Contract value vs forecast cost", "By project · forecast over contract means a loss", hbars({ cats: pos.map((x) => x.p.name), series: [{ name: "Contract value", values: pos.map((x) => x.c.revisedContract) }, { name: "Forecast final cost", values: pos.map((x) => x.c.forecastFinalCost) }], fmt: fmtMoneyShort })));
  }
  const od = projects.map((p) => { const open = openDefects(u, p.id), over = overdueDefects(u, p.id).length; return [p.name, open.length - over, over]; });
  cards.push(vizCard("Open defects", "By project · overdue = open and past its due date", hbars({ cats: od.map((x) => x[0]), series: [{ name: "Open, on time", values: od.map((x) => x[1]) }, { name: "Overdue", values: od.map((x) => x[2]) }] })));
  const ws = weekStarts(8), ts = liveTs(), top = topN(tally(ts.filter((t) => t.date >= ws[0]), (t) => projName(t.projectId), (t) => Number(t.hours)), 4).map((e) => e[0]);
  cards.push(vizCard("Labour hours", "Approved timesheets per week, last 8 weeks", columns({ labels: ws.map(dayTick), tableHead: "Week of", stacked: true, fmt: fmtHours,
    series: top.map((name, i) => ({ name, color: name === "Other" ? OTHER_COLOR : SERIES[i], values: ws.map((w) => hoursOf(ts.filter((t) => t.date >= w && t.date <= addDays(w, 6) && (name === "Other" ? !top.slice(0, -1).includes(projName(t.projectId)) : projName(t.projectId) === name)))) })) })));
  const ds = DB.defects.filter((d) => projects.some((p) => p.id === d.projectId) && d.status !== "draft");
  cards.push(vizCard("Defects raised vs closed", "Per week, last 8 weeks", columns({ labels: ws.map(dayTick), tableHead: "Week of", series: [
    { name: "Raised", values: ws.map((w) => ds.filter((d) => { const r = ymd(new Date(d.raisedAt)); return r >= w && r <= addDays(w, 6); }).length) },
    { name: "Closed", values: ws.map((w) => ds.filter((d) => { const c = d.status === "closed" && closedOn(d); return c && c >= w && c <= addDays(w, 6); }).length) }] })));
  if (money_) {
    const cl = DB.claims.filter((c) => c.status !== "draft").sort((a, b) => (a.periodEnd || "").localeCompare(b.periodEnd || "")).slice(-8);
    cards.push(vizCard("Progress claims", "Last 8 claims · claimed vs certified (excl. GST)", columns({ labels: cl.map((c) => c.ref), titles: cl.map((c) => `${projName(c.projectId)} ${c.ref}`), tableHead: "Claim", fmt: fmtMoneyShort,
      series: [{ name: "Claimed", values: cl.map((c) => c.claimed) }, { name: "Certified", values: cl.map((c) => c.certified ?? 0) }] })));
  }
  return `<div class="viz-grid">${cards.join("")}</div>`;
}

function projectDashboard(u, p) {
  const money_ = can(u, "commercial.view"), cards = [];
  if (money_) {
    const led = costLedger(p.id).rows.filter((r) => r.budget || r.forecast).slice(0, 8);
    cards.push(vizCard("Budget vs forecast by cost code", "Forecast over budget needs action", hbars({ cats: led.map((r) => `${r.code}${r.description ? ` ${r.description}` : ""}`), series: [{ name: "Budget", values: led.map((r) => r.budget) }, { name: "Forecast final", values: led.map((r) => r.forecast) }], fmt: fmtMoneyShort })));
    const cc = cumulativeCost(p.id), budget = sum(DB.budgetLines.filter((l) => l.projectId === p.id), (l) => l.originalBudget || 0);
    cards.push(vizCard("Cost to date", "Cumulative actual cost by week, against the total budget", lines({ labels: cc.labels, tableHead: "Week of", fmt: fmtMoneyShort, series: [{ name: "Actual cost to date", values: cc.values }], ref: budget ? { name: "Budget", value: budget } : null })));
  }
  const days = daysBetweenYmd(addDays(todayYmd(), -13), todayYmd()), ts = liveTs(p.id);
  cards.push(vizCard("Labour hours", "Approved timesheets per day, last 14 days", columns({ labels: days.map(dayTick), tableHead: "Day", fmt: fmtHours, series: [{ name: "Hours", values: days.map((d) => hoursOf(ts.filter((t) => t.date === d))) }] })));
  const byTrade = topN(tally(openDefects(u, p.id), (d) => d.trade || "General"));
  cards.push(vizCard("Open defects by trade", "Not closed and not draft", hbars({ cats: byTrade.map((e) => e[0]), series: [{ name: "Open defects", values: byTrade.map((e) => e[1]) }] })));
  return `<div class="viz-grid">${cards.join("")}</div>`;
}
