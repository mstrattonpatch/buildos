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

## Roles

| Role | Can |
| --- | --- |
| Director | Everything, including approving variations of any size |
| Project manager | Projects, people, defects, ITP hold points, SWMS, variations up to $50,000, commercial |
| Site supervisor | People, defects, SWMS review, site diary |
| Quality manager | Defects and ITP hold points |
| Subcontractor admin | Their own company's defects (rectify) and raising variations |
| Worker | Raise defects, acknowledge SWMS, sign in to site |

Company **admins** (the person who created the company, plus anyone they tick as admin) can invite people and change roles.
