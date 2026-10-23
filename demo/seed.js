// Sample company for the demo, built through the app's own database functions (so it obeys every rule the
// real app does). Fictional names and figures only.

export const DEMO_PASSWORD = "demo-password";
export const DEMO_PEOPLE = [
  { key: "director", email: "director@demo.buildos", name: "Alex Chen", role: "director", title: "Construction director", blurb: "Everything: projects, money, people and approvals." },
  { key: "supervisor", email: "supervisor@demo.buildos", name: "Dana Morris", role: "site_supervisor", title: "Site supervisor", blurb: "Site sign-in, defects, inspections, diary and timesheets." },
  { key: "quality", email: "quality@demo.buildos", name: "Priya Nair", role: "quality_manager", title: "Quality manager", blurb: "ITPs and hold points, NCRs and document approval." },
  { key: "sub", email: "sub@demo.buildos", name: "Jordan Lee", role: "subcontractor_admin", title: "Contracts admin · AquaSeal", blurb: "A subcontractor's view: only their own company's work." },
  { key: "worker", email: "worker@demo.buildos", name: "Sam Okafor", role: "worker", title: "Concreter · Solid Pour", blurb: "The site app on a phone: sign in, defects, hours, receipts." },
];

const ymdOff = (d) => { const x = new Date(Date.now() + d * 86400000); return x.toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" }); };

/** A simple drawn receipt, so the sample receipt has a photo like a real one. */
function receiptImage(lines) {
  const c = document.createElement("canvas"); c.width = 360; c.height = 520;
  const g = c.getContext("2d");
  g.fillStyle = "#d9d4c7"; g.fillRect(0, 0, 360, 520); g.fillStyle = "#fbfaf6"; g.fillRect(40, 20, 280, 480);
  g.fillStyle = "#222"; g.textAlign = "center"; g.font = "bold 20px monospace"; g.fillText(lines[0], 180, 70);
  g.font = "14px monospace"; g.textAlign = "left";
  lines.slice(1).forEach((l, i) => g.fillText(l, 60, 120 + i * 26));
  return new Promise((res) => c.toBlob(res, "image/jpeg", 0.85));
}

export async function seed({ sql, rpcAs, samplePayload, putFile, onStep = () => {} }) {
  const people = {};
  for (const p of DEMO_PEOPLE) {
    const [u] = await sql("insert into auth.users (email, encrypted_password, raw_user_meta_data) values ($1, $2, $3) returning id, email", [p.email, DEMO_PASSWORD, { full_name: p.name }]);
    people[p.key] = u;
  }
  const { director: alex, supervisor: dana, quality: priya, sub: jordan, worker: sam } = people;
  onStep("Loading sample projects…");
  const org = (await rpcAs(alex, "create_organisation", { p_name: "Demo Builders Pty Ltd" })).id;
  await rpcAs(alex, "import_sample_data", { p_org: org, p: samplePayload(alex.id) });

  const one = async (q, args) => (await sql(q, args))[0];
  const aqua = (await one("select id from contractors where org_id = $1 and trading_name = 'AquaSeal Waterproofing'", [org])).id;
  const pour = (await one("select id from contractors where org_id = $1 and trading_name = 'Solid Pour Concreting'", [org])).id;
  const samW = (await one("select id from workers where org_id = $1 and name = 'Sam Okafor'", [org])).id;
  const danaW = (await rpcAs(alex, "create_worker", { p_org: org, p: { name: "Dana Morris", contractor_id: pour } })).id;
  for (const [u, p, contractor, worker] of [[dana, DEMO_PEOPLE[1], null, danaW], [priya, DEMO_PEOPLE[2], null, null], [jordan, DEMO_PEOPLE[3], aqua, null], [sam, DEMO_PEOPLE[4], null, samW]]) {
    await rpcAs(alex, "invite_member", { p_org: org, p_email: p.email, p_role: p.role, p_title: p.title, p_contractor: contractor, p_worker: worker });
    await rpcAs(u, "accept_invitations", {});
  }

  onStep("Adding timesheets, chat, costs and safety records…");
  const proj = (await one("select id from projects where org_id = $1 and code = 'P-2041'", [org])).id;
  const crew = (await sql("select id from workers where org_id = $1 and contractor_id = $2 and name <> 'Dana Morris' order by name limit 5", [org, pour])).map((r) => r.id);
  const codes = (await sql("select cost_code from budget_lines where project_id = $1 order by cost_code", [proj])).map((r) => r.cost_code);
  const code = (re) => codes.find((c) => re.test(c)) || codes[0];
  // Each extra is independent: if one is refused, the rest of the demo still loads.
  const step = async (label, fn) => { try { await fn(); } catch (e) { console.warn(`Demo seed: ${label} skipped —`, e.message); } };

  await step("chat", async () => {
    await rpcAs(dana, "post_message", { p_project: proj, p_body: "Pump booked for the L4 pour Thursday 6 am. Reo inspection Wednesday 2 pm." });
    await rpcAs(sam, "post_message", { p_project: proj, p_body: "Concrete truck 20 min late, we're set up and waiting." });
    await rpcAs(alex, "post_message", { p_project: proj, p_body: "Thanks all. Priya, can you confirm the hold point release before 5?" });
  });
  await step("site tasks and notes", async () => {
    await rpcAs(dana, "create_site_task", { p_project: proj, p: { title: "Clean out the L3 corridor before tilers start", assignee_id: sam.id } });
    await rpcAs(sam, "send_site_note", { p_project: proj, p_body: "Crane stood down 10–11 am for wind." });
  });
  await step("timesheets", async () => {
    const ids = [];
    for (const [d, s, e] of [[-1, "06:30", "15:00"], [-2, "06:30", "15:30"], [-3, "07:00", "15:30"]]) for (const w of crew) ids.push((await rpcAs(dana, "create_timesheet", { p_project: proj, p: { worker_id: w, date: ymdOff(d), start_time: s, end_time: e, break_min: 30 } })).id);
    await rpcAs(sam, "create_timesheet", { p_project: proj, p: { worker_id: samW, date: ymdOff(0), hours: 4 } });
    await rpcAs(dana, "timesheet_action", { p_ids: ids.slice(0, 10), p_action: "approve" });
  });
  await step("rates", async () => {
    await rpcAs(alex, "save_rate_card", { p_org: org, p_id: null, p: { name: "Concreter", cost_rate: 6200, charge_rate: 9500 } });
    await rpcAs(alex, "save_rate_card", { p_org: org, p_id: null, p: { name: "Labourer", cost_rate: 4800, charge_rate: 7800 } });
  });
  await step("purchase order and bills", async () => {
    const po = (await rpcAs(alex, "create_po", { p_project: proj, p: { contractor_id: pour, cost_code: code(/conc|struct|02/i), description: "L1–L4 slab pours", amount: 42000000 } })).id;
    await rpcAs(alex, "enter_bill", { p_project: proj, p: { contractor_id: pour, invoice_number: "SP-1042", invoice_date: ymdOff(-12), due_date: ymdOff(18), amount: 11800000, po_id: po, description: "L3 slab pour" } });
    await rpcAs(alex, "enter_bill", { p_project: proj, p: { contractor_id: aqua, invoice_number: "AQ-311", invoice_date: ymdOff(-3), due_date: ymdOff(27), amount: 2450000, cost_code: code(/water|wet|fin/i), description: "Bathroom membranes L2" } });
  });
  await step("receipt", async () => {
    const photo = `${org}/${crypto.randomUUID()}.jpg`;
    await putFile("photos", photo, await receiptImage(["BUNNINGS", "Masonry anchors x2   $54.80", "Silicone x3         $32.10", "", "TOTAL              $86.90", "GST incl.           $7.90", ymdOff(-1)]), sam.id);
    await rpcAs(sam, "submit_receipt", { p_project: proj, p: { supplier: "Bunnings Warehouse", amount: 8690, paid_with: "personal", date: ymdOff(-1), note: "Masonry anchors and silicone", photo_path: photo } });
  });
  await step("safety", async () => {
    await rpcAs(sam, "request_permit", { p_project: proj, p: { type: "Hot work", location: "L4 east stair", valid_from: ymdOff(1), valid_to: ymdOff(3), description: "Cutting starter bars" } });
    await rpcAs(sam, "report_incident", { p_project: proj, p: { type: "near_miss", title: "Pallet of blocks slipped on the hoist", severity: "high", notifiable: false } });
    await rpcAs(dana, "record_toolbox_talk", { p_project: proj, p: { topic: "Working near the slab edge", attendees: crew.slice(0, 4) } });
  });
  await step("NCR", async () => {
    await rpcAs(priya, "create_ncr", { p_project: proj, p: { title: "Slab cover below 40 mm at grid C4", requirement: "Minimum 40 mm cover to AS 3600, drawing S-201" } });
  });
  await step("estimate", async () => {
    const e = (await rpcAs(alex, "create_estimate", { p_org: org, p: { name: "Bayview Duplex", client: "R. & K. Patel", address: "7 Bayview Pde, Collaroy NSW" } })).id;
    await rpcAs(alex, "save_estimate", { p_estimate: e, p: { markup_pct: 15, items: [
      { category: "Preliminaries", description: "Site establishment and supervision", qty: 1, rate: 3800000 },
      { category: "Concrete", description: "Slab on ground", qty: 210, unit: "m²", rate: 14500, qty_formula: "21*10" },
      { category: "Framing", description: "Wall and roof framing", qty: 1, rate: 9600000 },
      { category: "Wet areas", description: "Waterproofing and tiling", qty: 6, unit: "rooms", rate: 680000 },
    ] } });
  });
  onStep("Finishing…");
  return { org, people };
}
