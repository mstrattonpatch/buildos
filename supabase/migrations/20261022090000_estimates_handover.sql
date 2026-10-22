-- =====================================================================
-- Estimates (blueprint §7.1) and the handover pack (§8)
--
-- Estimates
--  * Items by category (trade package) with quantity × rate; quantities can
--    come from a simple formula (e.g. 12.5*2.4) worked out in the app and
--    stored as the number. Assemblies are company templates that expand
--    into several items.
--  * Each category can have quotes; a selected quote replaces the
--    category's itemised cost. Sell price = cost × (1 + markup).
--  * Draft → sent (locked) → won / lost. A new version copies the estimate
--    and supersedes the old one. A won estimate converts to a project with
--    the budget and claim schedule filled in.
-- Handover
--  * Issuing a handover pack records what was outstanding at the time,
--    moves the project to handover and starts the defects liability period.
-- =====================================================================

create or replace function public.role_can(p_role text, p_perm text) returns boolean
language sql immutable as $$
  select case p_role
    when 'director' then p_perm = any (array['defect.create','defect.assign','defect.verify','itp.release_hold','itp.manage','itp.submit','swms.submit','variation.create','variation.approve','swms.review','commercial.view','diary.submit','people.manage','project.manage','documents.upload','documents.approve','ncr.manage','permit.request','permit.approve','safety.report','safety.manage','attendance.manage','timesheet.submit','timesheet.approve','timesheet.process','rates.manage','task.assign','cost.manage','receipt.submit','estimate.manage'])
    when 'project_manager' then p_perm = any (array['defect.create','defect.assign','defect.verify','itp.release_hold','itp.manage','itp.submit','swms.submit','variation.create','variation.approve','swms.review','commercial.view','diary.submit','people.manage','project.manage','documents.upload','documents.approve','ncr.manage','permit.request','permit.approve','safety.report','safety.manage','attendance.manage','timesheet.submit','timesheet.approve','timesheet.process','rates.manage','task.assign','cost.manage','receipt.submit','estimate.manage'])
    when 'site_supervisor' then p_perm = any (array['defect.create','defect.assign','defect.verify','itp.submit','swms.submit','swms.review','diary.submit','people.manage','documents.upload','ncr.manage','permit.request','permit.approve','safety.report','safety.manage','attendance.manage','timesheet.submit','timesheet.approve','task.assign','receipt.submit'])
    when 'quality_manager' then p_perm = any (array['defect.create','defect.assign','defect.verify','itp.release_hold','itp.manage','itp.submit','documents.upload','documents.approve','ncr.manage','safety.report','task.assign','receipt.submit'])
    when 'subcontractor_admin' then p_perm = any (array['defect.rectify','variation.create','itp.submit','swms.submit','documents.upload','permit.request','safety.report','timesheet.submit'])
    when 'worker' then p_perm = any (array['defect.create','permit.request','safety.report','timesheet.submit','receipt.submit'])
    else false end;
$$;

-- ------------------------------------------------------------- estimates
create table public.estimates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  ref text not null,
  version int not null default 1,
  series_id uuid,
  name text not null,
  client text,
  address text,
  status text not null default 'draft' check (status in ('draft','sent','won','lost','superseded')),
  markup_pct numeric(6,2) not null default 15 check (markup_pct between 0 and 500),
  valid_until date,
  inclusions text,
  exclusions text,
  notes text,
  project_id uuid references public.projects (id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  decided_at timestamptz,
  decision_note text,
  unique (org_id, ref, version)
);

create table public.estimate_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  seq int not null default 0,
  category text not null,
  description text not null,
  qty numeric(14,3) not null default 1 check (qty >= 0),
  unit text,
  rate bigint not null default 0 check (rate >= 0),
  qty_formula text
);

create table public.estimate_quotes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  category text not null,
  supplier text not null,
  amount bigint not null check (amount >= 0),
  note text,
  selected boolean not null default false
);

create table public.assemblies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  name text not null,
  unit text not null default 'each',
  category text,
  components jsonb not null default '[]',   -- [{ description, qty, unit, rate }] per 1 unit of the assembly
  archived boolean not null default false
);

create table public.handovers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  issued_by uuid,
  issued_at timestamptz not null default now(),
  recipient text not null,
  dlp_months int not null default 12 check (dlp_months between 0 and 120),
  dlp_end date not null,
  outstanding jsonb not null default '{}',
  note text
);

do $$
declare t text;
begin
  foreach t in array array['estimates','estimate_items','estimate_quotes','assemblies'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "commercial roles read" on public.%I for select using (has_perm(org_id, ''commercial.view''))', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
alter table public.handovers enable row level security;
create policy "members read" on public.handovers for select using (is_member(org_id));
grant select on public.handovers to authenticated;

-- Cost per category: the selected quote if there is one, otherwise the itemised total.
create or replace function public.estimate_costs(p_estimate uuid) returns table (category text, cost bigint, sell bigint)
language sql stable security definer set search_path = public as $$
  with cats as (
    select i.category, min(i.seq) as seq, sum(round(i.qty * i.rate))::bigint as items from estimate_items i where i.estimate_id = p_estimate group by i.category
    union select q.category, 100000, 0 from estimate_quotes q where q.estimate_id = p_estimate and q.selected and not exists (select 1 from estimate_items i where i.estimate_id = p_estimate and i.category = q.category)
  ), costed as (
    select c.category, c.seq, coalesce((select q.amount from estimate_quotes q where q.estimate_id = p_estimate and q.category = c.category and q.selected limit 1), c.items) as cost from cats c
  )
  select x.category, x.cost, round(x.cost * (1 + e.markup_pct / 100))::bigint from costed x, estimates e
  where e.id = p_estimate and (auth.uid() is null or has_perm(e.org_id, 'commercial.view')) order by x.seq, x.category;
$$;

create or replace function public._estimate(p_id uuid, p_draft boolean default false) returns public.estimates
language plpgsql stable security definer set search_path = public as $$
declare e estimates;
begin
  select * into e from estimates where id = p_id;
  if not found then perform _fail('Estimate not found.'); end if;
  perform _require(e.org_id, 'estimate.manage');
  if p_draft and e.status <> 'draft' then perform _fail('This version has been sent and is locked. Make a new version to change it.'); end if;
  return e;
end $$;

create or replace function public.create_estimate(p_org uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid; ref text; n int;
begin
  perform _require(p_org, 'estimate.manage');
  if length(trim(coalesce(p ->> 'name', ''))) = 0 then perform _fail('Name the job, e.g. 12 Smith St — new dwelling.'); end if;
  perform pg_advisory_xact_lock(hashtext('estimate-ref:' || p_org::text));
  select coalesce(max(nullif(regexp_replace(e.ref, '\D', '', 'g'), '')::int), 0) + 1 into n from estimates e where e.org_id = p_org;
  ref := 'EST-' || lpad(n::text, 3, '0');
  insert into estimates (org_id, ref, name, client, address, markup_pct, valid_until, created_by)
  values (p_org, ref, trim(p ->> 'name'), nullif(trim(coalesce(p ->> 'client', '')), ''), nullif(trim(coalesce(p ->> 'address', '')), ''),
    coalesce(nullif(p ->> 'markup_pct', '')::numeric, 15), coalesce(nullif(p ->> 'valid_until', '')::date, current_date + 30), auth.uid())
  returning id into v;
  update estimates set series_id = v where id = v;
  perform _audit(p_org, null, 'estimate', v::text, 'Estimate started', null, 'draft', ref || ' · ' || trim(p ->> 'name'));
  return jsonb_build_object('id', v, 'message', ref || ' started.');
end $$;

-- Saves the header and replaces the items and quotes of a draft.
create or replace function public.save_estimate(p_estimate uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e estimates := _estimate(p_estimate, true); it jsonb; n int := 0; total bigint;
begin
  if length(trim(coalesce(p ->> 'name', e.name))) = 0 then perform _fail('Name the job.'); end if;
  update estimates set name = trim(coalesce(p ->> 'name', name)), client = nullif(trim(coalesce(p ->> 'client', client, '')), ''), address = nullif(trim(coalesce(p ->> 'address', address, '')), ''),
    markup_pct = coalesce(nullif(p ->> 'markup_pct', '')::numeric, markup_pct), valid_until = coalesce(nullif(p ->> 'valid_until', '')::date, valid_until),
    inclusions = nullif(trim(coalesce(p ->> 'inclusions', inclusions, '')), ''), exclusions = nullif(trim(coalesce(p ->> 'exclusions', exclusions, '')), ''), notes = nullif(trim(coalesce(p ->> 'notes', notes, '')), '')
  where id = e.id;
  if p ? 'items' then
    delete from estimate_items where estimate_id = e.id;
    for it in select * from jsonb_array_elements(p -> 'items') loop
      if length(trim(coalesce(it ->> 'description', ''))) = 0 then continue; end if;
      if length(trim(coalesce(it ->> 'category', ''))) = 0 then perform _fail('Give "' || (it ->> 'description') || '" a category.'); end if;
      if coalesce((it ->> 'qty')::numeric, 0) < 0 or coalesce((it ->> 'rate')::bigint, 0) < 0 then perform _fail('Quantities and rates can''t be negative ("' || (it ->> 'description') || '").'); end if;
      n := n + 1;
      insert into estimate_items (org_id, estimate_id, seq, category, description, qty, unit, rate, qty_formula)
      values (e.org_id, e.id, n, trim(it ->> 'category'), trim(it ->> 'description'), coalesce((it ->> 'qty')::numeric, 0), nullif(trim(coalesce(it ->> 'unit', '')), ''),
        coalesce((it ->> 'rate')::bigint, 0), nullif(trim(coalesce(it ->> 'qty_formula', '')), ''));
    end loop;
  end if;
  if p ? 'quotes' then
    delete from estimate_quotes where estimate_id = e.id;
    for it in select * from jsonb_array_elements(p -> 'quotes') loop
      if length(trim(coalesce(it ->> 'supplier', ''))) = 0 then continue; end if;
      if length(trim(coalesce(it ->> 'category', ''))) = 0 then perform _fail('Say which trade package the quote from ' || (it ->> 'supplier') || ' is for.'); end if;
      if coalesce((it ->> 'amount')::bigint, -1) < 0 then perform _fail('Enter the quote amount from ' || (it ->> 'supplier') || '.'); end if;
      insert into estimate_quotes (org_id, estimate_id, category, supplier, amount, note, selected)
      values (e.org_id, e.id, trim(it ->> 'category'), trim(it ->> 'supplier'), (it ->> 'amount')::bigint, nullif(trim(coalesce(it ->> 'note', '')), ''), coalesce((it ->> 'selected')::boolean, false));
    end loop;
    if exists (select 1 from estimate_quotes where estimate_id = e.id and selected group by category having count(*) > 1) then
      perform _fail('Choose one quote per trade package.');
    end if;
  end if;
  select coalesce(sum(sell), 0) into total from estimate_costs(e.id);
  return jsonb_build_object('message', format('%s saved — %s excl. GST.', e.ref, _money(total)));
end $$;

create or replace function public.estimate_action(p_estimate uuid, p_action text, p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public as $$
declare e estimates := _estimate(p_estimate); v uuid; total bigint; pr jsonb; pid uuid; r record; n int := 0;
begin
  if p_action = 'send' then
    if e.status <> 'draft' then perform _fail('Only a draft can be sent.'); end if;
    if not exists (select 1 from estimate_items where estimate_id = e.id) and not exists (select 1 from estimate_quotes where estimate_id = e.id and selected) then perform _fail('Add some items before sending the quote.'); end if;
    update estimates set status = 'sent', sent_at = now() where id = e.id;
  elsif p_action in ('won','lost') then
    if e.status <> 'sent' then perform _fail('Mark the quote as sent first.'); end if;
    update estimates set status = p_action, decided_at = now(), decision_note = nullif(trim(coalesce(p ->> 'note', '')), '') where id = e.id;
  elsif p_action = 'new_version' then
    if e.status not in ('sent','lost') then perform _fail('Only a sent or lost quote gets a new version — edit the draft instead.'); end if;
    if exists (select 1 from estimates where series_id = e.series_id and status = 'draft') then perform _fail('There''s already a draft version.'); end if;
    insert into estimates (org_id, ref, version, series_id, name, client, address, markup_pct, valid_until, inclusions, exclusions, notes, created_by)
    values (e.org_id, e.ref, (select max(version) + 1 from estimates where series_id = e.series_id), e.series_id, e.name, e.client, e.address, e.markup_pct,
      greatest(e.valid_until, current_date + 30), e.inclusions, e.exclusions, e.notes, auth.uid()) returning id into v;
    insert into estimate_items (org_id, estimate_id, seq, category, description, qty, unit, rate, qty_formula) select org_id, v, seq, category, description, qty, unit, rate, qty_formula from estimate_items where estimate_id = e.id;
    insert into estimate_quotes (org_id, estimate_id, category, supplier, amount, note, selected) select org_id, v, category, supplier, amount, note, selected from estimate_quotes where estimate_id = e.id;
    update estimates set status = 'superseded' where id = e.id;
    perform _audit(e.org_id, null, 'estimate', v::text, 'New estimate version', null, 'draft', e.ref || ' v' || (e.version + 1));
    return jsonb_build_object('id', v, 'message', format('%s v%s started from v%s.', e.ref, (select version from estimates where id = v), e.version));
  elsif p_action = 'convert' then
    if e.status <> 'won' then perform _fail('Mark the quote as won before converting it to a job.'); end if;
    if e.project_id is not null then perform _fail('This estimate is already a job.'); end if;
    select coalesce(sum(sell), 0) into total from estimate_costs(e.id);
    pr := create_project(e.org_id, jsonb_build_object('name', coalesce(nullif(trim(p ->> 'name'), ''), e.name), 'code', p ->> 'code', 'client', e.client, 'address', e.address,
      'contract_sum', total, 'start_date', p ->> 'start_date', 'pc_date', p ->> 'pc_date'));
    pid := (pr ->> 'id')::uuid;
    for r in select * from estimate_costs(e.id) loop
      n := n + 1;
      insert into budget_lines (org_id, project_id, cost_code, description, original_budget) values (e.org_id, pid, lpad(n::text, 2, '0'), r.category, r.cost);
      insert into contract_items (org_id, project_id, seq, description, value) values (e.org_id, pid, n, r.category, r.sell);
    end loop;
    update estimates set project_id = pid where id = e.id;
    perform _audit(e.org_id, pid, 'estimate', e.id::text, 'Estimate converted to a job', null, null, e.ref || ' v' || e.version || ' · ' || _money(total));
    return jsonb_build_object('id', pid, 'message', format('Job created from %s: contract sum %s, %s budget lines and claim items.', e.ref, _money(total), n));
  else
    perform _fail('Unknown action.');
  end if;
  select * into e from estimates where id = p_estimate;
  perform _audit(e.org_id, null, 'estimate', e.id::text, 'Estimate ' || e.status, null, e.status, e.ref || ' v' || e.version);
  return jsonb_build_object('message', format('%s v%s %s.', e.ref, e.version, case e.status when 'sent' then 'marked as sent' else 'marked as ' || e.status end));
end $$;

create or replace function public.save_assembly(p_org uuid, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid; c jsonb;
begin
  perform _require(p_org, 'estimate.manage');
  if length(trim(coalesce(p ->> 'name', ''))) = 0 then perform _fail('Name the assembly, e.g. Stud wall per m².'); end if;
  for c in select * from jsonb_array_elements(coalesce(p -> 'components', '[]')) loop
    if length(trim(coalesce(c ->> 'description', ''))) = 0 then perform _fail('Every component needs a description.'); end if;
    if coalesce((c ->> 'qty')::numeric, -1) < 0 or coalesce((c ->> 'rate')::bigint, -1) < 0 then perform _fail('Check the quantity and rate for ' || (c ->> 'description') || '.'); end if;
  end loop;
  if jsonb_array_length(coalesce(p -> 'components', '[]')) = 0 then perform _fail('Add at least one component.'); end if;
  if p_id is null then
    insert into assemblies (org_id, name, unit, category, components) values (p_org, trim(p ->> 'name'), coalesce(nullif(trim(p ->> 'unit'), ''), 'each'), nullif(trim(coalesce(p ->> 'category', '')), ''), p -> 'components') returning id into v;
  else
    update assemblies set name = trim(p ->> 'name'), unit = coalesce(nullif(trim(p ->> 'unit'), ''), 'each'), category = nullif(trim(coalesce(p ->> 'category', '')), ''), components = p -> 'components',
      archived = coalesce((p ->> 'archived')::boolean, archived) where id = p_id and org_id = p_org returning id into v;
    if v is null then perform _fail('Assembly not found.'); end if;
  end if;
  return jsonb_build_object('id', v, 'message', trim(p ->> 'name') || ' saved.');
end $$;

-- -------------------------------------------------------------- handover
create or replace function public.issue_handover(p_project uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects; v uuid; dm int := coalesce(nullif(p ->> 'dlp_months', '')::int, 12); od int; oi int; on_ int; outst jsonb;
begin
  select * into pr from projects where id = p_project;
  if not found then perform _fail('Project not found.'); end if;
  perform _require(pr.org_id, 'project.manage');
  if length(trim(coalesce(p ->> 'recipient', ''))) = 0 then perform _fail('Who is the pack going to (e.g. the client''s representative)?'); end if;
  if dm < 0 or dm > 120 then perform _fail('The defects liability period is 0 to 120 months.'); end if;
  select count(*) into od from defects where project_id = pr.id and status not in ('closed','draft');
  select count(*) into oi from itp_points x join itps i on i.id = x.itp_id where i.project_id = pr.id and x.status <> 'released';
  select count(*) into on_ from ncrs where project_id = pr.id and status <> 'closed';
  if od + oi + on_ > 0 and not coalesce((p ->> 'accept_outstanding')::boolean, false) then
    perform _fail(format('There are %s open defects, %s unreleased inspection points and %s open NCRs. Tick that they''re listed as outstanding to issue the pack anyway.', od, oi, on_));
  end if;
  outst := jsonb_build_object('defects', (select coalesce(jsonb_agg(jsonb_build_object('ref', ref, 'title', title, 'status', status)), '[]') from defects where project_id = pr.id and status not in ('closed','draft')),
    'itp_points', oi, 'ncrs', on_);
  insert into handovers (org_id, project_id, issued_by, recipient, dlp_months, dlp_end, outstanding, note)
  values (pr.org_id, pr.id, auth.uid(), trim(p ->> 'recipient'), dm, (current_date + make_interval(months => dm))::date, outst, nullif(trim(coalesce(p ->> 'note', '')), ''))
  returning id into v;
  update projects set status = case when dm > 0 then 'dlp' else 'handover' end where id = pr.id;
  perform _audit(pr.org_id, pr.id, 'handover', v::text, 'Handover pack issued', pr.status, case when dm > 0 then 'dlp' else 'handover' end,
    trim(p ->> 'recipient') || ' · ' || od || ' defects outstanding · DLP ' || dm || ' months');
  return jsonb_build_object('id', v, 'message', format('Handover pack issued to %s. Defects liability period runs to %s.', trim(p ->> 'recipient'), to_char((current_date + make_interval(months => dm))::date, 'FMDD Mon YYYY')));
end $$;

-- ---------------------------------------------------------------- grants
do $$
declare f text;
begin
  foreach f in array array['public.create_estimate(uuid, jsonb)', 'public.save_estimate(uuid, jsonb)', 'public.estimate_action(uuid, text, jsonb)',
    'public.save_assembly(uuid, uuid, jsonb)', 'public.issue_handover(uuid, jsonb)', 'public.estimate_costs(uuid)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  execute 'revoke execute on function public._estimate(uuid, boolean) from public, anon, authenticated';
end $$;
grant execute on function public.role_can(text, text) to anon, authenticated;
