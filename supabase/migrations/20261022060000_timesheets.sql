-- =====================================================================
-- Timesheets & rates (blueprint §6.4)
--
--  * Hours are entered by the office, a supervisor, a subcontractor admin
--    (their own workers) or the worker from the site app, or created from
--    the sign-in register.
--  * Pending → Approved (by a supervisor/PM/director, never your own
--    hours) → Processed (PM/director). Processing locks the cost and
--    chargeout rates; a rejected timesheet goes back to be fixed.
--  * Rates resolve from the most specific rule: job + person + cost code,
--    job + person, job + cost code, company cost-code rate, the person's
--    own rate, then their rate card. Cost and chargeout resolve separately.
--  * Rates and locked costs are readable only by people who manage rates
--    (PM, director) — supervisors and subcontractors never see wages.
-- =====================================================================

create or replace function public.role_can(p_role text, p_perm text) returns boolean
language sql immutable as $$
  select case p_role
    when 'director' then p_perm = any (array['defect.create','defect.assign','defect.verify','itp.release_hold','itp.manage','itp.submit','swms.submit','variation.create','variation.approve','swms.review','commercial.view','diary.submit','people.manage','project.manage','documents.upload','documents.approve','ncr.manage','permit.request','permit.approve','safety.report','safety.manage','attendance.manage','timesheet.submit','timesheet.approve','timesheet.process','rates.manage'])
    when 'project_manager' then p_perm = any (array['defect.create','defect.assign','defect.verify','itp.release_hold','itp.manage','itp.submit','swms.submit','variation.create','variation.approve','swms.review','commercial.view','diary.submit','people.manage','project.manage','documents.upload','documents.approve','ncr.manage','permit.request','permit.approve','safety.report','safety.manage','attendance.manage','timesheet.submit','timesheet.approve','timesheet.process','rates.manage'])
    when 'site_supervisor' then p_perm = any (array['defect.create','defect.assign','defect.verify','itp.submit','swms.submit','swms.review','diary.submit','people.manage','documents.upload','ncr.manage','permit.request','permit.approve','safety.report','safety.manage','attendance.manage','timesheet.submit','timesheet.approve'])
    when 'quality_manager' then p_perm = any (array['defect.create','defect.assign','defect.verify','itp.release_hold','itp.manage','itp.submit','documents.upload','documents.approve','ncr.manage','safety.report'])
    when 'subcontractor_admin' then p_perm = any (array['defect.rectify','variation.create','itp.submit','swms.submit','documents.upload','permit.request','safety.report','timesheet.submit'])
    when 'worker' then p_perm = any (array['defect.create','permit.request','safety.report','timesheet.submit'])
    else false end;
$$;

-- ---------------------------------------------------------------- tables
create table public.rate_cards (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  name text not null,
  cost_rate bigint not null default 0 check (cost_rate >= 0),     -- cents per hour
  charge_rate bigint not null default 0 check (charge_rate >= 0),
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index rate_cards_name on public.rate_cards (org_id, lower(name));

-- One row per scope. A person's own row (no job, no cost code) can also name their rate card.
create table public.rate_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  worker_id uuid references public.workers (id) on delete cascade,
  cost_code text,
  rate_card_id uuid references public.rate_cards (id) on delete set null,
  cost_rate bigint check (cost_rate >= 0),
  charge_rate bigint check (charge_rate >= 0),
  updated_at timestamptz not null default now(),
  check (worker_id is not null or cost_code is not null),
  check (rate_card_id is null or (worker_id is not null and project_id is null and cost_code is null))
);
create unique index rate_rules_scope on public.rate_rules (org_id, project_id, worker_id, lower(cost_code)) nulls not distinct;

create table public.timesheets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  worker_id uuid not null references public.workers (id) on delete cascade,
  date date not null,
  start_time time,
  end_time time,
  break_min int not null default 0 check (break_min between 0 and 300),
  hours numeric(5,2) not null check (hours > 0 and hours <= 24),
  task_id uuid references public.tasks (id) on delete set null,
  cost_code text,
  billable boolean not null default true,
  note text,
  source text not null default 'manual' check (source in ('manual','sign_in','site_app')),
  status text not null default 'pending' check (status in ('pending','approved','rejected','processed')),
  entered_by uuid,
  entered_at timestamptz not null default now(),
  approved_by uuid,
  approved_at timestamptz,
  reject_reason text,
  processed_by uuid,
  processed_at timestamptz
);
create index on public.timesheets (org_id, date);
create index on public.timesheets (worker_id, date);

-- Rates locked when a timesheet is processed.
create table public.timesheet_costs (
  timesheet_id uuid primary key references public.timesheets (id) on delete cascade,
  org_id uuid not null references public.organisations (id) on delete cascade,
  cost_rate bigint not null,
  charge_rate bigint not null,
  source text
);

alter table public.timesheets enable row level security;
-- Approvers see everything; a worker sees their own; a subcontractor admin sees their company's.
create policy "timesheets read" on public.timesheets for select using (
  has_perm(org_id, 'timesheet.approve')
  or worker_id = (my_membership(org_id)).worker_id
  or ((my_membership(org_id)).role = 'subcontractor_admin'
      and exists (select 1 from workers w where w.id = worker_id and w.contractor_id = (my_membership(org_id)).contractor_id))
);
grant select on public.timesheets to authenticated;
do $$
declare t text;
begin
  foreach t in array array['rate_cards','rate_rules','timesheet_costs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "rates read" on public.%I for select using (has_perm(org_id, ''rates.manage''))', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- helpers
create or replace function public._money(p_cents bigint) returns text
language sql immutable as $$ select to_char(coalesce(p_cents, 0) / 100.0, 'FM$999,999,990.00') $$;
create or replace function public._hours(p numeric) returns text
language sql immutable as $$ select rtrim(rtrim(round(p, 2)::text, '0'), '.') || ' h' $$;

-- The rate for one person on one job and cost code: cost and chargeout resolve separately.
create or replace function public.resolve_rate(p_worker uuid, p_project uuid, p_code text,
  out cost_rate bigint, out charge_rate bigint, out cost_source text, out charge_source text)
language plpgsql stable security definer set search_path = public as $$
declare w workers; r record; card rate_cards; lbl text;
begin
  select * into w from workers where id = p_worker;
  for r in
    select x.*, case
        when x.project_id is not null and x.worker_id is not null and x.cost_code is not null then 1
        when x.project_id is not null and x.worker_id is not null then 2
        when x.project_id is not null then 3
        when x.worker_id is null then 4
        else 5 end as rank
    from rate_rules x
    where x.org_id = w.org_id and (
      (x.project_id = p_project and x.worker_id = p_worker and lower(x.cost_code) = lower(p_code)) or
      (x.project_id = p_project and x.worker_id = p_worker and x.cost_code is null) or
      (x.project_id = p_project and x.worker_id is null and lower(x.cost_code) = lower(p_code)) or
      (x.project_id is null and x.worker_id is null and lower(x.cost_code) = lower(p_code)) or
      (x.project_id is null and x.worker_id = p_worker and x.cost_code is null))
    order by rank
  loop
    lbl := case r.rank when 1 then 'Job rate for this person and cost code' when 2 then 'Job rate for this person'
      when 3 then 'Job rate for ' || r.cost_code when 4 then 'Company rate for ' || r.cost_code else 'Personal rate' end;
    if cost_rate is null and r.cost_rate is not null then cost_rate := r.cost_rate; cost_source := lbl; end if;
    if charge_rate is null and r.charge_rate is not null then charge_rate := r.charge_rate; charge_source := lbl; end if;
    if r.rate_card_id is not null then select * into card from rate_cards where id = r.rate_card_id and not archived; end if;
  end loop;
  if card.id is not null then
    if cost_rate is null then cost_rate := card.cost_rate; cost_source := 'Rate card: ' || card.name; end if;
    if charge_rate is null then charge_rate := card.charge_rate; charge_source := 'Rate card: ' || card.name; end if;
  end if;
end $$;

create or replace function public._ts_can_enter(m public.memberships, w public.workers) returns boolean
language sql stable as $$
  select role_can(m.role, 'timesheet.approve')
    or (m.role = 'subcontractor_admin' and w.contractor_id is not distinct from m.contractor_id and m.contractor_id is not null)
    or (m.role = 'worker' and m.worker_id = w.id)
$$;

-- Validates and normalises a timesheet. Returns the row to store (id/status untouched).
create or replace function public._ts_build(pr public.projects, w public.workers, p jsonb, p_except uuid default null) returns public.timesheets
language plpgsql stable security definer set search_path = public as $$
declare t timesheets; mins int; other numeric; tk tasks;
begin
  t.org_id := pr.org_id; t.project_id := pr.id; t.worker_id := w.id;
  t.date := nullif(p ->> 'date', '')::date;
  if t.date is null then perform _fail('Choose the date.'); end if;
  if t.date > (now() at time zone 'Australia/Sydney')::date then perform _fail('Hours can''t be entered for a future date.'); end if;
  if t.date < (now() at time zone 'Australia/Sydney')::date - 90 then perform _fail('That date is more than 90 days ago. Ask the office to enter it.'); end if;
  t.start_time := nullif(p ->> 'start_time', '')::time;
  t.end_time := nullif(p ->> 'end_time', '')::time;
  t.break_min := coalesce(nullif(p ->> 'break_min', '')::int, 0);
  if t.break_min < 0 or t.break_min > 300 then perform _fail('The unpaid break must be between 0 and 300 minutes.'); end if;
  if (t.start_time is null) <> (t.end_time is null) then perform _fail('Enter both the start and finish times, or just the hours.'); end if;
  if t.start_time is not null then
    if t.end_time <= t.start_time then perform _fail('The finish time must be after the start time.'); end if;
    mins := extract(epoch from (t.end_time - t.start_time))::int / 60 - t.break_min;
    if mins <= 0 then perform _fail('The break is longer than the time worked.'); end if;
    t.hours := round(mins / 15.0) / 4.0;
    if t.hours <= 0 then perform _fail('Less than 15 minutes worked.'); end if;
  else
    t.hours := nullif(p ->> 'hours', '')::numeric;
    t.break_min := 0;
    if t.hours is null then perform _fail('Enter the start and finish times, or the hours worked.'); end if;
    if t.hours <= 0 or t.hours > 24 then perform _fail('Hours must be more than 0 and no more than 24.'); end if;
    t.hours := round(t.hours * 4) / 4.0;
  end if;
  if t.start_time is not null and exists (
    select 1 from timesheets x where x.worker_id = w.id and x.date = t.date and x.status <> 'rejected' and x.id is distinct from p_except
      and x.start_time is not null and x.start_time < t.end_time and x.end_time > t.start_time) then
    perform _fail(format('%s already has hours that overlap %s–%s on that day.', w.name, to_char(t.start_time, 'HH24:MI'), to_char(t.end_time, 'HH24:MI')));
  end if;
  select coalesce(sum(hours), 0) into other from timesheets x where x.worker_id = w.id and x.date = t.date and x.status <> 'rejected' and x.id is distinct from p_except;
  if other + t.hours > 24 then perform _fail(format('That would be more than 24 hours for %s on that day.', w.name)); end if;
  if nullif(p ->> 'task_id', '') is not null then
    select * into tk from tasks where id = (p ->> 'task_id')::uuid and project_id = pr.id;
    if not found then perform _fail('That task isn''t on this project.'); end if;
    t.task_id := tk.id;
  end if;
  t.cost_code := coalesce(nullif(upper(trim(coalesce(p ->> 'cost_code', ''))), ''), tk.cost_code);
  t.billable := coalesce((p ->> 'billable')::boolean, true);
  t.note := nullif(trim(coalesce(p ->> 'note', '')), '');
  return t;
end $$;

-- ------------------------------------------------------------ timesheets
create or replace function public.create_timesheet(p_project uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects; m memberships; w workers; t timesheets; v uuid;
begin
  select * into pr from projects where id = p_project;
  if not found then perform _fail('Project not found.'); end if;
  m := _require(pr.org_id, 'timesheet.submit');
  select * into w from workers where id = nullif(p ->> 'worker_id', '')::uuid and org_id = pr.org_id;
  if not found then perform _fail('Choose who the hours are for.'); end if;
  if not _ts_can_enter(m, w) then perform _fail('You can only enter hours for ' || case m.role when 'worker' then 'yourself.' else 'your own company''s workers.' end); end if;
  t := _ts_build(pr, w, p);
  insert into timesheets (org_id, project_id, worker_id, date, start_time, end_time, break_min, hours, task_id, cost_code, billable, note, source, entered_by)
  values (t.org_id, t.project_id, t.worker_id, t.date, t.start_time, t.end_time, t.break_min, t.hours, t.task_id, t.cost_code, t.billable, t.note,
    case when m.worker_id = w.id then 'site_app' else 'manual' end, auth.uid())
  returning id into v;
  perform _audit(pr.org_id, pr.id, 'timesheet', v::text, 'Timesheet entered', null, 'pending', w.name || ' · ' || to_char(t.date, 'DD Mon') || ' · ' || _hours(t.hours));
  return jsonb_build_object('id', v, 'message', format('%s for %s on %s sent for approval.', _hours(t.hours), w.name, to_char(t.date, 'FMDD Mon')));
end $$;

create or replace function public.update_timesheet(p_ts uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x timesheets; pr projects; m memberships; w workers; t timesheets;
begin
  select * into x from timesheets where id = p_ts for update;
  if not found then perform _fail('Timesheet not found.'); end if;
  m := _require(x.org_id, 'timesheet.submit');
  select * into w from workers where id = x.worker_id;
  if not _ts_can_enter(m, w) then perform _fail('You can''t change this timesheet.'); end if;
  if x.status not in ('pending','rejected') then perform _fail('Approved and processed timesheets can''t be changed. Ask the approver to reject it first.'); end if;
  select * into pr from projects where id = x.project_id;
  t := _ts_build(pr, w, p, x.id);
  update timesheets set date = t.date, start_time = t.start_time, end_time = t.end_time, break_min = t.break_min, hours = t.hours,
    task_id = t.task_id, cost_code = t.cost_code, billable = t.billable, note = t.note, status = 'pending', reject_reason = null, approved_by = null, approved_at = null
  where id = x.id;
  perform _audit(x.org_id, x.project_id, 'timesheet', x.id::text, 'Timesheet changed', x.status, 'pending', w.name || ' · ' || to_char(t.date, 'DD Mon') || ' · ' || _hours(t.hours));
  return jsonb_build_object('message', format('Saved — %s for %s sent for approval.', _hours(t.hours), w.name));
end $$;

create or replace function public.delete_timesheet(p_ts uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x timesheets; m memberships; w workers;
begin
  select * into x from timesheets where id = p_ts for update;
  if not found then perform _fail('Timesheet not found.'); end if;
  m := _require(x.org_id, 'timesheet.submit');
  select * into w from workers where id = x.worker_id;
  if not _ts_can_enter(m, w) then perform _fail('You can''t delete this timesheet.'); end if;
  if x.status not in ('pending','rejected') then perform _fail('Only pending or rejected timesheets can be deleted.'); end if;
  delete from timesheets where id = x.id;
  perform _audit(x.org_id, x.project_id, 'timesheet', x.id::text, 'Timesheet deleted', x.status, null, w.name || ' · ' || to_char(x.date, 'DD Mon') || ' · ' || _hours(x.hours));
  return jsonb_build_object('message', 'Timesheet deleted.');
end $$;

-- Bulk approve / reject / process / unprocess. All or nothing.
create or replace function public.timesheet_action(p_ids uuid[], p_action text, p_reason text default '', p_cost bigint default null, p_charge bigint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x timesheets; m memberships; org uuid; n int := 0; hrs numeric := 0; total bigint := 0; r record; missing text[] := '{}'; wname text;
begin
  if coalesce(cardinality(p_ids), 0) = 0 then perform _fail('Tick the timesheets first.'); end if;
  select distinct t.org_id into org from timesheets t where t.id = any (p_ids);
  if org is null then perform _fail('Timesheet not found.'); end if;
  if (select count(distinct t.org_id) from timesheets t where t.id = any (p_ids)) > 1 then perform _fail('Those timesheets belong to different companies.'); end if;
  m := _require(org, case when p_action in ('process','unprocess') then 'timesheet.process' else 'timesheet.approve' end);
  if p_action = 'reject' and length(trim(coalesce(p_reason, ''))) = 0 then perform _fail('Say why the hours are rejected, so they can be fixed.'); end if;
  if p_cost is not null and p_cost < 0 or p_charge is not null and p_charge < 0 then perform _fail('Rates can''t be negative.'); end if;
  for x in select * from timesheets t where t.id = any (p_ids) order by t.date for update loop
    select name into wname from workers where id = x.worker_id;
    if p_action = 'approve' then
      if x.status <> 'pending' then perform _fail(format('%s on %s is already %s.', wname, to_char(x.date, 'FMDD Mon'), x.status)); end if;
      if x.worker_id = m.worker_id then perform _fail('You can''t approve your own hours.'); end if;
      update timesheets set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = x.id;
    elsif p_action = 'reject' then
      if x.status not in ('pending','approved') then perform _fail(format('%s on %s is %s and can''t be rejected.', wname, to_char(x.date, 'FMDD Mon'), x.status)); end if;
      update timesheets set status = 'rejected', reject_reason = trim(p_reason), approved_by = auth.uid(), approved_at = now() where id = x.id;
    elsif p_action = 'process' then
      if x.status <> 'approved' then perform _fail(format('%s on %s isn''t approved yet.', wname, to_char(x.date, 'FMDD Mon'))); end if;
      select * into r from resolve_rate(x.worker_id, x.project_id, x.cost_code);
      if coalesce(r.cost_rate, p_cost) is null or (x.billable and coalesce(r.charge_rate, p_charge) is null) then
        if not (wname = any (missing)) then missing := missing || wname; end if;
        continue;
      end if;
      insert into timesheet_costs (timesheet_id, org_id, cost_rate, charge_rate, source)
      values (x.id, org, coalesce(r.cost_rate, p_cost), case when x.billable then coalesce(r.charge_rate, p_charge) else 0 end,
        coalesce(r.cost_source, 'Entered when processing') || ' / ' || case when not x.billable then 'not billable' else coalesce(r.charge_source, 'entered when processing') end);
      update timesheets set status = 'processed', processed_by = auth.uid(), processed_at = now() where id = x.id;
      total := total + round(x.hours * coalesce(r.cost_rate, p_cost));
    elsif p_action = 'unprocess' then
      if x.status <> 'processed' then perform _fail(format('%s on %s isn''t processed.', wname, to_char(x.date, 'FMDD Mon'))); end if;
      delete from timesheet_costs where timesheet_id = x.id;
      update timesheets set status = 'approved', processed_by = null, processed_at = null where id = x.id;
    else
      perform _fail('Unknown action.');
    end if;
    n := n + 1; hrs := hrs + x.hours;
    perform _audit(x.org_id, x.project_id, 'timesheet', x.id::text, 'Timesheet ' || case p_action when 'unprocess' then 'unprocessed' else p_action || 'd' end,
      x.status, case p_action when 'unprocess' then 'approved' when 'process' then 'processed' else p_action || 'd' end,
      wname || ' · ' || to_char(x.date, 'DD Mon') || ' · ' || _hours(x.hours) || coalesce(' — ' || nullif(trim(p_reason), ''), ''));
  end loop;
  if cardinality(missing) > 0 then
    perform _fail('No rate is set up for ' || array_to_string(missing, ', ') || '. Set their rates under Rates, or enter a rate to use for this run.');
  end if;
  return jsonb_build_object('message', format('%s timesheet%s %s · %s', n, case when n = 1 then '' else 's' end,
    case p_action when 'approve' then 'approved' when 'reject' then 'rejected' when 'process' then 'processed' else 'unprocessed' end, _hours(hrs))
    || case when p_action = 'process' then ' · labour cost ' || _money(total) else '' end || '.');
end $$;

-- One timesheet per person from the day's first sign-in to last sign-out.
create or replace function public.timesheets_from_sign_ins(p_project uuid, p_date date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects; r record; n int := 0; open_ int := 0; dup int := 0; s time; e time; brk int; mins int;
begin
  select * into pr from projects where id = p_project;
  if not found then perform _fail('Project not found.'); end if;
  perform _require(pr.org_id, 'timesheet.approve');
  if p_date is null or p_date > (now() at time zone 'Australia/Sydney')::date then perform _fail('Choose a date up to today.'); end if;
  for r in
    select a.worker_id,
      min(a.at) filter (where a.kind = 'check_in') as first_in,
      max(a.at) filter (where a.kind = 'check_out') as last_out
    from attendance a
    where a.project_id = pr.id and (a.at at time zone 'Australia/Sydney')::date = p_date
    group by a.worker_id
  loop
    if exists (select 1 from timesheets t where t.worker_id = r.worker_id and t.project_id = pr.id and t.date = p_date and t.status <> 'rejected') then dup := dup + 1; continue; end if;
    if r.first_in is null or r.last_out is null or r.last_out <= r.first_in then open_ := open_ + 1; continue; end if;
    s := date_trunc('minute', r.first_in at time zone 'Australia/Sydney')::time;
    e := date_trunc('minute', r.last_out at time zone 'Australia/Sydney')::time;
    if e <= s then open_ := open_ + 1; continue; end if;
    mins := extract(epoch from (e - s))::int / 60;
    brk := case when mins > 300 then 30 else 0 end;
    if round((mins - brk) / 15.0) = 0 then continue; end if;
    insert into timesheets (org_id, project_id, worker_id, date, start_time, end_time, break_min, hours, source, entered_by)
    values (pr.org_id, pr.id, r.worker_id, p_date, s, e, brk, round((mins - brk) / 15.0) / 4.0, 'sign_in', auth.uid());
    n := n + 1;
  end loop;
  if n > 0 then perform _audit(pr.org_id, pr.id, 'timesheet', pr.id::text, 'Timesheets created from sign-ins', null, 'pending', n || ' for ' || to_char(p_date, 'DD Mon')); end if;
  return jsonb_build_object('message', case when n = 0 and open_ = 0 and dup = 0 then 'Nobody signed in on that day.'
    else format('%s timesheet%s created from sign-ins', n, case when n = 1 then '' else 's' end)
      || case when dup > 0 then format(' · %s already had hours', dup) else '' end
      || case when open_ > 0 then format(' · %s skipped (no sign-out)', open_) else '' end || '.' end);
end $$;

-- ---------------------------------------------------------------- rates
create or replace function public.save_rate_card(p_org uuid, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid; nm text := trim(coalesce(p ->> 'name', '')); c bigint := nullif(p ->> 'cost_rate', '')::bigint; ch bigint := nullif(p ->> 'charge_rate', '')::bigint;
begin
  perform _require(p_org, 'rates.manage');
  if nm = '' then perform _fail('Name the rate card, e.g. Carpenter or Leading hand.'); end if;
  if c is null or ch is null then perform _fail('Enter both the cost and chargeout rates per hour.'); end if;
  if c < 0 or ch < 0 or c > 100000 or ch > 100000 then perform _fail('Rates must be between $0 and $1,000 per hour.'); end if;
  if exists (select 1 from rate_cards where org_id = p_org and lower(name) = lower(nm) and id is distinct from p_id) then perform _fail('There''s already a rate card called ' || nm || '.'); end if;
  if p_id is null then
    insert into rate_cards (org_id, name, cost_rate, charge_rate) values (p_org, nm, c, ch) returning id into v;
  else
    update rate_cards set name = nm, cost_rate = c, charge_rate = ch, archived = coalesce((p ->> 'archived')::boolean, archived) where id = p_id and org_id = p_org returning id into v;
    if v is null then perform _fail('Rate card not found.'); end if;
  end if;
  perform _audit(p_org, null, 'rates', v::text, case when p_id is null then 'Rate card added' else 'Rate card changed' end, null, null, nm || ' · cost ' || _money(c) || ' / charge ' || _money(ch));
  return jsonb_build_object('id', v, 'message', format('%s saved — cost %s, chargeout %s per hour.', nm, _money(c), _money(ch)));
end $$;

-- Sets (or clears, when no rate and no card is given) the rule for one scope.
create or replace function public.set_rate_rule(p_org uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pj uuid := nullif(p ->> 'project_id', '')::uuid; wk uuid := nullif(p ->> 'worker_id', '')::uuid;
  code text := nullif(upper(trim(coalesce(p ->> 'cost_code', ''))), ''); card uuid := nullif(p ->> 'rate_card_id', '')::uuid;
  c bigint := nullif(p ->> 'cost_rate', '')::bigint; ch bigint := nullif(p ->> 'charge_rate', '')::bigint; what text;
begin
  perform _require(p_org, 'rates.manage');
  if wk is null and code is null then perform _fail('Choose a person or a cost code for this rate.'); end if;
  if pj is not null and not exists (select 1 from projects where id = pj and org_id = p_org) then perform _fail('Project not found.'); end if;
  if wk is not null and not exists (select 1 from workers where id = wk and org_id = p_org) then perform _fail('Worker not found.'); end if;
  if card is not null and (wk is null or pj is not null or code is not null) then perform _fail('A rate card is assigned to a person, not to a job or cost code.'); end if;
  if card is not null and not exists (select 1 from rate_cards where id = card and org_id = p_org and not archived) then perform _fail('Rate card not found.'); end if;
  if c < 0 or ch < 0 or c > 100000 or ch > 100000 then perform _fail('Rates must be between $0 and $1,000 per hour.'); end if;
  what := concat_ws(' · ', (select name from projects where id = pj), (select name from workers where id = wk), code);
  if card is null and c is null and ch is null then
    delete from rate_rules where org_id = p_org and project_id is not distinct from pj and worker_id is not distinct from wk and lower(cost_code) is not distinct from lower(code);
    perform _audit(p_org, pj, 'rates', coalesce(wk::text, code), 'Rate removed', null, null, what);
    return jsonb_build_object('message', 'Rate removed for ' || what || '.');
  end if;
  insert into rate_rules (org_id, project_id, worker_id, cost_code, rate_card_id, cost_rate, charge_rate)
  values (p_org, pj, wk, code, card, c, ch)
  on conflict (org_id, project_id, worker_id, lower(cost_code)) do update set rate_card_id = excluded.rate_card_id, cost_rate = excluded.cost_rate, charge_rate = excluded.charge_rate, updated_at = now();
  perform _audit(p_org, pj, 'rates', coalesce(wk::text, code), 'Rate set', null, null,
    what || coalesce(' · card ' || (select name from rate_cards where id = card), '') || coalesce(' · cost ' || _money(c), '') || coalesce(' · charge ' || _money(ch), ''));
  return jsonb_build_object('message', 'Rate saved for ' || what || '.');
end $$;

-- ---------------------------------------------------------------- grants
do $$
declare f text;
begin
  foreach f in array array['public.create_timesheet(uuid, jsonb)', 'public.update_timesheet(uuid, jsonb)', 'public.delete_timesheet(uuid)',
    'public.timesheet_action(uuid[], text, text, bigint, bigint)', 'public.timesheets_from_sign_ins(uuid, date)',
    'public.save_rate_card(uuid, uuid, jsonb)', 'public.set_rate_rule(uuid, jsonb)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array['public.resolve_rate(uuid, uuid, text)', 'public._ts_can_enter(public.memberships, public.workers)',
    'public._ts_build(public.projects, public.workers, jsonb, uuid)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;
grant execute on function public.role_can(text, text), public._money(bigint), public._hours(numeric) to anon, authenticated;
