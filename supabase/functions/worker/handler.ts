// The "worker" Edge Function: runs the automations and the background jobs queued in the database.
// Called on a schedule (Supabase dashboard → Integrations → Cron, every minute) with the WORKER_SECRET header.
// Dependencies are passed in (see index.ts) so this can be tested outside Deno.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface Email { to: string; subject: string; text: string; html: string }
export interface WorkerDeps {
  db: SupabaseClient;                                 // service-role client: the worker acts for the system, not a person
  secret: string | undefined;                         // WORKER_SECRET; requests without it are refused
  sendEmail: ((e: Email) => Promise<void>) | null;    // null until an email provider is set up
  appUrl: string;                                     // where links in emails point, e.g. https://setout.com.au/app/
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

type Job = { id: string; type: string; payload: { notification_id?: string }; attempts: number };
type Note = { id: string; email: string | null; name: string; company: string; title: string; body: string | null; link: string | null; emailed_at: string | null; read_at: string | null };

async function emailNotification(d: WorkerDeps, job: Job): Promise<string> {
  const { data, error } = await d.db.rpc("notification_for_email", { p_id: job.payload.notification_id });
  if (error) throw new Error(error.message);
  const n = data as Note | null;
  if (!n) return "skipped: notification no longer exists";
  if (n.emailed_at) return "skipped: already emailed";
  if (n.read_at) return "skipped: already seen in the app";
  if (!n.email) return "skipped: no email address";
  if (!d.sendEmail) return "skipped: email not set up";
  const link = n.link ? d.appUrl.replace(/\/$/, "/") + n.link : d.appUrl;
  await d.sendEmail({
    to: n.email,
    subject: n.title,
    text: `${n.title}\n\n${n.body ?? ""}\n\nOpen in Setout: ${link}\n\n— ${n.company} on Setout`,
    html: `<p style="font:16px/1.5 Arial,sans-serif;margin:0 0 8px"><b>${esc(n.title)}</b></p><p style="font:14px/1.5 Arial,sans-serif;color:#333;margin:0 0 16px">${esc(n.body)}</p><p><a href="${esc(link)}" style="font:14px Arial,sans-serif;background:#27815F;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Open in Setout</a></p><p style="font:12px Arial,sans-serif;color:#777">${esc(n.company)} on Setout</p>`,
  });
  await d.db.rpc("mark_notification_emailed", { p_id: n.id });
  return "sent";
}

const RUNNERS: Record<string, (d: WorkerDeps, j: Job) => Promise<string>> = { "notification.email": emailNotification };

export async function handleWorker(req: Request, d: WorkerDeps): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  if (!d.secret || req.headers.get("x-worker-secret") !== d.secret) return json({ error: "Not allowed." }, 401);
  const out = { automations: null as unknown, jobs: { done: 0, failed: 0 } };
  const auto = await d.db.rpc("run_automations", {});
  out.automations = auto.error ? { error: auto.error.message } : auto.data;
  for (const [type, run] of Object.entries(RUNNERS)) {
    const { data: jobs, error } = await d.db.rpc("claim_jobs", { p_type: type, p_limit: 20 });
    if (error) return json({ ...out, error: error.message }, 500);
    for (const job of (jobs || []) as Job[]) {
      try { await d.db.rpc("finish_job", { p_id: job.id, p_result: await run(d, job) }); out.jobs.done++; }
      catch (e) { await d.db.rpc("fail_job", { p_id: job.id, p_error: e instanceof Error ? e.message : String(e) }); out.jobs.failed++; }
    }
  }
  return json(out);
}
