# BuildOS (working name)

One connected construction platform: quality, programme, workforce & safety, and commercial, all sharing one project record.

| | Link | What it is |
| --- | --- | --- |
| **App** | https://mstrattonpatch.github.io/buildos/app/ | The real program: accounts, your company's data in Supabase |
| **Demo** | https://mstrattonpatch.github.io/buildos/ | Public website + clickable demo with sample data in the browser |

## How it fits together

```
GitHub Pages (static files)          Supabase (Sydney)
  app/index.html  ──supabase-js──▶     Auth: accounts, passwords, sessions
  app/js/*.js                          Postgres: all records + security rules
                                       Storage: private "photos" bucket
```

- **Security lives in the database.** Every table has Row Level Security: people only read their own company's rows, subcontractors only see their own company's defects and workers, and only commercial roles see variations, budgets and claims. Nothing is written to tables directly — every change goes through a database function (`supabase/migrations/…`) that checks the role, validates the workflow step and writes an audit event.
- **Photos** are uploaded to a private bucket under `<company id>/…` and shown through short-lived signed links.
- **Database changes deploy automatically:** the Supabase GitHub integration applies new files in `supabase/migrations/` to the live database when they're merged to `main`.

## Files

```
index.html                         public website + demo (sample data, no account needed)
app/index.html                     the real app
app/js/config.js                   Supabase URL + publishable key (public by design)
app/js/core.js                     helpers, display rules, sample dataset
app/js/data.js                     loading data, calling database functions, photo upload
app/js/pages.js, auth.js, main.js  screens, sign-in, routing and actions
app/styles.css                     design system
supabase/migrations/               database schema, security rules, workflow functions
```

## First-time setup checklist (Supabase dashboard)

1. **Authentication → URL Configuration:** set *Site URL* to `https://mstrattonpatch.github.io/buildos/app/` and add the same address under *Redirect URLs*. Email confirmation and password-reset links use this.
2. **Authentication → Sign In / Providers → Email:** keep *Confirm email* on for real use. Supabase's built-in email sender only sends a few emails per hour — set up custom SMTP before inviting many people.
3. Check the migration ran: **Database → Tables** should list `projects`, `defects` and so on.

## Programme

Tasks and milestones with finish-to-start dependencies (loops are refused), forecast vs baseline dates, critical path and float, site progress updates (0–100%, or flagged blocked with a reason), and delay reasons whenever a forecast finish moves later. Re-baselining copies forecasts to the baseline and is recorded in the history. Project progress is calculated from task progress weighted by duration.

## Inspection & test plans (ITPs)

Company templates (**ITP templates** in the sidebar, with a starter set for concrete slabs, wet-area waterproofing and fire stopping) list the points in order: hold, witness, inspection, test or review, each with acceptance criteria, minimum photos, an optional measurement and one or two required sign-offs. Saving a template creates a new version; ITPs already on projects keep the version they were created from.

On a project, add an ITP from a template and link it to a programme task. Points are completed in order — nothing after an unreleased hold point can be submitted. Hold and witness points are signed off by a director, PM or quality manager, never by the person who submitted them. Rejecting a point raises a "Failed inspection" defect; rejecting a hold point also flags the linked task as blocked. ITPs can be printed or saved as PDF.

## SWMS

Contractors (or the site team on their behalf) submit a Safe Work Method Statement with the work activity, high-risk construction work categories, hazards and controls, the document itself and the programme tasks it covers. A supervisor, PM or director approves it (with a periodic review date) or requests changes. Each revision is a new version: the approved version stays in force — and keeps controlling site sign-in — until the revision is approved. Revisions require workers to acknowledge again unless marked as a minor correction. Every version keeps who submitted, reviewed and acknowledged it.

## Safety extras & site access

- **Incidents, near misses, hazards, observations** — anyone on the project can report from the office or their phone. A supervisor or PM investigates, records the root cause and corrective action, and closes out (a corrective action is required, except for observations). Notifiable incidents are flagged until closed.
- **Permits to work** — requested for up to 7 days, approved by a supervisor, PM or director who is *not* the requester, then closed when the work is done. Live permits show on the register and can be printed.
- **Toolbox talks** — topic, date, points covered and who attended (tick everyone on site in one go).
- **NCRs** (under Quality) — requirement breached → containment → root cause and corrective action (the responsible subcontractor can answer these) → verification. Someone other than the person who raised it must verify and close it.
- **QR gate** — each project has a printable poster (*Safety → Site access & visitors*). Scanning it opens a page that needs no account. Workers enter their 6-digit worker code, read and acknowledge any SWMS, and sign in or out; the same requirements as the app apply. Visitors enter their details and accept the site rules. Gate calls are rate-limited, and **Replace QR code** stops old posters working.
- **Workforce** — supervisors can sign someone in by hand (a reason is required, requirements still apply), sign people out, record missing sign-outs at 3:30 pm, and print an emergency **muster list** of workers and visitors on site. Visitor details are visible only to the people who run the site register.

## Timesheets & rates

- **Entering hours** — on a project's *Workforce → Timesheets*: start, finish and unpaid break (rounded to 15 minutes) or hours only, task, cost code and billable. Supervisors and the office enter for anyone, subcontractor admins for their own workers, and workers log their own from the site app (*Me*). Overlapping hours and more than 24 h a day are refused. **Create from sign-ins** makes one timesheet per person from their first sign-in to last sign-out (30-minute break over 5 hours).
- **Pending → Approved → Processed** — a supervisor, PM or director approves (never their own hours) or rejects with a reason. A PM or director processes, which locks the cost and chargeout rates onto each timesheet. Processed hours show as labour cost by cost code on *Commercial*.
- **Rates** (*Rates*, PMs and directors only) — rate cards, a personal rate per person, company cost-code rates and job rates. The most specific wins: job + person + cost code → job + person → job + cost code → company cost-code rate → personal rate → rate card. Supervisors and subcontractors never see rates or labour cost.
- **Payroll** — *Timesheets* lists every project by week, exports a payroll CSV of approved and processed hours split into ordinary and overtime (over 38 h a week), and prints a weekly timesheet per person with sign-off lines.

## Team chat & phone tasks

- **Team chat** — each project has a chat (*Team chat* in the office, *Chat* in the site app) for everyone in the company, with photos. Open chats check for new messages every few seconds, and unread counts show on the menu and the phone's tab bar.
- **Tasks to a phone** — supervisors, PMs, directors and quality managers give someone a task (due date, photos needed), from the chat page, the site app, or straight from a defect or ITP point (*Send to someone's phone*). The person marks it done with a note and photos; whoever gave it, or a supervisor, accepts it or sends it back with what's still needed. Nobody checks their own work. Each step is posted in the chat.
- **Site notes** — anyone sends a note and photos for the site diary from the site app (*Diary note*). A supervisor adds it to the day's diary or dismisses it; notes accepted after the diary is submitted are marked as late additions, so the original entry is never changed.
- **From site** (office) — finished tasks to check, site notes waiting, and hours sent in from phones, in one place.
- **Contacts** (site app) — the team with call and email buttons, and crew with a phone number.

## Costs & claims

*Commercial* (PMs and directors) has tabs for the overview, cost ledger, purchase orders, bills, receipts & charges, and claims.

- **Budget** by cost code, each line standard, a provisional sum (PS) or a prime cost item (PC), with an optional hand-set forecast.
- **Purchase orders** commit cost. PMs issue up to $50,000; above that a director does. Closing a PO stops its unbilled balance counting as committed.
- **Bills** are entered against a PO or a cost code and approved by someone other than the person who entered them (when there's someone else). A bill that takes a PO over its value needs a reason. Duplicate invoice numbers are refused.
- **Receipts** come from the site app (*Receipt*): photo, supplier, total incl. GST, and how it was paid. The office approves them with a cost code, and receipts paid personally are tracked until reimbursed.
- **Internal charges** (company plant, yard materials) and **backcharges** to subcontractors (which reduce cost once agreed).
- **Cost ledger**: actual = approved bills + approved receipts + internal charges + processed labour − agreed backcharges; committed adds open PO balances; forecast final is the larger of budget and committed unless set by hand. Warnings: forecast over budget, 90%+ spent, PS/PC over allowance, costs with no budget line, claims past due or certified short.
- **Progress claims**: lump sum (a schedule of contract items that adds up to the contract sum, plus approved variations, retention to a cap) or cost-plus (every approved, unclaimed cost to the period end, the fee on costs, labour at chargeout). Draft → submitted → certified (a short certificate needs the payment-schedule reason) → paid. Each claim prints as a payment claim document with the security-of-payment statement.

## Estimates

*Estimates* (PMs and directors) holds quotes for new work.

- Items by category (trade package) with quantity × rate. A quantity can be a sum such as `12.05*10`.
- **Assemblies** are company build-ups (e.g. a stud wall per m²) that drop priced items into an estimate.
- **Trade package quotes**: mark one quote per package as *Use* and it replaces that package's itemised cost.
- Markup on cost gives the sell price; the summary shows cost, sell, GST and margin. Inclusions and exclusions go on the quote.
- Draft → sent (locked) → won or lost. **New version** copies a sent or lost quote; the old one is kept as superseded.
- The **client quote** prints sell prices by package with inclusions, exclusions and acceptance lines — no rates, costs or suppliers.
- A won estimate **converts to a job**: the contract sum, a budget line per package (at cost) and a claim schedule per package (at sell) are filled in.

## Dashboards & charts

- **Company overview** dashboard: contract value vs forecast cost by project, open and overdue defects by project, labour hours per week (by project), defects raised vs closed per week, and progress claims claimed vs certified. Money charts show only for PMs and directors.
- **Project overview** dashboard: budget vs forecast by cost code, cumulative cost to date against the budget, labour hours per day, and open defects by trade.
- **Reports** include charts in every preset (hours per day/week and by company, workers on site, defects raised vs closed, defects by trade and company, progress, cost to date, budget vs forecast, claims).
- Every chart has a legend, a hover/keyboard tooltip and **Show as table**, so nothing relies on colour or hovering alone. Charts are plain SVG/HTML (`app/js/charts.js`), no chart library; series colours use a colour-blind-safe order.

## Insights (interactive dashboard)

*Insights* in the company menu is a Power BI-style view of the live data:

- **Pages**: Overview, Quality, Labour and Commercial (PMs and directors).
- **Slicers** scope every visual: date range (presets or custom), projects, companies and trades. KPI tiles compare against the previous period of the same length.
- **Cross-filtering**: click (or press Enter on) any bar or column to filter everything else by it — click again to clear. The chart you clicked keeps its other bars, dimmed.
- **Matrix tables** sort by any column, break down by project, company or trade, open the project on click, and export to CSV.
- **What-if**: on Quality, change the weekly close and raise rates to see when the open defects would be cleared; on Commercial, change the cost still to come and the share of unapproved variations approved to see the margin per project. Nothing is saved.
- **Live**: the page reloads the data every 30 seconds while it's open (pause it if you like). The filters and what-if values are in the URL, so a view can be bookmarked or shared with colleagues (they see only what their role allows).

## Reports & handover

- **Project reports** (*Reports*): weekly site report, client progress report, cost report (internal only), quality report and site diary pack, for any date range. The client view leaves out internal detail. Each section notes how its figures are worked out. Print or save as PDF.
- **Handover** (*Handover*): readiness checks for open defects, unreleased inspection points, open NCRs, and current certificates, warranties, O&M manuals and as-built drawings (upload these under those document categories). The pack lists outstanding defects, ITP status and the drawing register, and prints as a cover document. Issuing it records the recipient and what was outstanding, and moves the project into its defects liability period.

## Worker wallets & contractor profiles

- **Credential wallet** (*People → a worker*): each card or licence keeps its evidence, issuer, expiry and status — uploaded, awaiting verification, verified, expired, rejected or unable to verify. Verifying records the method (original sighted, online register checked…), who and when. Nobody verifies their own.
- **Site requirements** (*Workforce*): besides the White Card and induction, a project can require other credentials (e.g. working at heights). They block sign-in — in the app, at the QR gate and for manual sign-in — until verified and in date.
- **Self-service links** (no account needed): give a worker their link to see their cards and upload new ones; give a contractor theirs to update contacts and upload insurance certificates and company documents. Uploads wait for the office to check them. Links can be replaced at any time, and uploads through a link can only go into that link's own folder.
- **Contractor profile** (*People → a company*): contacts and emergency contact, approved trades, prequalification (approval needs an expiry), insurances with cover limits and certificates, company documents, workers and their compliance, projects, and performance — defects assigned, average close-out, NCRs, agreed backcharges.

## Roles

| Role | Can |
| --- | --- |
| Director | Everything, including approving variations of any size |
| Project manager | Projects, people, defects, ITP hold points, SWMS, variations up to $50,000, commercial, everything in safety, approving and processing timesheets, rates, giving and checking tasks, budgets, POs, bills, receipts and claims (PMs up to $50,000 per PO or bill), estimates, issuing the handover pack |
| Site supervisor | People, defects, completing ITP points, accepting inspections, SWMS review, site diary, programme progress, NCRs, approving permits, investigating incidents, the site register and visitors, entering and approving timesheets, giving and checking tasks, accepting site notes |
| Quality manager | Defects, ITP templates and hold-point sign-off, NCRs, giving and checking tasks |
| Subcontractor admin | Their own company's defects (rectify), SWMS submissions, completing ITP points and raising variations, answering their NCRs, requesting permits, reporting incidents, entering their workers' hours |
| Worker | Raise defects, report hazards and incidents, request permits, acknowledge SWMS, sign in to site, log their own hours |

Company **admins** (the person who created the company, plus anyone they tick as admin) can invite people and change roles.
