# BuildOS roadmap

Features are being brought across from the earlier single-file BuildOS
build (a claude.ai artifact that stored data per browser) into this app,
where data is shared live in Supabase and permissions are enforced by the
database. Where both versions had a feature, this app's version is kept and
the extras are added.

> The earlier build contained real company figures (progress-claim ledger,
> certificates, variations, PS/PC sums, supplier rates). **None of that goes
> in this public repository** — sample data only. Real figures are entered in
> the app, where only the company's members can see them.

## Done

| Area | Notes |
| --- | --- |
| Accounts, companies, roles, invitations | Supabase Auth; admins invite by email |
| Control centre, project overview, My tasks, notifications | |
| Defects | Draft → Open → Assigned → Rectifying → Verify → Closed, photos, evidence |
| Programme | Tasks, milestones, dependencies, critical path, delays, re-baseline |
| ITPs | Versioned templates, hold points in order, two-person sign-off, failed point → defect |
| SWMS | Submit, review, versions, re-acknowledgement before sign-in |
| Documents & drawings | Revision control with review, previews, site app current drawings |
| Safety extras | Incidents & observations, permits to work, toolbox talks, NCRs, QR gate (workers and visitors, no account), manual sign-in, missing sign-outs, muster list |
| Timesheets & rates | Hours entry (office, subbie, site app, from sign-ins), approve/reject, process with locked rates, rate cards and job/cost-code rates, payroll CSV with overtime, weekly timesheet print, labour cost on Commercial |
| Team chat & phone tasks | Project chat with photos and unread counts, tasks to someone's phone (from chat, defects, ITP points) with done → check → accept/send back, site notes into the diary, From site review, Contacts |
| Costs & claims | Budget (PS/PC), purchase orders, bills with separation of duties, receipts from the site app, internal charges, backcharges, running-cost ledger with warnings, lump-sum and cost-plus progress claims with retention and a claim document |
| Variations (basic), claims register, budget view, site diary, sign-in | |

## Next, in order

1. **Estimates** — costings by category with formulas, assemblies, take-offs, trade packages and quotes, inclusions/exclusions, versions, client quote, convert to job.
2. **AI features** (needs an Anthropic API key in Supabase secrets, called from an Edge Function — never from the browser) — invoice/receipt reading, estimate document review, subcontractor ITP conversion, diary drafting, report writing, Ask Claude.
3. **Reports & handover** — report builder with presets (weekly site, client progress, cost, quality, diary pack), internal vs client view, handover pack.

Also from the earlier build, folded into the steps above: programme phases with
drag-to-edit bars, short-term (look-ahead) programme, delays and EOT notices,
cost and earned-value view, quality dashboard, subcontractor ITPs, programme
requirements (certificates per task), numbered inspections and checks.
