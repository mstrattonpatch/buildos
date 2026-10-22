// ===================================================== AI help (blueprint §13)
// 1. "Read with AI" on upload forms: the document goes to the "ai" Edge Function, which returns the values it can read.
//    They're filled into the form and highlighted. Nothing is saved until the person checks them and presses save.
// 2. Scan a document (#/app/scan): read any document, then open the right form with it filled in.
// 3. Help chat: a question box on every page that knows BuildOS's pages and the person's role.
// The AI key lives in Supabase (Edge Function secret), never in this code.

const aiOn = () => !!(SESSION && DB && DB.org.aiEnabled !== false);
const AI_KINDS = {
  receipt: { label: "receipt", docType: "receipt" },
  bill: { label: "supplier invoice", docType: "bill" },
  credential: { label: "licence or ticket", docType: "credential" },
  insurance: { label: "certificate of currency", docType: "insurance" },
  document: { label: "drawing or document", docType: "drawing" },
  company_doc: { label: "company document", docType: "company_doc" },
};
const DOC_TYPE_LABEL = { receipt: "receipt", bill: "supplier invoice", credential: "licence or ticket", insurance: "certificate of currency", drawing: "drawing or document", company_doc: "company document", other: "document" };

async function aiCall(body) {
  if (!navigator.onLine) throw new RuleError("AI help needs a connection.");
  const { data, error } = await sb.functions.invoke("ai", { body: { ...body, org_id: DB.org.id } });
  if (error) {
    let msg = null;
    try { msg = (await error.context?.json())?.error; } catch { /* not JSON */ }
    throw new RuleError(msg || (error.name === "FunctionsFetchError" || error.name === "FunctionsRelayError" ? "Couldn't reach AI help. It may not be set up yet — ask a director to check." : "AI help isn't available right now."));
  }
  if (data?.error) throw new RuleError(data.error);
  return data;
}

const blobToBase64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = () => rej(new RuleError("Couldn't open that file.")); r.readAsDataURL(blob); });

/** Photos are shrunk before sending (sharper than the phone needs, and much faster). PDFs go as they are. */
async function aiFilePayload(file) {
  if (!file) throw new RuleError("Choose the file first, then press Read with AI.");
  const name = file.name || "upload";
  if (file.type === "application/pdf" || /\.pdf$/i.test(name)) {
    if (file.size > 12 * 1024 * 1024) throw new RuleError("That PDF is over 12 MB — too big for AI to read. Try just the pages you need.");
    return { media_type: "application/pdf", data: await blobToBase64(file), file_name: name };
  }
  if (file.type.startsWith("image/") || /\.(jpe?g|png|heic|webp|gif)$/i.test(name)) {
    let blob;
    try { blob = await downscale(file, 2000); } catch { throw new RuleError("Couldn't open that photo here. Try a JPG, PNG or PDF."); }
    return { media_type: "image/jpeg", data: await blobToBase64(blob), file_name: name };
  }
  throw new RuleError("AI can read PDFs and photos. For a Word file, save it as a PDF first.");
}

async function aiRead(file, expect) {
  return aiCall({ action: "read", expect: expect ? AI_KINDS[expect]?.docType : undefined, ...(await aiFilePayload(file)), today: todayYmd(),
    options: { credential_types: CREDENTIAL_TYPES, insurance_types: INSURANCE_TYPES, categories: DOC_CATEGORIES, company_doc_kinds: COMPANY_DOC_KINDS } });
}

// ---- matching what was read to records in BuildOS
const norm = (s) => String(s ?? "").toLowerCase().replace(/\b(pty|ltd|limited|p\/l|the|australia|aust)\b/g, "").replace(/[^a-z0-9]/g, "");
function closest(v, list) {
  if (!v) return null;
  const n = norm(v);
  return list.find((x) => norm(x) === n) || list.find((x) => n && (norm(x).includes(n) || n.includes(norm(x)))) || null;
}
function matchContractor(name, abn) {
  const digits = String(abn ?? "").replace(/\D/g, "");
  if (digits.length === 11) { const c = DB.contractors.find((x) => String(x.abn ?? "").replace(/\D/g, "") === digits); if (c) return c; }
  const n = norm(name);
  if (!n) return null;
  return DB.contractors.find((c) => [c.tradingName, c.legalName].some((x) => norm(x) === n))
    || DB.contractors.find((c) => [c.tradingName, c.legalName].some((x) => norm(x) && (norm(x).includes(n) || n.includes(norm(x))))) || null;
}
function matchWorker(name) {
  const n = norm(name);
  if (!n) return null;
  const parts = String(name).toLowerCase().split(/\s+/).filter(Boolean);
  return DB.workers.find((w) => norm(w.name) === n) || DB.workers.find((w) => parts.length > 1 && parts.every((p) => w.name.toLowerCase().includes(p))) || null;
}
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
const dollars = (v) => (num(v) === null ? null : (Math.round(v * 100) / 100).toFixed(2));

/** Form field → value, for each kind of form. */
function aiValues(kind, f) {
  const exGst = num(f.amount_ex_gst) ?? (num(f.total) !== null && num(f.gst) !== null ? f.total - f.gst : null);
  switch (kind) {
    case "receipt": return { supplier: f.supplier, amount: dollars(f.total ?? (exGst !== null && num(f.gst) !== null ? exGst + f.gst : null)), date: isDate(f.date) ? f.date : null, note: f.description };
    case "bill": return { contractor_id: matchContractor(f.supplier, f.abn)?.id, invoice_number: f.invoice_number, invoice_date: isDate(f.invoice_date) ? f.invoice_date : null, due_date: isDate(f.due_date) ? f.due_date : null, amount: dollars(exGst), gst: dollars(f.gst), description: f.description };
    case "credential": return { type: closest(f.credential_type, CREDENTIAL_TYPES) ?? f.credential_type, number: f.number, issuer: f.issuer, expires: isDate(f.expires) ? f.expires : null };
    case "insurance": return { type: closest(f.insurance_type, INSURANCE_TYPES), insurer: f.insurer, policy_number: f.policy_number, cover_limit: num(f.cover_limit) === null ? null : Math.round(f.cover_limit).toLocaleString("en-AU"), expires: isDate(f.expires) ? f.expires : null };
    case "document": return { number: f.doc_number, revision: f.revision, title: f.title, category: closest(f.category, DOC_CATEGORIES), description: f.description };
    case "company_doc": return { kind: closest(f.company_doc_kind, COMPANY_DOC_KINDS) ?? "Other", title: f.title, expires: isDate(f.expires) ? f.expires : null };
    default: return {};
  }
}

/** Put the values into the form. Only fields the AI could read are touched; each one is highlighted until edited. */
function aiFill(formEl, kind, result) {
  const filled = [];
  for (const [name, v] of Object.entries(aiValues(kind, result.fields || {}))) {
    if (v === null || v === undefined || v === "") continue;
    const el = formEl.querySelector(`[name="${name}"]`);
    if (!el || el.type === "hidden" || el.disabled) continue;
    if (el.tagName === "SELECT") {
      const opt = [...el.options].find((o) => o.value === String(v)) || [...el.options].find((o) => o.textContent.trim().toLowerCase() === String(v).toLowerCase());
      if (!opt) continue;
      el.value = opt.value;
    } else el.value = String(v).slice(0, 200);
    el.classList.add("ai-filled");
    el.addEventListener("input", () => el.classList.remove("ai-filled"), { once: true });
    el.addEventListener("change", () => el.classList.remove("ai-filled"), { once: true });
    filled.push(name);
  }
  return filled;
}

function aiResultNote(kind, result, filledCount) {
  const f = result.fields || {}, want = AI_KINDS[kind]?.docType, extra = [];
  if (want && result.doc_type !== want && result.doc_type !== "other") extra.push(`This looks like a ${DOC_TYPE_LABEL[result.doc_type]}, not a ${AI_KINDS[kind].label}. <a href="#/app/scan">Scan a document</a> sends it to the right place.`);
  if (isDate(f.expires) && f.expires < todayYmd()) extra.push(`It expired on ${dayMonth(f.expires)}.`);
  if (kind === "bill" && (f.supplier || f.abn) && !matchContractor(f.supplier, f.abn)) extra.push(`“${esc(f.supplier || `ABN ${f.abn}`)}” isn't one of your contractors yet — choose the company, or add it under People &amp; contractors.`);
  const checks = [...(result.checks || []).map(esc), ...extra];
  return `<div class="ai-note" role="status"><div class="row" style="gap:8px;flex-wrap:wrap">${icon("sparkle", 15)}<b>Read by AI</b>${badge(result.confidence === "high" ? "approved" : result.confidence === "low" ? "expiring" : "pending", `${result.confidence || "medium"} confidence`)}</div>
    <p class="small" style="margin:6px 0 0">${esc(result.summary || "")}${result.summary ? " " : ""}${filledCount ? `Filled ${filledCount} field${filledCount > 1 ? "s" : ""} (highlighted) — <b>check them before saving</b>.` : "Nothing could be filled in — please enter the details yourself."}</p>
    ${checks.length ? `<ul class="small">${checks.map((c) => `<li>${c}</li>`).join("")}</ul>` : ""}</div>`;
}

/** The button that goes on an upload form, next to its file field. */
const aiReadButton = (kind) => aiOn() ? `<div class="ai-read full"><button type="button" class="btn btn-ghost btn-ai" data-ai-read="${kind}">${icon("sparkle", 15)} Read with AI</button><span class="small muted" data-ai-status>Fills in the details from the file — you check them before saving.</span><div data-ai-panel></div></div>` : "";

async function runAiRead(btn, file = null) {
  const formEl = btn.closest("form"), kind = btn.dataset.aiRead, status = formEl.querySelector("[data-ai-status]"), panel = formEl.querySelector("[data-ai-panel]");
  file ||= formEl.querySelector('input[type=file][name="file"], input[type=file][name="photo"]')?.files?.[0];
  btn.disabled = true; btn.setAttribute("aria-busy", "true"); status.textContent = "Reading…"; panel.innerHTML = "";
  try {
    const result = await aiRead(file, kind);
    const filled = aiFill(formEl, kind, result);
    panel.innerHTML = aiResultNote(kind, result, filled.length);
    status.textContent = "";
    return result;
  } catch (e) {
    status.textContent = "";
    panel.innerHTML = `<div class="ai-note ai-error" role="alert">${icon("alert", 15)} ${esc(e instanceof RuleError ? e.message : "Couldn't read that file. Please try again.")}</div>`;
  } finally { btn.disabled = false; btn.removeAttribute("aria-busy"); }
}

// ---- Scan a document: read first, then choose where it goes
let SCAN = { file: null, result: null, busy: false, error: null };
let AI_PENDING = null; // { kind, result, file } waiting for the destination page to render

const SCAN_DEST = {
  bill: { kind: "bill", pick: "project", perm: "cost.manage", go: (id) => `/app/projects/${id}/commercial/bills`, label: "Enter the bill" },
  receipt: { kind: "receipt", pick: null, perm: "receipt.submit", go: () => "/site/receipt", label: "Send the receipt" },
  credential: { kind: "credential", pick: "worker", perm: null, go: (id) => `/app/people/workers/${id}`, label: "Add to their wallet" },
  insurance: { kind: "insurance", pick: "contractor", perm: "people.manage", go: (id) => `/app/people/contractors/${id}`, label: "Add the insurance" },
  company_doc: { kind: "company_doc", pick: "contractor", perm: "people.manage", go: (id) => `/app/people/contractors/${id}`, label: "Add the document" },
  drawing: { kind: "document", pick: "project", perm: "documents.upload", go: (id) => `/app/projects/${id}/documents`, label: "Upload the document" },
};

function scanFieldsTable(f) {
  const rows = Object.entries(f || {}).filter(([, v]) => v !== null && v !== "").map(([k, v]) => `<tr><th>${esc(words(k).replace(/^./, (c) => c.toUpperCase()))}</th><td>${esc(typeof v === "number" ? (k === "cover_limit" ? money(v * 100, { compact: true }) : `$${v.toFixed(2)}`) : isDate(v) ? new Date(`${v}T00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : v)}</td></tr>`);
  return rows.length ? `<table class="kv-table"><tbody>${rows.join("")}</tbody></table>` : '<p class="small muted">No details could be read.</p>';
}

function scanDestination(u, r) {
  const d = SCAN_DEST[r.doc_type];
  if (!d) return '<p class="small">We couldn\'t tell where this belongs. You can still upload it on a project\'s <b>Documents</b> page.</p>';
  if (d.perm && !can(u, d.perm) && !(r.doc_type === "credential")) return `<p class="small">Your role can't add a ${DOC_TYPE_LABEL[r.doc_type]}. Ask a director or project manager.</p>`;
  const f = r.fields || {};
  let pick = "";
  if (d.pick === "project") pick = field("Project", `<select name="dest" class="input">${listProjects(u).map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select>`);
  if (d.pick === "worker") {
    const workers = can(u, "people.manage") ? DB.workers : DB.workers.filter((w) => w.id === u.workerId || (u.role === "subcontractor_admin" && w.contractorId === u.contractorId));
    const m = matchWorker(f.person_name);
    pick = field(`Whose is it?${f.person_name ? ` <span class="muted">(card says ${esc(f.person_name)})</span>` : ""}`, `<select name="dest" class="input"><option value="">Choose…</option>${workers.map((w) => `<option value="${w.id}"${m?.id === w.id || (!m && w.id === u.workerId) ? " selected" : ""}>${esc(w.name)}</option>`).join("")}</select>`);
  }
  if (d.pick === "contractor") {
    const m = matchContractor(f.insured_name || f.supplier, f.abn);
    pick = field(`Which company?${f.insured_name || f.supplier ? ` <span class="muted">(document says ${esc(f.insured_name || f.supplier)})</span>` : ""}`, `<select name="dest" class="input"><option value="">Choose…</option>${DB.contractors.map((c) => `<option value="${c.id}"${m?.id === c.id ? " selected" : ""}>${esc(c.tradingName)}</option>`).join("")}</select>`);
  }
  return `<div class="stack" style="gap:10px">${pick}<div><button class="btn btn-primary" type="button" data-scan-go="${r.doc_type}">${d.label} →</button></div>
    <p class="small muted">Opens the form with these details and the file filled in. Nothing is saved until you check it and press save.</p></div>`;
}

function pageScan(u) {
  const r = SCAN.result;
  return `${pageHeader({ title: "Scan a document", meta: "<span>Upload a receipt, supplier invoice, licence or ticket, certificate of currency or drawing — AI reads it and fills in the right form.</span>" })}
  ${!aiOn() ? `<section class="card card-pad"><p>AI help is switched off for ${esc(DB.org.name)}. ${can(u, "project.manage") ? 'Turn it on in <a href="#/app/settings">Team &amp; roles</a>.' : "A director or project manager can turn it on in Team &amp; roles."}</p></section>` : `
  <div class="two-col">
    <section class="card card-pad"><h2 style="margin-bottom:12px">1. Choose the file</h2>
      <div class="stack">${field("Document <span class=\"muted\">(PDF or photo)</span>", '<input type="file" name="scan" accept=".pdf,image/*" class="input" style="padding:8px" data-scan-file>')}
      ${SCAN.file ? `<p class="small muted">Chosen: <b>${esc(SCAN.file.name)}</b> (${Math.max(1, Math.round(SCAN.file.size / 1024))} KB)</p>` : ""}
      <div><button class="btn btn-primary" type="button" data-scan-read${SCAN.busy ? " disabled aria-busy=\"true\"" : ""}>${icon("sparkle", 15)} ${SCAN.busy ? "Reading…" : "Read with AI"}</button></div>
      ${SCAN.error ? `<div class="ai-note ai-error" role="alert">${icon("alert", 15)} ${esc(SCAN.error)}</div>` : ""}
      <p class="small muted">The file is sent to the AI service to be read and isn't kept there. It's only saved in BuildOS when you save the form.</p></div>
    </section>
    <section class="card card-pad"><h2 style="margin-bottom:12px">2. Check and send it where it belongs</h2>
      ${r ? `<div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:6px"><b>Looks like a ${DOC_TYPE_LABEL[r.doc_type] || "document"}</b>${badge(r.confidence === "high" ? "approved" : r.confidence === "low" ? "expiring" : "pending", `${r.confidence} confidence`)}</div>
        <p class="small" style="margin-top:0">${esc(r.summary || "")}</p>${scanFieldsTable(r.fields)}
        ${r.checks?.length ? `<ul class="small">${r.checks.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
        <div style="margin-top:14px">${scanDestination(u, r)}</div>` : '<p class="muted small">The details will appear here.</p>'}
    </section>
  </div>`}`;
}

/** After a page renders: if the scan page sent us here, fill in the form waiting on this page. */
function afterAiRender() {
  if (!AI_PENDING) return;
  const btn = document.querySelector(`[data-ai-read="${AI_PENDING.kind}"]`);
  const { kind, result, file } = AI_PENDING;
  AI_PENDING = null;
  if (!btn) { toast("You can't add that on this page with your role.", "error"); return; }
  const formEl = btn.closest("form");
  const input = formEl.querySelector('input[type=file][name="file"], input[type=file][name="photo"]');
  const attachable = input && !(input.name === "photo" && file.type === "application/pdf");
  if (attachable) { const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files; }
  const filled = aiFill(formEl, kind, result);
  formEl.querySelector("[data-ai-panel]").innerHTML = aiResultNote(kind, result, filled.length) + (attachable ? "" : '<p class="small amber-text">Add a photo of the receipt before sending.</p>');
  formEl.closest("details")?.setAttribute("open", "");
  formEl.scrollIntoView({ block: "center" });
}

// ---- help chat
let HELP = { open: false, busy: false, messages: [] };
try { HELP.messages = JSON.parse(sessionStorage.getItem("buildos-help") || "[]").slice(-20); } catch { /* private mode */ }
const saveHelp = () => { try { sessionStorage.setItem("buildos-help", JSON.stringify(HELP.messages.slice(-20))); } catch { /* full */ } };

/** Safe, tiny markdown: escape everything, then allow **bold**, `code`, in-app links and simple lists. */
function helpMarkdown(s) {
  const inline = (t) => esc(t)
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((#\/[A-Za-z0-9/_\-?=&.%]*)\)/g, '<a href="$2" data-help-link>$1</a>');
  const out = []; let list = null;
  for (const line of String(s).split("\n")) {
    const m = line.match(/^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/);
    if (m) { const tag = m[1] ? "ol" : "ul"; if (list !== tag) { if (list) out.push(`</${list}>`); out.push(`<${tag}>`); list = tag; } out.push(`<li>${inline(m[2])}</li>`); continue; }
    if (list) { out.push(`</${list}>`); list = null; }
    if (line.trim()) out.push(`<p>${inline(line.replace(/^#+\s*/, ""))}</p>`);
  }
  if (list) out.push(`</${list}>`);
  return out.join("");
}

const HELP_STARTERS = ["How do I enter a supplier invoice?", "Where do I release a hold point?", "How do workers upload their white card?", "Something isn't saving — what do I check?"];

function helpPanelHtml() {
  const msgs = HELP.messages.map((m) => `<div class="help-msg ${m.role}">${m.role === "user" ? esc(m.content) : helpMarkdown(m.content)}</div>`).join("");
  return `<div class="help-head"><b>${icon("sparkle", 15)} Ask BuildOS</b><span class="spacer"></span>${HELP.messages.length ? '<button type="button" class="link small" data-help-clear>New chat</button>' : ""}<button type="button" class="icon-btn" data-help-toggle aria-label="Close help">${icon("x", 16)}</button></div>
    <div class="help-list" id="help-list" aria-live="polite">${msgs || `<p class="small muted">Ask how to do something in BuildOS, or where to find it. I know the pages and what your role can do.</p><div class="help-starters">${HELP_STARTERS.map((q) => `<button type="button" class="chip" data-help-ask="${esc(q)}">${esc(q)}</button>`).join("")}</div>`}
    ${HELP.busy ? '<div class="help-msg assistant muted">Thinking…</div>' : ""}</div>
    <form class="help-form" data-help-form><label class="sr-only" for="help-q">Your question</label><textarea id="help-q" name="q" rows="1" class="input" placeholder="${navigator.onLine ? "Ask a question…" : "Help needs a connection"}" maxlength="2000"${HELP.busy || !navigator.onLine ? " disabled" : ""}></textarea><button class="btn btn-primary" ${HELP.busy || !navigator.onLine ? "disabled" : ""}>Ask</button></form>
    <p class="help-foot">AI answers can be wrong — check before acting on anything important.</p>`;
}

function renderHelp() {
  let root = document.getElementById("help-root");
  const show = aiOn() && !!currentUser();
  if (!show) { root?.remove(); return; }
  if (!root) { root = document.createElement("div"); root.id = "help-root"; document.body.appendChild(root); }
  const onSite = location.hash.startsWith("#/site");
  root.className = `help-root${onSite ? " on-site" : ""}`;
  root.innerHTML = HELP.open
    ? `<section class="help-panel" role="dialog" aria-label="Ask BuildOS">${helpPanelHtml()}</section>`
    : `<button type="button" class="help-fab" data-help-toggle aria-label="Ask BuildOS for help">${icon("sparkle", 18)}<span>Help</span></button>`;
  const list = document.getElementById("help-list");
  if (list) list.scrollTop = list.scrollHeight;
}

function helpContext(u) {
  const { path } = parseRoute();
  return { name: u.name, company: DB.org.name, role: ROLE_LABEL[u.role], permissions: GRANTS[u.role] || [], page: path, page_title: document.title.replace(/ · BuildOS$/, ""),
    site_app: path.startsWith("/site"), today: todayYmd(), projects: listProjects(u).map((p) => ({ id: p.id, name: p.name })) };
}

async function askHelp(q) {
  q = q.trim();
  if (!q || HELP.busy) return;
  HELP.messages.push({ role: "user", content: q.slice(0, 2000) });
  HELP.busy = true; renderHelp();
  try {
    const r = await aiCall({ action: "chat", messages: HELP.messages.slice(-16), context: helpContext(currentUser()) });
    HELP.messages.push({ role: "assistant", content: r.reply });
  } catch (e) {
    HELP.messages.pop();
    HELP.messages.push({ role: "user", content: q }, { role: "assistant", content: `Sorry — ${e instanceof RuleError ? e.message : "something went wrong. Please try again."}`, error: true });
  }
  HELP.busy = false; saveHelp(); renderHelp();
  document.getElementById("help-q")?.focus();
}

// ---- events
document.addEventListener("click", async (e) => {
  const t = e.target.closest?.("[data-ai-read],[data-scan-read],[data-scan-go],[data-help-toggle],[data-help-ask],[data-help-clear],[data-help-link]");
  if (!t) return;
  if (t.matches("[data-ai-read]")) { e.preventDefault(); await runAiRead(t); return; }
  if (t.matches("[data-scan-read]")) {
    const input = document.querySelector("[data-scan-file]");
    if (input?.files?.[0]) SCAN.file = input.files[0];
    if (!SCAN.file) { SCAN.error = "Choose the file first."; render(); return; }
    SCAN = { ...SCAN, busy: true, error: null, result: null }; render();
    try { SCAN.result = await aiRead(SCAN.file, null); } catch (err) { SCAN.error = err instanceof RuleError ? err.message : "Couldn't read that file. Please try again."; }
    SCAN.busy = false; render(); return;
  }
  if (t.matches("[data-scan-go]")) {
    const d = SCAN_DEST[t.dataset.scanGo], dest = document.querySelector('[name="dest"]')?.value;
    if (d.pick && !dest) { toast(`Choose the ${d.pick} first.`, "error"); return; }
    AI_PENDING = { kind: d.kind, result: SCAN.result, file: SCAN.file };
    SCAN = { file: null, result: null, busy: false, error: null };
    go(d.go(dest)); return;
  }
  if (t.matches("[data-help-toggle]")) { HELP.open = !HELP.open; renderHelp(); if (HELP.open) document.getElementById("help-q")?.focus(); return; }
  if (t.matches("[data-help-ask]")) { await askHelp(t.dataset.helpAsk); return; }
  if (t.matches("[data-help-clear]")) { HELP.messages = []; saveHelp(); renderHelp(); return; }
  if (t.matches("[data-help-link]") && matchMedia("(max-width: 700px)").matches) { HELP.open = false; setTimeout(renderHelp, 0); }
});
document.addEventListener("change", (e) => { if (e.target.matches?.("[data-scan-file]") && e.target.files?.[0]) { SCAN = { file: e.target.files[0], result: null, busy: false, error: null }; render(); } });
document.addEventListener("submit", (e) => {
  if (!e.target.matches?.("[data-help-form]")) return;
  e.preventDefault(); e.stopPropagation();
  const q = e.target.q.value; e.target.q.value = ""; askHelp(q);
}, true);
document.addEventListener("keydown", (e) => {
  if (e.target.id === "help-q" && e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.target.form.requestSubmit(); }
  if (e.key === "Escape" && HELP.open) { HELP.open = false; renderHelp(); }
});
window.addEventListener("online", renderHelp);
window.addEventListener("offline", renderHelp);
