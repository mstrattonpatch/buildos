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
| Variations (basic), claims register, budget view, site diary, sign-in | |

## Next, in order

1. **Safety extras** — NCRs (requirement breached, containment, root cause, corrective action), permits to work (requested → approved by an authorised person → closed), incidents & observations, toolbox talks, printable QR gate poster, visitor sign-in and log, emergency muster list, manual sign-in with a reason, missing sign-outs.
2. **Timesheets & rates** — job, person, date, start/finish, unpaid break, task, cost code, billable; Pending → Approved → Processed (locks cost and chargeout rates); rate cards with personal overrides and job/cost-code rates; payroll export with overtime over 38 h; official weekly timesheet PDF; labour costing; create timesheets from sign-ins; hours from the site app.
3. **Team chat & phone tasks** — per-project chat with photos and assigned tasks; send defects/ITP points to someone's phone; site app Tasks, Hours, receipts, diary notes, Contacts; office "From site" review.
4. **Costs & claims** — budget by cost code, purchase orders and bills, receipts (paid by card / personally / cash / on account), internal charges, running-cost ledger with warnings (lines over contract, 90 %+ claimed, PS/PC overruns, claimed-not-certified), full progress claims (retention, cost-plus, claim document), variation extras (backcharge trade, charge client).
5. **Estimates** — costings by category with formulas, assemblies, take-offs, trade packages and quotes, inclusions/exclusions, versions, client quote, convert to job.
6. **AI features** (needs an Anthropic API key in Supabase secrets, called from an Edge Function — never from the browser) — invoice/receipt reading, estimate document review, subcontractor ITP conversion, diary drafting, report writing, Ask Claude.
7. **Reports & handover** — report builder with presets (weekly site, client progress, cost, quality, diary pack), internal vs client view, handover pack.

Also from the earlier build, folded into the steps above: programme phases with
drag-to-edit bars, short-term (look-ahead) programme, delays and EOT notices,
cost and earned-value view, quality dashboard, subcontractor ITPs, programme
requirements (certificates per task), numbered inspections and checks.
