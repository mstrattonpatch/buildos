-- =====================================================================
-- BuildOS — initial schema
--
-- Every tenant table carries org_id. Row Level Security lets members read
-- their own organisation's rows only. There are NO insert/update/delete
-- policies on business tables: every change goes through the SECURITY
-- DEFINER functions below, which check the caller's role, validate the
-- workflow and write an audit event. A modified browser request can't skip
-- those rules.
--
-- Money is stored as integer cents (bigint).
-- =====================================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------- tables
create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  abn text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  initials text not null default '',
  email text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.contractors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  legal_name text not null,
  trading_name text not null,
  abn text,
  trade text,
  created_at timestamptz not null default now()
);

create table public.workers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  name text not null,
  contractor_id uuid references public.contractors (id) on delete set null,
  phone text,
  created_at timestamptz not null default now()
);

create table public.memberships (
  org_id uuid not null references public.organisations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('director','project_manager','site_supervisor','quality_manager','subcontractor_admin','worker')),
  title text not null default '',
  is_admin boolean not null default false,
  contractor_id uuid references public.contractors (id) on delete set null,
  worker_id uuid references public.workers (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index on public.memberships (user_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  email text not null,
  role text not null check (role in ('director','project_manager','site_supervisor','quality_manager','subcontractor_admin','worker')),
  title text not null default '',
  contractor_id uuid references public.contractors (id) on delete set null,
  worker_id uuid references public.workers (id) on delete set null,
  invited_by uuid,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid
);
create unique index invitations_pending_email on public.invitations (org_id, lower(email)) where accepted_at is null;

create table public.insurances (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  contractor_id uuid not null references public.contractors (id) on delete cascade,
  type text not null,
  expires date not null,
  verified boolean not null default false
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  code text not null,
  name text not null,
  address text,
  client text,
  type text not null default 'Residential',
  status text not null default 'construction' check (status in ('tender','construction','handover','dlp')),
  pm_id uuid,
  contract_sum bigint not null default 0 check (contract_sum >= 0), -- original; never changed by variations
  start_date date,
  pc_date date,
  planned_progress int not null default 0 check (planned_progress between 0 and 100),
  verified_progress int not null default 0 check (verified_progress between 0 and 100),
  next_milestone_name text,
  next_milestone_date date,
  weather text,
  created_at timestamptz not null default now(),
  unique (org_id, code)
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  building text not null default '',
  level text not null default '',
  zone text not null default ''
);

create table public.inductions (
  org_id uuid not null references public.organisations (id) on delete cascade,
  worker_id uuid not null references public.workers (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (worker_id, project_id)
);

create table public.credentials (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  worker_id uuid not null references public.workers (id) on delete cascade,
  type text not null,
  number text,
  expires date,
  status text not null default 'uploaded' check (status in ('uploaded','awaiting_verification','verified','expired','rejected','unable_to_verify')),
  verified_by uuid,
  verified_method text
);

create table public.itps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  ref text not null,
  title text not null,
  template_version int not null default 1, -- pinned: template edits don't alter active ITPs
  task_id uuid
);

create table public.swms (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  ref text not null,
  title text not null,
  activity text,
  contractor_id uuid references public.contractors (id) on delete set null,
  version int not null default 1,
  status text not null default 'submitted' check (status in ('submitted','in_review','approved','changes_requested')),
  high_risk_categories text[] not null default '{}'
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null,
  trade text,
  contractor_id uuid references public.contractors (id) on delete set null,
  baseline_start date, baseline_finish date,
  forecast_start date, forecast_finish date,
  is_milestone boolean not null default false,
  progress int not null default 0 check (progress between 0 and 100),
  status text not null default 'not_started' check (status in ('not_started','in_progress','complete','blocked')),
  predecessor_ids uuid[] not null default '{}',
  cost_code text,
  itp_id uuid references public.itps (id) on delete set null,
  swms_id uuid references public.swms (id) on delete set null
);
alter table public.itps add constraint itps_task_fk foreign key (task_id) references public.tasks (id) on delete set null deferrable initially deferred;

create table public.itp_points (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  itp_id uuid not null references public.itps (id) on delete cascade,
  seq int not null default 0,
  name text not null,
  check_text text,
  type text not null check (type in ('hold','witness','inspection','test')),
  status text not null default 'pending' check (status in ('pending','submitted','released','rejected')),
  evidence int not null default 0,
  released_by uuid,
  released_at timestamptz
);

create table public.swms_acks (
  org_id uuid not null references public.organisations (id) on delete cascade,
  swms_id uuid not null references public.swms (id) on delete cascade,
  worker_id uuid not null references public.workers (id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  primary key (swms_id, worker_id)
);

create table public.defects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  ref text not null,
  title text not null,
  description text,
  category text not null default 'Workmanship',
  location_id uuid references public.locations (id) on delete set null,
  room text,
  trade text not null default 'General',
  contractor_id uuid references public.contractors (id) on delete set null,
  priority text not null default 'medium' check (priority in ('low','medium','high','critical')),
  due_date date,
  status text not null default 'open' check (status in ('draft','open','assigned','rectifying','ready_for_verification','closed')),
  raised_by uuid,
  raised_at timestamptz not null default now(),
  photos text[] not null default '{}',          -- storage paths in the private "photos" bucket
  rectification_note text,
  evidence_photos text[] not null default '{}',
  verified_by uuid,
  task_id uuid references public.tasks (id) on delete set null,
  itp_id uuid references public.itps (id) on delete set null,
  client_key uuid unique,                        -- makes retried submissions idempotent
  unique (project_id, ref)
);
create index on public.defects (org_id, project_id, status);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  number text not null,
  title text not null,
  category text,
  revision text not null,
  status text not null check (status in ('current','in_review','superseded')),
  uploaded_by uuid,
  uploaded_at timestamptz not null default now()
);

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  worker_id uuid not null references public.workers (id) on delete cascade,
  kind text not null check (kind in ('check_in','check_out')),
  at timestamptz not null default now(),
  method text not null default 'qr',
  override_reason text
);
create index on public.attendance (project_id, at);

create table public.budget_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  cost_code text not null,
  description text,
  original_budget bigint not null default 0,
  committed bigint not null default 0,
  actual bigint not null default 0,
  forecast_final bigint not null default 0
);

create table public.variations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  ref text not null,
  title text not null,
  reason text,
  amount bigint not null check (amount >= 0),
  approved_amount bigint,
  time_impact_days int not null default 0,
  status text not null default 'submitted' check (status in ('draft','submitted','under_review','approved','rejected','included_in_claim')),
  raised_at timestamptz not null default now(),
  raised_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  unique (project_id, ref)
);

create table public.claims (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  ref text not null,
  period_end date,
  due_date date,
  claimed bigint not null default 0,
  certified bigint,
  paid bigint,
  status text not null default 'draft' check (status in ('draft','submitted','assessed','certified','paid','disputed'))
);

create table public.diary (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  date date not null,
  weather text,
  workers_on_site int not null default 0,
  companies_on_site int not null default 0,
  notes text not null,
  delays text,
  author_id uuid,
  submitted boolean not null default true
);

-- Append-only: no update/delete is possible through the API.
create table public.audit_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organisations (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  record_type text not null,
  record_id text not null,
  action text not null,
  actor_id uuid,
  at timestamptz not null default now(),
  from_status text,
  to_status text,
  detail text
);
create index on public.audit_events (org_id, at desc);
create index on public.audit_events (record_id);

-- ------------------------------------------------- helper functions
create or replace function public.is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships where org_id = p_org and user_id = auth.uid());
$$;

create or replace function public.my_membership(p_org uuid) returns public.memberships
language sql stable security definer set search_path = public as $$
  select * from memberships where org_id = p_org and user_id = auth.uid();
$$;

-- Same role → permission table as the app (app/js/core.js GRANTS).
create or replace function public.role_can(p_role text, p_perm text) returns boolean
language sql immutable as $$
  select case p_role
    when 'director' then p_perm = any (array['defect.create','defect.assign','defect.verify','itp.release_hold','variation.create','variation.approve','swms.review','commercial.view','diary.submit','people.manage','project.manage'])
    when 'project_manager' then p_perm = any (array['defect.create','defect.assign','defect.verify','itp.release_hold','variation.create','variation.approve','swms.review','commercial.view','diary.submit','people.manage','project.manage'])
    when 'site_supervisor' then p_perm = any (array['defect.create','defect.assign','defect.verify','swms.review','diary.submit','people.manage'])
    when 'quality_manager' then p_perm = any (array['defect.create','defect.assign','defect.verify','itp.release_hold'])
    when 'subcontractor_admin' then p_perm = any (array['defect.rectify','variation.create'])
    when 'worker' then p_perm = any (array['defect.create'])
    else false end;
$$;

create or replace function public.has_perm(p_org uuid, p_perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role_can(role, p_perm) from memberships where org_id = p_org and user_id = auth.uid()), false);
$$;

create or replace function public.shares_org(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_user = auth.uid() or exists (
    select 1 from memberships a join memberships b on a.org_id = b.org_id
    where a.user_id = auth.uid() and b.user_id = p_user);
$$;

-- Raise a readable error (shown to the user as-is).
create or replace function public._fail(p_msg text) returns void
language plpgsql as $$ begin raise exception using message = p_msg, errcode = 'P0001'; end $$;

-- Returns the caller's membership or fails.
create or replace function public._me(p_org uuid) returns public.memberships
language plpgsql stable security definer set search_path = public as $$
declare m memberships;
begin
  if auth.uid() is null then perform _fail('Please sign in first.'); end if;
  select * into m from memberships where org_id = p_org and user_id = auth.uid();
  if not found then perform _fail('You are not a member of this company.'); end if;
  return m;
end $$;

create or replace function public._require(p_org uuid, p_perm text) returns public.memberships
language plpgsql stable security definer set search_path = public as $$
declare m memberships;
begin
  m := _me(p_org);
  if not role_can(m.role, p_perm) then
    perform _fail(format('Your role (%s) can''t do that.', replace(m.role, '_', ' ')));
  end if;
  return m;
end $$;

create or replace function public._audit(p_org uuid, p_project uuid, p_type text, p_record text, p_action text,
  p_from text default null, p_to text default null, p_detail text default null) returns void
language sql security definer set search_path = public as $$
  insert into audit_events (org_id, project_id, record_type, record_id, action, actor_id, from_status, to_status, detail)
  values (p_org, p_project, p_type, p_record, p_action, auth.uid(), p_from, p_to, p_detail);
$$;

-- --------------------------------------------- new user → profile row
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare n text := coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1));
begin
  insert into profiles (id, full_name, initials, email)
  values (new.id, n, upper(left(regexp_replace(initcap(n), '[^A-Z]', '', 'g'), 2)), new.email)
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------ RLS
alter table public.organisations enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;

create policy "members read their organisations" on public.organisations for select using (is_member(id));
create policy "read profiles of colleagues" on public.profiles for select using (shares_org(id));
create policy "members read memberships" on public.memberships for select using (is_member(org_id));
create policy "admins and invitees read invitations" on public.invitations for select
  using ((my_membership(org_id)).is_admin or lower(email) = lower(auth.jwt() ->> 'email'));

do $$
declare t text;
begin
  foreach t in array array['contractors','insurances','projects','locations','inductions','itps',
    'swms','tasks','itp_points','swms_acks','documents','attendance','diary'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "members read" on public.%I for select using (is_member(org_id))', t);
  end loop;
  -- Commercial records: only roles with commercial access (subcontractors never see margins).
  foreach t in array array['budget_lines','variations','claims'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "commercial roles read" on public.%I for select using (has_perm(org_id, ''commercial.view''))', t);
  end loop;
end $$;

-- Subcontractors only see their own company's workers and credentials.
alter table public.workers enable row level security;
create policy "members read workers" on public.workers for select using (
  is_member(org_id) and ((my_membership(org_id)).role <> 'subcontractor_admin' or contractor_id = (my_membership(org_id)).contractor_id));
alter table public.credentials enable row level security;
create policy "members read credentials" on public.credentials for select using (
  is_member(org_id) and exists (select 1 from workers w where w.id = worker_id));

-- Commercial history is only visible to commercial roles.
alter table public.audit_events enable row level security;
create policy "members read audit" on public.audit_events for select using (
  is_member(org_id) and (record_type not in ('variation','claim','budget') or has_perm(org_id, 'commercial.view')));

-- Subcontractors only see defects assigned to their own company.
alter table public.defects enable row level security;
create policy "members read defects" on public.defects for select using (
  is_member(org_id) and ((my_membership(org_id)).role <> 'subcontractor_admin' or contractor_id = (my_membership(org_id)).contractor_id));

-- ======================================================= RPC: accounts
create or replace function public.update_my_profile(p_full_name text, p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then perform _fail('Please sign in first.'); end if;
  if length(trim(coalesce(p_full_name, ''))) = 0 then perform _fail('Your name can''t be empty.'); end if;
  update profiles set full_name = trim(p_full_name), phone = nullif(trim(coalesce(p_phone, '')), ''),
    initials = upper(left(regexp_replace(initcap(trim(p_full_name)), '[^A-Z]', '', 'g'), 2)), updated_at = now()
  where id = auth.uid();
  return jsonb_build_object('message', 'Profile saved.');
end $$;

create or replace function public.create_organisation(p_name text, p_abn text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if auth.uid() is null then perform _fail('Please sign in first.'); end if;
  if length(trim(coalesce(p_name, ''))) = 0 then perform _fail('Enter your company name.'); end if;
  insert into organisations (name, abn, created_by) values (trim(p_name), nullif(trim(coalesce(p_abn, '')), ''), auth.uid()) returning id into v;
  insert into memberships (org_id, user_id, role, title, is_admin) values (v, auth.uid(), 'director', 'Director', true);
  perform _audit(v, null, 'organisation', v::text, 'Company created', null, null, trim(p_name));
  return jsonb_build_object('id', v, 'message', 'Company created.');
end $$;

-- Turns any pending invitations for the signed-in email into memberships.
create or replace function public.accept_invitations() returns jsonb
language plpgsql security definer set search_path = public as $$
declare i invitations; n int := 0; em text := lower(auth.jwt() ->> 'email');
begin
  if auth.uid() is null or em is null then return jsonb_build_object('accepted', 0); end if;
  for i in select * from invitations where lower(email) = em and accepted_at is null loop
    insert into memberships (org_id, user_id, role, title, contractor_id, worker_id)
    values (i.org_id, auth.uid(), i.role, i.title, i.contractor_id, i.worker_id)
    on conflict (org_id, user_id) do nothing;
    update invitations set accepted_at = now(), accepted_by = auth.uid() where id = i.id;
    perform _audit(i.org_id, null, 'membership', auth.uid()::text, 'Joined company', null, i.role, em);
    n := n + 1;
  end loop;
  return jsonb_build_object('accepted', n);
end $$;

create or replace function public.invite_member(p_org uuid, p_email text, p_role text, p_title text,
  p_contractor uuid default null, p_worker uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m memberships; em text := lower(trim(coalesce(p_email, '')));
begin
  m := _me(p_org);
  if not m.is_admin then perform _fail('Only company admins can invite people.'); end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then perform _fail('Enter a valid email address.'); end if;
  if p_role not in ('director','project_manager','site_supervisor','quality_manager','subcontractor_admin','worker') then perform _fail('Choose a role.'); end if;
  if p_role = 'subcontractor_admin' and p_contractor is null then perform _fail('Link a subcontractor admin to their company.'); end if;
  if p_role = 'worker' and p_worker is null then perform _fail('Link a worker account to their worker profile.'); end if;
  if p_contractor is not null and not exists (select 1 from contractors where id = p_contractor and org_id = p_org) then perform _fail('Contractor not found.'); end if;
  if p_worker is not null and not exists (select 1 from workers where id = p_worker and org_id = p_org) then perform _fail('Worker not found.'); end if;
  if exists (select 1 from memberships mm join auth.users u on u.id = mm.user_id where mm.org_id = p_org and lower(u.email) = em) then
    perform _fail('That person is already in your company.');
  end if;
  delete from invitations where org_id = p_org and lower(email) = em and accepted_at is null;
  insert into invitations (org_id, email, role, title, contractor_id, worker_id, invited_by)
  values (p_org, em, p_role, coalesce(nullif(trim(p_title), ''), initcap(replace(p_role, '_', ' '))), p_contractor, p_worker, auth.uid());
  perform _audit(p_org, null, 'invitation', em, 'Invitation created', null, p_role, em);
  return jsonb_build_object('message', format('Invitation saved for %s. Ask them to sign up with that email.', em));
end $$;

create or replace function public.cancel_invitation(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i invitations; m memberships;
begin
  select * into i from invitations where id = p_id;
  if not found then perform _fail('Invitation not found.'); end if;
  m := _me(i.org_id);
  if not m.is_admin then perform _fail('Only company admins can do that.'); end if;
  delete from invitations where id = p_id and accepted_at is null;
  return jsonb_build_object('message', 'Invitation cancelled.');
end $$;

create or replace function public.update_member(p_org uuid, p_user uuid, p_role text, p_title text, p_is_admin boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m memberships;
begin
  m := _me(p_org);
  if not m.is_admin then perform _fail('Only company admins can change roles.'); end if;
  if p_user = auth.uid() and not p_is_admin then perform _fail('You can''t remove your own admin access.'); end if;
  if p_role not in ('director','project_manager','site_supervisor','quality_manager','subcontractor_admin','worker') then perform _fail('Choose a role.'); end if;
  update memberships set role = p_role, title = coalesce(nullif(trim(p_title), ''), title), is_admin = p_is_admin
  where org_id = p_org and user_id = p_user;
  if not found then perform _fail('Member not found.'); end if;
  perform _audit(p_org, null, 'membership', p_user::text, 'Role changed', null, p_role);
  return jsonb_build_object('message', 'Member updated.');
end $$;

create or replace function public.remove_member(p_org uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m memberships;
begin
  m := _me(p_org);
  if not m.is_admin then perform _fail('Only company admins can remove people.'); end if;
  if p_user = auth.uid() then perform _fail('You can''t remove yourself.'); end if;
  delete from memberships where org_id = p_org and user_id = p_user;
  perform _audit(p_org, null, 'membership', p_user::text, 'Removed from company');
  return jsonb_build_object('message', 'Member removed.');
end $$;

-- ===================================================== RPC: set-up records
create or replace function public.create_project(p_org uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid; m memberships;
begin
  m := _require(p_org, 'project.manage');
  if length(trim(coalesce(p ->> 'name', ''))) = 0 then perform _fail('Enter a project name.'); end if;
  if length(trim(coalesce(p ->> 'code', ''))) = 0 then perform _fail('Enter a project code, e.g. P-2050.'); end if;
  if exists (select 1 from projects where org_id = p_org and code = trim(p ->> 'code')) then perform _fail('That project code is already used.'); end if;
  insert into projects (org_id, code, name, address, client, type, pm_id, contract_sum, start_date, pc_date, next_milestone_name, next_milestone_date)
  values (p_org, trim(p ->> 'code'), trim(p ->> 'name'), p ->> 'address', p ->> 'client', coalesce(nullif(p ->> 'type', ''), 'Residential'), auth.uid(),
    coalesce((p ->> 'contract_sum')::bigint, 0), nullif(p ->> 'start_date', '')::date, nullif(p ->> 'pc_date', '')::date,
    'Practical completion', nullif(p ->> 'pc_date', '')::date)
  returning id into v;
  -- A first location so defects can be raised straight away.
  insert into locations (org_id, project_id, building, level, zone) values (p_org, v, 'Site', 'Ground', 'General');
  perform _audit(p_org, v, 'project', v::text, 'Project created', null, null, trim(p ->> 'name'));
  return jsonb_build_object('id', v, 'message', 'Project created.');
end $$;

create or replace function public.create_location(p_project uuid, p_building text, p_level text, p_zone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects;
begin
  select * into pr from projects where id = p_project;
  if not found then perform _fail('Project not found.'); end if;
  perform _require(pr.org_id, 'defect.assign');
  if length(trim(coalesce(p_level, '') || coalesce(p_zone, ''))) = 0 then perform _fail('Enter at least a level or zone.'); end if;
  insert into locations (org_id, project_id, building, level, zone) values (pr.org_id, p_project, coalesce(trim(p_building), ''), coalesce(trim(p_level), ''), coalesce(trim(p_zone), ''));
  return jsonb_build_object('message', 'Location added.');
end $$;

create or replace function public.create_contractor(p_org uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  perform _require(p_org, 'people.manage');
  if length(trim(coalesce(p ->> 'trading_name', ''))) = 0 then perform _fail('Enter the company''s trading name.'); end if;
  insert into contractors (org_id, legal_name, trading_name, abn, trade)
  values (p_org, coalesce(nullif(trim(p ->> 'legal_name'), ''), trim(p ->> 'trading_name')), trim(p ->> 'trading_name'), p ->> 'abn', p ->> 'trade')
  returning id into v;
  if nullif(p ->> 'pl_expires', '') is not null then
    insert into insurances (org_id, contractor_id, type, expires, verified) values (p_org, v, 'Public liability', (p ->> 'pl_expires')::date, true);
  end if;
  if nullif(p ->> 'wc_expires', '') is not null then
    insert into insurances (org_id, contractor_id, type, expires, verified) values (p_org, v, 'Workers comp', (p ->> 'wc_expires')::date, true);
  end if;
  perform _audit(p_org, null, 'contractor', v::text, 'Contractor added', null, null, trim(p ->> 'trading_name'));
  return jsonb_build_object('id', v, 'message', 'Contractor added.');
end $$;

create or replace function public.create_worker(p_org uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid; m memberships; who text;
begin
  m := _require(p_org, 'people.manage');
  if length(trim(coalesce(p ->> 'name', ''))) = 0 then perform _fail('Enter the worker''s name.'); end if;
  if nullif(p ->> 'contractor_id', '') is null then perform _fail('Choose the worker''s company.'); end if;
  insert into workers (org_id, name, contractor_id, phone) values (p_org, trim(p ->> 'name'), (p ->> 'contractor_id')::uuid, p ->> 'phone') returning id into v;
  select full_name into who from profiles where id = auth.uid();
  if nullif(trim(coalesce(p ->> 'white_card', '')), '') is not null then
    insert into credentials (org_id, worker_id, type, number, status, verified_by, verified_method)
    values (p_org, v, 'White Card', trim(p ->> 'white_card'), 'verified', auth.uid(), 'Sighted by ' || coalesce(who, 'site team'));
  end if;
  if nullif(p ->> 'inducted_project_id', '') is not null then
    insert into inductions (org_id, worker_id, project_id) values (p_org, v, (p ->> 'inducted_project_id')::uuid);
  end if;
  perform _audit(p_org, null, 'worker', v::text, 'Worker added', null, null, trim(p ->> 'name'));
  return jsonb_build_object('id', v, 'message', 'Worker added.');
end $$;

create or replace function public.record_induction(p_worker uuid, p_project uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare w workers;
begin
  select * into w from workers where id = p_worker;
  if not found then perform _fail('Worker not found.'); end if;
  perform _require(w.org_id, 'people.manage');
  if not exists (select 1 from projects where id = p_project and org_id = w.org_id) then perform _fail('Project not found.'); end if;
  insert into inductions (org_id, worker_id, project_id) values (w.org_id, p_worker, p_project) on conflict do nothing;
  perform _audit(w.org_id, p_project, 'worker', p_worker::text, 'Site induction recorded', null, null, w.name);
  return jsonb_build_object('message', w.name || ' inducted.');
end $$;

-- ========================================================= RPC: defects
create or replace function public.create_defect(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects; m memberships; d defects; n int; draft boolean := coalesce((p ->> 'draft')::boolean, false);
  assign boolean; ck uuid := nullif(p ->> 'client_key', '')::uuid;
begin
  select * into pr from projects where id = (p ->> 'project_id')::uuid;
  if not found then perform _fail('Project not found.'); end if;
  m := _require(pr.org_id, 'defect.create');
  if ck is not null then
    select * into d from defects where client_key = ck;
    if found then return jsonb_build_object('id', d.id, 'message', 'Already received.'); end if;
  end if;
  if length(trim(coalesce(p ->> 'title', ''))) = 0 then perform _fail('Say what''s wrong.'); end if;
  if nullif(p ->> 'location_id', '') is null and not draft then perform _fail('Choose a location.'); end if;
  if nullif(p ->> 'location_id', '') is not null and not exists (select 1 from locations where id = (p ->> 'location_id')::uuid and project_id = pr.id) then
    perform _fail('That location isn''t on this project.');
  end if;
  assign := not draft and nullif(p ->> 'contractor_id', '') is not null and nullif(p ->> 'due_date', '') is not null and role_can(m.role, 'defect.assign');
  perform pg_advisory_xact_lock(hashtext('defect-ref:' || pr.id::text));
  select coalesce(max(nullif(regexp_replace(ref, '\D', '', 'g'), '')::int), 0) + 1 into n from defects where project_id = pr.id;
  insert into defects (org_id, project_id, ref, title, description, location_id, room, trade, contractor_id, priority, due_date, status, raised_by, photos, client_key)
  values (pr.org_id, pr.id, 'DEF-' || lpad(n::text, 4, '0'), trim(p ->> 'title'), trim(p ->> 'title'), nullif(p ->> 'location_id', '')::uuid,
    nullif(p ->> 'room', ''), coalesce(nullif(p ->> 'trade', ''), 'General'), case when assign then (p ->> 'contractor_id')::uuid end,
    coalesce(nullif(p ->> 'priority', ''), 'medium'), nullif(p ->> 'due_date', '')::date,
    case when draft then 'draft' when assign then 'assigned' else 'open' end, auth.uid(),
    coalesce(array(select jsonb_array_elements_text(p -> 'photos')), '{}'), ck)
  returning * into d;
  perform _audit(d.org_id, d.project_id, 'defect', d.id::text, case when draft then 'Draft saved' else 'Defect raised' end, null, d.status, d.ref || ' · ' || d.title);
  if assign then
    perform _audit(d.org_id, d.project_id, 'defect', d.id::text, 'Assigned', null, null, (select trading_name from contractors where id = d.contractor_id));
  end if;
  return jsonb_build_object('id', d.id, 'message', d.ref || case when draft then ' saved as a draft.' when assign then ' raised and assigned.' else ' raised.' end);
end $$;

create or replace function public.defect_action(p_defect uuid, p_type text, p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public as $$
declare d defects; m memberships; from_s text; owner_or_site boolean; label text; detail text; ev text[];
begin
  select * into d from defects where id = p_defect for update;
  if not found then perform _fail('Defect not found.'); end if;
  m := _me(d.org_id);
  if m.role = 'subcontractor_admin' and d.contractor_id is distinct from m.contractor_id then perform _fail('Defect not found.'); end if;
  from_s := d.status;
  owner_or_site := coalesce((m.role = 'subcontractor_admin' and m.contractor_id = d.contractor_id) or m.role in ('site_supervisor','project_manager'), false);

  if p_type = 'submit' then
    if not role_can(m.role, 'defect.create') then perform _fail('Your role can''t submit defects.'); end if;
    if from_s <> 'draft' then perform _fail('Only a draft can be submitted.'); end if;
    if d.location_id is null then perform _fail('Choose a location before submitting.'); end if;
    update defects set status = 'open' where id = d.id; label := 'Submitted';
  elsif p_type = 'assign' then
    if not role_can(m.role, 'defect.assign') then perform _fail('Your role can''t assign defects.'); end if;
    if from_s not in ('open','assigned') then perform _fail(format('Can''t assign a defect that is %s.', replace(from_s, '_', ' '))); end if;
    if nullif(p ->> 'contractor_id', '') is null then perform _fail('Choose a responsible contractor.'); end if;
    if nullif(p ->> 'due_date', '') is null then perform _fail('A due date is needed before this can be assigned.'); end if;
    if not exists (select 1 from contractors where id = (p ->> 'contractor_id')::uuid and org_id = d.org_id) then perform _fail('Contractor not found.'); end if;
    update defects set status = 'assigned', contractor_id = (p ->> 'contractor_id')::uuid, due_date = (p ->> 'due_date')::date where id = d.id;
    label := 'Assigned'; detail := (select trading_name from contractors where id = (p ->> 'contractor_id')::uuid);
  elsif p_type = 'start_rectification' then
    if from_s <> 'assigned' then perform _fail('Only an assigned defect can start rectification.'); end if;
    if not owner_or_site then perform _fail('Only the assigned contractor or the site team can record rectification.'); end if;
    update defects set status = 'rectifying' where id = d.id; label := 'Rectification started';
  elsif p_type = 'submit_for_verification' then
    if from_s not in ('rectifying','assigned') then perform _fail(format('Can''t submit a defect that is %s.', replace(from_s, '_', ' '))); end if;
    if not owner_or_site then perform _fail('Only the assigned contractor or the site team can record rectification.'); end if;
    if length(trim(coalesce(p ->> 'note', ''))) = 0 then perform _fail('Describe the rectification before submitting.'); end if;
    ev := coalesce(array(select jsonb_array_elements_text(p -> 'evidence')), '{}');
    if cardinality(ev) = 0 then perform _fail('Add at least one completion photo as evidence.'); end if;
    update defects set status = 'ready_for_verification', rectification_note = trim(p ->> 'note'), evidence_photos = evidence_photos || ev where id = d.id;
    label := 'Submitted for verification'; detail := cardinality(ev) || ' photos';
  elsif p_type = 'verify' then
    if not role_can(m.role, 'defect.verify') then perform _fail('Your role can''t verify defects.'); end if;
    if from_s <> 'ready_for_verification' then perform _fail('Only a defect in review can be verified.'); end if;
    -- Closing needs evidence and an authorised reviewer, not just a status change.
    if cardinality(d.evidence_photos) = 0 or d.rectification_note is null then perform _fail('Completion evidence is missing — can''t close.'); end if;
    update defects set status = 'closed', verified_by = auth.uid() where id = d.id; label := 'Verified and closed';
  elsif p_type = 'reject' then
    if not role_can(m.role, 'defect.verify') then perform _fail('Your role can''t verify defects.'); end if;
    if from_s <> 'ready_for_verification' then perform _fail('Only a defect in review can be rejected.'); end if;
    if length(trim(coalesce(p ->> 'reason', ''))) = 0 then perform _fail('Give a reason so the contractor knows what to fix.'); end if;
    update defects set status = 'rectifying' where id = d.id; label := 'Repair rejected'; detail := trim(p ->> 'reason');
  else
    perform _fail('Unknown action.');
  end if;
  select * into d from defects where id = p_defect;
  perform _audit(d.org_id, d.project_id, 'defect', d.id::text, label, from_s, d.status, detail);
  return jsonb_build_object('message', d.ref || ': ' || lower(label) || '.');
end $$;

-- ====================================================== RPC: variations
create or replace function public.create_variation(p_project uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects; n int; v variations;
begin
  select * into pr from projects where id = p_project;
  if not found then perform _fail('Project not found.'); end if;
  perform _require(pr.org_id, 'variation.create');
  if length(trim(coalesce(p ->> 'title', ''))) = 0 then perform _fail('Describe the variation.'); end if;
  if coalesce((p ->> 'amount')::bigint, -1) < 0 then perform _fail('Enter the cost impact.'); end if;
  perform pg_advisory_xact_lock(hashtext('variation-ref:' || pr.id::text));
  select coalesce(max(nullif(regexp_replace(ref, '\D', '', 'g'), '')::int), 0) + 1 into n from variations where project_id = pr.id;
  insert into variations (org_id, project_id, ref, title, reason, amount, time_impact_days, status, raised_by)
  values (pr.org_id, pr.id, 'VAR-' || lpad(n::text, 3, '0'), trim(p ->> 'title'), nullif(trim(coalesce(p ->> 'reason', '')), ''),
    (p ->> 'amount')::bigint, coalesce((p ->> 'time_impact_days')::int, 0), 'submitted', auth.uid())
  returning * into v;
  perform _audit(v.org_id, v.project_id, 'variation', v.id::text, 'Variation submitted', null, 'submitted', v.ref);
  return jsonb_build_object('id', v.id, 'message', v.ref || ' submitted for approval.');
end $$;

create or replace function public.variation_action(p_variation uuid, p_type text, p_reason text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare v variations; m memberships; from_s text; lim bigint;
begin
  select * into v from variations where id = p_variation for update;
  if not found then perform _fail('Variation not found.'); end if;
  m := _require(v.org_id, 'variation.approve');
  from_s := v.status;
  if p_type = 'approve' then
    if from_s not in ('submitted','under_review') then perform _fail(format('Can''t approve a variation that is %s.', replace(from_s, '_', ' '))); end if;
    lim := case m.role when 'director' then null when 'project_manager' then 5000000 else 0 end; -- PM limit $50,000
    if lim is not null and v.amount > lim then
      perform _fail(format('This exceeds your delegated limit of $%s. A director must approve it.', to_char(lim / 100, 'FM999,999,999')));
    end if;
    update variations set status = 'approved', approved_amount = v.amount, approved_by = auth.uid(), approved_at = now() where id = v.id;
  elsif p_type = 'reject' then
    if from_s not in ('submitted','under_review') then perform _fail('This variation isn''t awaiting a decision.'); end if;
    if length(trim(coalesce(p_reason, ''))) = 0 then perform _fail('A reason is required to reject a variation.'); end if;
    update variations set status = 'rejected' where id = v.id;
  elsif p_type = 'include_in_claim' then
    if from_s <> 'approved' then perform _fail('Only an approved variation can go in a claim.'); end if;
    update variations set status = 'included_in_claim' where id = v.id;
  else
    perform _fail('Unknown action.');
  end if;
  select * into v from variations where id = p_variation;
  perform _audit(v.org_id, v.project_id, 'variation', v.id::text, 'Variation ' || replace(v.status, '_', ' '), from_s, v.status, v.ref || coalesce(' — ' || nullif(trim(p_reason), ''), ''));
  return jsonb_build_object('message', v.ref || ' ' || replace(v.status, '_', ' ') || '.');
end $$;

-- ====================================================== RPC: ITP points
create or replace function public.itp_point_action(p_point uuid, p_decision text, p_comment text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare pt itp_points; i itps;
begin
  select * into pt from itp_points where id = p_point for update;
  if not found then perform _fail('Inspection point not found.'); end if;
  select * into i from itps where id = pt.itp_id;
  perform _require(pt.org_id, 'itp.release_hold');
  if pt.status <> 'submitted' then perform _fail('Only a submitted point can be released or rejected.'); end if;
  if p_decision = 'release' then
    if pt.evidence = 0 then perform _fail('No evidence attached — can''t release.'); end if;
    update itp_points set status = 'released', released_by = auth.uid(), released_at = now() where id = pt.id;
    -- Quality acceptance ≠ physical progress: unblock the task, don't complete it.
    update tasks set status = 'not_started' where id = i.task_id and status = 'blocked'
      and not exists (select 1 from itp_points x where x.itp_id = i.id and x.type = 'hold' and x.status <> 'released');
  elsif p_decision = 'reject' then
    if length(trim(coalesce(p_comment, ''))) = 0 then perform _fail('Give a reason for rejecting.'); end if;
    update itp_points set status = 'rejected' where id = pt.id;
  else
    perform _fail('Unknown decision.');
  end if;
  perform _audit(pt.org_id, i.project_id, 'itp_point', i.id::text, case when p_decision = 'release' then 'Hold point released' else 'Inspection rejected' end,
    pt.status, case when p_decision = 'release' then 'released' else 'rejected' end, i.ref || ' · ' || pt.name || coalesce(' — ' || nullif(trim(p_comment), ''), ''));
  return jsonb_build_object('message', i.ref || ' ' || pt.name || ': ' || case when p_decision = 'release' then 'released.' else 'rejected.' end);
end $$;

-- ============================================================ RPC: SWMS
create or replace function public.swms_review(p_swms uuid, p_decision text, p_comment text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare s swms;
begin
  select * into s from swms where id = p_swms for update;
  if not found then perform _fail('SWMS not found.'); end if;
  perform _require(s.org_id, 'swms.review');
  if s.status not in ('submitted','in_review') then perform _fail('This SWMS isn''t awaiting review.'); end if;
  if p_decision = 'changes' and length(trim(coalesce(p_comment, ''))) = 0 then perform _fail('Say what needs to change.'); end if;
  update swms set status = case when p_decision = 'approve' then 'approved' else 'changes_requested' end where id = s.id;
  perform _audit(s.org_id, s.project_id, 'swms', s.id::text, case when p_decision = 'approve' then 'SWMS approved' else 'SWMS changes requested' end,
    s.status, null, s.title || ' v' || s.version);
  return jsonb_build_object('message', s.ref || case when p_decision = 'approve' then ' approved.' else ' returned for changes.' end);
end $$;

create or replace function public.swms_acknowledge(p_swms uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s swms; m memberships;
begin
  select * into s from swms where id = p_swms;
  if not found then perform _fail('SWMS not found.'); end if;
  m := _me(s.org_id);
  if m.worker_id is null then perform _fail('Only workers acknowledge a SWMS.'); end if;
  if s.status <> 'approved' then perform _fail('This SWMS isn''t approved yet.'); end if;
  insert into swms_acks (org_id, swms_id, worker_id) values (s.org_id, s.id, m.worker_id) on conflict do nothing;
  perform _audit(s.org_id, s.project_id, 'swms', s.id::text, 'SWMS acknowledged', null, null, s.title || ' v' || s.version);
  return jsonb_build_object('message', 'Acknowledged ' || s.title || ' v' || s.version || '.');
end $$;

-- ====================================================== RPC: site access
-- Exact blocking requirements for a worker on a project (empty = can sign in).
create or replace function public.site_blockers(p_worker uuid, p_project uuid) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare out text[] := '{}'; w workers; wc credentials; s swms;
begin
  select * into w from workers where id = p_worker;
  select * into wc from credentials where worker_id = p_worker and type = 'White Card' order by status = 'verified' desc limit 1;
  if wc.id is null then out := out || 'White Card — not uploaded'::text;
  elsif wc.expires is not null and wc.expires < current_date then out := out || 'White Card — expired'::text;
  elsif wc.status <> 'verified' then out := out || 'White Card — awaiting verification'::text;
  end if;
  if not exists (select 1 from inductions where worker_id = p_worker and project_id = p_project) then
    out := out || 'Site induction — not yet inducted to this site'::text;
  end if;
  for s in select * from swms where project_id = p_project and contractor_id = w.contractor_id and status = 'approved' loop
    if not exists (select 1 from swms_acks where swms_id = s.id and worker_id = p_worker) then
      out := out || format('SWMS · %s v%s — needs signing', s.title, s.version);
    end if;
  end loop;
  return out;
end $$;

create or replace function public.site_sign_in(p_project uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects; m memberships; b text[];
begin
  select * into pr from projects where id = p_project;
  if not found then perform _fail('Project not found.'); end if;
  m := _me(pr.org_id);
  if m.worker_id is null then perform _fail('Only workers sign in to site.'); end if;
  b := site_blockers(m.worker_id, p_project);
  if cardinality(b) > 0 then perform _fail('Can''t sign in yet: ' || array_to_string(b, '; ') || '.'); end if;
  -- A check-in is an attendance fact, not an approved timesheet.
  insert into attendance (org_id, project_id, worker_id, kind, method) values (pr.org_id, pr.id, m.worker_id, 'check_in', 'qr');
  perform _audit(pr.org_id, pr.id, 'attendance', m.worker_id::text, 'Signed in to site', null, null, 'QR · Gate 1');
  return jsonb_build_object('message', 'You''re signed in. Have a safe day.');
end $$;

create or replace function public.site_sign_out(p_project uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects; m memberships;
begin
  select * into pr from projects where id = p_project;
  if not found then perform _fail('Project not found.'); end if;
  m := _me(pr.org_id);
  if m.worker_id is null then perform _fail('Only workers sign out of site.'); end if;
  insert into attendance (org_id, project_id, worker_id, kind, method) values (pr.org_id, pr.id, m.worker_id, 'check_out', 'qr');
  perform _audit(pr.org_id, pr.id, 'attendance', m.worker_id::text, 'Signed out of site');
  return jsonb_build_object('message', 'Signed out.');
end $$;

-- ============================================================ RPC: diary
create or replace function public.submit_diary(p_project uuid, p_weather text, p_notes text, p_delays text, p_date date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects; v uuid; n int; c int; dt date := coalesce(p_date, current_date);
begin
  select * into pr from projects where id = p_project;
  if not found then perform _fail('Project not found.'); end if;
  perform _require(pr.org_id, 'diary.submit');
  if length(trim(coalesce(p_notes, ''))) = 0 then perform _fail('Add a note about today''s work.'); end if;
  if dt > current_date + 1 then perform _fail('The diary can''t be dated in the future.'); end if;
  -- Submitted records are never silently overwritten.
  if exists (select 1 from diary where project_id = p_project and date = dt and submitted) then perform _fail('Today''s diary is already submitted.'); end if;
  select count(*), count(distinct w.contractor_id) into n, c from (
    select distinct on (a.worker_id) a.worker_id, a.kind from attendance a
    where a.project_id = p_project and (a.at at time zone 'Australia/Sydney')::date = dt order by a.worker_id, a.at desc) last
    join workers w on w.id = last.worker_id where last.kind = 'check_in';
  insert into diary (org_id, project_id, date, weather, workers_on_site, companies_on_site, notes, delays, author_id)
  values (pr.org_id, pr.id, dt, nullif(trim(coalesce(p_weather, '')), ''), n, c, trim(p_notes), nullif(trim(coalesce(p_delays, '')), ''), auth.uid())
  returning id into v;
  perform _audit(pr.org_id, pr.id, 'diary', v::text, 'Site diary submitted');
  return jsonb_build_object('message', 'Diary submitted. Attendance was pulled in automatically.');
end $$;

-- ================================================= RPC: sample project
-- Loads the demo dataset into an empty company so people can explore.
-- Rows arrive as JSON with snake_case keys and fresh UUIDs from the app.
create or replace function public.import_sample_data(p_org uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m memberships; t text; cols text;
begin
  m := _me(p_org);
  if not m.is_admin then perform _fail('Only company admins can load sample data.'); end if;
  if exists (select 1 from projects where org_id = p_org) then perform _fail('Sample data can only be loaded into a company with no projects yet.'); end if;
  -- Order matters for foreign keys. org_id is always forced to the caller's company.
  foreach t in array array['contractors','insurances','workers','projects','locations','inductions','credentials','swms','itps','tasks',
    'itp_points','swms_acks','defects','documents','attendance','budget_lines','variations','claims','diary','audit_events'] loop
    if p ? t and jsonb_array_length(p -> t) > 0 then
      -- Insert only the columns provided, so column defaults still apply.
      select string_agg(quote_ident(k), ', ') into cols
        from jsonb_object_keys((p -> t -> 0) || jsonb_build_object('org_id', p_org)) k where k <> 'id' or t <> 'audit_events';
      execute format('insert into %1$I (%2$s) select %2$s from jsonb_populate_recordset(null::%1$I, (select jsonb_agg(r || jsonb_build_object(''org_id'', $1)) from jsonb_array_elements($2) r))', t, cols)
        using p_org, p -> t;
    end if;
  end loop;
  return jsonb_build_object('message', 'Sample project loaded.');
end $$;

-- ------------------------------------------------------------ grants
-- Functions are callable by signed-in users only; each checks permissions itself.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname not in ('handle_new_user') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
-- Read-only helpers used inside RLS policies: safe for anyone (they return false when signed out).
grant execute on function public.is_member(uuid), public.my_membership(uuid), public.has_perm(uuid, text),
  public.shares_org(uuid), public.role_can(text, text) to anon;
revoke all on public.audit_events from anon;
grant select on all tables in schema public to authenticated;

-- --------------------------------------------------- photo storage
insert into storage.buckets (id, name, public) values ('photos', 'photos', false) on conflict (id) do nothing;

-- Paths are "<org_id>/<file>". Members can upload to and read their own company's folder.
create policy "members upload photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "members read photos" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and public.is_member(((storage.foldername(name))[1])::uuid));
