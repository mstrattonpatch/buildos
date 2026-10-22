"use strict";
/* =====================================================================
   BuildOS — shared helpers, display rules and the sample dataset.
   Data lives in Supabase (see data.js). The rules here only decide what
   to show; the database functions enforce every change.
   Money is stored in cents.
   ===================================================================== */

// ------------------------------------------------------------- utilities
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0);
const uniq = (xs) => [...new Set(xs)];
const pad = (n) => String(n).padStart(2, "0");
/** Local calendar date, YYYY-MM-DD. */
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Parse a date-only string as a local date (not UTC), anything else normally. */
const D = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) : new Date(s));
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
const todayYmd = () => ymd(new Date());

function money(cents, o = {}) {
  const dollars = cents / 100, abs = Math.abs(dollars);
  const sign = dollars < 0 ? "-" : o.sign && dollars > 0 ? "+" : "";
  if (o.compact) {
    if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}m`;
    if (abs >= 1e3) return `${sign}$${Math.round(abs / 1e3)}k`;
  }
  return `${sign}$${abs.toLocaleString("en-AU", { maximumFractionDigits: 0 })}`;
}
const moneyLimit = (c) => (c === undefined ? "none" : Number.isFinite(c) ? money(c) : "unlimited");
const pct = (n, d = 1) => `${n.toFixed(d)}%`;
const shortDate = (s) => D(s).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
const dayMonth = (s) => D(s).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
const longToday = () => new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });
const dateTime = (s) => new Date(s).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
const timeOf = (s) => new Date(s).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" });
function timeAgo(s) {
  const mins = Math.round((Date.now() - new Date(s)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}
function dueLabel(s) {
  if (!s) return "—";
  const diff = daysBetween(new Date(), D(s));
  if (diff === 0) return "Today";
  if (diff < 0) return `${-diff}d ago`;
  if (diff === 1) return "Tomorrow";
  return shortDate(s);
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const words = (s) => s.replace(/_/g, " ");

// ------------------------------------------------------------------ icons
const ICONS = {
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkcircle: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
  dashed: '<circle cx="12" cy="12" r="9" stroke-dasharray="4 3"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  cloudoff: '<path d="m2 2 20 20"/><path d="M5.78 5.78A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.31-.2"/><path d="M21.53 16.2A4.5 4.5 0 0 0 17.5 10h-1.79A7 7 0 0 0 9.6 5.06"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  xcircle: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  arrowleft: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  arrowright: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  listchecks: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  chart: '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
  clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  hardhat: '<path d="M2 18a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v2z"/><path d="M10 10V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5"/><path d="M4 15v-3a6 6 0 0 1 6-6"/><path d="M14 6a6 6 0 0 1 6 6v3"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  dollar: '<path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  notebook: '<path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4"/><path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><path d="M21.38 5.63a1 1 0 0 0-3-3l-5.01 5.01a2 2 0 0 0-.51.85l-.84 2.87a.5.5 0 0 0 .62.62l2.87-.84a2 2 0 0 0 .85-.5z"/>',
  package: '<path d="m16 16 2 2 4-4"/><path d="M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14"/><path d="M3.29 7 12 12l8.71-5"/><path d="M12 22V12"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  qr: '<rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  mappin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  user: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  menu: '<path d="M4 12h16"/><path d="M4 6h16"/><path d="M4 18h16"/>',
  rotate: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  phone: '<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>',
  align: '<path d="M15 12H3"/><path d="M17 18H3"/><path d="M21 6H3"/>',
  filewarn: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  octagon: '<path d="M12 16h.01"/><path d="M12 8v4"/><path d="M15.31 2a2 2 0 0 1 1.42.59l4.68 4.68A2 2 0 0 1 22 8.69v6.62a2 2 0 0 1-.59 1.42l-4.68 4.68a2 2 0 0 1-1.42.59H8.69a2 2 0 0 1-1.42-.59l-4.68-4.68A2 2 0 0 1 2 15.31V8.69a2 2 0 0 1 .59-1.42l4.68-4.68A2 2 0 0 1 8.69 2z"/>',
};
const icon = (n, size = 16, style = "") => `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${style ? ` style="${style}"` : ""}>${ICONS[n] || ""}</svg>`;

// ------------------------------------------------------------- seed data
// The sample project an admin can load into an empty company. Dates are
// relative to the day it is loaded. Converted for the database by
// samplePayload() in data.js.
function createSeed(now = new Date()) {
  const day = (offset, hour = 9, minute = 0) => { const d = new Date(now); d.setDate(d.getDate() + offset); d.setHours(hour, minute, 0, 0); return d.toISOString(); };
  const date = (offset) => { const d = new Date(now); d.setDate(d.getDate() + offset); return ymd(d); };
  const minsAgo = (m) => new Date(now.getTime() - m * 60000).toISOString();
  const $m = (x) => Math.round(x * 1e6 * 100);
  const $d = (x) => Math.round(x * 100);
  const o = "org_1";
  const org = { id: o, name: "Demo Builders Pty Ltd", abn: "00 000 000 000" };

  const users = [
    { id: "u_dir", orgId: o, name: "Alex Chen", initials: "AC", role: "director", title: "Construction director" },
    { id: "u_pm", orgId: o, name: "M. Stratton", initials: "MS", role: "project_manager", title: "Project manager" },
    { id: "u_sup", orgId: o, name: "Dana Morris", initials: "DM", role: "site_supervisor", title: "Site supervisor" },
    { id: "u_qm", orgId: o, name: "Priya Nair", initials: "PN", role: "quality_manager", title: "Quality manager" },
    { id: "u_sub", orgId: o, name: "Jordan Lee", initials: "JL", role: "subcontractor_admin", title: "Contracts admin · AquaSeal", contractorId: "c_wp" },
    { id: "u_wkr", orgId: o, name: "Sam Okafor", initials: "SO", role: "worker", title: "Concreter · Solid Pour", workerId: "w_co1" },
  ];

  const con = (id, name, trade, pl, wc) => ({
    id, orgId: o, legalName: `${name} Pty Ltd`, tradingName: name, abn: "00 000 000 000", trade,
    insurances: [{ type: "Public liability", expires: date(pl), verified: true }, { type: "Workers comp", expires: date(wc), verified: true }],
  });
  const contractors = [
    con("c_wp", "AquaSeal Waterproofing", "Waterproofing", 220, 180), con("c_pl", "Riverbend Plumbing", "Plumbing", 140, 300),
    con("c_ti", "Tile & Stone Co", "Tiling", 260, 200), con("c_co", "Solid Pour Concreting", "Concrete", 90, 160),
    con("c_el", "Brightline Electrical", "Electrical", -3, 210), con("c_sc", "Highreach Scaffolding", "Scaffolding", 190, 12),
    con("c_st", "Steelfix Reinforcing", "Reinforcement", 150, 240), con("c_ca", "Northside Carpentry", "Carpentry", 300, 280),
    con("c_fo", "FormRight Formwork", "Formwork", 120, 150),
  ];

  const projects = [
    { id: "p_riv", orgId: o, code: "P-2041", name: "Riverside Apartments", address: "14 Wharf Rd, Riverside NSW", client: "Harbourview Developments", type: "Residential", status: "construction", pmId: "u_pm", contractSum: $m(18.0), startDate: date(-260), pcDate: date(234), plannedProgress: 62, verifiedProgress: 55, nextMilestone: { name: "L4 slab pour", date: date(2) }, weather: "Fine, 24°C" },
    { id: "p_har", orgId: o, code: "P-2038", name: "Harbour St Fit-out", address: "200 Harbour St, Sydney NSW", client: "Meridian Property Group", type: "Commercial", status: "construction", pmId: "u_pm", contractSum: $m(4.15), startDate: date(-150), pcDate: date(23), plannedProgress: 81, verifiedProgress: 70, nextMilestone: { name: "Practical completion", date: date(23) } },
    { id: "p_nor", orgId: o, code: "P-2044", name: "Northgate Warehouse", address: "8 Logistics Dr, Northgate NSW", client: "Coastline Logistics", type: "Industrial", status: "construction", pmId: "u_pm", contractSum: $m(9.7), startDate: date(-90), pcDate: date(200), plannedProgress: 31, verifiedProgress: 31, nextMilestone: { name: "Portal frames", date: date(12) } },
    { id: "p_elm", orgId: o, code: "P-2046", name: "Elm Grove Townhouses", address: "31 Elm Grove, Westfield NSW", client: "Elm Grove Living", type: "Residential", status: "construction", pmId: "u_pm", contractSum: $m(6.1), startDate: date(-40), pcDate: date(320), plannedProgress: 12, verifiedProgress: 12, nextMilestone: { name: "Slab on ground", date: date(8) } },
  ];

  const loc = (id, projectId, building, level, zone) => ({ id, projectId, building, level, zone });
  const locations = [
    loc("l_rb1", "p_riv", "B", "L1", "Units 101–108"), loc("l_rb2", "p_riv", "B", "L2", "Units 201–208"),
    loc("l_rb3", "p_riv", "B", "L3", "Units 301–308"), loc("l_rb3c", "p_riv", "B", "L3", "Corridor"),
    loc("l_rb4", "p_riv", "B", "L4", "Slab"), loc("l_h1", "p_har", "Tower", "L12", "North wing"),
    loc("l_h2", "p_har", "Tower", "L12", "South wing"), loc("l_n1", "p_nor", "Main", "Ground", "Grid A–F"),
    loc("l_e1", "p_elm", "Lot 1–6", "Ground", "Slab"),
  ];

  // workers & credentials
  const workers = [], credentials = [];
  const first = ["Liam", "Noah", "Mia", "Ava", "Leo", "Kai", "Zoe", "Eli", "Ivy", "Max", "Ruby", "Jack", "Ella", "Theo", "Nina", "Owen", "Isla", "Finn", "Luca", "Ari"];
  const last = ["Tran", "Nguyen", "Smith", "Kelly", "Brown", "Singh", "Wilson", "Martin", "Park", "Rossi", "Ali", "Cooper", "Walsh", "Reid", "Shaw"];
  let n = 0;
  for (const [cid, size] of [["c_co", 9], ["c_st", 7], ["c_fo", 8], ["c_wp", 5], ["c_pl", 6], ["c_el", 6], ["c_sc", 4]]) {
    for (let i = 1; i <= size; i++) {
      const id = `w_${cid.slice(2)}${i}`;
      const name = id === "w_co1" ? "Sam Okafor" : id === "w_sc2" ? "J. Tran" : `${first[n % first.length]} ${last[(n * 7) % last.length]}`;
      n++;
      // One concreter is missing the Riverside induction (drives a readiness item).
      workers.push({ id, name, contractorId: cid, phone: "04xx xxx xxx", inductedProjectIds: id === "w_co9" ? ["p_nor"] : ["p_riv", "p_nor"] });
      credentials.push({ id: `cr_${id}_wc`, workerId: id, type: "White Card", number: `WC${100000 + n}`, status: "verified", verifiedBy: "u_sup", verifiedMethod: "Sighted original" });
    }
  }
  credentials.push(
    { id: "cr_ewp_sam", workerId: "w_co1", type: "EWP licence", number: "HRW-EWP-2231", expires: date(7), status: "verified", verifiedBy: "u_sup", verifiedMethod: "SafeWork register" },
    { id: "cr_ewp_tran", workerId: "w_sc2", type: "EWP licence", number: "HRW-EWP-1180", expires: date(6), status: "verified", verifiedBy: "u_sup", verifiedMethod: "SafeWork register" },
    { id: "cr_fa_1", workerId: "w_co2", type: "First aid", number: "HLTAID011", expires: date(200), status: "verified" },
    { id: "cr_dog_1", workerId: "w_st1", type: "Dogging licence", number: "HRW-DG-5521", expires: date(400), status: "awaiting_verification" },
  );

  // attendance: 37 on site at Riverside today from 6 companies
  const attendance = [];
  workers.filter((w) => w.contractorId !== "c_sc" && w.id !== "w_co1" && w.id !== "w_co9").slice(0, 37).forEach((w, i) => {
    attendance.push({ id: `a_${w.id}`, projectId: "p_riv", workerId: w.id, kind: "check_in", at: day(0, 6, 15 + (i % 40)), method: i % 9 === 0 ? "kiosk" : "qr" });
  });
  for (let i = 0; i < 47; i++) attendance.push({ id: `a_x${i}`, projectId: i < 30 ? "p_nor" : "p_har", workerId: `w_ext${i}`, kind: "check_in", at: day(0, 6, 30), method: "qr" });

  // programme
  const task = (id, projectId, name, trade, contractorId, bs, bf, fs, ff, isMilestone, progress, status, extra = {}) => ({
    id, projectId, name, trade, contractorId, baselineStart: date(bs), baselineFinish: date(bf), forecastStart: date(fs), forecastFinish: date(ff),
    isMilestone, progress, status, predecessorIds: [], ...extra,
  });
  const tasks = [
    task("t_r1", "p_riv", "L3 slab — pour & cure", "Concrete", "c_co", -40, -30, -40, -30, false, 100, "complete"),
    task("t_r2", "p_riv", "L4 slab — reo & formwork", "Formwork", "c_fo", -6, 1, -6, 1, false, 80, "in_progress", { itpId: "itp_r07" }),
    task("t_r3", "p_riv", "L4 slab pour", "Concrete", "c_co", 2, 2, 2, 2, true, 0, "blocked", { itpId: "itp_r07", swmsId: "swms_r03", predecessorIds: ["t_r2"] }),
    task("t_r4", "p_riv", "L3 waterproofing", "Waterproofing", "c_wp", -3, 3, -1, 5, false, 45, "in_progress"),
    task("t_r5", "p_riv", "L2 services rough-in", "Plumbing", "c_pl", 0, 10, 1, 11, false, 10, "in_progress"),
    task("t_r6", "p_riv", "L1 framing", "Carpentry", "c_ca", 6, 14, 7, 16, false, 0, "not_started"),
    task("t_r7", "p_riv", "L3 tiling", "Tiling", "c_ti", 6, 18, 8, 20, false, 0, "not_started", { predecessorIds: ["t_r4"] }),
    task("t_h1", "p_har", "L12 ceilings close-up", "Carpentry", "c_ca", -10, 4, -10, 8, false, 60, "in_progress"),
    task("t_h2", "p_har", "Practical completion", "—", undefined, 23, 23, 23, 23, true, 0, "not_started"),
    task("t_n1", "p_nor", "Portal frames", "Steel", "c_st", 12, 30, 12, 30, true, 0, "not_started"),
    task("t_e1", "p_elm", "Slab on ground", "Concrete", "c_co", 8, 8, 8, 8, true, 0, "not_started"),
  ];

  // defects
  const defects = [];
  let defNo = 90;
  const def = (projectId, title, locationId, room, trade, contractorId, priority, due, status, raisedDaysAgo = 8, extra = {}) => {
    defNo++;
    defects.push({
      id: `d_${defNo}`, orgId: o, projectId, ref: extra.ref || `DEF-${pad(defNo).padStart(4, "0")}`, title, description: title + ".",
      category: "Workmanship", locationId, room, trade, contractorId, priority, dueDate: due === undefined ? undefined : date(due), status,
      raisedBy: "u_sup", raisedAt: day(-raisedDaysAgo, 10), photos: [], evidencePhotos: [], ...extra,
    });
  };
  def("p_riv", "Paint overspray on window frame", "l_rb1", "Unit 102", "Painting", undefined, "low", undefined, "open", 3, { ref: "DEF-0099" });
  def("p_riv", "GPO not level", "l_rb2", "Unit 203", "Electrical", "c_el", "low", 8, "assigned", 6, { ref: "DEF-0104" });
  def("p_riv", "Missing fire collar at riser", "l_rb2", "Riser 1", "Plumbing", "c_pl", "high", 5, "assigned", 4, { ref: "DEF-0110" });
  def("p_riv", "Exposed reo at slab edge", "l_rb3", "East edge", "Concrete", "c_co", "medium", 2, "rectifying", 9, { ref: "DEF-0115" });
  def("p_riv", "Skirting gap over 3mm", "l_rb2", "Unit 205", "Carpentry", "c_ca", "low", 9, "assigned", 2, { ref: "DEF-0118" });
  def("p_riv", "Cracked tile at lift lobby", "l_rb2", "Lift lobby", "Tiling", undefined, "medium", undefined, "open", 1, { ref: "DEF-0120" });
  def("p_riv", "Puddle flange not lapped at floor waste", "l_rb3", "Unit 302", "Waterproofing", "c_wp", "high", -1, "assigned", 7, { ref: "DEF-0125" });
  def("p_riv", "Bond breaker missing at wall junction", "l_rb3", "Unit 306", "Waterproofing", "c_wp", "high", -4, "rectifying", 10, { ref: "DEF-0128" });
  def("p_riv", "Upturn height below spec", "l_rb3", "Unit 301", "Waterproofing", "c_wp", "medium", 6, "assigned", 2, { ref: "DEF-0131" });
  def("p_riv", "Penetration not sealed, riser 2", "l_rb3c", "Riser 2", "Plumbing", "c_pl", "high", 3, "ready_for_verification", 5, { ref: "DEF-0139", rectificationNote: "Sealed with fire-rated sealant, collar fitted.", evidencePhotos: ["", ""] });
  def("p_riv", "Membrane lap short at shower hob", "l_rb3", "Unit 304 · Ensuite", "Waterproofing", "c_wp", "high", -2, "assigned", 6, { ref: "DEF-0142" });
  def("p_riv", "Chipped bench edge", "l_rb1", "Unit 104", "Joinery", "c_ca", "low", -10, "closed", 20, { ref: "DEF-0091", rectificationNote: "Edge replaced.", evidencePhotos: [""], verifiedBy: "u_sup" });
  defNo = 200;
  [["Ceiling tile damaged, meeting room 3", -3, "assigned"], ["Door closer not adjusted", 2, "assigned"], ["Fire stopping incomplete at L12 riser", -1, "rectifying"],
    ["Carpet seam visible at reception", 4, "assigned"], ["Downlight not aligned to grid", 6, "open"], ["Glazing film bubbled", 3, "ready_for_verification"],
    ["Joinery handle missing, kitchenette", 7, "assigned"], ["Paint touch-up at column C4", 5, "assigned"], ["Signage misaligned at lift", 10, "open"],
  ].forEach(([t, due, s], i) => def("p_har", t, i % 2 ? "l_h1" : "l_h2", "", "Fit-out", s === "open" ? undefined : "c_ca", "medium", due, s, 5,
    s === "ready_for_verification" ? { evidencePhotos: [""], rectificationNote: "Film replaced." } : {}));
  def("p_nor", "Holding-down bolt projection short", "l_n1", "Grid C3", "Steel", "c_st", "high", -2, "assigned");
  def("p_nor", "Slab joint sawcut late", "l_n1", "Grid E", "Concrete", "c_co", "medium", 5, "assigned");
  def("p_nor", "Stormwater pit lid missing", "l_n1", "Hardstand", "Civil", undefined, "high", undefined, "open");
  def("p_nor", "Bracing cleat misaligned", "l_n1", "Grid B2", "Steel", "c_st", "medium", 9, "assigned");
  def("p_elm", "Set-out peg disturbed", "l_e1", "Lot 3", "Survey", undefined, "medium", undefined, "open");
  def("p_elm", "Termite collar missing", "l_e1", "Lot 2", "Plumbing", "c_pl", "high", 4, "assigned");
  def("p_elm", "Vapour barrier torn", "l_e1", "Lot 5", "Concrete", "c_co", "medium", 3, "assigned");

  const itps = [
    { id: "itp_r07", projectId: "p_riv", ref: "ITP-07", title: "L4 slab — concrete", templateVersion: 3, taskId: "t_r3", points: [
      { id: "ip1", name: "Reinforcement", check: "Bar size, spacing and cover checked against S-201 rev C", type: "hold", status: "submitted", evidence: 4 },
      { id: "ip2", name: "Formwork", check: "Dimensions and stability", type: "inspection", status: "released", evidence: 1, releasedBy: "u_sup", releasedAt: day(-1, 15) },
      { id: "ip3", name: "Pre-pour services & embeds", check: "Services, sleeves and embeds confirmed", type: "hold", status: "released", evidence: 1, releasedBy: "u_pm", releasedAt: day(-1, 16) },
      { id: "ip4", name: "Structural engineer", check: "Engineer site inspection", type: "witness", status: "pending", evidence: 0 },
      { id: "ip5", name: "Concrete delivery", check: "Record batch dockets and slump tests", type: "test", status: "pending", evidence: 0 },
      { id: "ip6", name: "Finish & curing", check: "Finish tolerance and curing regime", type: "inspection", status: "pending", evidence: 0 },
    ] },
    { id: "itp_r06", projectId: "p_riv", ref: "ITP-06", title: "L3 slab — concrete", templateVersion: 3, taskId: "t_r1", points: [
      { id: "ip1", name: "Reinforcement", check: "Bar size, spacing and cover", type: "hold", status: "released", evidence: 1, releasedBy: "u_pm", releasedAt: minsAgo(18) },
    ] },
    { id: "itc_r14", projectId: "p_riv", ref: "ITC-14", title: "L3 waterproofing flood test · Units 301–306", templateVersion: 1, points: [
      { id: "ip1", name: "Flood test 24h", check: "No drop in water level after 24 hours", type: "test", status: "submitted", evidence: 2 },
    ] },
    { id: "itp_h03", projectId: "p_har", ref: "ITP-03", title: "L12 fire stopping", templateVersion: 2, points: [
      { id: "ip1", name: "Penetrations sealed", check: "All penetrations sealed with approved system", type: "hold", status: "rejected", evidence: 1 },
    ] },
  ];

  const swms = [
    { id: "swms_r03", projectId: "p_riv", ref: "SWMS-03", title: "Concrete placement", activity: "Concrete pumping and placement", contractorId: "c_co", version: 3, status: "approved", highRiskCategories: ["Work near mobile plant", "Fall > 2m"], acknowledgedBy: ["w_co2", "w_co3", "w_co4", "w_co5", "w_co6"] },
    { id: "swms_r04", projectId: "p_riv", ref: "SWMS-04", title: "Wet area waterproofing", activity: "Membrane application", contractorId: "c_wp", version: 1, status: "approved", highRiskCategories: ["Hazardous chemicals"], acknowledgedBy: ["w_wp1", "w_wp2", "w_wp3", "w_wp4", "w_wp5"] },
    { id: "swms_r05", projectId: "p_riv", ref: "SWMS-05", title: "Scaffold alteration", activity: "Scaffold modification", contractorId: "c_sc", version: 2, status: "in_review", highRiskCategories: ["Fall > 2m"], acknowledgedBy: [] },
    { id: "swms_n02", projectId: "p_nor", ref: "SWMS-02", title: "Formwork", activity: "Formwork erection", contractorId: "c_fo", version: 2, status: "submitted", highRiskCategories: ["Fall > 2m"], acknowledgedBy: [] },
    { id: "swms_n03", projectId: "p_nor", ref: "SWMS-03", title: "Steel erection", activity: "Portal frame erection", contractorId: "c_st", version: 1, status: "submitted", highRiskCategories: ["Fall > 2m", "Work near mobile plant"], acknowledgedBy: [] },
  ];

  const doc = (projectId, number, title, category, revision, status, up) => ({ id: `doc_${projectId}_${number}_${revision}`, projectId, number, title, category, revision, status, uploadedBy: "u_pm", uploadedAt: day(up, 11) });
  const documents = [
    doc("p_riv", "A-101", "General arrangement — L1", "Architectural", "3", "current", -60),
    doc("p_riv", "A-102", "General arrangement — L2–L4", "Architectural", "3", "current", -60),
    doc("p_riv", "A-102", "General arrangement — L2–L4", "Architectural", "4", "in_review", -1),
    doc("p_riv", "S-201", "Slab reinforcement — L4", "Structural", "C", "current", -30),
    doc("p_riv", "S-201", "Slab reinforcement — L4", "Structural", "D", "in_review", 0),
    doc("p_riv", "H-301", "Hydraulic layout — L3", "Services", "2", "current", -45),
    doc("p_riv", "SPEC-07", "Waterproofing specification", "Specification", "1", "current", -200),
    doc("p_riv", "SMP-01", "Site safety management plan", "Safety", "2", "current", -120),
    doc("p_nor", "A-102", "Floor plan", "Architectural", "4", "current", 0),
    doc("p_har", "A-501", "Reflected ceiling plan — L12", "Architectural", "5", "current", -14),
  ];

  // budgets: lines sum to each project's forecast final cost
  const budgetLines = [];
  const cats = [["01-PRE", "Preliminaries", 0.11], ["02-CON", "Concrete", 0.19], ["03-STL", "Reinforcement & steel", 0.12], ["04-FRM", "Formwork", 0.08],
    ["05-HYD", "Plumbing & hydraulics", 0.1], ["06-ELE", "Electrical", 0.1], ["07-WPF", "Waterproofing", 0.04], ["08-FIN", "Finishes", 0.16], ["09-LAB", "Own labour", 0.1]];
  for (const [pid, ffc, cr, ar] of [["p_riv", 16.95, 0.78, 0.58], ["p_har", 4.31, 0.96, 0.82], ["p_nor", 8.86, 0.55, 0.3], ["p_elm", 5.52, 0.4, 0.1]]) {
    for (const [code, description, w] of cats) {
      const ff = Math.round($m(ffc) * w);
      budgetLines.push({ id: `bl_${pid}_${code}`, projectId: pid, costCode: code, description, originalBudget: Math.round(ff * (pid === "p_har" ? 0.97 : 1.004)), committed: Math.round(ff * cr), actual: Math.round(ff * ar), forecastFinal: ff });
    }
  }

  const vari = (projectId, ref, title, amount, status, raised) => {
    const ok = status === "approved" || status === "included_in_claim";
    return { id: `v_${projectId}_${ref}`, orgId: o, projectId, ref, title, reason: "Client instruction", amount, approvedAmount: ok ? amount : undefined, timeImpactDays: 0, status, raisedAt: day(raised), approvedBy: ok ? "u_dir" : undefined, approvedAt: ok ? day(raised + 5) : undefined };
  };
  const variations = [
    vari("p_riv", "VAR-009", "Additional balcony waterproofing", $d(120000), "approved", -60),
    vari("p_riv", "VAR-010", "Client-requested kitchen upgrade, L3", $d(186500), "approved", -40),
    vari("p_riv", "VAR-011", "Façade louvre change", $d(93500), "included_in_claim", -30),
    vari("p_riv", "VAR-012", "Extra steel — L4 transfer beam", $d(48200), "under_review", -3),
    vari("p_riv", "VAR-013", "Rock excavation, lift pit", $d(162000), "submitted", -1),
    vari("p_har", "VAR-004", "Additional data points", $d(100000), "approved", -50),
    vari("p_har", "VAR-005", "Reception joinery redesign", $d(214000), "submitted", -6),
    vari("p_nor", "VAR-002", "Hardstand extension", $d(100000), "approved", -20),
    vari("p_nor", "VAR-003", "Additional roller door", $d(215800), "under_review", -4),
  ];

  const claims = [
    { id: "pc_r09", projectId: "p_riv", ref: "PC-09", periodEnd: date(-26), dueDate: date(-12), claimed: $d(1240000), certified: $d(1190000), paid: $d(1190000), status: "paid" },
    { id: "pc_r10", projectId: "p_riv", ref: "PC-10", periodEnd: date(4), dueDate: date(4), claimed: $d(960000), status: "draft" },
    { id: "pc_h09", projectId: "p_har", ref: "PC-09", periodEnd: date(-5), dueDate: date(2), claimed: $d(512000), status: "submitted" },
    { id: "pc_h08", projectId: "p_har", ref: "PC-08", periodEnd: date(-35), dueDate: date(-9), claimed: $d(410000), certified: $d(310000), paid: 0, status: "certified" },
    { id: "pc_n04", projectId: "p_nor", ref: "PC-04", periodEnd: date(-4), dueDate: date(10), claimed: $d(598000), certified: $d(598000), status: "certified" },
    { id: "pc_e02", projectId: "p_elm", ref: "PC-02", periodEnd: date(-3), dueDate: date(11), claimed: $d(100000), status: "submitted" },
  ];

  const diary = [
    { id: "di_r1", projectId: "p_riv", date: date(-1), weather: "Fine, 24°C", workersOnSite: 37, companiesOnSite: 6, authorId: "u_sup", submitted: true, notes: "L4 reo 80% placed. Waterproofer on L3 units 301–306. Pump delivery confirmed for Thursday.", delays: "Crane down 40 min for wind." },
    { id: "di_e1", projectId: "p_elm", date: date(-1), weather: "Showers, 19°C", workersOnSite: 11, companiesOnSite: 3, authorId: "u_sup", submitted: true, notes: "Set-out complete for lots 1–6." },
  ];

  const audit = [
    { id: "ae1", projectId: "p_riv", recordType: "itp_point", recordId: "itp_r06", action: "Hold point released", detail: "ITP-06 L3 slab", actorId: "u_pm", at: minsAgo(18) },
    { id: "ae2", projectId: "p_har", recordType: "itp_point", recordId: "itp_h03", action: "Inspection failed", detail: "Fire stopping L12", actorId: "u_qm", at: minsAgo(62) },
    { id: "ae3", projectId: "p_nor", recordType: "document", recordId: "doc_p_nor_A-102_4", action: "A-102 rev 4 issued for construction", actorId: "u_pm", at: minsAgo(130) },
    { id: "ae4", projectId: "p_elm", recordType: "diary", recordId: "di_e1", action: "Site diary submitted", actorId: "u_sup", at: day(-1, 16, 40) },
    { id: "ae5", projectId: "p_riv", recordType: "defect", recordId: "d_100", action: "Evidence added", detail: "DEF-0139 · 2 photos", actorId: "u_sub", at: day(-1, 11, 47) },
  ];

  return { version: 1, createdAt: now.toISOString(), org, users, projects, locations, contractors, workers, credentials, tasks, defects, itps, swms, documents, attendance, budgetLines, variations, claims, diary, audit, seq: { defect: 216, audit: 100, attendance: 1000 } };
}

// ------------------------------------------------------- permissions
// Mirror of role_can() in the database. Used only to decide which buttons
// to show — the database refuses anything a role isn't allowed to do.
const SAFETY = ["ncr.manage", "permit.request", "permit.approve", "safety.report", "safety.manage", "attendance.manage"];
const GRANTS = {
  director: ["defect.create", "defect.assign", "defect.verify", "itp.release_hold", "itp.manage", "itp.submit", "swms.submit", "variation.create", "variation.approve", "swms.review", "commercial.view", "diary.submit", "people.manage", "project.manage", "documents.upload", "documents.approve", ...SAFETY],
  project_manager: ["defect.create", "defect.assign", "defect.verify", "itp.release_hold", "itp.manage", "itp.submit", "swms.submit", "variation.create", "variation.approve", "swms.review", "commercial.view", "diary.submit", "people.manage", "project.manage", "documents.upload", "documents.approve", ...SAFETY],
  site_supervisor: ["defect.create", "defect.assign", "defect.verify", "itp.submit", "swms.submit", "swms.review", "diary.submit", "people.manage", "documents.upload", ...SAFETY],
  quality_manager: ["defect.create", "defect.assign", "defect.verify", "itp.release_hold", "itp.manage", "itp.submit", "documents.upload", "documents.approve", "ncr.manage", "safety.report"],
  subcontractor_admin: ["defect.rectify", "variation.create", "itp.submit", "swms.submit", "documents.upload", "permit.request", "safety.report"],
  worker: ["defect.create", "permit.request", "safety.report"],
};
const VARIATION_LIMIT = { project_manager: 5000000, director: Infinity };
const ROLE_LABEL = { director: "Director", project_manager: "Project manager", site_supervisor: "Site supervisor", quality_manager: "Quality manager", subcontractor_admin: "Subcontractor admin", worker: "Worker" };
class RuleError extends Error {}
const can = (u, p) => !!u && (GRANTS[u.role] || []).includes(p);
const assertCan = (u, p) => { if (!can(u, p)) throw new RuleError(`${ROLE_LABEL[u.role]}s can't do that (${p.replace(".", " → ")}).`); };

// ---------------------------------------------------------- workflows
const DEFECT_STEPS = [["open", "Open"], ["assigned", "Assigned"], ["rectifying", "Rectifying"], ["ready_for_verification", "Verify"], ["closed", "Closed"]];

function transitionDefect(d, a, u) {
  const from = d.status;
  const bad = () => new RuleError(`Can't ${words(a.type)} a defect that is ${words(from)}.`);
  const ownerOrSite = () => {
    const owner = u.role === "subcontractor_admin" && u.contractorId === d.contractorId;
    if (!owner && u.role !== "site_supervisor" && u.role !== "project_manager") throw new RuleError("Only the assigned contractor or the site team can record rectification.");
  };
  switch (a.type) {
    case "submit": assertCan(u, "defect.create"); if (from !== "draft") throw bad();
      if (!d.locationId) throw new RuleError("Choose a location before submitting.");
      return { status: "open" };
    case "assign": assertCan(u, "defect.assign"); if (from !== "open" && from !== "assigned") throw bad();
      if (!a.contractorId) throw new RuleError("Choose a responsible contractor.");
      if (!a.dueDate) throw new RuleError("A due date is needed before this can be assigned.");
      return { status: "assigned", contractorId: a.contractorId, dueDate: a.dueDate };
    case "start_rectification": if (from !== "assigned") throw bad(); ownerOrSite(); return { status: "rectifying" };
    case "submit_for_verification": if (from !== "rectifying" && from !== "assigned") throw bad(); ownerOrSite();
      if (!a.note.trim()) throw new RuleError("Describe the rectification before submitting.");
      if (!a.evidencePhotos.length) throw new RuleError("Add at least one completion photo as evidence.");
      return { status: "ready_for_verification", rectificationNote: a.note.trim(), evidencePhotos: [...d.evidencePhotos, ...a.evidencePhotos] };
    case "verify": assertCan(u, "defect.verify"); if (from !== "ready_for_verification") throw bad();
      // Closing needs evidence and an authorised reviewer, not just a status change.
      if (!d.evidencePhotos.length || !d.rectificationNote) throw new RuleError("Completion evidence is missing — can't close.");
      return { status: "closed", verifiedBy: u.id };
    case "reject": assertCan(u, "defect.verify"); if (from !== "ready_for_verification") throw bad();
      if (!a.reason.trim()) throw new RuleError("Give a reason so the contractor knows what to fix.");
      return { status: "rectifying" };
  }
  throw new RuleError("Unknown action.");
}
const isOverdue = (d, today = new Date()) => !!d.dueDate && d.status !== "closed" && d.status !== "draft" && D(d.dueDate) < startOfDay(today);

const VAR_FROM = { approve: ["submitted", "under_review"], reject: ["submitted", "under_review"], include_in_claim: ["approved"] };
function transitionVariation(v, a, u) {
  if (!VAR_FROM[a.type]?.includes(v.status)) throw new RuleError(`Can't ${words(a.type)} a variation that is ${words(v.status)}.`);
  assertCan(u, "variation.approve");
  if (a.type === "approve") {
    const limit = VARIATION_LIMIT[u.role] ?? 0;
    if (v.amount > limit) throw new RuleError(`This exceeds your delegated limit of ${moneyLimit(limit)}. A director must approve it.`);
    return { status: "approved", approvedAmount: v.amount, approvedBy: u.id, approvedAt: new Date().toISOString() };
  }
  if (a.type === "reject") { if (!a.reason.trim()) throw new RuleError("A reason is required to reject a variation."); return { status: "rejected" }; }
  return { status: "included_in_claim" };
}

function commercialPosition(p, vars, lines) {
  const approvedVariations = sum(vars.filter((v) => v.status === "approved" || v.status === "included_in_claim"), (v) => v.approvedAmount ?? v.amount);
  const variationExposure = sum(vars.filter((v) => ["draft", "submitted", "under_review"].includes(v.status)), (v) => v.amount);
  const revisedContract = p.contractSum + approvedVariations;
  const forecastFinalCost = sum(lines, (l) => l.forecastFinal);
  const forecastMargin = revisedContract - forecastFinalCost;
  return {
    originalContract: p.contractSum, approvedVariations, variationExposure, revisedContract,
    budget: sum(lines, (l) => l.originalBudget), committed: sum(lines, (l) => l.committed), actual: sum(lines, (l) => l.actual),
    forecastFinalCost, forecastMargin, forecastMarginPct: revisedContract ? (forecastMargin / revisedContract) * 100 : 0,
  };
}

function credentialReq(type, c, today, mandatory) {
  if (!c) return { label: type, detail: "Not uploaded", severity: mandatory ? "blocking" : "warning" };
  if (c.expires && D(c.expires) < startOfDay(today)) return { label: type, detail: `Expired ${dayMonth(c.expires)}`, severity: "blocking" };
  if (c.status !== "verified") return { label: type, detail: "Awaiting verification", severity: mandatory ? "blocking" : "warning" };
  const days = c.expires ? daysBetween(today, D(c.expires)) : Infinity;
  if (days <= 30) return { label: type, detail: `Expires ${dayMonth(c.expires)}`, severity: "warning" };
  return { label: type, detail: "Verified", severity: "ok" };
}
/** Exact requirements for a worker to sign in — never a generic "not compliant". */
function siteRequirements(w, projectId, today = new Date()) {
  const mine = DB.credentials.filter((c) => c.workerId === w.id);
  const reqs = [credentialReq("White Card", mine.find((c) => c.type === "White Card"), today, true)];
  const inducted = w.inductedProjectIds.includes(projectId);
  reqs.push({ label: "Site induction", detail: inducted ? "Complete" : "Not yet inducted to this site", severity: inducted ? "ok" : "blocking" });
  for (const c of mine.filter((c) => c.type !== "White Card")) reqs.push(credentialReq(c.type, c, today, false));
  for (const s of DB.swms.filter((s) => s.projectId === projectId && s.contractorId === w.contractorId && s.status === "approved")) {
    const ack = s.acknowledgedBy.includes(w.id);
    reqs.push({ label: `SWMS · ${s.title} v${s.version}`, detail: ack ? "Acknowledged" : "Needs signing", severity: ack ? "ok" : "blocking" });
  }
  return reqs;
}
const canSignIn = (reqs) => reqs.every((r) => r.severity !== "blocking");

// ------------------------------------------------------------- queries
// Scoped by organisation; subcontractors only see their own company's records.
const userById = (id) => DB.users.find((u) => u.id === id);
const listProjects = (u) => DB.projects.filter((p) => p.orgId === u.orgId);
const getProject = (u, id) => DB.projects.find((p) => p.id === id && p.orgId === u.orgId) || null;
const contractorOf = (id) => (id ? DB.contractors.find((c) => c.id === id) : undefined);
const locationOf = (id) => DB.locations.find((l) => l.id === id);
const projName = (id) => DB.projects.find((p) => p.id === id)?.name ?? "";
const listDefects = (u, pid) => DB.defects.filter((d) => d.orgId === u.orgId && (!pid || d.projectId === pid) && (u.role !== "subcontractor_admin" || d.contractorId === u.contractorId));
const getDefect = (u, id) => listDefects(u).find((d) => d.id === id) || null;
const openDefects = (u, pid) => listDefects(u, pid).filter((d) => d.status !== "closed" && d.status !== "draft");
const overdueDefects = (u, pid) => listDefects(u, pid).filter((d) => isOverdue(d));
const listVariations = (u, pid) => (can(u, "commercial.view") ? DB.variations.filter((v) => v.orgId === u.orgId && (!pid || v.projectId === pid)) : []);
function projectCommercial(u, pid) {
  const p = getProject(u, pid);
  if (!p || !can(u, "commercial.view")) return null;
  return commercialPosition(p, DB.variations.filter((v) => v.projectId === pid), DB.budgetLines.filter((l) => l.projectId === pid));
}
function onSiteNow(pid) {
  const latest = new Map(), today = todayYmd();
  for (const e of DB.attendance) {
    if ((pid && e.projectId !== pid) || ymd(new Date(e.at)) !== today) continue;
    const k = `${e.projectId}:${e.workerId}`, prev = latest.get(k);
    if (!prev || prev.at <= e.at) latest.set(k, e);
  }
  return [...latest.values()].filter((e) => e.kind === "check_in");
}
const companiesOnSite = (pid) => new Set(onSiteNow(pid).map((e) => DB.workers.find((w) => w.id === e.workerId)?.contractorId ?? e.workerId)).size;
function awaitingSignOff(pid) {
  const itps = DB.itps.filter((i) => !pid || i.projectId === pid);
  const points = itps.flatMap((i) => i.points.filter((p) => p.status === "submitted").map((p) => ({ itp: i, point: p })));
  const defects = DB.defects.filter((d) => (!pid || d.projectId === pid) && d.status === "ready_for_verification");
  const holdsBlocking = itps.flatMap((i) => i.points.filter((p) => p.type === "hold" && (p.status === "submitted" || p.status === "rejected")));
  return { points, defects, holdsBlocking, total: points.length + defects.length };
}
function workerRequirements(wid, pid) {
  const w = DB.workers.find((x) => x.id === wid);
  if (!w) return null;
  const reqs = siteRequirements(w, pid);
  return { worker: w, reqs, eligible: canSignIn(reqs) };
}
function locationLabel(d) {
  const l = locationOf(d.locationId);
  return l ? `${l.building} · ${l.level} · ${d.room || l.zone}` : "—";
}
const auditFor = (id) => DB.audit.filter((a) => a.recordId === id);

/** Readiness for a milestone (blueprint §11). Shows facts; never authorises. */
function readiness(pid, taskId) {
  const t = DB.tasks.find((x) => x.id === taskId && x.projectId === pid);
  if (!t) return null;
  const base = `#/app/projects/${pid}`, items = [];
  const pred = DB.tasks.filter((x) => t.predecessorIds.includes(x.id));
  const predOk = pred.every((x) => x.progress >= 80);
  items.push({ label: "Programme task & pump booking", state: predOk ? "ready" : "action", detail: predOk ? "Ready" : "Predecessor behind", href: `${base}/programme` });
  const itp = DB.itps.find((i) => i.id === t.itpId);
  for (const p of itp?.points.filter((p) => p.type === "hold" || p.type === "witness") ?? []) {
    const rel = p.status === "released";
    items.push({ label: `${itp.ref} ${p.name.toLowerCase()} ${p.type === "hold" ? "hold point" : "witness point"}`, state: rel ? "ready" : p.type === "hold" ? "blocking" : "action", detail: rel ? "Released" : p.type === "hold" ? "Blocking" : "Not booked", href: `${base}/quality/itp/${itp.id}` });
  }
  const locs = DB.locations.filter((l) => l.projectId === pid && t.name.startsWith(l.level));
  const open = DB.defects.filter((d) => locs.some((l) => l.id === d.locationId) && d.status !== "closed" && d.status !== "draft");
  items.push({ label: `Open defects on ${locs[0]?.level ?? "area"}`, state: open.length ? "action" : "ready", detail: open.length ? `${open.length} open` : "None", href: `${base}/quality` });
  if (t.contractorId) {
    const crew = DB.workers.filter((w) => w.contractorId === t.contractorId), missing = crew.filter((w) => !w.inductedProjectIds.includes(pid));
    items.push({ label: `${contractorOf(t.contractorId)?.trade ?? "Crew"} crew credentials`, state: missing.length ? "action" : "ready", detail: missing.length ? `${missing.length} of ${crew.length} missing induction` : "All inducted", href: `${base}/workforce` });
  }
  const linked = DB.swms.find((x) => x.id === t.swmsId), s = swmsInForce(linked) || linked;
  if (s) items.push({ label: `SWMS · ${s.title} v${s.version}`, state: s.status === "approved" ? "ready" : "blocking", detail: s.status === "approved" ? "Approved" : "Not approved", href: `${base}/safety/swms/${s.id}` });
  return { task: t, items };
}

// ------------------------------------------------------------ programme
const dayNo = (s) => Math.round(D(s) / 86400000);
const durationDays = (t) => dayNo(t.forecastFinish) - dayNo(t.forecastStart) + 1;

/**
 * Float and critical path from forecast dates and finish-to-start links.
 * Late finish = earliest late start of any successor − 1 day, or the
 * programme's last finish. Zero (or negative) float = critical.
 */
function criticalPath(tasks) {
  const out = new Map();
  if (!tasks.length) return out;
  const byId = new Map(tasks.map((t) => [t.id, t])), succ = new Map(), lf = new Map();
  for (const t of tasks) for (const p of t.predecessorIds) if (byId.has(p)) (succ.get(p) || succ.set(p, []).get(p)).push(t);
  const end = Math.max(...tasks.map((t) => dayNo(t.forecastFinish)));
  const span = (t) => dayNo(t.forecastFinish) - dayNo(t.forecastStart);
  const LF = (t, seen = new Set()) => {
    if (lf.has(t.id)) return lf.get(t.id);
    if (seen.has(t.id)) return end; // the database prevents loops; guard anyway
    seen.add(t.id);
    const ss = succ.get(t.id) || [];
    // A task must finish the day before its successor starts; a milestone's successor can start the same day.
    const v = ss.length ? Math.min(...ss.map((s) => LF(s, seen) - span(s) - (t.isMilestone ? 0 : 1))) : end;
    lf.set(t.id, v);
    return v;
  };
  for (const t of tasks) {
    const float = LF(t) - dayNo(t.forecastFinish);
    out.set(t.id, { float, critical: float <= 0 && t.status !== "complete" });
  }
  return out;
}

/** Predecessors this task starts before (finish-to-start broken). */
function dependencyClashes(t, tasks) {
  return t.predecessorIds.map((id) => tasks.find((x) => x.id === id)).filter(Boolean)
    .filter((p) => (p.isMilestone ? dayNo(t.forecastStart) < dayNo(p.forecastFinish) : dayNo(t.forecastStart) <= dayNo(p.forecastFinish)));
}

/**
 * Planned vs site-reported progress, weighted by task duration. Projects
 * with progress entered directly (e.g. the sample set) keep those figures.
 */
function progressOf(p) {
  const tasks = DB.tasks.filter((t) => t.projectId === p.id && t.baselineStart && t.baselineFinish);
  if (p.plannedProgress || p.verifiedProgress || !tasks.length) return { planned: p.plannedProgress || 0, verified: p.verifiedProgress || 0 };
  const today = dayNo(todayYmd());
  let w = 0, planned = 0, done = 0;
  for (const t of tasks) {
    const d = Math.max(1, dayNo(t.baselineFinish) - dayNo(t.baselineStart) + 1);
    w += d;
    planned += d * Math.min(1, Math.max(0, (today - dayNo(t.baselineStart) + 1) / d));
    done += d * (t.progress / 100);
  }
  return { planned: Math.round((planned / w) * 100), verified: Math.round((done / w) * 100) };
}

/** Next open milestone from the programme, falling back to the project record. */
function nextMilestoneOf(p) {
  const m = DB.tasks.filter((t) => t.projectId === p.id && t.isMilestone && t.status !== "complete").sort((a, b) => a.forecastStart.localeCompare(b.forecastStart))[0];
  return m ? { name: m.name, date: m.forecastStart } : p.nextMilestone;
}

// ---------------------------------------------------------------- ITPs
const POINT_TYPES = { hold: "Hold point", witness: "Witness point", inspection: "Inspection", test: "Test", review: "Review" };

/** Who may sign off a point (mirrors itp_point_action in the database). */
const canSignOff = (u, pt) => (pt.type === "hold" || pt.type === "witness" ? can(u, "itp.release_hold") : can(u, "itp.release_hold") || can(u, "defect.verify"));

/** The unreleased hold point that stops this point being submitted, if any. */
const holdBlocking = (itp, pt) => itp.points.find((x) => x.type === "hold" && x.seq < pt.seq && x.status !== "released");

/** Approvals on the current submission. */
const currentSignoffs = (pt) => pt.signoffs.filter((s) => !pt.submittedAt || s.at >= pt.submittedAt);

/** Starter templates (blueprint §4.3 example plus common trades). */
const STARTER_TEMPLATES = [
  { name: "Concrete slab", trade: "Concrete", description: "Suspended or on-ground slab, from formwork to curing.", points: [
    { name: "Formwork", type: "inspection", check_text: "Dimensions, levels and stability checked against drawings", evidence_required: 1 },
    { name: "Reinforcement", type: "hold", check_text: "Bar size, spacing and cover checked against structural drawings", evidence_required: 2, measurement_label: "Cover (mm)" },
    { name: "Pre-pour services & embeds", type: "hold", check_text: "Services, sleeves, cast-ins and embeds confirmed in position", evidence_required: 1 },
    { name: "Structural engineer", type: "witness", check_text: "Engineer's pre-pour inspection", evidence_required: 0 },
    { name: "Concrete delivery", type: "test", check_text: "Batch dockets checked; slump and cylinder samples taken", evidence_required: 1, measurement_label: "Slump (mm)" },
    { name: "Finish & curing", type: "inspection", check_text: "Finish tolerance and curing regime in place", evidence_required: 1 },
  ] },
  { name: "Wet area waterproofing", trade: "Waterproofing", description: "Bathrooms, ensuites and laundries to AS 3740.", points: [
    { name: "Substrate & falls", type: "inspection", check_text: "Substrate clean and sound; falls to waste", evidence_required: 1 },
    { name: "Bond breakers & puddle flanges", type: "hold", check_text: "Bond breakers at junctions; puddle flanges set at every waste", evidence_required: 2 },
    { name: "Membrane application", type: "inspection", check_text: "Membrane coats, laps and upturn heights to spec", evidence_required: 2, measurement_label: "Upturn height (mm)" },
    { name: "Flood test", type: "test", check_text: "24-hour flood test with no drop in level", evidence_required: 1 },
    { name: "Certificate", type: "review", check_text: "Installer's waterproofing certificate received", evidence_required: 1 },
  ] },
  { name: "Fire stopping", trade: "Fire services", description: "Penetrations through fire-rated walls and floors.", points: [
    { name: "Penetration register", type: "review", check_text: "All penetrations listed with tested system", evidence_required: 0 },
    { name: "Installation", type: "hold", check_text: "Each penetration sealed with the approved system before close-up", evidence_required: 2, required_signoffs: 2 },
    { name: "Labels & certification", type: "inspection", check_text: "Labels fixed; installer certificate received", evidence_required: 1 },
  ] },
];

// ----------------------------------------------------------- documents
const DOC_CATEGORIES = ["Architectural", "Structural", "Services", "Civil", "Specification", "Contract", "Certificates", "Safety", "Minutes", "Correspondence", "Handover", "Other"];
/** Mirrors document_needs_review() in the database. */
const docNeedsReview = (cat) => ["Architectural", "Structural", "Services", "Civil", "Specification", "Contract"].includes(cat);
/** One entry per document number: current revision, any revision in review, and every revision. */
function docSeries(projectId) {
  const groups = new Map();
  for (const d of DB.documents.filter((x) => x.projectId === projectId)) {
    const k = d.number.toLowerCase();
    (groups.get(k) || groups.set(k, []).get(k)).push(d);
  }
  return [...groups.values()].map((revs) => {
    revs.sort((a, b) => (b.uploadedAt || "").localeCompare(a.uploadedAt || ""));
    return { number: revs[0].number, current: revs.find((r) => r.status === "current") || null, pending: revs.find((r) => r.status === "in_review") || null, latest: revs[0], revisions: revs };
  }).sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
}
/** A revision issued in the last week replaced an earlier one. */
const isNewRevision = (d, series) => series.revisions.length > 1 && d.status === "current" && daysBetween(D(d.reviewedAt || d.uploadedAt), new Date()) <= 7;

// ---------------------------------------------------------------- SWMS
/** High-risk construction work categories (WHS Regulations r 291). */
const HRCW = [
  "Risk of a fall of more than 2 metres", "Work on a telecommunication tower", "Demolition of a load-bearing element", "Disturbing or removing asbestos",
  "Structural alterations needing temporary support", "Work in or near a confined space", "Shaft or trench deeper than 1.5 m, or a tunnel", "Use of explosives",
  "Work on or near pressurised gas mains or piping", "Work on or near chemical, fuel or refrigerant lines", "Work on or near energised electrical installations",
  "Work in a contaminated or flammable atmosphere", "Tilt-up or precast concrete", "Work on or next to a road, railway or shipping lane in use",
  "Work in an area with movement of powered mobile plant", "Work in areas with artificial extremes of temperature", "Work in or near water with a risk of drowning", "Diving work",
];

/** One entry per SWMS (all versions): the version in force, any revision waiting, and the history. */
function swmsSeries(projectId) {
  const groups = new Map();
  for (const s of DB.swms.filter((x) => x.projectId === projectId)) (groups.get(s.seriesId) || groups.set(s.seriesId, []).get(s.seriesId)).push(s);
  return [...groups.values()].map((vs) => {
    vs.sort((a, b) => b.version - a.version);
    const current = vs.find((v) => v.status === "approved") || null;
    const pending = vs.find((v) => ["submitted", "in_review", "changes_requested"].includes(v.status)) || null;
    return { current, pending, latest: vs[0], versions: vs };
  }).sort((a, b) => a.latest.ref.localeCompare(b.latest.ref));
}
/** The approved version in force for any version of a SWMS. */
const swmsInForce = (s) => (s ? DB.swms.find((x) => x.seriesId === s.seriesId && x.status === "approved") || null : null);

function search(u, q) {
  const n = q.trim().toLowerCase();
  if (!n) return [];
  const hit = (...xs) => xs.some((x) => x?.toLowerCase().includes(n));
  const out = [];
  for (const p of listProjects(u)) if (hit(p.name, p.code, p.address)) out.push(["Project", p.name, p.code, `#/app/projects/${p.id}`]);
  for (const d of listDefects(u)) if (hit(d.ref, d.title, d.trade)) out.push(["Defect", `${d.ref} · ${d.title}`, projName(d.projectId), `#/app/projects/${d.projectId}/quality/defects/${d.id}`]);
  for (const d of DB.documents.filter((x) => x.status !== "superseded" && x.status !== "rejected")) if (hit(d.number, d.title)) out.push(["Document", `${d.number} rev ${d.revision} · ${d.title}`, projName(d.projectId), `#/app/projects/${d.projectId}/documents/${d.id}`]);
  for (const w of DB.workers) if (hit(w.name)) out.push(["Worker", w.name, contractorOf(w.contractorId)?.tradingName ?? "", `#/app/people`]);
  for (const x of listNcrs(u)) if (hit(x.ref, x.title)) out.push(["NCR", `${x.ref} · ${x.title}`, projName(x.projectId), `#/app/projects/${x.projectId}/quality/ncrs/${x.id}`]);
  for (const x of DB.incidents) if (hit(x.ref, x.title)) out.push(["Safety report", `${x.ref} · ${x.title}`, projName(x.projectId), `#/app/projects/${x.projectId}/safety/incidents/${x.id}`]);
  for (const x of DB.permits) if (hit(x.ref, x.type, x.location)) out.push(["Permit", `${x.ref} · ${x.type} · ${x.location}`, projName(x.projectId), `#/app/projects/${x.projectId}/safety/permits/${x.id}`]);
  for (const v of listVariations(u)) if (hit(v.ref, v.title)) out.push(["Variation", `${v.ref} · ${v.title}`, projName(v.projectId), `#/app/projects/${v.projectId}/commercial`]);
  return out.slice(0, 40);
}

// --------------------------------------------- derived views (one source)
// ---- safety extras (NCRs, permits, incidents, site access)
const INCIDENT_TYPES = { incident: "Incident (injury or damage)", near_miss: "Near miss", hazard: "Hazard", observation: "Observation (good or bad)" };
const PERMIT_TYPES = ["Hot work", "Working at heights", "Confined space", "Excavation", "Electrical isolation", "Crane lift", "Roof access", "Demolition"];
const SITE_RULES = ["Sign in when you arrive and sign out when you leave.", "Stay with your host and keep to marked walkways.", "Wear the PPE you're given: hard hat, hi-vis, closed boots.", "Don't enter exclusion zones or areas behind barriers.", "In an emergency, follow the wardens to the assembly point."];
const NCR_STEPS = [["open", "Raised"], ["corrective_action", "Corrective action"], ["verification", "Verification"], ["closed", "Closed"]];
const permitLive = (x, day = todayYmd()) => x.status === "approved" && x.validFrom <= day && x.validTo >= day;
const listNcrs = (u, pid) => DB.ncrs.filter((n) => (!pid || n.projectId === pid) && (u.role !== "subcontractor_admin" || n.contractorId === u.contractorId));
const ncrCanEdit = (u, n) => n.status !== "closed" && (can(u, "ncr.manage") || (u.role === "subcontractor_admin" && u.contractorId === n.contractorId));
/** Workers whose latest record (in the last two days) is a sign-in from an earlier day. */
function missingSignOuts(pid) {
  const latest = new Map();
  for (const e of DB.attendance.filter((x) => x.projectId === pid)) { const prev = latest.get(e.workerId); if (!prev || prev.at <= e.at) latest.set(e.workerId, e); }
  return [...latest.values()].filter((e) => e.kind === "check_in" && ymd(new Date(e.at)) !== todayYmd());
}
const visitorsOnSite = (pid) => DB.visitors.filter((v) => v.projectId === pid && !v.signedOutAt && ymd(new Date(v.signedInAt)) === todayYmd());

function myTasks(u) {
  const out = [];
  if (can(u, "variation.approve")) for (const v of listVariations(u).filter((v) => v.status === "submitted" || v.status === "under_review"))
    out.push({ title: `Approve ${v.ref} · ${v.title}`, sub: `${projName(v.projectId)} · ${money(v.amount)}`, href: `#/app/projects/${v.projectId}/commercial`, tone: "red" });
  for (const i of DB.itps) for (const p of i.points) {
    const mine = p.submittedBy === u.id && (p.type === "hold" || p.type === "witness"), signed = currentSignoffs(p).some((x) => x.userId === u.id);
    if (p.status === "submitted" && canSignOff(u, p) && !mine && !signed)
      out.push({ title: `${p.type === "hold" ? "Release hold point" : "Sign off"} · ${i.ref} ${p.name}`, sub: `${projName(i.projectId)} · ${p.evidence} photos attached`, href: `#/app/projects/${i.projectId}/quality/itp/${i.id}`, tone: p.type === "hold" ? "red" : "blue" });
    if (p.status === "rejected" && can(u, "itp.submit"))
      out.push({ title: `Redo inspection · ${i.ref} ${p.name}`, sub: `${projName(i.projectId)} · rejected, resubmit with new evidence`, href: `#/app/projects/${i.projectId}/quality/itp/${i.id}`, tone: "amber" });
  }
  if (can(u, "defect.verify")) for (const d of listDefects(u).filter((d) => d.status === "ready_for_verification"))
    out.push({ title: `Verify ${d.ref} · ${d.title}`, sub: `${projName(d.projectId)} · ${contractorOf(d.contractorId)?.tradingName ?? ""}`, href: `#/app/projects/${d.projectId}/quality/defects/${d.id}`, tone: "blue" });
  if (can(u, "swms.review")) for (const s of DB.swms.filter((s) => s.status === "submitted" || s.status === "in_review"))
    out.push({ title: `Review SWMS · ${s.title} v${s.version}`, sub: `${projName(s.projectId)} · ${contractorOf(s.contractorId)?.tradingName}`, href: `#/app/projects/${s.projectId}/safety/swms/${s.id}`, tone: "blue" });
  if (can(u, "commercial.view")) for (const c of DB.claims.filter((c) => c.status === "submitted"))
    out.push({ title: `Assess progress claim ${c.ref}`, sub: `${projName(c.projectId)} · response due ${dayMonth(c.dueDate)}`, href: `#/app/projects/${c.projectId}/commercial`, tone: "amber" });
  if (can(u, "documents.approve")) for (const d of DB.documents.filter((x) => x.status === "in_review"))
    out.push({ title: `Review ${d.number} rev ${d.revision} · ${d.title}`, sub: `${projName(d.projectId)} · uploaded ${dayMonth(d.uploadedAt)}`, href: `#/app/projects/${d.projectId}/documents/${d.id}`, tone: "blue" });
  if (can(u, "swms.submit")) for (const s of DB.swms.filter((x) => x.status === "changes_requested" && (u.role !== "subcontractor_admin" || x.contractorId === u.contractorId)))
    out.push({ title: `Revise SWMS · ${s.title} v${s.version}`, sub: `${projName(s.projectId)} · changes requested`, href: `#/app/projects/${s.projectId}/safety/swms/${s.id}`, tone: "amber" });
  if (can(u, "permit.approve")) for (const x of DB.permits.filter((x) => x.status === "requested" && x.requestedBy !== u.id))
    out.push({ title: `Approve permit ${x.ref} · ${x.type}`, sub: `${projName(x.projectId)} · ${x.location} · from ${dayMonth(x.validFrom)}`, href: `#/app/projects/${x.projectId}/safety/permits/${x.id}`, tone: "red" });
  if (can(u, "safety.manage")) for (const x of DB.incidents.filter((x) => x.status !== "closed" && x.type !== "observation"))
    out.push({ title: `Investigate ${x.ref} · ${x.title}`, sub: `${projName(x.projectId)} · ${words(x.severity)} severity`, href: `#/app/projects/${x.projectId}/safety/incidents/${x.id}`, tone: x.severity === "high" || x.severity === "critical" || x.notifiable ? "red" : "amber" });
  for (const n of listNcrs(u).filter((n) => n.status !== "closed")) {
    if (can(u, "ncr.manage") && n.status === "verification" && n.raisedBy !== u.id)
      out.push({ title: `Verify and close ${n.ref} · ${n.title}`, sub: projName(n.projectId), href: `#/app/projects/${n.projectId}/quality/ncrs/${n.id}`, tone: "blue" });
    else if (u.role === "subcontractor_admin" && (!n.rootCause || !n.correctiveAction))
      out.push({ title: `Respond to ${n.ref} · ${n.title}`, sub: `${projName(n.projectId)} · root cause and corrective action needed`, href: `#/app/projects/${n.projectId}/quality/ncrs/${n.id}`, tone: "amber" });
  }
  if (can(u, "attendance.manage")) for (const p of listProjects(u)) { const m = missingSignOuts(p.id); if (m.length) out.push({ title: `${m.length} missing sign-out${m.length > 1 ? "s" : ""}`, sub: `${p.name} · still signed in from an earlier day`, href: `#/app/projects/${p.id}/workforce`, tone: "amber" }); }
  if (u.role === "subcontractor_admin") for (const d of listDefects(u).filter((d) => d.status === "assigned" || d.status === "rectifying"))
    out.push({ title: `Rectify ${d.ref} · ${d.title}`, sub: projName(d.projectId), href: `#/app/projects/${d.projectId}/quality/defects/${d.id}`, tone: "amber" });
  const firstProject = listProjects(u)[0];
  if (u.role === "worker" && u.workerId && firstProject) {
    const r = workerRequirements(u.workerId, firstProject.id);
    for (const x of r?.reqs.filter((x) => x.severity !== "ok") ?? []) out.push({ title: `${x.label} — ${x.detail}`, sub: firstProject.name, href: "#/site/sign-in", tone: x.severity === "blocking" ? "red" : "amber" });
  }
  const rank = { red: 0, amber: 1, blue: 2 };
  return out.sort((a, b) => rank[a.tone] - rank[b.tone]);
}
function complianceExpiring(within = 30) {
  const out = [], today = new Date();
  for (const c of DB.contractors) for (const ins of c.insurances) {
    const days = daysBetween(today, D(ins.expires));
    if (days <= within) out.push({ who: c.tradingName, what: ins.type, sub: "Certificate of currency", days });
  }
  for (const cr of DB.credentials) {
    if (!cr.expires) continue;
    const days = daysBetween(today, D(cr.expires));
    if (days <= within) out.push({ who: DB.workers.find((w) => w.id === cr.workerId)?.name ?? "Worker", what: cr.type, sub: "High-risk work licence", days });
  }
  return out.sort((a, b) => a.days - b.days);
}
function notifications(u) {
  const out = [], od = overdueDefects(u);
  if (od.length) out.push({ title: `${od.length} defects overdue`, sub: "Across active projects", href: "#/app/reports?view=overdue", tone: "amber" });
  for (const c of complianceExpiring(14)) out.push({ title: `${c.who} — ${c.what}`, sub: c.days < 0 ? "Expired" : `Expires in ${c.days} days`, href: "#/app/people", tone: c.days < 0 ? "red" : "amber" });
  for (const i of DB.itps) for (const p of i.points.filter((p) => p.status === "rejected")) out.push({ title: `Inspection rejected · ${i.ref} ${p.name}`, sub: projName(i.projectId), href: `#/app/projects/${i.projectId}/quality/itp/${i.id}`, tone: "red" });
  for (const s of DB.swms.filter((x) => x.status === "approved" && x.reviewDue)) {
    const d = daysBetween(new Date(), D(s.reviewDue));
    if (d <= 14) out.push({ title: `SWMS review ${d < 0 ? "overdue" : "due"} · ${s.title} v${s.version}`, sub: `${projName(s.projectId)} · ${d < 0 ? `${-d} days ago` : `in ${d} days`}`, href: `#/app/projects/${s.projectId}/safety/swms/${s.id}`, tone: d < 0 ? "red" : "amber" });
  }
  // Hold points that need releasing before their task starts.
  for (const i of DB.itps) {
    const t = DB.tasks.find((x) => x.id === i.taskId);
    const open = i.points.filter((p) => p.type === "hold" && p.status !== "released");
    if (t && open.length && t.status !== "complete") {
      const d = daysBetween(new Date(), D(t.forecastStart));
      if (d <= 2) out.push({ title: `${i.ref} hold point${open.length > 1 ? "s" : ""} not released`, sub: `${projName(i.projectId)} · ${t.name} ${d < 0 ? "started" : d === 0 ? "starts today" : `starts in ${d} day${d > 1 ? "s" : ""}`}`, href: `#/app/projects/${i.projectId}/quality/itp/${i.id}`, tone: "red" });
    }
  }
  for (const x of DB.incidents.filter((x) => x.notifiable && x.status !== "closed")) out.push({ title: `Notifiable incident ${x.ref} open`, sub: `${projName(x.projectId)} · ${x.title}`, href: `#/app/projects/${x.projectId}/safety/incidents/${x.id}`, tone: "red" });
  for (const x of DB.permits.filter((x) => permitLive(x) && x.validTo === todayYmd())) out.push({ title: `Permit ${x.ref} ends today`, sub: `${projName(x.projectId)} · ${x.type} · ${x.location} — close it out when work stops`, href: `#/app/projects/${x.projectId}/safety/permits/${x.id}`, tone: "amber" });
  for (const p of DB.projects) { const nm = nextMilestoneOf(p), d = daysBetween(new Date(), D(nm.date)); if (d >= 0 && d <= 7) out.push({ title: `${nm.name} in ${d} days`, sub: p.name, href: `#/app/projects/${p.id}/programme`, tone: "blue" }); }
  return out;
}

