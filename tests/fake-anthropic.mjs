// Stands in for the Claude API in local tests: checks the request shape the real API needs, returns canned answers.
import Anthropic from "@anthropic-ai/sdk";
export const AI = { mode: "ok", requests: [] };
const F = (o) => Object.fromEntries(["supplier","abn","invoice_number","invoice_date","due_date","date","description","person_name","credential_type","number","issuer","expires","insurance_type","insurer","policy_number","insured_name","doc_number","revision","title","category","company_doc_kind","amount_ex_gst","gst","total","cover_limit"].map((k) => [k, o[k] ?? null]));
const CANNED = {
  invoice: { doc_type: "bill", summary: "Tax invoice from Coastal Concrete for the level 2 pour.", confidence: "high", checks: ["The due date is 14 days from the invoice date."], fields: F({ supplier: "Coastal Concrete Pty Ltd", invoice_number: "INV-20931", invoice_date: "2026-10-15", due_date: "2026-10-29", amount_ex_gst: 18400, gst: 1840, total: 20240, description: "Level 2 slab pour, 32 MPa" }) },
  whitecard: { doc_type: "credential", summary: "General construction induction card (White Card).", confidence: "high", checks: [], fields: F({ person_name: "Sam Taylor", credential_type: "White Card", number: "CGI-7781234", issuer: "SafeWork NSW", expires: null }) },
  heights: { doc_type: "credential", summary: "Working at heights certificate.", confidence: "medium", checks: ["The last digit of the number is hard to read."], fields: F({ person_name: "Sam Taylor", credential_type: "Working at heights", number: "WAH-55120", issuer: "Safe Training Co", expires: "2025-03-01" }) },
  coc: { doc_type: "insurance", summary: "Certificate of currency for public liability.", confidence: "high", checks: [], fields: F({ insured_name: "Coastal Concrete Pty Ltd", insurance_type: "Public liability", insurer: "QBE Insurance", policy_number: "PL-448812", cover_limit: 20000000, expires: "2027-06-30" }) },
  drawing: { doc_type: "drawing", summary: "Architectural drawing, level 3 floor plan.", confidence: "high", checks: [], fields: F({ doc_number: "A-301", revision: "C", title: "Level 3 floor plan", category: "Architectural", description: "Revised core layout" }) },
  receipt: { doc_type: "receipt", summary: "Bunnings receipt for fixings.", confidence: "high", checks: ["GST worked out as 1/11 of the total."], fields: F({ supplier: "Bunnings Warehouse", date: "2026-10-21", total: 86.9, gst: 7.9, description: "Masonry anchors and silicone" }) },
  blank: { doc_type: "other", summary: "A photo of a wall, not a document.", confidence: "low", checks: [], fields: F({}) },
};
function check(p) {
  const errs = [];
  const reading = !!p.output_config?.format;
  // Documents are read with Opus 5.5 (with the server-side fallback); the help chat uses Haiku 5.5, which has no fallback.
  if (p.model !== (reading ? "claude-opus-5-5" : "claude-haiku-5-5")) errs.push("model");
  if (!reading) { if ("fallbacks" in p) errs.push("fallbacks not supported on Haiku"); }
  else if (AI.mode === "nofallback" ? "fallbacks" in p : p.fallbacks !== "default" || !p.betas?.includes("server-side-fallback-2026-07-01")) errs.push("fallbacks");
  if ("temperature" in p || "top_p" in p || "thinking" in p && p.thinking?.type !== "adaptive") errs.push("sampling/thinking");
  if (!p.max_tokens) errs.push("max_tokens");
  if (p.tool_choice && ["any", "tool"].includes(p.tool_choice.type)) errs.push("tool_choice");
  if (p.messages.at(-1).role !== "user") errs.push("last message must be user");
  for (let i = 1; i < p.messages.length; i++) if (p.messages[i].role === p.messages[i - 1].role) errs.push("roles must alternate");
  if (errs.length) throw Anthropic.APIError.generate(400, { type: "error", error: { type: "invalid_request_error", message: errs.join(", ") } }, errs.join(", "), new Headers());
}
export const fakeAnthropic = {
  beta: { messages: { async create(p) {
    AI.requests.push(p); if (AI.requests.length > 50) AI.requests.shift();
    if (AI.mode === "badkey") throw Anthropic.APIError.generate(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, "invalid x-api-key", new Headers());
    check(p);
    const usage = { input_tokens: 1200, output_tokens: 180, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    if (p.output_config?.format) {
      const s = p.output_config.format.schema;
      if (s?.additionalProperties !== false || s.properties.fields.additionalProperties !== false) throw new Error("schema must forbid extra properties");
      const prompt = p.messages[0].content.find((c) => c.type === "text").text, file = (prompt.match(/File name: (.*)/)?.[1] || "").toLowerCase();
      const key = Object.keys(CANNED).find((k) => file.includes(k)) || "blank";
      return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(CANNED[key]) }], usage };
    }
    const ctx = p.system[1].text, q = p.messages.at(-1).content, pid = ctx.match(/\(id ([0-9a-f-]{36})\)/)?.[1];
    const role = ctx.match(/- Role: (.*)/)?.[1];
    const reply = /invoice|bill/i.test(q) && pid ? `As a ${role}, you can enter it on the bills page:\n1. Open [Bills](#/app/projects/${pid}/commercial/bills)\n2. Choose the invoice file and press **Read with AI**\n3. Check the values, then press Enter bill.\n\n[Evil](javascript:alert(1)) <img src=x onerror=alert(1)>`
      : `You're on ${ctx.match(/- Page they're on: (.*)/)?.[1]}. Try the [Company overview](#/app).`;
    return { stop_reason: "end_turn", content: [{ type: "text", text: reply }], usage };
  } } },
};
