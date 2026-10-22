-- =====================================================================
-- Safety & site access extras (blueprint §4.4, §6.3, §6.5)
--   NCRs · permits to work · incidents & observations · toolbox talks ·
--   visitors · QR gate (no account needed) · manual sign-in · missing
--   sign-outs
--
-- The gate works without logging in, so anonymous calls must carry the
-- project's gate code (printed on the QR poster) and are rate-limited.
-- Workers at the gate identify themselves with their personal worker code.
-- =====================================================================

create or replace function public.role_can(p_role text, p_perm text) returns boolean
language sql immutable as $$
  select case p_role
    when 'director' then p_perm = any (array['defect.create','defect.assign','defect.verify','itp.release_hold','itp.manage','itp.submit','swms.submit','variation.create','variation.approve','swms.review','commercial.view','diary.submit','people.manage','project.manage','documents.upload','documents.approve','ncr.manage','permit.request','permit.approve','safety.report','safety.manage','attendance.manage'])
    when 'project_manager' then p_perm = any (array['defect.create','defect.assign','defect.verify','itp.release_hold','itp.manage','itp.submit','swms.submit','variation.create','variation.approve','swms.review','commercial.view','diary.submit','people.manage','project.manage','documents.upload','documents.approve','ncr.manage','permit.request','permit.approve','safety.report','safety.manage','attendance.manage'])
    when 'site_supervisor' then p_perm = any (array['defect.create','defect.assign','defect.verify','itp.submit','swms.submit','swms.review','diary.submit','people.manage','documents.upload','ncr.manage','permit.request','permit.approve','safety.report','safety.manage','attendance.manage'])
    when 'quality_manager' then p_perm = any (array['defect.create','defect.assign','defect.verify','itp.release_hold','itp.manage','itp.submit','documents.upload','documents.approve','ncr.manage','safety.report'])
    when 'subcontractor_admin' then p_perm = any (array['defect.rectify','variation.create','itp.submit','swms.submit','documents.upload','permit.request','safety.report'])
    when 'worker' then p_perm = any (array['defect.create','permit.request','safety.report'])
    else false end;
$$;

-- ---------------------------------------------------------------- tables
create table public.ncrs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  ref text not null,
  title text not null,
  location text,
  requirement text not null,
  containment text,
  root_cause text,
  corrective_action text,
  contractor_id uuid references public.contractors (id) on delete set null,
  status text not null default 'open' check (status in ('open','corrective_action','verification','closed')),
  raised_by uuid,
  raised_at timestamptz not null default now(),
  closed_by uuid,
  closed_at timestamptz,
  itp_id uuid references public.itps (id) on delete set null,
  defect_id uuid references public.defects (id) on delete set null,
  unique (project_id, ref)
);

create table public.permits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  ref text not null,
  type text not null,
  location text not null,
  description text,
  conditions text,
  valid_from date not null,
  valid_to date not null,
  contractor_id uuid references public.contractors (id) on delete set null,
  status text not null default 'requested' check (status in ('requested','approved','rejected','closed')),
  requested_by uuid,
  requested_at timestamptz not null default now(),
  approved_by uuid,
  approved_at timestamptz,
  decision_note text,
  closed_by uuid,
  closed_at timestamptz,
  close_note text,
  unique (project_id, ref)
);

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  ref text not null,
  type text not null check (type in ('incident','near_miss','hazard','observation')),
  title text not null,
  description text,
  location text,
  occurred_at timestamptz not null default now(),
  severity text not null default 'low' check (severity in ('low','medium','high','critical')),
  immediate_action text,
  root_cause text,
  corrective_action text,
  notifiable boolean not null default false,
  status text not null default 'open' check (status in ('open','investigating','closed')),
  reported_by uuid,
  reported_at timestamptz not null default now(),
  closed_by uuid,
  closed_at timestamptz,
  unique (project_id, ref)
);

create table public.toolbox_talks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  date date not null,
  topic text not null,
  notes text,
  run_by uuid,
  created_at timestamptz not null default now()
);
create table public.toolbox_attendees (
  org_id uuid not null references public.organisations (id) on delete cascade,
  talk_id uuid not null references public.toolbox_talks (id) on delete cascade,
  worker_id uuid not null references public.workers (id) on delete cascade,
  primary key (talk_id, worker_id)
);

create table public.visitors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null,
  company text,
  phone text,
  purpose text not null,
  host text,
  vehicle_rego text,
  rules_accepted boolean not null default false,
  signed_in_at timestamptz not null default now(),
  signed_out_at timestamptz,
  method text not null default 'gate'
);
create index on public.visitors (project_id, signed_in_at desc);

-- Gate code per project (on the QR poster) and personal code per worker.
alter table public.projects add column if not exists gate_code text unique;
alter table public.workers add column if not exists worker_code text;
create or replace function public._new_gate_code() returns text language sql volatile as $$ select left(replace(gen_random_uuid()::text, '-', ''), 18) $$;
update public.projects set gate_code = _new_gate_code() where gate_code is null;
alter table public.projects alter column gate_code set default left(replace(gen_random_uuid()::text, '-', ''), 18);

-- 6-digit worker codes, unique within a company.
create or replace function public._worker_code() returns trigger
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if new.worker_code is not null then return new; end if;
  loop
    c := lpad((floor(random() * 1000000))::int::text, 6, '0');
    exit when not exists (select 1 from workers where org_id = new.org_id and worker_code = c);
  end loop;
  new.worker_code := c;
  return new;
end $$;
drop trigger if exists workers_code on public.workers;
create trigger workers_code before insert on public.workers for each row execute function public._worker_code();
do $$
declare r record; c text;
begin
  for r in select id, org_id from public.workers where worker_code is null loop
    loop
      c := lpad((floor(random() * 1000000))::int::text, 6, '0');
      exit when not exists (select 1 from public.workers where org_id = r.org_id and worker_code = c);
    end loop;
    update public.workers set worker_code = c where id = r.id;
  end loop;
end $$;
create unique index if not exists workers_code_per_org on public.workers (org_id, worker_code);

create table public.gate_attempts (
  id bigint generated always as identity primary key,
  project_id uuid not null,
  at timestamptz not null default now()
);
create index on public.gate_attempts (project_id, at);

do $$
declare t text;
begin
  foreach t in array array['ncrs','permits','incidents','toolbox_talks','toolbox_attendees'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "members read" on public.%I for select using (is_member(org_id))', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
-- Visitor names and phone numbers: only the people who run the site register.
alter table public.visitors enable row level security;
create policy "site register read" on public.visitors for select using (has_perm(org_id, 'attendance.manage'));
grant select on public.visitors to authenticated;
alter table public.gate_attempts enable row level security; -- no policies: internal only

-- ------------------------------------------------------------- helpers
create or replace function public._next_ref(p_table text, p_project uuid, p_prefix text, p_width int default 3) returns text
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform pg_advisory_xact_lock(hashtext(p_table || '-ref:' || p_project::text));
  execute format('select coalesce(max(nullif(regexp_replace(ref, ''\D'', '''', ''g''), '''')::int), 0) + 1 from public.%I where project_id = $1 and ref like $2', p_table) into n using p_project, p_prefix || '-%';
  return p_prefix || '-' || lpad(n::text, p_width, '0');
end $$;

create or replace function public._project_for(p_project uuid) returns public.projects
language plpgsql stable security definer set search_path = public as $$
declare pr projects;
begin
  select * into pr from projects where id = p_project;
  if not found then perform _fail('Project not found.'); end if;
  return pr;
end $$;

-- ================================================================ NCRs
create or replace function public.create_ncr(p_project uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects := _project_for(p_project); v uuid; ref text;
begin
  perform _require(pr.org_id, 'ncr.manage');
  if length(trim(coalesce(p ->> 'title', ''))) = 0 then perform _fail('Describe the non-conformance.'); end if;
  if length(trim(coalesce(p ->> 'requirement', ''))) = 0 then perform _fail('State the requirement that was breached (e.g. drawing, spec clause or standard).'); end if;
  if nullif(p ->> 'contractor_id', '') is not null and not exists (select 1 from contractors where id = (p ->> 'contractor_id')::uuid and org_id = pr.org_id) then perform _fail('Contractor not found.'); end if;
  ref := _next_ref('ncrs', pr.id, 'NCR');
  insert into ncrs (org_id, project_id, ref, title, location, requirement, containment, contractor_id, raised_by, itp_id, defect_id)
  values (pr.org_id, pr.id, ref, trim(p ->> 'title'), nullif(trim(coalesce(p ->> 'location', '')), ''), trim(p ->> 'requirement'),
    nullif(trim(coalesce(p ->> 'containment', '')), ''), nullif(p ->> 'contractor_id', '')::uuid, auth.uid(), nullif(p ->> 'itp_id', '')::uuid, nullif(p ->> 'defect_id', '')::uuid)
  returning id into v;
  perform _audit(pr.org_id, pr.id, 'ncr', v::text, 'NCR raised', null, 'open', ref || ' · ' || trim(p ->> 'title'));
  return jsonb_build_object('id', v, 'message', ref || ' raised.');
end $$;

-- Details can be filled in by the NCR team, or by the responsible subcontractor (root cause and corrective action).
create or replace function public.update_ncr(p_ncr uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n ncrs; m memberships; team boolean;
begin
  select * into n from ncrs where id = p_ncr for update;
  if not found then perform _fail('NCR not found.'); end if;
  m := _me(n.org_id);
  team := role_can(m.role, 'ncr.manage');
  if not team and not (m.role = 'subcontractor_admin' and m.contractor_id = n.contractor_id) then perform _fail('Only the NCR team or the responsible company can update this NCR.'); end if;
  if n.status = 'closed' then perform _fail('This NCR is closed.'); end if;
  update ncrs set
    containment = case when team then coalesce(nullif(trim(coalesce(p ->> 'containment', '')), ''), containment) else containment end,
    root_cause = coalesce(nullif(trim(coalesce(p ->> 'root_cause', '')), ''), root_cause),
    corrective_action = coalesce(nullif(trim(coalesce(p ->> 'corrective_action', '')), ''), corrective_action)
  where id = n.id;
  perform _audit(n.org_id, n.project_id, 'ncr', n.id::text, 'NCR details updated', null, null, n.ref);
  return jsonb_build_object('message', n.ref || ' updated.');
end $$;

create or replace function public.advance_ncr(p_ncr uuid, p_note text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare n ncrs; nxt text;
begin
  select * into n from ncrs where id = p_ncr for update;
  if not found then perform _fail('NCR not found.'); end if;
  perform _require(n.org_id, 'ncr.manage');
  nxt := case n.status when 'open' then 'corrective_action' when 'corrective_action' then 'verification' when 'verification' then 'closed' end;
  if nxt is null then perform _fail('This NCR is already closed.'); end if;
  if nxt = 'corrective_action' and n.containment is null then perform _fail('Record the immediate containment first.'); end if;
  if nxt = 'verification' and (n.root_cause is null or n.corrective_action is null) then perform _fail('Record the root cause and corrective action before verification.'); end if;
  if nxt = 'closed' and n.raised_by = auth.uid() and exists (select 1 from memberships where org_id = n.org_id and user_id <> auth.uid() and role_can(role, 'ncr.manage')) then
    perform _fail('Someone other than the person who raised it must verify and close the NCR.');
  end if;
  update ncrs set status = nxt, closed_by = case when nxt = 'closed' then auth.uid() end, closed_at = case when nxt = 'closed' then now() end where id = n.id;
  perform _audit(n.org_id, n.project_id, 'ncr', n.id::text, case nxt when 'closed' then 'NCR verified and closed' when 'verification' then 'NCR ready for verification' else 'NCR corrective action started' end,
    n.status, nxt, n.ref || coalesce(' — ' || nullif(trim(p_note), ''), ''));
  return jsonb_build_object('message', n.ref || case nxt when 'closed' then ' verified and closed.' when 'verification' then ' ready for verification.' else ' moved to corrective action.' end);
end $$;

-- ============================================================= permits
create or replace function public.request_permit(p_project uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects := _project_for(p_project); m memberships; v uuid; ref text; f date; t date;
begin
  m := _require(pr.org_id, 'permit.request');
  if length(trim(coalesce(p ->> 'type', ''))) = 0 then perform _fail('Choose the permit type.'); end if;
  if length(trim(coalesce(p ->> 'location', ''))) = 0 then perform _fail('Where is the work?'); end if;
  f := nullif(p ->> 'valid_from', '')::date; t := coalesce(nullif(p ->> 'valid_to', '')::date, f);
  if f is null then perform _fail('Choose the date the work is planned.'); end if;
  if t < f then perform _fail('The end date can''t be before the start date.'); end if;
  if t - f > 7 then perform _fail('Permits can cover at most 7 days — request a new one after that.'); end if;
  ref := _next_ref('permits', pr.id, 'PTW');
  insert into permits (org_id, project_id, ref, type, location, description, conditions, valid_from, valid_to, contractor_id, requested_by)
  values (pr.org_id, pr.id, ref, trim(p ->> 'type'), trim(p ->> 'location'), nullif(trim(coalesce(p ->> 'description', '')), ''),
    nullif(trim(coalesce(p ->> 'conditions', '')), ''), f, t, coalesce(case when m.role = 'subcontractor_admin' then m.contractor_id end, nullif(p ->> 'contractor_id', '')::uuid), auth.uid())
  returning id into v;
  perform _audit(pr.org_id, pr.id, 'permit', v::text, 'Permit requested', null, 'requested', ref || ' · ' || trim(p ->> 'type') || ' · ' || trim(p ->> 'location'));
  return jsonb_build_object('id', v, 'message', ref || ' requested. It must be approved by an authorised person before work starts.');
end $$;

create or replace function public.permit_action(p_permit uuid, p_action text, p_note text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare x permits; m memberships;
begin
  select * into x from permits where id = p_permit for update;
  if not found then perform _fail('Permit not found.'); end if;
  m := _me(x.org_id);
  if p_action in ('approve','reject') then
    if not role_can(m.role, 'permit.approve') then perform _fail('Only an authorised person (supervisor, PM or director) can approve permits.'); end if;
    if x.status <> 'requested' then perform _fail('This permit isn''t waiting for approval.'); end if;
    if p_action = 'approve' then
      -- Never self-issued, never automatic.
      if x.requested_by = auth.uid() then perform _fail('You requested this permit — another authorised person must approve it.'); end if;
      if x.valid_to < current_date then perform _fail('This permit''s dates have passed. Ask for a new request.'); end if;
      update permits set status = 'approved', approved_by = auth.uid(), approved_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), '') where id = x.id;
    else
      if length(trim(coalesce(p_note, ''))) = 0 then perform _fail('Say why the permit is rejected.'); end if;
      update permits set status = 'rejected', approved_by = auth.uid(), approved_at = now(), decision_note = trim(p_note) where id = x.id;
    end if;
  elsif p_action = 'close' then
    if x.status <> 'approved' then perform _fail('Only an approved permit can be closed.'); end if;
    if not (role_can(m.role, 'permit.approve') or x.requested_by = auth.uid()) then perform _fail('Only the requester or an authorised person can close a permit.'); end if;
    update permits set status = 'closed', closed_by = auth.uid(), closed_at = now(), close_note = nullif(trim(coalesce(p_note, '')), '') where id = x.id;
  else
    perform _fail('Unknown action.');
  end if;
  select * into x from permits where id = p_permit;
  perform _audit(x.org_id, x.project_id, 'permit', x.id::text, 'Permit ' || x.status, null, x.status, x.ref || coalesce(' — ' || nullif(trim(p_note), ''), ''));
  return jsonb_build_object('message', x.ref || ' ' || x.status || '.');
end $$;

-- =========================================================== incidents
create or replace function public.report_incident(p_project uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects := _project_for(p_project); v uuid; ref text; typ text := coalesce(nullif(p ->> 'type', ''), 'incident');
begin
  perform _require(pr.org_id, 'safety.report');
  if typ not in ('incident','near_miss','hazard','observation') then perform _fail('Choose what you''re reporting.'); end if;
  if length(trim(coalesce(p ->> 'title', ''))) = 0 then perform _fail('Say what happened.'); end if;
  ref := _next_ref('incidents', pr.id, case typ when 'observation' then 'OBS' when 'hazard' then 'HAZ' else 'INC' end);
  insert into incidents (org_id, project_id, ref, type, title, description, location, occurred_at, severity, immediate_action, notifiable, reported_by)
  values (pr.org_id, pr.id, ref, typ, trim(p ->> 'title'), nullif(trim(coalesce(p ->> 'description', '')), ''), nullif(trim(coalesce(p ->> 'location', '')), ''),
    coalesce(nullif(p ->> 'occurred_at', '')::timestamptz, now()), coalesce(nullif(p ->> 'severity', ''), 'low'), nullif(trim(coalesce(p ->> 'immediate_action', '')), ''),
    coalesce((p ->> 'notifiable')::boolean, false), auth.uid())
  returning id into v;
  perform _audit(pr.org_id, pr.id, 'incident', v::text, case typ when 'observation' then 'Observation recorded' when 'hazard' then 'Hazard reported' when 'near_miss' then 'Near miss reported' else 'Incident reported' end,
    null, 'open', ref || ' · ' || trim(p ->> 'title'));
  return jsonb_build_object('id', v, 'message', ref || ' reported.' || case when coalesce((p ->> 'notifiable')::boolean, false) then ' Notifiable incident: notify the regulator immediately and preserve the site.' else '' end);
end $$;

create or replace function public.incident_action(p_incident uuid, p_action text, p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public as $$
declare x incidents;
begin
  select * into x from incidents where id = p_incident for update;
  if not found then perform _fail('Report not found.'); end if;
  perform _require(x.org_id, 'safety.manage');
  if x.status = 'closed' then perform _fail('This report is closed.'); end if;
  update incidents set
    root_cause = coalesce(nullif(trim(coalesce(p ->> 'root_cause', '')), ''), root_cause),
    corrective_action = coalesce(nullif(trim(coalesce(p ->> 'corrective_action', '')), ''), corrective_action)
  where id = x.id;
  select * into x from incidents where id = p_incident;
  if p_action = 'investigate' then
    update incidents set status = 'investigating' where id = x.id;
  elsif p_action = 'close' then
    if x.type <> 'observation' and x.corrective_action is null then perform _fail('Record the corrective action before closing.'); end if;
    update incidents set status = 'closed', closed_by = auth.uid(), closed_at = now() where id = x.id;
  elsif p_action <> 'save' then
    perform _fail('Unknown action.');
  end if;
  select * into x from incidents where id = p_incident;
  perform _audit(x.org_id, x.project_id, 'incident', x.id::text, case p_action when 'close' then 'Report closed out' when 'investigate' then 'Investigation started' else 'Report updated' end, null, x.status, x.ref);
  return jsonb_build_object('message', x.ref || case p_action when 'close' then ' closed out.' when 'investigate' then ' under investigation.' else ' updated.' end);
end $$;

-- ======================================================== toolbox talks
create or replace function public.record_toolbox_talk(p_project uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects := _project_for(p_project); v uuid; w uuid; n int := 0;
begin
  perform _require(pr.org_id, 'diary.submit');
  if length(trim(coalesce(p ->> 'topic', ''))) = 0 then perform _fail('Enter the topic.'); end if;
  insert into toolbox_talks (org_id, project_id, date, topic, notes, run_by)
  values (pr.org_id, pr.id, coalesce(nullif(p ->> 'date', '')::date, current_date), trim(p ->> 'topic'), nullif(trim(coalesce(p ->> 'notes', '')), ''), auth.uid())
  returning id into v;
  for w in select (jsonb_array_elements_text(coalesce(p -> 'attendees', '[]')))::uuid loop
    if not exists (select 1 from workers where id = w and org_id = pr.org_id) then perform _fail('Attendee not found.'); end if;
    insert into toolbox_attendees (org_id, talk_id, worker_id) values (pr.org_id, v, w) on conflict do nothing;
    n := n + 1;
  end loop;
  if n = 0 then perform _fail('Tick who attended.'); end if;
  perform _audit(pr.org_id, pr.id, 'toolbox', v::text, 'Toolbox talk recorded', null, null, trim(p ->> 'topic') || ' · ' || n || ' attended');
  return jsonb_build_object('id', v, 'message', format('Toolbox talk recorded with %s attendee%s.', n, case when n = 1 then '' else 's' end));
end $$;

-- ============================================== sign-in register extras
-- Supervisor signs someone in by hand. Requirements still apply — a reason doesn't override safety.
create or replace function public.manual_sign_in(p_project uuid, p_worker uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects := _project_for(p_project); w workers; b text[];
begin
  perform _require(pr.org_id, 'attendance.manage');
  select * into w from workers where id = p_worker and org_id = pr.org_id;
  if not found then perform _fail('Worker not found.'); end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then perform _fail('Give a reason for signing them in by hand (e.g. no phone).'); end if;
  b := site_blockers(w.id, pr.id);
  if cardinality(b) > 0 then perform _fail(w.name || ' can''t be signed in yet: ' || array_to_string(b, '; ') || '.'); end if;
  insert into attendance (org_id, project_id, worker_id, kind, method, override_reason) values (pr.org_id, pr.id, w.id, 'check_in', 'manual', trim(p_reason));
  perform _audit(pr.org_id, pr.id, 'attendance', w.id::text, 'Signed in by supervisor', null, null, w.name || ' — ' || trim(p_reason));
  return jsonb_build_object('message', w.name || ' signed in.');
end $$;

create or replace function public.manual_sign_out(p_project uuid, p_worker uuid, p_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects := _project_for(p_project); w workers;
begin
  perform _require(pr.org_id, 'attendance.manage');
  select * into w from workers where id = p_worker and org_id = pr.org_id;
  if not found then perform _fail('Worker not found.'); end if;
  insert into attendance (org_id, project_id, worker_id, kind, at, method, override_reason)
  values (pr.org_id, pr.id, w.id, 'check_out', coalesce(p_at, now()), 'manual', case when p_at is not null then 'Missing sign-out recorded' end);
  perform _audit(pr.org_id, pr.id, 'attendance', w.id::text, case when p_at is null then 'Signed out by supervisor' else 'Missing sign-out recorded' end, null, null, w.name);
  return jsonb_build_object('message', w.name || ' signed out.');
end $$;

-- Closes sign-ins left open on earlier days at 3:30 pm that day (Sydney time).
create or replace function public.fix_missing_sign_outs(p_project uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects := _project_for(p_project); r record; n int := 0;
begin
  perform _require(pr.org_id, 'attendance.manage');
  for r in
    select distinct on (a.worker_id) a.worker_id, a.kind, a.at from attendance a
    where a.project_id = pr.id order by a.worker_id, a.at desc
  loop
    if r.kind = 'check_in' and (r.at at time zone 'Australia/Sydney')::date < (now() at time zone 'Australia/Sydney')::date then
      insert into attendance (org_id, project_id, worker_id, kind, at, method, override_reason)
      values (pr.org_id, pr.id, r.worker_id, 'check_out', (((r.at at time zone 'Australia/Sydney')::date + time '15:30') at time zone 'Australia/Sydney'), 'manual', 'Missing sign-out recorded');
      n := n + 1;
    end if;
  end loop;
  if n > 0 then perform _audit(pr.org_id, pr.id, 'attendance', pr.id::text, 'Missing sign-outs recorded', null, null, n || ' at 3:30 pm'); end if;
  return jsonb_build_object('message', case when n = 0 then 'No missing sign-outs.' else format('%s missing sign-out%s recorded at 3:30 pm.', n, case when n = 1 then '' else 's' end) end);
end $$;

create or replace function public.office_visitor(p_project uuid, p_action text, p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects := _project_for(p_project); v visitors;
begin
  perform _require(pr.org_id, 'attendance.manage');
  if p_action = 'sign_out' then
    update visitors set signed_out_at = now() where id = (p ->> 'id')::uuid and project_id = pr.id and signed_out_at is null returning * into v;
    if v.id is null then perform _fail('Visitor not found or already signed out.'); end if;
    return jsonb_build_object('message', v.name || ' signed out.');
  end if;
  perform _fail('Unknown action.');
end $$;

-- ============================================================ the gate
-- Anonymous: identified by the project's gate code and rate-limited.
create or replace function public._gate(p_code text) returns public.projects
language plpgsql security definer set search_path = public as $$
declare pr projects; n int;
begin
  select * into pr from projects where gate_code = p_code;
  if not found then perform _fail('This QR code isn''t valid any more. Ask the site office for the current poster.'); end if;
  select count(*) into n from gate_attempts where project_id = pr.id and at > now() - interval '1 minute';
  if n >= 60 then perform _fail('Too many attempts — wait a minute and try again.'); end if;
  insert into gate_attempts (project_id) values (pr.id);
  delete from gate_attempts where at < now() - interval '1 hour';
  return pr;
end $$;

create or replace function public._gate_worker(pr public.projects, p_worker_code text) returns public.workers
language plpgsql security definer set search_path = public as $$
declare w workers;
begin
  -- No exception here: an error would roll back the attempt counted by _gate, so callers return
  -- a soft error instead and wrong guesses still count towards the rate limit.
  select * into w from workers where org_id = pr.org_id and worker_code = trim(coalesce(p_worker_code, ''));
  return w;
end $$;

create or replace function public.gate_info(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects := _gate(p_code);
begin
  return jsonb_build_object('project', pr.name, 'address', pr.address, 'company', (select name from organisations where id = pr.org_id));
end $$;

-- What a worker still needs, including the SWMS text to read.
create or replace function public.gate_worker_status(p_code text, p_worker_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects := _gate(p_code); w workers := _gate_worker(pr, p_worker_code); v_last attendance;
begin
  if w.id is null then return jsonb_build_object('error', 'That worker code wasn''t found. Check it with the site office.'); end if;
  select * into v_last from attendance where project_id = pr.id and worker_id = w.id order by at desc limit 1;
  return jsonb_build_object(
    'name', w.name, 'company', (select trading_name from contractors where id = w.contractor_id),
    'blockers', to_jsonb(site_blockers(w.id, pr.id)),
    'on_site', coalesce(v_last.kind = 'check_in' and (v_last.at at time zone 'Australia/Sydney')::date = (now() at time zone 'Australia/Sydney')::date, false),
    'swms', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'version', s.version, 'activity', s.activity, 'hazards', s.hazards))
      from swms s where s.project_id = pr.id and s.contractor_id = w.contractor_id and s.status = 'approved'
        and not exists (select 1 from swms_acks a where a.swms_id = s.id and a.worker_id = w.id)), '[]'));
end $$;

create or replace function public.gate_worker_action(p_code text, p_worker_code text, p_action text, p_swms uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects := _gate(p_code); w workers := _gate_worker(pr, p_worker_code); s swms; b text[];
begin
  if w.id is null then return jsonb_build_object('error', 'That worker code wasn''t found. Check it with the site office.'); end if;
  if p_action = 'acknowledge' then
    select * into s from swms where id = p_swms and project_id = pr.id and contractor_id = w.contractor_id and status = 'approved';
    if not found then perform _fail('SWMS not found.'); end if;
    insert into swms_acks (org_id, swms_id, worker_id) values (pr.org_id, s.id, w.id) on conflict do nothing;
    perform _audit(pr.org_id, pr.id, 'swms', s.id::text, 'SWMS acknowledged at the gate', null, null, s.ref || ' v' || s.version || ' · ' || w.name);
    return jsonb_build_object('message', 'Acknowledged ' || s.title || ' v' || s.version || '.');
  elsif p_action = 'sign_in' then
    b := site_blockers(w.id, pr.id);
    if cardinality(b) > 0 then perform _fail('Can''t sign in yet: ' || array_to_string(b, '; ') || '.'); end if;
    insert into attendance (org_id, project_id, worker_id, kind, method) values (pr.org_id, pr.id, w.id, 'check_in', 'qr');
    perform _audit(pr.org_id, pr.id, 'attendance', w.id::text, 'Signed in at the gate', null, null, w.name);
    return jsonb_build_object('message', 'You''re signed in, ' || split_part(w.name, ' ', 1) || '. Have a safe day.');
  elsif p_action = 'sign_out' then
    insert into attendance (org_id, project_id, worker_id, kind, method) values (pr.org_id, pr.id, w.id, 'check_out', 'qr');
    perform _audit(pr.org_id, pr.id, 'attendance', w.id::text, 'Signed out at the gate', null, null, w.name);
    return jsonb_build_object('message', 'Signed out. See you next time.');
  end if;
  perform _fail('Unknown action.');
end $$;

create or replace function public.gate_visitor_sign_in(p_code text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects := _gate(p_code); v uuid;
begin
  if length(trim(coalesce(p ->> 'name', ''))) = 0 then perform _fail('Enter your name.'); end if;
  if length(trim(coalesce(p ->> 'purpose', ''))) = 0 then perform _fail('Say why you''re visiting.'); end if;
  if not coalesce((p ->> 'rules_accepted')::boolean, false) then perform _fail('Please read and accept the site rules.'); end if;
  insert into visitors (org_id, project_id, name, company, phone, purpose, host, vehicle_rego, rules_accepted)
  values (pr.org_id, pr.id, left(trim(p ->> 'name'), 120), left(nullif(trim(coalesce(p ->> 'company', '')), ''), 120), left(nullif(trim(coalesce(p ->> 'phone', '')), ''), 40),
    left(trim(p ->> 'purpose'), 200), left(nullif(trim(coalesce(p ->> 'host', '')), ''), 120), left(nullif(trim(coalesce(p ->> 'vehicle_rego', '')), ''), 20), true)
  returning id into v;
  return jsonb_build_object('id', v, 'message', 'Welcome, ' || split_part(trim(p ->> 'name'), ' ', 1) || '. Please wait at the site office for your host.');
end $$;

create or replace function public.gate_visitor_sign_out(p_code text, p_visitor uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects := _gate(p_code); v visitors;
begin
  update visitors set signed_out_at = now() where id = p_visitor and project_id = pr.id and signed_out_at is null returning * into v;
  if v.id is null then return jsonb_build_object('error', 'Already signed out.'); end if;
  return jsonb_build_object('message', 'Signed out. Thanks for visiting.');
end $$;

-- A new gate code invalidates old posters.
create or replace function public.reset_gate_code(p_project uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects := _project_for(p_project);
begin
  perform _require(pr.org_id, 'project.manage');
  update projects set gate_code = _new_gate_code() where id = pr.id;
  perform _audit(pr.org_id, pr.id, 'project', pr.id::text, 'Gate QR code replaced');
  return jsonb_build_object('message', 'New QR code created. Print the new poster — the old one no longer works.');
end $$;

-- ---------------------------------------------------------------- grants
do $$
declare f text;
begin
  foreach f in array array['public.create_ncr(uuid, jsonb)', 'public.update_ncr(uuid, jsonb)', 'public.advance_ncr(uuid, text)',
    'public.request_permit(uuid, jsonb)', 'public.permit_action(uuid, text, text)', 'public.report_incident(uuid, jsonb)',
    'public.incident_action(uuid, text, jsonb)', 'public.record_toolbox_talk(uuid, jsonb)', 'public.manual_sign_in(uuid, uuid, text)',
    'public.manual_sign_out(uuid, uuid, timestamptz)', 'public.fix_missing_sign_outs(uuid)', 'public.office_visitor(uuid, text, jsonb)',
    'public.reset_gate_code(uuid)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  -- The gate is usable without an account.
  foreach f in array array['public.gate_info(text)', 'public.gate_worker_status(text, text)', 'public.gate_worker_action(text, text, text, uuid)',
    'public.gate_visitor_sign_in(text, jsonb)', 'public.gate_visitor_sign_out(text, uuid)'] loop
    execute format('revoke execute on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
  foreach f in array array['public._new_gate_code()', 'public._next_ref(text, uuid, text, integer)', 'public._project_for(uuid)', 'public._gate(text)', 'public._gate_worker(public.projects, text)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;
grant execute on function public.role_can(text, text) to anon, authenticated;
