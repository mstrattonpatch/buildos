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

## Roles

| Role | Can |
| --- | --- |
| Director | Everything, including approving variations of any size |
| Project manager | Projects, people, defects, ITP hold points, SWMS, variations up to $50,000, commercial, everything in safety, approving and processing timesheets, rates, giving and checking tasks |
| Site supervisor | People, defects, completing ITP points, accepting inspections, SWMS review, site diary, programme progress, NCRs, approving permits, investigating incidents, the site register and visitors, entering and approving timesheets, giving and checking tasks, accepting site notes |
| Quality manager | Defects, ITP templates and hold-point sign-off, NCRs, giving and checking tasks |
| Subcontractor admin | Their own company's defects (rectify), SWMS submissions, completing ITP points and raising variations, answering their NCRs, requesting permits, reporting incidents, entering their workers' hours |
| Worker | Raise defects, report hazards and incidents, request permits, acknowledge SWMS, sign in to site, log their own hours |

Company **admins** (the person who created the company, plus anyone they tick as admin) can invite people and change roles.
