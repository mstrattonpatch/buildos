// ===================================================== offline drafts (blueprint §10)
// Site work can be captured without a signal: defects, inspections, diary entries, site notes,
// hours, receipts and finished tasks are kept on the phone (encrypted) and sent when the
// connection returns. Approvals are never queued — they need a live permission check.
// Everything stored here is wiped on sign-out.

const OUTBOX_OK = new Set(["createDefect", "submitPoint", "diary", "sendSiteNote", "createTimesheet", "submitReceipt", "taskDone"]);
const OUTBOX_LABEL = { createDefect: "Defect", submitPoint: "Inspection", diary: "Site diary", sendSiteNote: "Diary note", createTimesheet: "Hours", submitReceipt: "Receipt", taskDone: "Finished task" };
let OUTBOX = [];          // cached list (decrypted metadata) for the UI
let SYNCING = false, SNAPSHOT_AT = null;

// ---- IndexedDB with an AES-GCM key that can't be read out of the browser
const idb = (() => {
  let dbp = null;
  const open = () => (dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open("buildos-offline", 1);
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore("outbox", { keyPath: "id" }); d.createObjectStore("kv"); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = async (store, mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction(store, mode), s = t.objectStore(store), out = fn(s); t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out); t.onerror = () => rej(t.error); }); };
  return {
    all: () => tx("outbox", "readonly", (s) => s.getAll()),
    put: (v) => tx("outbox", "readwrite", (s) => s.put(v)),
    del: (id) => tx("outbox", "readwrite", (s) => s.delete(id)),
    get: (k) => tx("kv", "readonly", (s) => s.get(k)),
    set: (k, v) => tx("kv", "readwrite", (s) => s.put(v, k)),
    wipe: async () => { await tx("outbox", "readwrite", (s) => s.clear()); await tx("kv", "readwrite", (s) => s.clear()); },
  };
})();
async function offlineKey() {
  let k = await idb.get("key");
  if (!k) { k = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]); await idb.set("key", k); }
  return k;
}
async function seal(bytes) { const iv = crypto.getRandomValues(new Uint8Array(12)); return { iv, data: await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await offlineKey(), bytes) }; }
async function unseal(box) { return crypto.subtle.decrypt({ name: "AES-GCM", iv: box.iv }, await offlineKey(), box.data); }
const sealJson = async (o) => seal(new TextEncoder().encode(JSON.stringify(o)));
const unsealJson = async (b) => JSON.parse(new TextDecoder().decode(await unseal(b)));

const isNetworkError = (e) => !navigator.onLine || /Failed to fetch|NetworkError|Load failed|Can't reach the server|ERR_INTERNET|network/i.test(e?.message || String(e));

/** Save a form submission for later. Fields and files are encrypted; only the label and status stay readable. */
async function saveDraft(act, el, fd) {
  const fields = [], files = [];
  for (const [k, v] of fd.entries()) if (!(v instanceof File)) fields.push([k, String(v)]);
  fields.push(["_savedOn", todayYmd()]); // a diary entry or note saved offline belongs to the day it was written
  for (const input of el.querySelectorAll("input[type=file]")) for (const file of input.files || []) files.push({ name: input.name, fileName: file.name, type: file.type, box: await seal(await file.arrayBuffer()) });
  const draft = { id: crypto.randomUUID(), act, label: `${OUTBOX_LABEL[act]}${fd.get("title") ? ` · ${String(fd.get("title")).slice(0, 60)}` : ""}`, userId: SESSION?.user.id, orgId: DB?.org.id,
    createdAt: new Date().toISOString(), status: "waiting", error: null, attempts: 0, box: await sealJson({ fields, dataset: { ...el.dataset } }), files };
  await idb.put(draft);
  await loadOutbox();
  return draft;
}

/** Rebuild the form so the normal action code can run unchanged (photos included). */
async function draftForm(d) {
  const { fields, dataset } = await unsealJson(d.box), el = document.createElement("form");
  Object.assign(el.dataset, dataset);
  for (const [k, v] of fields) { const i = document.createElement("input"); i.type = "hidden"; i.name = k; i.value = v; el.appendChild(i); }
  const byName = {};
  for (const f of d.files) (byName[f.name] ||= []).push(new File([await unseal(f.box)], f.fileName, { type: f.type }));
  for (const [name, list] of Object.entries(byName)) {
    const i = document.createElement("input"); i.type = "file"; i.name = name; i.multiple = true;
    if (name === "photos" && el.dataset.act === "createDefect") i.setAttribute("data-photo-input", "");
    const dt = new DataTransfer(); list.forEach((x) => dt.items.add(x)); i.files = dt.files; el.appendChild(i);
  }
  return el;
}

async function loadOutbox() {
  try { OUTBOX = (await idb.all()).filter((d) => d.userId === SESSION?.user.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)); } catch { OUTBOX = []; }
  updateSyncUI();
  return OUTBOX;
}

/** Send everything waiting, oldest first. A refusal from the server is kept (with the reason) for the person to see. */
async function syncOutbox({ quiet = false } = {}) {
  if (SYNCING || !navigator.onLine || !SESSION || !DB) return;
  const waiting = (await loadOutbox()).filter((d) => d.status !== "failed" && d.orgId === DB.org.id);
  if (!waiting.length) return;
  SYNCING = true; updateSyncUI();
  let sent = 0, failed = 0;
  for (const d of waiting) {
    try {
      const el = await draftForm(d);
      await ACTIONS[d.act](new FormData(el), currentUser(), el);
      await idb.del(d.id); sent++;
    } catch (e) {
      if (isNetworkError(e)) { d.attempts++; await idb.put(d); break; }
      d.status = "failed"; d.error = e.message || String(e); await idb.put(d); failed++;
    }
  }
  SYNCING = false;
  await loadOutbox();
  if (sent) { try { await refresh(); } catch { /* shown next time */ } render(); }
  if (!quiet && (sent || failed)) toast(`${sent ? `${sent} saved item${sent > 1 ? "s" : ""} sent` : ""}${sent && failed ? " · " : ""}${failed ? `${failed} couldn't be sent — see Outbox` : ""}.`, failed ? "error" : "ok");
}

// ---- status shown in the site app and the office top bar
function syncText() {
  const waiting = OUTBOX.filter((d) => d.status !== "failed").length, failed = OUTBOX.filter((d) => d.status === "failed").length;
  if (SYNCING) return ["blue", `Sending ${waiting}…`];
  if (failed) return ["red", `${failed} couldn't be sent`];
  if (!navigator.onLine) return ["amber", waiting ? `Offline · ${waiting} waiting to send` : SNAPSHOT_AT ? `Offline · showing data from ${timeOf(SNAPSHOT_AT)}` : "Offline"];
  if (waiting) return ["amber", `${waiting} waiting to send`];
  return null;
}
const syncBar = () => `<a class="sync-bar" href="#/site/outbox" data-sync-bar hidden></a>`;
function updateSyncUI() {
  const t = syncText();
  document.querySelectorAll("[data-sync-bar]").forEach((el) => { el.hidden = !t; if (t) { el.dataset.tone = t[0]; el.textContent = t[1]; } });
}

function pageOutbox(u, route) {
  const list = OUTBOX;
  return siteWrap(`<div class="site-top"><a href="#/site" class="link">Back</a><b>Outbox</b><span style="width:40px"></span></div><div class="site-body">
    <p class="small muted">Things you saved without a signal. They're sent automatically when you're back online. Approvals always need a live connection, so they're never saved here.</p>
    <div class="list-card">${list.map((d) => `<div class="li" style="justify-content:space-between;gap:10px;align-items:flex-start"><span style="min-width:0"><b style="display:block;font-size:15px">${esc(d.label)}</b><span class="muted small">Saved ${dateTime(d.createdAt)}${d.attempts ? ` · ${d.attempts} attempt${d.attempts > 1 ? "s" : ""}` : ""}</span>${d.error ? `<span class="small red-text" style="display:block">${esc(d.error)}</span>` : ""}</span>
      <span class="stack" style="gap:6px;align-items:flex-end">${badge(d.status === "failed" ? "rejected" : "pending", d.status === "failed" ? "Not sent" : "Waiting")}<button class="link small" type="button" data-outbox-discard="${d.id}">Discard</button></span></div>`).join("") || '<div class="li muted">Nothing waiting — everything has been sent.</div>'}</div>
    ${list.length ? `<button class="btn btn-primary btn-lg btn-block" type="button" data-outbox-retry${navigator.onLine ? "" : " disabled"}>${navigator.onLine ? "Send now" : "Waiting for a connection"}</button>` : ""}
  </div>${siteTabs(route)}`);
}

// ---- encrypted copy of the last data loaded, so the app still opens offline
async function saveSnapshot() {
  if (!DB || !SESSION) return;
  try { const { photoUrls, fileUrls, ...rest } = DB; await idb.set("snapshot", { userId: SESSION.user.id, orgId: DB.org.id, at: new Date().toISOString(), box: await sealJson(rest) }); } catch { /* storage full or blocked */ }
}
async function loadSnapshot() {
  try {
    const s = await idb.get("snapshot");
    if (!s || s.userId !== SESSION?.user.id) return false;
    DB = { ...(await unsealJson(s.box)), photoUrls: {}, fileUrls: {} };
    SNAPSHOT_AT = s.at;
    return true;
  } catch { return false; }
}
async function wipeOffline() { OUTBOX = []; SNAPSHOT_AT = null; try { await idb.wipe(); } catch { /* nothing stored */ } }

document.addEventListener("click", async (e) => {
  const dis = e.target.closest?.("[data-outbox-discard]");
  if (dis) { if (!confirm("Discard this? It hasn't been sent.")) return; await idb.del(dis.dataset.outboxDiscard); await loadOutbox(); render(); return; }
  if (e.target.closest?.("[data-outbox-retry]")) {
    for (const d of OUTBOX.filter((x) => x.status === "failed")) { d.status = "waiting"; d.error = null; await idb.put(d); }
    await syncOutbox(); render();
  }
});
window.addEventListener("online", () => { updateSyncUI(); syncOutbox(); });
window.addEventListener("offline", updateSyncUI);
setInterval(() => { if (navigator.onLine && OUTBOX.some((d) => d.status !== "failed")) syncOutbox({ quiet: true }); }, 20000);
