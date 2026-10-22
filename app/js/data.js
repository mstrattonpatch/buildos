// ===================================================== Supabase data layer
// Reads a company's records (Row Level Security limits them to what the
// signed-in person may see) and sends every change to a database function.

const sb = window.supabase.createClient(BUILDOS_CONFIG.supabaseUrl, BUILDOS_CONFIG.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

let DB = null;              // the current company's records, in the shape the pages use
let SESSION = null;         // Supabase auth session
let MY_ORGS = [];           // [{ id, name, role, isAdmin }]
const ORG_KEY = "buildos_org";
const prefs = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* storage blocked */ } },
};

const camelKey = (k) => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const camel = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [camelKey(k), v ?? undefined]));
const snakeKey = (k) => k.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());

async function selectAll(table, build = (q) => q) {
  const { data, error } = await build(sb.from(table).select("*").eq("org_id", DB_ORG_ID));
  if (error) throw new Error(`Couldn't load ${table}: ${error.message}`);
  return data.map(camel);
}
let DB_ORG_ID = null;

/** Call a database function. Its error message is shown to the user as-is. */
async function rpc(fn, args = {}) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new RuleError(friendlyError(error));
  return data;
}
function friendlyError(e) {
  const m = e?.message || String(e);
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "Can't reach the server. Check your connection and try again.";
  if (/JWT|token is expired|not authenticated/i.test(m)) return "Your session has expired. Please sign in again.";
  return m;
}

// ------------------------------------------------------------- session
async function loadMyOrgs() {
  const uid = SESSION.user.id;
  const { data: ms, error } = await sb.from("memberships").select("*").eq("user_id", uid);
  if (error) throw new Error(friendlyError(error));
  if (!ms.length) { MY_ORGS = []; return; }
  const { data: orgs, error: e2 } = await sb.from("organisations").select("*").in("id", ms.map((m) => m.org_id));
  if (e2) throw new Error(friendlyError(e2));
  MY_ORGS = ms.map((m) => ({ id: m.org_id, name: orgs.find((o) => o.id === m.org_id)?.name ?? "Company", role: m.role, isAdmin: m.is_admin }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function myProfile() {
  const { data } = await sb.from("profiles").select("*").eq("id", SESSION.user.id).maybeSingle();
  return data ? camel(data) : { id: SESSION.user.id, fullName: "", initials: "" };
}

// ---------------------------------------------------------- load company
async function loadCompany(orgId) {
  DB_ORG_ID = orgId;
  const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString();
  const T = [
    "memberships", "contractors", "insurances", "workers", "inductions", "credentials", "projects", "locations", "tasks",
    "defects", "itps", "itp_points", "swms", "swms_acks", "documents", "budget_lines", "variations", "claims", "diary",
  ];
  const [orgRes, profRes, attendance, audit, invitations, ...rows] = await Promise.all([
    sb.from("organisations").select("*").eq("id", orgId).single(),
    sb.from("profiles").select("*"),
    selectAll("attendance", (q) => q.gte("at", twoDaysAgo)),
    selectAll("audit_events", (q) => q.order("at", { ascending: false }).limit(300)),
    selectAll("invitations", (q) => q.is("accepted_at", null)),
    ...T.map((t) => selectAll(t)),
  ]);
  if (orgRes.error) throw new Error(friendlyError(orgRes.error));
  const r = Object.fromEntries(T.map((t, i) => [t, rows[i]]));
  const profiles = (profRes.data || []).map(camel);

  const db = {
    org: camel(orgRes.data),
    users: r.memberships.map((m) => {
      const p = profiles.find((x) => x.id === m.userId) || {};
      return { id: m.userId, orgId, name: p.fullName || p.email || "Member", initials: p.initials || "?", email: p.email, phone: p.phone, role: m.role, title: m.title, contractorId: m.contractorId, workerId: m.workerId, isAdmin: m.isAdmin };
    }),
    invitations,
    projects: r.projects.map((p) => ({ ...p, nextMilestone: { name: p.nextMilestoneName || "Practical completion", date: p.nextMilestoneDate || p.pcDate || ymd(new Date()) } }))
      .sort((a, b) => a.code.localeCompare(b.code)),
    locations: r.locations.sort((a, b) => `${a.building}${a.level}${a.zone}`.localeCompare(`${b.building}${b.level}${b.zone}`)),
    contractors: r.contractors.map((c) => ({ ...c, insurances: r.insurances.filter((i) => i.contractorId === c.id) })).sort((a, b) => a.tradingName.localeCompare(b.tradingName)),
    workers: r.workers.map((w) => ({ ...w, inductedProjectIds: r.inductions.filter((i) => i.workerId === w.id).map((i) => i.projectId) })).sort((a, b) => a.name.localeCompare(b.name)),
    credentials: r.credentials,
    tasks: r.tasks.map((t) => ({ ...t, predecessorIds: t.predecessorIds || [] })),
    defects: r.defects.map((d) => ({ ...d, photos: d.photos || [], evidencePhotos: d.evidencePhotos || [] })).sort((a, b) => b.ref.localeCompare(a.ref)),
    itps: r.itps.map((i) => ({ ...i, points: r.itp_points.filter((p) => p.itpId === i.id).sort((a, b) => a.seq - b.seq).map((p) => ({ ...p, check: p.checkText })) }))
      .sort((a, b) => a.ref.localeCompare(b.ref)),
    swms: r.swms.map((s) => ({ ...s, highRiskCategories: s.highRiskCategories || [], acknowledgedBy: r.swms_acks.filter((a) => a.swmsId === s.id).map((a) => a.workerId) })),
    documents: r.documents,
    attendance,
    budgetLines: r.budget_lines.sort((a, b) => a.costCode.localeCompare(b.costCode)),
    variations: r.variations.sort((a, b) => a.ref.localeCompare(b.ref)),
    claims: r.claims.sort((a, b) => a.ref.localeCompare(b.ref)),
    diary: r.diary.sort((a, b) => b.date.localeCompare(a.date)),
    audit,
    photoUrls: {},
  };
  await signPhotos(db);
  DB = db;
}

// Private photos are shown through short-lived signed links.
async function signPhotos(db) {
  const paths = uniq(db.defects.flatMap((d) => [...d.photos, ...d.evidencePhotos]).filter((p) => p && p.startsWith(db.org.id + "/")));
  if (!paths.length) return;
  const { data } = await sb.storage.from("photos").createSignedUrls(paths, 3600);
  for (const x of data || []) if (x.signedUrl) db.photoUrls[x.path] = x.signedUrl;
}

/** Downscale and upload photos to the company's private folder. Returns storage paths. */
async function uploadPhotos(input, max = 6) {
  const files = [...(input?.files || [])].slice(0, max);
  const paths = [];
  for (const f of files) {
    const blob = await downscale(f, 1600);
    const path = `${DB.org.id}/${crypto.randomUUID()}.jpg`;
    const { error } = await sb.storage.from("photos").upload(path, blob, { contentType: "image/jpeg", upsert: false });
    if (error) throw new RuleError(`Photo upload failed: ${friendlyError(error)}`);
    paths.push(path);
  }
  return paths;
}
function downscale(file, maxSide) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, maxSide / Math.max(img.width, img.height)), c = document.createElement("canvas");
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? res(b) : rej(new RuleError("Couldn't read that photo."))), "image/jpeg", 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new RuleError("Couldn't read that photo.")); };
    img.src = url;
  });
}

// ------------------------------------------------------- sample project
/** Convert the demo dataset into database rows with fresh IDs. Sample people map to you. */
function samplePayload(meId) {
  const seed = createSeed(new Date());
  const map = new Map();
  const add = (id) => { if (id && !map.has(id)) map.set(id, crypto.randomUUID()); };
  for (const u of seed.users) map.set(u.id, meId);
  for (const k of ["contractors", "workers", "projects", "locations", "tasks", "defects", "itps", "swms", "documents", "variations", "claims", "diary"]) for (const x of seed[k]) add(x.id);
  const id = (v) => (v == null ? null : map.get(v) ?? null);
  const pick = (o, keys) => Object.fromEntries(keys.map((k) => [snakeKey(k), o[k] ?? null]));
  const projectIds = new Set(seed.projects.map((p) => p.id));
  const workerIds = new Set(seed.workers.map((w) => w.id));
  return {
    contractors: seed.contractors.map((c) => ({ id: id(c.id), legal_name: c.legalName, trading_name: c.tradingName, abn: c.abn, trade: c.trade })),
    insurances: seed.contractors.flatMap((c) => c.insurances.map((i) => ({ id: crypto.randomUUID(), contractor_id: id(c.id), type: i.type, expires: i.expires, verified: i.verified }))),
    workers: seed.workers.map((w) => ({ id: id(w.id), name: w.name, contractor_id: id(w.contractorId), phone: w.phone })),
    projects: seed.projects.map((p) => ({
      ...pick(p, ["code", "name", "address", "client", "type", "status", "contractSum", "startDate", "pcDate", "plannedProgress", "verifiedProgress", "weather"]),
      id: id(p.id), pm_id: meId, next_milestone_name: p.nextMilestone.name, next_milestone_date: p.nextMilestone.date,
    })),
    locations: seed.locations.map((l) => ({ id: id(l.id), project_id: id(l.projectId), building: l.building, level: l.level, zone: l.zone })),
    inductions: seed.workers.flatMap((w) => w.inductedProjectIds.filter((p) => projectIds.has(p)).map((p) => ({ worker_id: id(w.id), project_id: id(p) }))),
    credentials: seed.credentials.map((c) => ({ id: crypto.randomUUID(), worker_id: id(c.workerId), type: c.type, number: c.number, expires: c.expires ?? null, status: c.status, verified_by: c.verifiedBy ? meId : null, verified_method: c.verifiedMethod ?? null })),
    swms: seed.swms.map((s) => ({ id: id(s.id), project_id: id(s.projectId), ref: s.ref, title: s.title, activity: s.activity, contractor_id: id(s.contractorId), version: s.version, status: s.status, high_risk_categories: s.highRiskCategories })),
    itps: seed.itps.map((i) => ({ id: id(i.id), project_id: id(i.projectId), ref: i.ref, title: i.title, template_version: i.templateVersion, task_id: id(i.taskId) })),
    tasks: seed.tasks.map((t) => ({
      ...pick(t, ["name", "trade", "baselineStart", "baselineFinish", "forecastStart", "forecastFinish", "isMilestone", "progress", "status"]),
      id: id(t.id), project_id: id(t.projectId), contractor_id: id(t.contractorId), predecessor_ids: t.predecessorIds.map(id), itp_id: id(t.itpId), swms_id: id(t.swmsId),
    })),
    itp_points: seed.itps.flatMap((i) => i.points.map((p, n) => ({ id: crypto.randomUUID(), itp_id: id(i.id), seq: n, name: p.name, check_text: p.check, type: p.type, status: p.status, evidence: p.evidence, released_by: p.releasedBy ? meId : null, released_at: p.releasedAt ?? null }))),
    swms_acks: seed.swms.flatMap((s) => s.acknowledgedBy.filter((w) => workerIds.has(w)).map((w) => ({ swms_id: id(s.id), worker_id: id(w) }))),
    defects: seed.defects.map((d) => ({
      ...pick(d, ["ref", "title", "description", "category", "room", "trade", "priority", "dueDate", "status", "raisedAt", "rectificationNote"]),
      id: id(d.id), project_id: id(d.projectId), location_id: id(d.locationId), contractor_id: id(d.contractorId), raised_by: meId,
      photos: [], evidence_photos: d.evidencePhotos.map(() => "sample"), verified_by: d.verifiedBy ? meId : null,
    })),
    documents: seed.documents.map((d) => ({ id: id(d.id), project_id: id(d.projectId), number: d.number, title: d.title, category: d.category, revision: d.revision, status: d.status, uploaded_by: meId, uploaded_at: d.uploadedAt })),
    attendance: seed.attendance.filter((a) => workerIds.has(a.workerId)).map((a) => ({ id: crypto.randomUUID(), project_id: id(a.projectId), worker_id: id(a.workerId), kind: a.kind, at: a.at, method: a.method })),
    budget_lines: seed.budgetLines.map((l) => ({ id: crypto.randomUUID(), project_id: id(l.projectId), cost_code: l.costCode, description: l.description, original_budget: l.originalBudget, committed: l.committed, actual: l.actual, forecast_final: l.forecastFinal })),
    variations: seed.variations.map((v) => ({ id: id(v.id), project_id: id(v.projectId), ref: v.ref, title: v.title, reason: v.reason, amount: v.amount, approved_amount: v.approvedAmount ?? null, time_impact_days: v.timeImpactDays, status: v.status, raised_at: v.raisedAt, approved_by: v.approvedBy ? meId : null, approved_at: v.approvedAt ?? null })),
    claims: seed.claims.map((c) => ({ id: id(c.id), project_id: id(c.projectId), ref: c.ref, period_end: c.periodEnd, due_date: c.dueDate, claimed: c.claimed, certified: c.certified ?? null, paid: c.paid ?? null, status: c.status })),
    diary: seed.diary.map((e) => ({ id: id(e.id), project_id: id(e.projectId), date: e.date, weather: e.weather, workers_on_site: e.workersOnSite, companies_on_site: e.companiesOnSite, notes: e.notes, delays: e.delays ?? null, author_id: meId, submitted: true })),
    audit_events: seed.audit.map((a) => ({ project_id: id(a.projectId), record_type: a.recordType, record_id: id(a.recordId) ?? a.recordId, action: a.action, actor_id: meId, at: a.at, detail: a.detail ?? null })),
  };
}
