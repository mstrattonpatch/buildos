# Setout 2.0: review and implementation plan

*Status: Phase 1 done — per-project access, the event log and job queue, the three built-in automations with bell and email alerts, the Automations page, CI and the AI model split. Next: Phase 2.*

*Reviews two documents: "Technical Product Strategy and AI Roadmap" and "BuildOS 2.0 Technical Design Specification" (v1.0, both 23 Oct 2026). The plan is written against the code as it stands (commit `658831c`).*

---

## 1. Summary

- **Direction: agreed.** The strategy is sound and fits what's already built: an activity-driven product, a universal AI Inbox, a readiness engine, sprints, controlled report generation, and a source-grounded copilot. Its governing rule (AI reads, drafts and recommends; database rules enforce; people approve) is how the current AI features already work.
- **The Technical Spec can't be built from as written.** It has 450 "sheets", but most are filled from a template:
  - The 128 table sheets give every table the same nine generic fields. Organisation, for example, is given an `organisation_id` and a `project_id`.
  - All 91 screens describe the same generic layout.
  - All 20 activity generators share one paragraph.
  - The 63 API sheets share one contract.
  - What's usable is the architecture paragraphs, the lists of names (tables, endpoints, workflows, queues, automations, screens), the AI feature one-liners, the testing gates and the seven delivery phases.
- **It doesn't reflect the existing code.** About half the tables it proposes already exist under other names (its "Safety report" is `incidents`, "Site diary" is `diary`, "Inspection point" is `itp_points`). Its `/v2/...` REST endpoints duplicate the database functions the app already uses as its API. Built literally, it would be a parallel rebuild of working, tested software.
- **Recommended approach:** keep the current architecture (Supabase, database functions as the API, a static front end) and add the new capabilities to it in the order the spec gives. Prove one complete workflow (a concrete slab pour, end to end) before broadening any phase.
- **Rough size:** 8–13 months for one experienced developer working with AI assistance. That excludes the standards content, which needs a competent construction person's time. Section 9 has the detail.

---

## 2. Review of the two documents

### What they get right
1. **They protect the right things:** the shared project record, separation of duties, field-first mobile, honest offline behaviour, database-enforced permissions and audit history. All of these exist now and are tested.
2. **The AI boundary is clear.** AI never releases hold points, approves bills, certifies claims, verifies credentials or issues documents.
3. **The sequencing is right.** Foundations (events, jobs, permission tests, files) come before AI features that depend on them.
4. **The differentiators are well chosen.** The activity generator, AI Inbox and connected readiness genuinely set the product apart from module-heavy competitors.
5. **They identify real gaps:** no automation engine, no per-project access control (see 2.3), browser-printed reports, no data import, and module-led navigation.
6. **The testing gates are good:** permission matrix, workflow states, offline replay, a document benchmark, AI evaluation, report reproducibility and prompt injection.

### Where they fall short

| Issue | Effect | What this plan does |
| --- | --- | --- |
| Detail sheets are templated, not designed | No real field lists, rules or acceptance criteria for new tables or screens | Section 6 gives concrete tables, columns, functions and screens for each new capability |
| Ignores the existing schema and functions | A literal build duplicates working code | Section 5 maps each spec item to *exists / extend / new* |
| Proposes a versioned REST API (`/v2/...`) | A second API layer to build, secure and test | Keep database functions as the API (decision D2) |
| Treats a React/Next.js migration as near-term | A rewrite would consume the first phases | Incremental, later, for specific screens only (decision D1) |
| Infrastructure unspecified (queue, PDF renderer, malware scanning, email, search, embeddings) | Can't start Phase 1 | Concrete choices in section 3 |
| No effort, cost, team or priority within phases | Hard to plan or fund | Estimates in section 9, costs in section 8 |
| The standards library is treated as software | It's mostly a content and legal job | A content workstream with an owner (section 6, Phase 5) |
| Twenty activity generators listed equally | Spreads effort thin | Three first (concrete slab, wet-area waterproofing, fire stopping), then expand |
| Spreadsheet import left to the last phase | A pilot customer can't load their data | Moved forward to Phase 2 |

### 2.3 One real gap the spec correctly calls out
Today, **every member of a company can see every project** (subcontractors are limited by company, not by project). The spec's *Project membership* entity is right, and it's the most important security change in Phase 1. It has to land before real customers with many projects and staff come on board.

---

## 3. Decisions to make first

Each decision has a recommendation; the remaining work depends on these.

| # | Decision | Recommendation | Why |
| --- | --- | --- | --- |
| D1 | Move the front end to React/Next.js? | **Not yet.** First add type checking to the current code (`// @ts-check` with JSDoc types, `tsc` in CI) and split `pages.js` (1,900 lines) into one file per module. Build the shared building blocks the spec wants (forms, tables, approval panel, AI suggestion, upload state) as plain functions. Revisit at Phase 3, and then only for the Inbox review screen and the sprint board, mounted inside the existing app. | About 4,700 lines of tested, working code. A rewrite would delay every new capability by months for no user-visible gain. The spec itself says "incremental, not a rewrite". |
| D2 | API layer | **Keep database functions as the API.** Add a request ID (`p_request_id`) to every create or decision function so retries are safe. If outside partners need an API later, add a thin Edge Function REST layer over the same functions. | It's already permission-checked, audited and tested. A separate `/v2` service doubles the security work. |
| D3 | Background jobs and queue | **A `jobs` table in Postgres** (claimed with `for update skip locked`). Workers run as Supabase Edge Functions, triggered on enqueue and every minute by `pg_cron`. | It's durable, idempotent, visible, and can be tested in the existing local setup. Supabase Queues (pgmq) is the alternative if volumes grow. |
| D4 | PDF and Word generation | **A small render service** (Node + Playwright in Docker, on Fly.io, Render or Google Cloud Run) that turns HTML templates into PDF using the app's own CSS. Word files via the `docx` library. | Edge Functions can't run a browser, and the reports already exist as HTML. |
| D5 | Hosting | **Move from GitHub Pages to Cloudflare Pages** (free) with a custom domain (e.g. setout.com.au). Do it before real customer data. | Security headers (CSP, HSTS) and preview deployments per branch. GitHub Pages can't set headers. |
| D6 | Environments | **Three Supabase projects: development (free), staging (free), production (Pro, US$25/month).** Production gets daily backups; add point-in-time recovery when customers sign. | The spec requires separate environments; Pro is needed for backups and no auto-pausing. |
| D7 | Email | **Resend or Postmark** for sending, and **Postmark inbound** for project email addresses (Phase 3). | Supabase's built-in email is for sign-in only and is rate-limited. |
| D8 | Search | **Postgres full-text search first** (one `search_index` table). Add semantic search with pgvector and an embeddings provider (Anthropic recommends Voyage AI) only if full-text proves insufficient. | Exact identifiers (drawing numbers, ABNs, invoice numbers) matter most in construction; full-text covers them at no extra cost. |
| D9 | AI models | **Decided (23 Oct): Claude Opus 5.5 reads documents; Claude Haiku 5.5 answers the help chat.** The Batches API is still an option for non-urgent bulk Inbox runs (50% off). | Accuracy where it matters (extraction feeds real records), low cost and fast replies for how-to questions. Revisit with the Phase 3 benchmark. |
| D10 | Malware scanning | **Phase 1:** file-type allow-list, real file-signature checks and size limits. **Before real customer onboarding:** a scanning service (e.g. ClamAV in the render container, or a cloud scanning API). | Proportionate: the spec's full scan pipeline matters once outside parties upload files. |
| D11 | Standards content owner | **Name a competent person** (for example your brother, or someone in his business) to author and approve activity content. Use public NSW sources first. | AI-generated safety documents need human authorship and approval; it's also the legal boundary. |

---

## 4. Build one complete workflow first

The strategy names the right demonstration (§21). Build it for **one activity, a concrete slab pour**, across Phases 2–5, before generalising anything:

1. A PM describes "Pour the L4 slab" on a programme task. The generator proposes a draft package: SWMS, ITP (formwork, reinforcement, pre-pour hold point, delivery, testing, curing), toolbox talk, permit prompts, required tickets, evidence plan and readiness requirements, each with its source shown.
2. The QM approves the ITP. The supervisor sends the SWMS to the concreter for review and submission (the existing SWMS workflow), and the readiness requirements go onto the task.
3. The sprint board shows the task as **red**, with the specific reasons. As the SWMS is approved, the crew acknowledges it, the inductions are recorded and the hold point is released, it turns green.
4. On site: sign-in, inspections, photos and the delivery docket. The docket goes to the AI Inbox, which matches it to the PO and the task.
5. At 3:30 pm the diary draft is ready. On Friday the weekly report is generated, reviewed and issued as a PDF.

Only once this works end to end, with tests, should the other 19 activities, the other report templates and the other Inbox document types follow.

---

## 5. How the spec's items map to the current code

### 5.1 Tables

| Spec table | Status | Where / what to do |
| --- | --- | --- |
| Organisation, User, Membership | Exists | `organisations`, `profiles`, `memberships` |
| **Project membership** | **New (Phase 1)** | `project_members`, see §6 Phase 1 |
| Project, Location, Contractor, Worker, Credential, Induction | Exist | Same names |
| Programme task | Exists | `tasks` |
| Task dependency | Extend | `tasks.predecessor_ids` (finish-to-start only). New `task_links` table with link type (FS/SS/FF/SF) and lag days, in Phase 2 or later |
| Delivery period, Sprint item, Readiness requirement, Readiness evaluation, Blocker | New (Phase 2) | `project_requirements` (credential types only) becomes one kind of readiness requirement |
| Document, Document revision | Exist | `documents` (one row per revision, grouped by number) |
| Document intake, extraction, relationship | New (Phase 3) | `document_intakes`, `intake_extractions`, `intake_matches` |
| RFI, Transmittal | New (Phase 3 or 4) | Small modules |
| Defect, ITP template, ITP, Inspection point, NCR | Exist | `defects`, `itp_templates`, `itps`, `itp_points`, `ncrs` |
| SWMS, SWMS acknowledgement, Permit, Toolbox talk | Exist | `swms`, `swms_acks`, `permits`, `toolbox_talks` |
| Safety report | Exists | `incidents` |
| Attendance event, Timesheet, Rate rule | Exist | `attendance`, `timesheets`, `rate_rules` |
| Budget line, PO, Bill, Receipt, Variation, Claim, Backcharge, Estimate | Exist | Same names |
| Site diary | Exists | `diary` (plus `site_notes`) |
| Report definition, Report run | New (Phase 4) | `report_templates`, `report_runs` |
| Handover requirement, Handover pack | Extend | `handovers` exists; add `handover_requirements` |
| Notification | New (Phase 1) | Server-side table; today notifications are worked out in the browser |
| Event | New (Phase 1) | `events`, written automatically by the existing `_audit()` helper |
| Automation rule, Automation run | New (Phase 1–2) | Built-in rules first; no customer rule builder yet |
| Job | New (Phase 1) | `jobs` |
| AI run, AI suggestion | Extend | `ai_usage` becomes `ai_runs` with feature, model, prompt version, inputs, output, cost and review result |
| Audit event | Exists | `audit_events` |
| Comment, Attachment | New (as needed) | Generic, linked to any record |
| Template source, Activity template, Checklist template, Generated compliance pack | New (Phase 5) | `standard_sources`, `content_fragments`, `activity_templates`, `generated_packs` |

### 5.2 API endpoints
Every `/v2/...` endpoint in the spec maps to a database function. About 40 of the 63 already exist; for example, `POST /v2/defects/{id}/transition` is `defect_action`, and `POST /v2/bills/{id}/decision` is `bill_action`. Each new capability below lists the new functions it needs.

### 5.3 Screens
Of the spec's 91 screens, about 70 exist today (the earlier slide deck has all 94 current ones). New screens: Today, My work (replacing My tasks), Sprint board, Look-ahead timeline, Sprint retrospective, Readiness detail, Blocker register, AI Inbox, Document review, Drawing viewer, RFI register, Transmittals, Activity generator, Report builder, Report review, Reports register, Handover readiness, Automation centre, Copilot, AI governance.

---

## 6. Phase-by-phase implementation

Each phase lists its database changes (one migration file per phase unless noted), server work, screens, AI, tests and what "done" means. Every new database function follows the existing pattern: `security definer`, a permission check, a workflow-state check, an audit entry, and grants revoked from public.

### Phase 1: Foundations and hardening (5–8 weeks)

**Database** (`20261101000000_platform_foundation.sql`)
- **`project_members`** (`project_id`, `user_id`, `added_by`, `added_at`).
  - A helper, `can_see_project(project_id)`: directors see every project; others see projects they've been added to; subcontractor admins and workers see projects their company or worker record is on.
  - Every project-scoped read rule changes from `is_member(org_id)` to `can_see_project(project_id)`.
  - **Existing data:** add every current member to every project, so nobody loses access when this ships.
- **`events`**: an append-only list of things that happened (`org_id`, `project_id`, `type`, `subject_type`, `subject_id`, `actor_id`, `correlation_id`, `payload`, `created_at`).
  - The existing `_audit()` helper writes an event as well, with a type such as `defect.closed` or `inspection_point.rejected` derived from the record and its new status.
  - So **all ~145 existing functions start emitting events without being rewritten.**
- **`jobs`**: `org_id`, `type`, `status` (queued, running, done, failed, dead), `idempotency_key` (unique per company and type), `payload`, `attempts`, `max_attempts`, `run_after`, `locked_until`, `error`, `cost_cents`, `created_by`. Functions: `enqueue_job`, `claim_jobs(type, n)` (`for update skip locked`), `finish_job`, `fail_job` (with backoff; after the last attempt it goes to *dead*).
- **`notifications`**: per person (`user_id`, `kind`, `title`, `body`, `link`, `subject`, `dedupe_key` unique, `read_at`, `emailed_at`). It replaces the browser-side `notifications()` gradually.
- **Safe retries:** a request ID on every create function used by the offline outbox. Defects already have `client_key`; timesheets, diary notes, receipts and finished tasks need the same.
- **`files`**: a register of every upload (`path`, `sha256`, detected type, size, `scan_status`), written by a `register_file` function after upload. It's the basis for duplicate detection in Phase 3.
- **`ai_runs`**, replacing `ai_usage` and keeping its history: feature, model, prompt version, input references, output, tokens, cost, time taken, review outcome (accepted, edited or rejected).
- **MFA:** require two-step sign-in for directors and PMs. Supabase supports authenticator apps, and the permission check can require the stronger sign-in level for privileged permissions.

**Server**
- A `worker` Edge Function that claims and runs jobs by type.
- `pg_cron` schedules: run the worker every minute, plus a daily expiry scan (credentials, insurances, permits) that writes events.
- An email-sending job type (Resend or Postmark) for notifications.
- The first three built-in automations, each with run history: **credential expiring**, **defect overdue**, **hold point submitted**.

**Platform**
- Staging and production Supabase projects. Cloudflare Pages hosting with security headers and a custom domain.
- **GitHub Actions** runs `tests/run.sh all` on every pull request, with Postgres and Chromium.
- Branch protection on `main`: no pushing to `main` without green tests.
- Error monitoring (Sentry's free tier) for the app and the Edge Functions.
- A backup-restore drill into staging, documented.

**Screens:** *Team & roles → Projects* (who's on each project); *Admin → Jobs* (queue, failures, retry); *Admin → Automations* (rules, recent runs).

**Tests**
- Project-membership tests for every project-scoped table and function, including another company, a removed member and a subcontractor on a different project.
- Job retry and dead-letter behaviour, automation de-duplication, event emission.

**Done when:** CI blocks a failing pull request; project access is enforced and tested; the three automations email the right people once (not repeatedly); the job dashboard shows a failed job and can retry it.

### Phase 2: A workspace built around the work (6–9 weeks)

**Database** (`…_delivery_readiness.sql`)
- **`delivery_periods`**: `project_id`, `label` (Sprint, Weekly plan, Look-ahead), `name`, `starts_on`, `ends_on`, `objective`, `owner_id`, `status` (planned, committed, active, closed), and a `retrospective` record.
- **`sprint_items`**: `period_id`, `task_id` (links to the programme task, never a copy), `board_state` (backlog, planned, ready, in progress, blocked, ready for inspection, verified, complete), `committed`, `position`, `owner_id`, `removed_reason`. Unique per period and task.
- **`readiness_requirements`**: `scope` (company, project, activity template or task) and a `kind`:
  - current approved drawing;
  - approved SWMS;
  - ITP applied;
  - hold point released;
  - predecessors complete;
  - crew inducted;
  - credential type held;
  - permit live;
  - custom check.

  Plus a `ref` (which record), and `amber_days` and `red_days` thresholds. The existing `project_requirements` rows migrate in as *credential type* requirements.
- **`readiness_evaluations`**: append-only history per task (`status` green, amber or red; `results` per requirement with pass/fail, reason and the record it checked; the event that caused the evaluation).
- **`blockers`**: task (optional), kind, description, owner, due date, status (open or resolved), resolution note, and source (readiness or manual).

**New functions**
- `evaluate_task_readiness(task)`: plain SQL, no AI. It returns each requirement's result with a link to the record that decided it, and a requirement's severity rises as the task's start date approaches.
- `create_delivery_period`, `add_sprint_items`, `commit_delivery_period`.
- `sprint_item_transition(item, to_state, reason)`. It validates every move, so dragging on the board can never write a status directly:
  - **Ready** needs green readiness, or a PM override with a reason.
  - **Verified** needs the linked ITP points released.
  - **Complete** needs progress at 100%.
  - **Removing** a committed item needs a reason.
- `close_delivery_period`: builds the retrospective counts (verified, rolled forward, blocked, which requirement types failed most often).
- `create_blocker`, `blocker_action`.
- `today_feed()`: the person's Today cards, worked out on the server. Each card says what the item is, why it's shown, who's responsible, how urgent it is and what they can do about it.
- `since_last_visit()`: events since the person last looked (a new `last_seen_at` on `profiles`).
- **Automations:** re-evaluate readiness when a relevant event happens (SWMS approved, credential expired, revision superseded, hold point released), plus nightly. A new automation, "task starts soon but not ready", creates a blocker and notifies the owner.

**Spreadsheet import** (moved forward from Phase 7, because a pilot needs its data loaded)
- Upload a CSV or Excel file for workers, contractors, cost codes or programme tasks.
- The file is read in the browser (SheetJS) into a staging table, and the person maps columns and reviews exceptions.
- `commit_import(batch)` then runs the existing create functions, all or nothing.

**Screens**
- **Today** (new home page): decisions first, then blockers and readiness failures in the next fortnight, "prepared for you", and "since your last visit". Charts move below.
- **My work**: replaces My tasks; adds the reason for each item and filters.
- **Sprint board**: columns as above. Drag and drop uses the browser's built-in drag API or SortableJS, with keyboard and "Move to…" buttons as an accessible alternative.
- **Look-ahead**: a 6-week timeline reusing the programme Gantt, with a readiness colour per task.
- **Readiness detail** for a task: each requirement, pass or fail, with links, history, and "create blocker" or "send task".
- **Blocker register**.
- **Project overview gets a data-quality panel:** tasks without owners, defects without due dates, unmatched documents, workers without a company.
- **Site app:** "My work today" lists only the supervisor's sprint items; blocked items show the reason in one line.

**Tests:** readiness for each requirement kind, including thresholds and the "superseded drawing" case; every allowed and refused board move; the retrospective counts; import validation and roll-back.

**Done when:** a PM plans a two-week sprint, sees why three tasks are red, resolves them, and the retrospective shows the result.

### Phase 3: The AI Inbox (7–10 weeks)

**Database** (`…_document_intake.sql`)
- **`document_intakes`**:
  - Where it came from: `project_id` (optional), `uploaded_by`, `source` (upload, email or mobile), `file_id`, `filename`.
  - What it is: `sha256`, `page_count`, and `batch_id` with `parent_intake_id`, `page_from` and `page_to` for pieces of a split document.
  - Where it's up to: `status` (uploaded, validating, rejected, processing, needs review, routed, discarded) and `error`.
- **`intake_extractions`**: `ai_run_id`, `doc_type`, `fields` (each field with its value, confidence and source page), `warnings`.
- **`intake_matches`**: `target_type`, `target_id`, `reason` ("ABN matches Coastal Concrete", "invoice number already on bill B-014"), `score`, `accepted`.
- **`intake_routes`**: which record it became, routed by whom, and when.
- **Functions:**
  - `create_intake` and `create_intake_batch`.
  - `match_intake(intake)`: plain rules, no AI. ABN → contractor; invoice number → duplicate bills; PO reference → purchase order; drawing number → document series and revision order; worker name → worker; policy number → insurance.
  - `split_intake(intake, ranges)`.
  - `discard_intake`.
  - **Accept functions that create the real record and mark the intake routed in one transaction:** `accept_intake_as_bill`, `…_as_receipt`, `…_as_credential`, `…_as_insurance`, `…_as_document`, `…_as_company_doc`. Each calls the existing create function, so every existing rule still applies.

**Server** (job types `intake.validate`, `intake.extract`)
1. **Validate.** Check the file's real type from its contents, its size and page count (pdf-lib). Reject damaged or password-protected files, and flag exact duplicates by checksum.
2. **Classify and split (AI).** For multi-document PDFs, Claude returns the segments with page ranges, each with a type and confidence. The person approves the split before anything is created.
3. **Extract (AI).** This generalises the existing extraction to each document type. The structured output now includes a source page and a confidence for every field.
4. **Match.** `match_intake` runs, and the intake moves to *needs review*.
5. **Bulk.** Several files, folders and ZIPs (unzipped in the browser) each become their own intake with its own status. Large batches use the Batches API at half price.

**Uploads:** resumable (Supabase Storage supports the TUS protocol), so leaving the page doesn't lose progress. The queue shows live status (Supabase Realtime, or polling).

**Project email** (after the Inbox is proven)
- Each project gets an address such as `p-2041.k7f2@in.setout.com.au`, handled by Postmark inbound, which passes messages to an `inbound-email` Edge Function.
- One intake per attachment, plus a record of the message itself.
- Duplicates are prevented by message ID and checksum.
- An email never becomes an instruction or approval by itself. It can only be offered as a draft RFI or variation.

**Screens**
- **AI Inbox**: drop zone, queue with per-file status, filters.
- **Document review**: the original on the left (pdf.js, page thumbnails); the proposed destination on the right. The right side reuses the existing forms and the current highlight-what-AI-filled behaviour. Each field shows its confidence; conflicts must be resolved; then Accept, Split or Discard.
- The existing **Read with AI** buttons stay, using the same service.
- **Bills inbox**: invoices waiting, with the PO match and duplicate warnings.

**AI quality**
- Build the **document benchmark** the spec asks for: 50–100 real but anonymised documents (clean PDFs, phone photos, rotated scans, handwriting, duplicates, expired certificates, combined packs, damaged files), each with the correct answers.
- An evaluation script scores accuracy per field, and **runs before any prompt or model change ships.**
- This is also where the Opus 5.5 vs Haiku 5.5 decision (D9) is made, on real numbers.

**Tests:** each validation failure; duplicate detection; split approval; each accept function (including refusals such as a duplicate invoice or the wrong company); malicious instructions inside a PDF don't change behaviour (prompt-injection tests); a re-run doesn't create duplicates.

**Done when:** you drop in a mixed folder of 20 real documents; each is identified, matched and waiting for review; accepting creates the right records; duplicates and expired certificates are caught.

### Phase 4: Controlled report generation (5–8 weeks)

**Database** (`…_report_generation.sql`)
- **`report_templates`**: `kind`, `version`, `name`, `sections`, `audience` (internal or client), `status` (draft or approved), `approved_by`.
  - Client templates can't include commercial sections, because the database refuses it.
- **`report_runs`**: links to the template and its version, the period, and the person who asked.
  - What went into it: a `snapshot` of the data at generation time.
  - The AI text: a `narrative` per section, with its AI run and who edited it.
  - Its status: draft, in review, approved, issued or withdrawn. It records who reviewed and who issued it, the recipients, and the file path and checksum.
  - **Issued runs can't be changed;** reissuing creates a new run.
- **`handover_requirements`**: category, description, linked record, status, an approved exception with its reason.
- **Functions:**
  - `snapshot_report_data(project, period, template)`: plain database queries under the requester's permissions; client audiences exclude commercial data.
  - `request_report`, `review_report`, `approve_report`, `issue_report`.
  - `draft_site_diary(project, date)`: assembles attendance, inspections, permits, incidents, accepted notes and programme progress into a draft. The existing `submit_diary` still does the submission.

**Server**
- **The render service** (D4). It takes a job, renders the HTML template using the app's CSS, makes the PDF, saves it privately and records its checksum.
- Word output for the diary and weekly report.
- The handover pack merges the current-revision certificates, warranties, O&M manuals and as-builts, with an index (pdf-lib).
- **AI narrative** (optional per section): Claude drafts from the snapshot only, and every claim links to the records it came from. **Numbers come from the snapshot, never the model.** The narrative stays a draft until someone reviews it.
- **Automations:** "site diary cut-off" (for example 3:30 pm) prepares the draft and notifies the supervisor; "report schedule reached" prepares the weekly report for review.

**Screens:** Report builder (choose template and period, preview); Report review (narrative editing, approve and issue); Reports register (issued versions, recipients, downloads); Handover readiness (requirements, gaps, exceptions); site diary draft review.

**Tests:** regenerating from the same snapshot and template gives identical figures and sections; client reports never contain commercial fields; issued reports can't be edited.

**Done when:** the weekly report and diary for the pilot project are generated, reviewed and issued as PDFs, with a record of who approved them.

### Phase 5: Standards library and activity generator (7–10 weeks of software, plus content)

**Database** (`…_standards_activity.sql`)
- **`standard_sources`**:
  - What it is: title, publisher, jurisdiction (NSW or Commonwealth), and kind (legislation, code of practice, Australian Standard, NCC, manufacturer, company procedure or client requirement).
  - Which version: edition, effective date and review date.
  - How it can be used: `rights` (public; customer-licensed; or reference-only, which means cite but don't reproduce).
  - Its status, owner, and what it was superseded by.
- **`content_fragments`**: source, clause reference, kind (hazard, control, inspection check, acceptance criterion, competency, permit trigger, PPE, evidence), the wording (company-authored, or a permitted extract), activity tags, version, status (draft or approved) and approver.
- **`activity_templates`**: a code (for example `CONC-SLAB`), name, description, tags, high-risk construction work categories, default readiness requirements, project questions, approved fragments, version and status.
- **`generated_packs`**:
  - What it's for: project, task, activity template and version, and the answers to the project questions.
  - What it contains: drafts of the SWMS, ITP, checklists, toolbox talk, permit prompts, required tickets, evidence plan and readiness requirements.
  - Where it came from: every source fragment it used, with its version, plus the AI runs.
  - Its status (draft, in review, approved, rejected) and who reviewed it.
- **`approve_pack(pack, selections)`** turns an approved pack into the existing records. It never skips their workflows:
  - The SWMS goes to the contractor as a draft to review and submit, then through normal SWMS review.
  - The ITP becomes a **draft template version** that a quality manager must approve.
  - Readiness requirements go onto the task; extra required tickets go onto the project; a toolbox talk draft is created.

**AI**
1. **Activity classification:** the description is matched to the approved activity list. The model chooses only from the list, and full-text search is the fallback.
2. **Project questions** come from the template (work area, plant, substances, nearby services, other trades, responsible people), answered in a form rather than guessed.
3. **Drafting:** the model assembles the pack **only from the fragments it is given.** Every item must carry a `fragment_id`, which the database checks. Anything without a valid source is marked "AI suggestion, no source" and needs explicit acceptance by the reviewer. The screen shows the source and edition beside each item.

**Content workstream** (not software)
- Owner: the competent person from D11.
- **Start with public NSW sources:**
  - the WHS Act and Regulation (NSW), including the high-risk construction work list and the SWMS requirements;
  - SafeWork NSW codes of practice (construction work, falls, excavation, demolition, hazardous manual tasks);
  - manufacturer installation guides.
- **Australian Standards** (for example concrete, waterproofing, fire stopping) are **licensed**. Store the clause *reference* and company-authored requirements, not the text, unless the customer holds a licence and uploads it under their own rights.
- **Check the current edition of each source;** NSW regulations are periodically remade.
- Author and approve three activities first (concrete slab, wet-area waterproofing, fire stopping, matching the existing ITP starters). Expect roughly 1–3 days of the competent person's time per activity, plus a second reviewer.

**Screens:** Activity generator (describe the work, then answer the questions, then review the draft pack showing sources and gaps, then approve); Standards library admin (sources, fragments, editions, review dates); a "Generated from…" panel on SWMS and ITP pages.

**Legal and governance**
- Every generated document shows **Draft — not reviewed** until approved.
- The approver confirms they've checked it against the actual work and site.
- Marketing never says "compliant".
- Get legal review before selling this feature.

**Tests:** items without a valid source are refused; superseded sources aren't used; approval goes through the normal SWMS and ITP workflows; nobody can approve a pack they generated without a second person, if that policy is chosen.

**Done when:** "Pour the L4 slab" produces a sourced draft pack; approving it creates the SWMS draft, the ITP template draft and the readiness requirements; and the readiness flow from Phase 2 picks them up.

### Phase 6: Project copilot (5–8 weeks, including search)

**Database:**
- **`search_index`**: record type, record ID, project, title, body (full-text), revision status, and who can see it. Kept up to date by triggers and a `search.reindex` job type. It's read through a `search_records(q, filters)` function that applies the person's permissions **before** results are returned.
- **`copilot_tools`**: a registered list of tools, each with a name, mode (ask, prepare or act), the function it calls, and whether it needs confirmation.

**Server:** extends the existing `ai` Edge Function with a `copilot` action.
- **Claude tool use with strict schemas.** Tools run **as the signed-in person**, using their sign-in token, so every database permission applies.
- **Ask tools:** `search_records`, `get_record`, `get_task_readiness`, `list_my_work`, `explain_blocker`.
- **Prepare tools** create drafts only: `draft_defect`, `draft_rfi`, `draft_report`, `draft_sprint`, `draft_variation_description`.
- **Act tools,** a short list, each confirmed by the person first: `create_site_task`, `add_comment`, `route_intake_for_review`.
- **Never available to the copilot:** releasing hold points, approving permits, verifying credentials, approving bills or variations, certifying claims, closing NCRs, issuing handover, changing permissions.
- **Grounding:**
  - Answers link to records. Where a document's text is quoted, Claude's citations feature gives the page.
  - If nothing supports an answer, it says so.
  - Content from superseded revisions is labelled as superseded.
- Uploaded documents are untrusted: instructions inside them never change the tools or permissions (prompt-injection tests from Phase 3 extended).

**Screens:** Copilot panel (replaces the current Help panel, with Ask, Prepare and Act tabs); confirmation sheet for Act; *AI governance* page (usage, cost, acceptance rates, features on/off per company and project).

**Done when:** "Why is the L4 pour blocked?" gives the right failed requirements with links; "Draft an RFI about the C4 cover" produces a draft for review; a worker can't learn anything they couldn't open themselves.

### Phase 7: Integrations (2–4 weeks each)
- **Xero** first (the usual choice for Australian builders): push approved bills and receipts; pull back payment status; map cost codes to tracking categories. **MYOB** second.
- **Payroll:** the payroll CSV exists; add an Employment Hero (KeyPay) or Xero Payroll connection when a customer needs it.
- **Microsoft sign-in:** Supabase supports Azure sign-in, so this is mostly configuration.
- **Schedule import:** MS Project XML, and Primavera P6 XER files, into tasks with links.
- **SharePoint or OneDrive document exchange** only if a customer requires it.
- **Each integration needs:**
  - a defined *system of record* for each field;
  - a sync log;
  - reconciliation;
  - retry without duplicates;
  - its own sandbox tests.

---

## 7. Front-end work that runs alongside the phases
- **Phase 1:** split `app/js/pages.js` into one file per module; add `// @ts-check` and `tsc --noEmit` in CI; build shared helpers (register table, form fields, approval panel, AI suggestion, upload progress, empty, loading, offline and error states).
- **Phases 2–3:** the sprint board and Inbox review are the most interactive screens. If plain functions become hard to manage there, mount Preact or React components into those two routes only (built with Vite into `app/dist/`) and leave everything else as it is. That's the "progressive migration" the spec describes, on a realistic timetable.
- Every new screen has a matching browser test in `tests/`, and the slide deck can be regenerated with `tests/capture.mjs`.

---

## 8. Running costs (indicative, per month, in USD)

| Item | Pilot | Early customers |
| --- | --- | --- |
| Supabase production (Pro) + staging (free) | $25 | $25–100 (more compute and storage) |
| Hosting (Cloudflare Pages) | $0 | $0–20 |
| Render service (Fly.io, Render or Cloud Run) | $5–15 | $15–50 |
| Email sending + inbound (Resend/Postmark) | $0–20 | $20–50 |
| Error monitoring (Sentry) | $0 | $0–26 |
| Malware scanning | $0 (file checks only) | $10–50 |
| **AI, document reading** | About **$0.03–0.05 per document** with Opus 5.5 (a 3-page PDF); about $0.001 with Haiku 5.5; half price for Batches | 1,000 documents ≈ $40 (Opus) or $1–2 (Haiku) |
| **AI, copilot question** | About $0.01–0.03 each (the guide is cached) | Depends on usage; capped per person and company already |

AI figures use Anthropic's current list prices (Opus 5.5 at $4 input / $20 output per million tokens; Haiku 5.5 at $0.10 / $0.50). They're estimates; the AI governance page will show real costs once usage starts.

---

## 9. Effort and order

| Phase | Weeks (one experienced developer + AI assistance) | Depends on |
| --- | --- | --- |
| 1. Foundations and hardening | 5–8 | Decisions D1–D7, D10 |
| 2. Work-centred workspace + import | 6–9 | Phase 1 (events, jobs, project access) |
| 3. AI Inbox | 7–10 | Phase 1 (jobs, files, AI runs) |
| 4. Report generation | 5–8 | Phase 1; render service |
| 5. Standards and activity generator | 7–10 + content | Phases 2 and 4; a named content owner |
| 6. Copilot + search | 5–8 | Phases 1–3 |
| 7. Integrations | 2–4 each | A customer who needs each one |

- **Total:** roughly **35–53 weeks** before integrations.
- **Overlap:** Phases 3 and 4 can run in parallel with a second developer, and the Phase 5 content can start during Phase 2.
- **Uncertainty:** these are planning ranges, not quotes. The biggest variables are the AI benchmark results and how much UI polish the pilot customer expects.

---

## 10. Risks and how to manage them

| Risk | Mitigation |
| --- | --- |
| Scope: the spec describes an enterprise product | Build the concrete-slab workflow first (§4), with one pilot customer, and say no to breadth until it works end to end |
| Liability for AI-drafted SWMS and ITPs | Drafts only; approved, sourced content; reviewer attestation; legal review before selling; no "compliant" claims |
| Copyright in Australian Standards | Store references and company-authored requirements; customer-licensed content only under their rights |
| Privacy (worker licences, personal phone numbers) and AI processing offshore | A privacy policy and data map, and disclosure that documents go to the AI provider (Anthropic, US) for reading. Check the AI data-retention settings. Retention rules per record type. Consider the Australian Privacy Principles before onboarding |
| AI extraction errors | Field-level confidence, human review before saving, the benchmark gate before any change, acceptance metrics |
| A real customer's data in the public repo | Keep the rule: sample data only in the repo; real data only in production Supabase; consider making the repo private once real customers start |
| Hidden regressions | CI on every pull request; no direct pushes to `main` once Phase 1 lands |

---

## 11. What I'd do next
1. **Agree the decisions in section 3** (or change them).
2. **Choose the pilot:** which company, which project, and who the competent person for the standards content is.
3. **Start Phase 1** with three pieces, in this order: project membership (a security gap), CI on pull requests, then events + jobs + the first three automations. Each one is a pull request with its own tests.
