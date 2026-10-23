// Supabase Edge Function "worker". Deploy with: supabase functions deploy worker --no-verify-jwt
// Secrets: WORKER_SECRET (any long random text; the scheduler sends it as the x-worker-secret header),
// optional RESEND_API_KEY + EMAIL_FROM to send emails, APP_URL (e.g. https://mstrattonpatch.github.io/buildos/app/).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { handleWorker } from "./handler.ts";

const secretKey = (() => { try { return Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"))[0] as string | undefined; } catch { return undefined; } })()
  || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(Deno.env.get("SUPABASE_URL")!, secretKey, { auth: { persistSession: false } });
const resendKey = Deno.env.get("RESEND_API_KEY"), from = Deno.env.get("EMAIL_FROM");

Deno.serve((req) => handleWorker(req, {
  db,
  secret: Deno.env.get("WORKER_SECRET"),
  appUrl: Deno.env.get("APP_URL") || "https://mstrattonpatch.github.io/buildos/app/",
  sendEmail: resendKey && from ? async (e) => {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: e.to, subject: e.subject, text: e.text, html: e.html }) });
    if (!r.ok) throw new Error(`Email provider said ${r.status}: ${(await r.text()).slice(0, 200)}`);
  } : null,
}));
