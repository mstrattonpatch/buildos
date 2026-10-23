// Starts the demo: the database in the browser, sample data on first visit, a role picker, then the real app.
import * as backend from "./backend.js";
import { seed, DEMO_PEOPLE, DEMO_PASSWORD } from "./seed.js";

window.BUILDOS_DEMO = { fetch: backend.demoFetch, fileUrl: backend.fileUrl };
window.BUILDOS_CONFIG = { supabaseUrl: backend.API, supabaseKey: "demo" };

const root = document.getElementById("root");
const loading = (msg) => { root.innerHTML = `<div class="demo-loading" role="status"><div class="demo-spinner"></div><b>Opening the BuildOS demo</b><span>${msg}</span></div>`; };
const loadScript = (src) => new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error(`Couldn't load ${src}`)); document.body.appendChild(s); });
const appScripts = (names) => names.reduce((p, n) => p.then(() => loadScript(`../app/js/${n}.js`)), Promise.resolve());

function picker() {
  return new Promise((resolve) => {
    root.innerHTML = `<div class="demo-pick"><h1>Explore BuildOS</h1><p>A sample building company with four live projects. Pick who you'd like to be — you can switch at any time from the bar at the top. Nothing you do here is saved anywhere except this browser.</p>
      <div class="demo-roles">${DEMO_PEOPLE.map((p) => `<button type="button" class="demo-role" data-email="${p.email}"><b>${p.title.split(" · ")[0]}</b><span class="demo-name">${p.name}</span><span class="demo-blurb">${p.blurb}</span></button>`).join("")}</div></div>`;
    root.addEventListener("click", (e) => { const b = e.target.closest("[data-email]"); if (b) resolve(b.dataset.email); });
  });
}

document.addEventListener("click", async (e) => {
  if (e.target.closest("[data-demo-switch]")) { try { await sb.auth.signOut(); } catch { /* not signed in */ } location.hash = ""; location.reload(); }
  if (e.target.closest("[data-demo-reset]")) {
    if (!confirm("Reset the demo? Everything you've changed will be put back to the sample data.")) return;
    try { await sb.auth.signOut(); } catch { /* not signed in */ }
    await backend.deleteDemo(); location.hash = ""; location.reload();
  }
});

(async () => {
  try {
    loading("Starting…");
    const { fresh } = await backend.openDatabase(loading);
    await appScripts(["core", "charts", "data"]);
    if (fresh) {
      try { localStorage.removeItem("buildos_demo_org"); } catch { /* blocked */ }
      await sb.auth.signOut({ scope: "local" }).catch(() => {}); // a sign-in from an older demo points at people who no longer exist
      await seed({ sql: backend.sql, rpcAs: backend.rpcAs, putFile: backend.putFile, samplePayload, onStep: loading });
      await backend.markSeeded();
    }
    let { data } = await sb.auth.getSession();
    if (!data.session) {
      const email = await picker();
      loading("Signing in…");
      await sb.auth.signInWithPassword({ email, password: DEMO_PASSWORD });
      location.hash = DEMO_PEOPLE.find((p) => p.email === email).role === "worker" ? "#/site" : "#/app";
    }
    const me = (await sb.auth.getSession()).data.session?.user?.email;
    const who = DEMO_PEOPLE.find((p) => p.email === me);
    document.querySelector("[data-demo-who]").textContent = who ? `${who.name} · ${who.title.split(" · ")[0]}` : "";
    // A signed-out demo goes back to the role picker instead of the sign-in page.
    sb.auth.onAuthStateChange((event) => { if (event === "SIGNED_OUT") setTimeout(() => { location.hash = ""; location.reload(); }, 0); });
    await appScripts(["pages", "insights", "offline", "ai", "auth", "main"]);
  } catch (e) {
    console.error(e);
    root.innerHTML = `<div class="demo-loading"><b>The demo couldn't start</b><span>${String(e.message || e).replace(/</g, "&lt;")}</span><span>It needs a recent version of Chrome, Edge, Safari or Firefox. <button type="button" class="link" data-demo-reset>Reset the demo</button> and try again.</span></div>`;
  }
})();
