-- =====================================================================
-- Inspection & Test Plans (blueprint §4.3–4.5)
--
--  * Company templates are versioned. Applying one copies its points into
--    the project, so later template edits never change an active ITP.
--  * Points are completed in order: nothing after an unreleased hold point
--    can be submitted ("work must not proceed").
--  * Each point needs its minimum photos (and measurement, if set).
--  * Sign-off can need one or two authorised people; whoever submitted a
--    hold or witness point can't also release it.
--  * Rejecting a point raises a defect against the work; rejecting a hold
--    point also flags the linked programme task as blocked.
-- =====================================================================

-- Permissions gain itp.manage (templates, adding ITPs) and itp.submit (completing points).
create or replace function public.role_can(p_role text, p_perm text) returns boolean
language sql immutable as $$
  select case p_role
    when 'director' then p_perm = any (array['defect.create','defect.assign','defect.verify','itp.release_hold','itp.manage','itp.submit','variation.create','variation.approve','swms.review','commercial.view','diary.submit','people.manage','project.manage'])
    when 'project_manager' then p_perm = any (array['defect.create','defect.assign','defect.verify','itp.release_hold','itp.manage','itp.submit','variation.create','variation.approve','swms.review','commercial.view','diary.submit','people.manage','project.manage'])
    when 'site_supervisor' then p_perm = any (array['defect.create','defect.assign','defect.verify','itp.submit','swms.review','diary.submit','people.manage'])
    when 'quality_manager' then p_perm = any (array['defect.create','defect.assign','defect.verify','itp.release_hold','itp.manage','itp.submit'])
    when 'subcontractor_admin' then p_perm = any (array['defect.rectify','variation.create','itp.submit'])
    when 'worker' then p_perm = any (array['defect.create'])
    else false end;
$$;

-- ------------------------------------------------------------- tables
create table public.itp_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  name text not null,
  trade text,
  description text,
  version int not null default 1,
  archived boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.itp_template_points (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  template_id uuid not null references public.itp_templates (id) on delete cascade,
  seq int not null,
  name text not null,
  check_text text,
  type text not null check (type in ('hold','witness','inspection','test','review')),
  evidence_required int not null default 0 check (evidence_required between 0 and 10),
  measurement_label text,
  required_signoffs int not null default 1 check (required_signoffs between 1 and 2)
);

alter table public.itps
  add column if not exists template_id uuid references public.itp_templates (id) on delete set null,
  add column if not exists created_at timestamptz not null default now();

alter table public.itp_points drop constraint if exists itp_points_type_check;
alter table public.itp_points add constraint itp_points_type_check check (type in ('hold','witness','inspection','test','review'));
alter table public.itp_points
  add column if not exists evidence_required int not null default 0,
  add column if not exists measurement_label text,
  add column if not exists measurement_value text,
  add column if not exists required_signoffs int not null default 1,
  add column if not exists photos text[] not null default '{}',
  add column if not exists submit_note text,
  add column if not exists submitted_by uuid,
  add column if not exists submitted_at timestamptz;

create table public.itp_signoffs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  point_id uuid not null references public.itp_points (id) on delete cascade,
  user_id uuid not null,
  role text not null,
  decision text not null check (decision in ('approve','reject')),
  comment text,
  at timestamptz not null default now()
);
create index on public.itp_signoffs (point_id, at);

alter table public.itp_templates enable row level security;
alter table public.itp_template_points enable row level security;
alter table public.itp_signoffs enable row level security;
create policy "members read" on public.itp_templates for select using (is_member(org_id));
create policy "members read" on public.itp_template_points for select using (is_member(org_id));
create policy "members read" on public.itp_signoffs for select using (is_member(org_id));
grant select on public.itp_templates, public.itp_template_points, public.itp_signoffs to authenticated;

-- ------------------------------------------------------ point validation
create or replace function public._template_points(p_org uuid, p_template uuid, p_points jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare pt jsonb; n int := 0;
begin
  if jsonb_typeof(p_points) <> 'array' or jsonb_array_length(p_points) = 0 then perform _fail('Add at least one inspection point.'); end if;
  for pt in select * from jsonb_array_elements(p_points) loop
    if length(trim(coalesce(pt ->> 'name', ''))) = 0 then perform _fail(format('Point %s needs a name.', n + 1)); end if;
    if coalesce(pt ->> 'type', '') not in ('hold','witness','inspection','test','review') then perform _fail(format('Choose a type for "%s".', pt ->> 'name')); end if;
    insert into itp_template_points (org_id, template_id, seq, name, check_text, type, evidence_required, measurement_label, required_signoffs)
    values (p_org, p_template, n, trim(pt ->> 'name'), nullif(trim(coalesce(pt ->> 'check_text', '')), ''), pt ->> 'type',
      least(10, greatest(0, coalesce((pt ->> 'evidence_required')::int, 0))), nullif(trim(coalesce(pt ->> 'measurement_label', '')), ''),
      least(2, greatest(1, coalesce((pt ->> 'required_signoffs')::int, 1))));
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------- templates
create or replace function public.create_itp_template(p_org uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid; n int;
begin
  perform _require(p_org, 'itp.manage');
  if length(trim(coalesce(p ->> 'name', ''))) = 0 then perform _fail('Name the template, e.g. "Concrete slab".'); end if;
  if exists (select 1 from itp_templates where org_id = p_org and lower(name) = lower(trim(p ->> 'name')) and not archived) then perform _fail('A template with that name already exists.'); end if;
  insert into itp_templates (org_id, name, trade, description, created_by)
  values (p_org, trim(p ->> 'name'), nullif(trim(coalesce(p ->> 'trade', '')), ''), nullif(trim(coalesce(p ->> 'description', '')), ''), auth.uid())
  returning id into v;
  n := _template_points(p_org, v, p -> 'points');
  perform _audit(p_org, null, 'itp_template', v::text, 'ITP template created', null, 'v1', trim(p ->> 'name') || ' · ' || n || ' points');
  return jsonb_build_object('id', v, 'message', format('Template "%s" created with %s points.', trim(p ->> 'name'), n));
end $$;

-- Saving changes bumps the version. ITPs already on projects keep their copy.
create or replace function public.update_itp_template(p_template uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t itp_templates; n int;
begin
  select * into t from itp_templates where id = p_template for update;
  if not found then perform _fail('Template not found.'); end if;
  perform _require(t.org_id, 'itp.manage');
  if length(trim(coalesce(p ->> 'name', ''))) = 0 then perform _fail('Name the template.'); end if;
  delete from itp_template_points where template_id = t.id;
  n := _template_points(t.org_id, t.id, p -> 'points');
  update itp_templates set name = trim(p ->> 'name'), trade = nullif(trim(coalesce(p ->> 'trade', '')), ''),
    description = nullif(trim(coalesce(p ->> 'description', '')), ''), version = version + 1, updated_at = now() where id = t.id;
  perform _audit(t.org_id, null, 'itp_template', t.id::text, 'ITP template revised', 'v' || t.version, 'v' || (t.version + 1), n || ' points');
  return jsonb_build_object('message', format('Saved as version %s. ITPs already on projects are unchanged.', t.version + 1));
end $$;

create or replace function public.archive_itp_template(p_template uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t itp_templates;
begin
  select * into t from itp_templates where id = p_template;
  if not found then perform _fail('Template not found.'); end if;
  perform _require(t.org_id, 'itp.manage');
  update itp_templates set archived = true, updated_at = now() where id = t.id;
  perform _audit(t.org_id, null, 'itp_template', t.id::text, 'ITP template archived', null, null, t.name);
  return jsonb_build_object('message', t.name || ' archived. Existing ITPs are unaffected.');
end $$;

-- ----------------------------------------------- add an ITP to a project
create or replace function public.apply_itp_template(p_template uuid, p_project uuid, p_task uuid default null, p_title text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t itp_templates; pr projects; tk tasks; v uuid; n int; ref text;
begin
  select * into t from itp_templates where id = p_template and not archived;
  if not found then perform _fail('Template not found.'); end if;
  select * into pr from projects where id = p_project and org_id = t.org_id;
  if not found then perform _fail('Project not found.'); end if;
  perform _require(pr.org_id, 'itp.manage');
  if p_task is not null then
    select * into tk from tasks where id = p_task and project_id = pr.id;
    if not found then perform _fail('That task isn''t on this project.'); end if;
  end if;
  perform pg_advisory_xact_lock(hashtext('itp-ref:' || pr.id::text));
  select coalesce(max(nullif(regexp_replace(i.ref, '\D', '', 'g'), '')::int), 0) + 1 into n from itps i where i.project_id = pr.id;
  ref := 'ITP-' || lpad(n::text, 2, '0');
  insert into itps (org_id, project_id, ref, title, template_version, task_id, template_id)
  values (pr.org_id, pr.id, ref, coalesce(nullif(trim(coalesce(p_title, '')), ''), t.name || coalesce(' — ' || tk.name, '')), t.version, p_task, t.id)
  returning id into v;
  insert into itp_points (org_id, itp_id, seq, name, check_text, type, status, evidence, evidence_required, measurement_label, required_signoffs)
  select pr.org_id, v, seq, name, check_text, type, 'pending', 0, evidence_required, measurement_label, required_signoffs
  from itp_template_points where template_id = t.id order by seq;
  if p_task is not null then update tasks set itp_id = v where id = p_task and itp_id is null; end if;
  perform _audit(pr.org_id, pr.id, 'itp', v::text, 'ITP added', null, null, ref || ' from ' || t.name || ' v' || t.version);
  return jsonb_build_object('id', v, 'message', ref || ' added from ' || t.name || ' v' || t.version || '.');
end $$;

-- ---------------------------------------------------- complete a point
create or replace function public.submit_itp_point(p_point uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pt itp_points; i itps; blocker itp_points; v_photos text[]; meas text := nullif(trim(coalesce(p ->> 'measurement', '')), '');
begin
  select * into pt from itp_points where id = p_point for update;
  if not found then perform _fail('Inspection point not found.'); end if;
  select * into i from itps where id = pt.itp_id;
  perform _require(pt.org_id, 'itp.submit');
  if pt.status not in ('pending','rejected') then perform _fail('This point is already ' || pt.status || '.'); end if;
  -- Work must not proceed past an unreleased hold point.
  select * into blocker from itp_points where itp_id = pt.itp_id and type = 'hold' and seq < pt.seq and status <> 'released' order by seq limit 1;
  if found then perform _fail(format('Hold point "%s" must be released before this can be submitted.', blocker.name)); end if;
  v_photos := coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'photos', '[]'::jsonb))), '{}');
  if cardinality(v_photos) < pt.evidence_required then
    perform _fail(format('Add at least %s photo%s as evidence.', pt.evidence_required, case when pt.evidence_required = 1 then '' else 's' end));
  end if;
  if pt.measurement_label is not null and meas is null then perform _fail(format('Record the measurement: %s.', pt.measurement_label)); end if;
  update itp_points set status = 'submitted', photos = v_photos, evidence = cardinality(v_photos), measurement_value = meas,
    submit_note = nullif(trim(coalesce(p ->> 'note', '')), ''), submitted_by = auth.uid(), submitted_at = now()
  where id = pt.id;
  perform _audit(pt.org_id, i.project_id, 'itp_point', i.id::text, 'Inspection submitted', pt.status, 'submitted',
    i.ref || ' · ' || pt.name || ' · ' || cardinality(v_photos) || ' photos' || coalesce(' · ' || pt.measurement_label || ' ' || meas, ''));
  return jsonb_build_object('message', i.ref || ' ' || pt.name || ': submitted for sign-off.');
end $$;

-- Sign-off: one or two approvals release the point; any rejection sends it back.
create or replace function public.itp_point_action(p_point uuid, p_decision text, p_comment text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare pt itp_points; i itps; m memberships; approvals int; tk tasks; dn int; dref text;
begin
  select * into pt from itp_points where id = p_point for update;
  if not found then perform _fail('Inspection point not found.'); end if;
  select * into i from itps where id = pt.itp_id;
  m := _me(pt.org_id);
  if pt.type in ('hold','witness') then
    if not role_can(m.role, 'itp.release_hold') then perform _fail(format('Your role (%s) can''t sign off hold or witness points.', replace(m.role, '_', ' '))); end if;
    if pt.submitted_by = auth.uid() then perform _fail('You submitted this point — another authorised person must sign it off.'); end if;
  elsif not (role_can(m.role, 'itp.release_hold') or role_can(m.role, 'defect.verify')) then
    perform _fail(format('Your role (%s) can''t sign off inspections.', replace(m.role, '_', ' ')));
  end if;
  if pt.status <> 'submitted' then perform _fail('Only a submitted point can be released or rejected.'); end if;
  if exists (select 1 from itp_signoffs where point_id = pt.id and user_id = auth.uid() and at >= coalesce(pt.submitted_at, '-infinity')) then
    perform _fail('You''ve already signed this off — it needs a second person.');
  end if;

  if p_decision = 'release' then
    if pt.evidence = 0 and pt.evidence_required > 0 then perform _fail('No evidence attached — can''t release.'); end if;
    insert into itp_signoffs (org_id, point_id, user_id, role, decision, comment) values (pt.org_id, pt.id, auth.uid(), m.role, 'approve', nullif(trim(coalesce(p_comment, '')), ''));
    select count(*) into approvals from itp_signoffs where point_id = pt.id and decision = 'approve' and at >= coalesce(pt.submitted_at, '-infinity');
    if approvals < pt.required_signoffs then
      perform _audit(pt.org_id, i.project_id, 'itp_point', i.id::text, 'Sign-off recorded', null, null, format('%s · %s — %s of %s', i.ref, pt.name, approvals, pt.required_signoffs));
      return jsonb_build_object('message', format('Signed off (%s of %s). One more authorised person needs to sign.', approvals, pt.required_signoffs));
    end if;
    update itp_points set status = 'released', released_by = auth.uid(), released_at = now() where id = pt.id;
    -- Quality acceptance ≠ physical progress: unblock the task, don't complete it.
    update tasks set status = case when progress > 0 then 'in_progress' else 'not_started' end where id = i.task_id and status = 'blocked'
      and not exists (select 1 from itp_points x where x.itp_id = i.id and x.type = 'hold' and x.status <> 'released');
    perform _audit(pt.org_id, i.project_id, 'itp_point', i.id::text, case when pt.type = 'hold' then 'Hold point released' else 'Inspection accepted' end,
      'submitted', 'released', i.ref || ' · ' || pt.name || coalesce(' — ' || nullif(trim(p_comment), ''), ''));
    return jsonb_build_object('message', i.ref || ' ' || pt.name || ': released.');
  elsif p_decision = 'reject' then
    if length(trim(coalesce(p_comment, ''))) = 0 then perform _fail('Give a reason for rejecting.'); end if;
    insert into itp_signoffs (org_id, point_id, user_id, role, decision, comment) values (pt.org_id, pt.id, auth.uid(), m.role, 'reject', trim(p_comment));
    update itp_points set status = 'rejected' where id = pt.id;
    -- A failed inspection raises a defect against the work and, for a hold point, flags the task.
    if i.task_id is not null then select * into tk from tasks where id = i.task_id; end if;
    perform pg_advisory_xact_lock(hashtext('defect-ref:' || i.project_id::text));
    select coalesce(max(nullif(regexp_replace(ref, '\D', '', 'g'), '')::int), 0) + 1 into dn from defects where project_id = i.project_id;
    dref := 'DEF-' || lpad(dn::text, 4, '0');
    insert into defects (org_id, project_id, ref, title, description, category, trade, contractor_id, priority, status, raised_by, itp_id, task_id)
    values (pt.org_id, i.project_id, dref, left(i.ref || ' ' || pt.name || ' failed: ' || trim(p_comment), 200), trim(p_comment), 'Failed inspection',
      coalesce(tk.trade, 'General'), tk.contractor_id, case when pt.type = 'hold' then 'high' else 'medium' end, 'open', auth.uid(), i.id, tk.id);
    if pt.type = 'hold' and tk.id is not null and tk.status <> 'complete' then
      update tasks set status = 'blocked' where id = tk.id;
      perform _audit(pt.org_id, i.project_id, 'task', tk.id::text, 'Task blocked', tk.status, 'blocked', i.ref || ' hold point rejected');
    end if;
    perform _audit(pt.org_id, i.project_id, 'itp_point', i.id::text, 'Inspection rejected', 'submitted', 'rejected', i.ref || ' · ' || pt.name || ' — ' || trim(p_comment) || ' · ' || dref || ' raised');
    return jsonb_build_object('message', format('%s %s rejected — %s raised%s.', i.ref, pt.name, dref, case when pt.type = 'hold' and tk.id is not null then ' and task flagged' else '' end));
  end if;
  perform _fail('Unknown decision.');
end $$;

do $$
declare f text;
begin
  foreach f in array array['public._template_points(uuid, uuid, jsonb)', 'public.create_itp_template(uuid, jsonb)', 'public.update_itp_template(uuid, jsonb)',
    'public.archive_itp_template(uuid)', 'public.apply_itp_template(uuid, uuid, uuid, text)', 'public.submit_itp_point(uuid, jsonb)',
    'public.itp_point_action(uuid, text, text)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
grant execute on function public.role_can(text, text) to anon, authenticated;
