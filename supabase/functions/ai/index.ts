// Supabase Edge Function entry point. Deploy with: supabase functions deploy ai
// Needs the secret ANTHROPIC_API_KEY (Dashboard → Edge Functions → Secrets). Never put the key in the app's code.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { handle } from "./handler.ts";

const key = Deno.env.get("ANTHROPIC_API_KEY");
const anthropic = key ? new Anthropic({ apiKey: key }) : null;
const url = Deno.env.get("SUPABASE_URL")!;
// Newer projects provide publishable keys as a JSON dictionary; older ones the legacy anon key.
const publishable = (() => { try { return Object.values(JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}"))[0] as string | undefined; } catch { return undefined; } })();
const anonKey = publishable || Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve((req) => handle(req, {
  anthropic,
  supabaseFor: (authHeader) => createClient(url, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } }),
}));
