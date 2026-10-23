-- Events, background jobs, notifications and the first built-in automations (Setout 2.0, Phase 1).
--
-- events        Every audit entry also becomes an event ("defect.closed", "inspection_point.submitted"…) — written by a
--               trigger, so all existing database functions emit events without being changed.
-- jobs          A durable queue: claimed with "for update skip locked", retried with backoff, then dead-lettered.
--               The "worker" Edge Function runs them (sending notification emails, for now).
-- notifications Per-person alerts shown on the bell and (when email is set up) emailed. One per dedupe key.
-- automations   Built-in rules, switched on/off and tuned per company. run_automations() checks the current records
--               (not stale event payloads) and records every run, so a rule never notifies twice for the same thing.

-- ---------------------------------------------------------------- events
create table public.events (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organisations (id) on delete cascade,
  project_id uuid,
  type text not null,
  subject_type text not null,
  subject_id text,
  actor_id uuid,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index events_org_time on public.events (org_id, created_at desc);
create index events_type on public.events (org_id, type, created_at desc);
alter table public.events enable row level security;
create policy "admins read events" on public.events for select using ((my_membership(org_id)).is_admin and can_see_project(project_id));

create or replace function public._event_from_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into events (org_id, project_id, type, subject_type, subject_id, actor_id, payload)
  values (new.org_id, new.project_id,
    new.record_type || '.' || coalesce(nullif(new.to_status, ''), trim(both '_' from regexp_replace(lower(new.action), '[^a-z0-9]+', '_', 'g'))),
    new.record_type, new.record_id, new.actor_id,
    jsonb_strip_nulls(jsonb_build_object('action', new.action, 'from', new.from_status, 'to', new.to_status, 'detail', new.detail)));
  return new;
end $$;
create trigger event_from_audit after insert on public.audit_events for each row execute function public._event_from_audit();

-- ---------------------------------------------------------------- jobs
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organisations (id) on delete cascade,
  type text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'dead')),
  idempotency_key text not null,
  payload jsonb not null default '{}',
  attempts int not null default 0,
  max_attempts int not null default 5,
  run_after timestamptz not null default now(),
  locked_until timestamptz,
  result text,
  error text,
  created_by uuid,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (type, idempotency_key)
);
create index jobs_ready on public.jobs (type, run_after) where status in ('queued', 'failed');
alter table public.jobs enable row level security;
create policy "admins read jobs" on public.jobs for select using (org_id is not null and (my_membership(org_id)).is_admin);

-- Queue a job once: the same type + key is never queued twice.
create or replace function public._enqueue(p_org uuid, p_type text, p_key text, p_payload jsonb default '{}', p_delay interval default '0') returns uuid
language sql security definer set search_path = public as $$
  insert into jobs (org_id, type, idempotency_key, payload, run_after, created_by)
  values (p_org, p_type, p_key, coalesce(p_payload, '{}'), now() + p_delay, auth.uid())
  on conflict (type, idempotency_key) do nothing returning id;
$$;

-- For the worker (service role only): take up to n ready jobs and lease them for five minutes.
create or replace function public.claim_jobs(p_type text, p_limit int default 20) returns setof public.jobs
language sql security definer set search_path = public as $$
  update jobs j set status = 'running', attempts = j.attempts + 1, locked_until = now() + interval '5 minutes'
  where j.id in (
    select id from jobs
    where type = p_type and run_after <= now()
      and (status in ('queued', 'failed') or (status = 'running' and locked_until < now()))  -- a crashed worker's lease expires
    order by run_after limit greatest(1, least(p_limit, 100)) for update skip locked)
  returning j.*;
$$;

create or replace function public.finish_job(p_id uuid, p_result text default null) returns void
language sql security definer set search_path = public as $$
  update jobs set status = 'done', result = left(p_result, 500), error = null, locked_until = null, finished_at = now() where id = p_id and status = 'running';
$$;

-- Retry later with backoff (1, 4, 9, 16… minutes); after the last attempt the job is dead and shown to admins.
create or replace function public.fail_job(p_id uuid, p_error text) returns void
language sql security definer set search_path = public as $$
  update jobs set status = case when attempts >= max_attempts then 'dead' else 'failed' end,
    error = left(p_error, 500), locked_until = null, run_after = now() + make_interval(mins => attempts * attempts),
    finished_at = case when attempts >= max_attempts then now() end
  where id = p_id and status = 'running';
$$;

create or replace function public.retry_job(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j jobs;
begin
  select * into j from jobs where id = p_id;
  if not found or j.org_id is null then perform _fail('Job not found.'); end if;
  if not (_me(j.org_id)).is_admin then perform _fail('Only company admins can retry jobs.'); end if;
  if j.status not in ('failed', 'dead') then perform _fail('Only a failed job can be retried.'); end if;
  update jobs set status = 'queued', attempts = 0, run_after = now(), error = null, finished_at = null where id = p_id;
  perform _audit(j.org_id, null, 'job', p_id::text, 'Retried', j.status, 'queued', j.type);
  return jsonb_build_object('message', 'Job queued again.');
end $$;

-- ---------------------------------------------------------------- notifications
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid,
  kind text not null,
  title text not null,
  body text,
  link text,
  subject_type text,
  subject_id text,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  emailed_at timestamptz,
  unique (user_id, dedupe_key)
);
create index notifications_user on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;
create policy "own notifications" on public.notifications for select using (user_id = auth.uid());

-- Can this person (not necessarily the one signed in) see the project? Same rules as can_see_project().
create or replace function public._user_sees_project(p_user uuid, p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_project is null or exists (
    select 1 from projects pr
    join organisations o on o.id = pr.org_id
    join memberships m on m.org_id = pr.org_id and m.user_id = p_user
    where pr.id = p_project and (
      o.project_access = 'all' or m.role = 'director' or m.is_admin
      or exists (select 1 from project_members pm where pm.project_id = pr.id and pm.user_id = p_user)
      or (m.contractor_id is not null and _contractor_on_project(m.contractor_id, pr.id))
      or (m.worker_id is not null and exists (select 1 from inductions i where i.worker_id = m.worker_id and i.project_id = pr.id))
    ));
$$;
create or replace function public.can_see_project(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select _user_sees_project(auth.uid(), p_project);
$$;

-- Create a notification once per person and key, and queue its email. Returns true if it was new.
create or replace function public._notify(p_org uuid, p_user uuid, p_project uuid, p_kind text, p_title text, p_body text, p_link text,
  p_subject_type text, p_subject_id text, p_dedupe text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if p_user is null or not _user_sees_project(p_user, p_project) then return false; end if;
  insert into notifications (org_id, user_id, project_id, kind, title, body, link, subject_type, subject_id, dedupe_key)
  values (p_org, p_user, p_project, p_kind, p_title, p_body, p_link, p_subject_type, p_subject_id, p_dedupe)
  on conflict (user_id, dedupe_key) do nothing returning id into v;
  if v is null then return false; end if;
  perform _enqueue(p_org, 'notification.email', v::text, jsonb_build_object('notification_id', v));
  return true;
end $$;

create or replace function public.mark_notifications_read(p_ids uuid[]) returns void
language sql security definer set search_path = public as $$
  update notifications set read_at = now() where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
$$;

-- For the worker: what to email, and recording that it was sent.
create or replace function public.notification_for_email(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', n.id, 'email', p.email, 'name', p.full_name, 'company', o.name, 'title', n.title, 'body', n.body, 'link', n.link, 'emailed_at', n.emailed_at, 'read_at', n.read_at)
  from notifications n join profiles p on p.id = n.user_id join organisations o on o.id = n.org_id where n.id = p_id;
$$;
create or replace function public.mark_notification_emailed(p_id uuid) returns void
language sql security definer set search_path = public as $$
  update notifications set emailed_at = now() where id = p_id;
$$;

-- ---------------------------------------------------------------- automations
create table public.automation_settings (
  org_id uuid not null references public.organisations (id) on delete cascade,
  rule text not null check (rule in ('credential_expiring', 'defect_overdue', 'hold_point_submitted')),
  enabled boolean not null default true,
  days int check (days between 1 and 180),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (org_id, rule)
);
alter table public.automation_settings enable row level security;
create policy "members read automation settings" on public.automation_settings for select using (is_member(org_id));

create table public.automation_runs (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organisations (id) on delete cascade,
  rule text not null,
  rule_version int not null,
  subject_type text not null,
  subject_id text not null,
  dedupe_key text not null,
  notified int not null default 0,
  detail text,
  created_at timestamptz not null default now(),
  unique (org_id, rule, dedupe_key)
);
create index automation_runs_recent on public.automation_runs (org_id, created_at desc);
alter table public.automation_runs enable row level security;
create policy "admins read automation runs" on public.automation_runs for select using ((my_membership(org_id)).is_admin);

create or replace function public._rule_on(p_org uuid, p_rule text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select enabled from automation_settings where org_id = p_org and rule = p_rule), true);
$$;
create or replace function public._rule_days(p_org uuid, p_rule text, p_default int) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select days from automation_settings where org_id = p_org and rule = p_rule), p_default);
$$;

-- Check every company (or one) against the built-in rules. Safe to run as often as you like.
create or replace function public.run_automations(p_org uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; n int; total int := 0; runs int := 0; key text; today date := (now() at time zone 'Australia/Sydney')::date;
begin
  -- 1. Tickets and licences expiring: the worker, their company's admins, and whoever manages people (v1).
  for r in select c.*, w.name worker_name, w.contractor_id, ct.trading_name company,
                  (c.expires - today) days_left
           from credentials c join workers w on w.id = c.worker_id left join contractors ct on ct.id = w.contractor_id
           where (p_org is null or c.org_id = p_org) and c.status = 'verified' and c.expires is not null
             and c.expires >= today and c.expires <= today + _rule_days(c.org_id, 'credential_expiring', 30)
             and _rule_on(c.org_id, 'credential_expiring') loop
    key := format('cred:%s:%s', r.id, r.expires);
    if exists (select 1 from automation_runs where org_id = r.org_id and rule = 'credential_expiring' and dedupe_key = key) then continue; end if;
    n := 0;
    select n + count(*) filter (where _notify(r.org_id, m.user_id, null, 'credential_expiring',
        format('%s for %s expires %s', r.type, r.worker_name, to_char(r.expires, 'FMDD Mon YYYY')),
        format('%s day%s left. Upload the renewed card or licence so they can keep signing in to site.', r.days_left, case when r.days_left = 1 then '' else 's' end),
        '#/app/people/workers/' || r.worker_id, 'credential', r.id::text, key))
      into n from memberships m
      where m.org_id = r.org_id and (m.worker_id = r.worker_id or (m.role = 'subcontractor_admin' and m.contractor_id = r.contractor_id) or role_can(m.role, 'people.manage'));
    insert into automation_runs (org_id, rule, rule_version, subject_type, subject_id, dedupe_key, notified, detail)
    values (r.org_id, 'credential_expiring', 1, 'credential', r.id::text, key, n, format('%s · %s', r.worker_name, r.type));
    total := total + n; runs := runs + 1;
  end loop;

  -- 2. Defects past their due date: the responsible company's admins and the people who assign defects (v1).
  for r in select d.*, coalesce(ct.trading_name, 'unassigned') company, p.name project_name
           from defects d join projects p on p.id = d.project_id left join contractors ct on ct.id = d.contractor_id
           where (p_org is null or d.org_id = p_org) and d.status in ('open', 'assigned', 'rectifying') and d.due_date < today
             and _rule_on(d.org_id, 'defect_overdue') loop
    key := format('defect:%s:%s', r.id, r.due_date);
    if exists (select 1 from automation_runs where org_id = r.org_id and rule = 'defect_overdue' and dedupe_key = key) then continue; end if;
    select count(*) filter (where _notify(r.org_id, m.user_id, r.project_id, 'defect_overdue',
        format('%s is overdue: %s', r.ref, r.title),
        format('%s · %s · was due %s', r.project_name, r.company, to_char(r.due_date, 'FMDD Mon')),
        format('#/app/projects/%s/quality/defects/%s', r.project_id, r.id), 'defect', r.id::text, key))
      into n from memberships m
      where m.org_id = r.org_id and ((m.role = 'subcontractor_admin' and m.contractor_id = r.contractor_id) or role_can(m.role, 'defect.assign'));
    insert into automation_runs (org_id, rule, rule_version, subject_type, subject_id, dedupe_key, notified, detail)
    values (r.org_id, 'defect_overdue', 1, 'defect', r.id::text, key, n, format('%s · %s', r.ref, r.company));
    total := total + n; runs := runs + 1;
  end loop;

  -- 3. Hold and witness points waiting for sign-off: everyone who may release them, except whoever submitted (v1).
  for r in select pt.*, i.project_id, i.ref itp_ref, i.title itp_title, p.name project_name
           from itp_points pt join itps i on i.id = pt.itp_id join projects p on p.id = i.project_id
           where (p_org is null or pt.org_id = p_org) and pt.status = 'submitted' and pt.type in ('hold', 'witness')
             and _rule_on(pt.org_id, 'hold_point_submitted') loop
    key := format('point:%s:%s', r.id, coalesce(r.submitted_at::text, ''));
    if exists (select 1 from automation_runs where org_id = r.org_id and rule = 'hold_point_submitted' and dedupe_key = key) then continue; end if;
    select count(*) filter (where _notify(r.org_id, m.user_id, r.project_id, 'hold_point_submitted',
        format('%s point waiting: %s', initcap(r.type), r.name),
        format('%s · %s %s — work after this point stays blocked until it''s signed off.', r.project_name, r.itp_ref, r.itp_title),
        format('#/app/projects/%s/quality/itp/%s', r.project_id, r.itp_id), 'itp_point', r.id::text, key))
      into n from memberships m
      where m.org_id = r.org_id and role_can(m.role, 'itp.release_hold') and m.user_id is distinct from r.submitted_by;
    insert into automation_runs (org_id, rule, rule_version, subject_type, subject_id, dedupe_key, notified, detail)
    values (r.org_id, 'hold_point_submitted', 1, 'itp_point', r.id::text, key, n, format('%s · %s', r.itp_ref, r.name));
    total := total + n; runs := runs + 1;
  end loop;
  return jsonb_build_object('rules_fired', runs, 'notifications', total);
end $$;

create or replace function public.set_automation(p_org uuid, p_rule text, p_enabled boolean, p_days int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not (_me(p_org)).is_admin then perform _fail('Only company admins can change automations.'); end if;
  if p_rule not in ('credential_expiring', 'defect_overdue', 'hold_point_submitted') then perform _fail('Unknown automation.'); end if;
  if p_days is not null and (p_days < 1 or p_days > 180) then perform _fail('Choose between 1 and 180 days.'); end if;
  insert into automation_settings (org_id, rule, enabled, days, updated_by) values (p_org, p_rule, coalesce(p_enabled, true), p_days, auth.uid())
  on conflict (org_id, rule) do update set enabled = excluded.enabled, days = coalesce(excluded.days, automation_settings.days), updated_by = auth.uid(), updated_at = now();
  perform _audit(p_org, null, 'automation', p_rule, case when p_enabled then 'Automation on' else 'Automation off' end);
  return jsonb_build_object('message', case when p_enabled then 'Automation on.' else 'Automation off.' end);
end $$;

-- An admin can run the rules for their company straight away (they also run on a schedule).
create or replace function public.run_my_automations(p_org uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if not (_me(p_org)).is_admin then perform _fail('Only company admins can run automations.'); end if;
  r := run_automations(p_org);
  return r || jsonb_build_object('message', format('Checked now: %s alert%s sent.', r ->> 'notifications', case when (r ->> 'notifications') = '1' then '' else 's' end));
end $$;

-- ---------------------------------------------------------------- schedule (on Supabase, where pg_cron is available)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('setout-automations', '*/15 * * * *', 'select public.run_automations()');
  else
    raise notice 'pg_cron is not available here; run select public.run_automations() on a schedule instead.';
  end if;
exception when others then
  raise notice 'Could not schedule automations (%). Schedule select public.run_automations() in the Supabase dashboard (Integrations → Cron).', sqlerrm;
end $$;

-- ---------------------------------------------------------------- grants
do $$
declare f text;
begin
  foreach f in array array['public.retry_job(uuid)', 'public.mark_notifications_read(uuid[])', 'public.set_automation(uuid, text, boolean, int)', 'public.run_my_automations(uuid)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  -- The worker and the scheduler only.
  foreach f in array array['public.claim_jobs(text, int)', 'public.finish_job(uuid, text)', 'public.fail_job(uuid, text)', 'public.notification_for_email(uuid)', 'public.mark_notification_emailed(uuid)', 'public.run_automations(uuid)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array['public._event_from_audit()', 'public._enqueue(uuid, text, text, jsonb, interval)', 'public._notify(uuid, uuid, uuid, text, text, text, text, text, text, text)',
    'public._user_sees_project(uuid, uuid)', 'public._rule_on(uuid, text)', 'public._rule_days(uuid, text, int)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;
