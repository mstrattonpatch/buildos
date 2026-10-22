-- =====================================================================
-- SWMS workflow (blueprint §6.4)
--
--  * Each version is its own row; versions of one SWMS share a series_id.
--  * A revision is reviewed before it replaces the current version. The
--    approved version stays in force (and keeps controlling site sign-in)
--    until the revision is approved, then it's marked superseded.
--  * A revision either requires every worker to acknowledge again (the
--    default) or, for minor changes, carries acknowledgements forward.
--  * Subcontractor admins can only submit for their own company.
-- =====================================================================

create or replace function public.role_can(p_role text, p_perm text) returns boolean
language sql immutable as $$
  select case p_role
    when 'director' then p_perm = any (array['defect.create','defect.assign','defect.verify','itp.release_hold','itp.manage','itp.submit','swms.submit','variation.create','variation.approve','swms.review','commercial.view','diary.submit','people.manage','project.manage'])
    when 'project_manager' then p_perm = any (array['defect.create','defect.assign','defect.verify','itp.release_hold','itp.manage','itp.submit','swms.submit','variation.create','variation.approve','swms.review','commercial.view','diary.submit','people.manage','project.manage'])
    when 'site_supervisor' then p_perm = any (array['defect.create','defect.assign','defect.verify','itp.submit','swms.submit','swms.review','diary.submit','people.manage'])
    when 'quality_manager' then p_perm = any (array['defect.create','defect.assign','defect.verify','itp.release_hold','itp.manage','itp.submit'])
    when 'subcontractor_admin' then p_perm = any (array['defect.rectify','variation.create','itp.submit','swms.submit'])
    when 'worker' then p_perm = any (array['defect.create'])
    else false end;
$$;

alter table public.swms
  add column if not exists series_id uuid,
  add column if not exists hazards jsonb not null default '[]',
  add column if not exists file_path text,
  add column if not exists notes text,
  add column if not exists requires_reack boolean not null default true,
  add column if not exists submitted_by uuid,
  add column if not exists submitted_at timestamptz not null default now(),
  add column if not exists reviewed_by uuid,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_comment text,
  add column if not exists review_due date;
update public.swms set series_id = id where series_id is null;
create index if not exists swms_series on public.swms (series_id, version);

alter table public.swms drop constraint if exists swms_status_check;
alter table public.swms add constraint swms_status_check check (status in ('submitted','in_review','approved','changes_requested','superseded'));

-- Rows loaded without a series (e.g. sample data) start their own.
create or replace function public._swms_series() returns trigger language plpgsql as $$
begin new.series_id := coalesce(new.series_id, new.id); return new; end $$;
drop trigger if exists swms_series_default on public.swms;
create trigger swms_series_default before insert on public.swms for each row execute function public._swms_series();

-- Private storage for SWMS and other documents: "<org_id>/<file>".
insert into storage.buckets (id, name, public) values ('documents', 'documents', false) on conflict (id) do nothing;
create policy "members upload documents" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "members read documents" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and public.is_member(((storage.foldername(name))[1])::uuid));

-- ---------------------------------------------------------- validation
create or replace function public._swms_content(p jsonb) returns jsonb
language plpgsql as $$
declare hz jsonb := '[]'; h jsonb;
begin
  if length(trim(coalesce(p ->> 'title', ''))) = 0 then perform _fail('Name the SWMS, e.g. "Concrete placement".'); end if;
  if length(trim(coalesce(p ->> 'activity', ''))) = 0 then perform _fail('Describe the work activity.'); end if;
  for h in select * from jsonb_array_elements(coalesce(p -> 'hazards', '[]')) loop
    if length(trim(coalesce(h ->> 'hazard', ''))) > 0 then
      if length(trim(coalesce(h ->> 'controls', ''))) = 0 then perform _fail(format('Add the controls for "%s".', trim(h ->> 'hazard'))); end if;
      hz := hz || jsonb_build_object('hazard', trim(h ->> 'hazard'), 'controls', trim(h ->> 'controls'), 'responsible', nullif(trim(coalesce(h ->> 'responsible', '')), ''));
    end if;
  end loop;
  if jsonb_array_length(hz) = 0 then perform _fail('List at least one hazard and its controls.'); end if;
  return hz;
end $$;

create or replace function public._swms_link_tasks(p_project uuid, p_swms uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  for tid in select (jsonb_array_elements_text(coalesce(p -> 'task_ids', '[]')))::uuid loop
    if not exists (select 1 from tasks where id = tid and project_id = p_project) then perform _fail('Linked tasks must be on this project.'); end if;
    update tasks set swms_id = p_swms where id = tid;
  end loop;
end $$;

-- ------------------------------------------------------------- submit
create or replace function public.submit_swms(p_project uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects; m memberships; hz jsonb; con uuid; n int; v uuid; ref text;
begin
  select * into pr from projects where id = p_project;
  if not found then perform _fail('Project not found.'); end if;
  m := _require(pr.org_id, 'swms.submit');
  hz := _swms_content(p);
  -- Subcontractors submit for their own company only.
  con := case when m.role = 'subcontractor_admin' then m.contractor_id else nullif(p ->> 'contractor_id', '')::uuid end;
  if con is null then perform _fail('Choose the contractor this SWMS is for.'); end if;
  if not exists (select 1 from contractors where id = con and org_id = pr.org_id) then perform _fail('Contractor not found.'); end if;
  perform pg_advisory_xact_lock(hashtext('swms-ref:' || pr.id::text));
  select coalesce(max(nullif(regexp_replace(s.ref, '\D', '', 'g'), '')::int), 0) + 1 into n from swms s where s.project_id = pr.id;
  ref := 'SWMS-' || lpad(n::text, 2, '0');
  insert into swms (org_id, project_id, ref, title, activity, contractor_id, version, status, high_risk_categories, hazards, file_path, notes, submitted_by)
  values (pr.org_id, pr.id, ref, trim(p ->> 'title'), trim(p ->> 'activity'), con, 1, 'submitted',
    coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'high_risk_categories', '[]'))), '{}'), hz,
    nullif(p ->> 'file_path', ''), nullif(trim(coalesce(p ->> 'notes', '')), ''), auth.uid())
  returning id into v;
  update swms set series_id = v where id = v;
  perform _swms_link_tasks(pr.id, v, p);
  perform _audit(pr.org_id, pr.id, 'swms', v::text, 'SWMS submitted', null, 'submitted', ref || ' v1 · ' || trim(p ->> 'title'));
  return jsonb_build_object('id', v, 'message', ref || ' submitted for review.');
end $$;

-- A revision is a new version in the same series, awaiting review.
create or replace function public.revise_swms(p_swms uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s swms; m memberships; hz jsonb; nv int; v uuid;
begin
  select * into s from swms where id = p_swms;
  if not found then perform _fail('SWMS not found.'); end if;
  m := _require(s.org_id, 'swms.submit');
  if m.role = 'subcontractor_admin' and m.contractor_id is distinct from s.contractor_id then perform _fail('You can only revise your own company''s SWMS.'); end if;
  if s.status = 'superseded' then perform _fail('That version has been superseded — revise the current one.'); end if;
  if exists (select 1 from swms where series_id = s.series_id and status in ('submitted','in_review') and id <> s.id) then
    perform _fail('A revision is already waiting for review.');
  end if;
  hz := _swms_content(p);
  select max(version) + 1 into nv from swms where series_id = s.series_id;
  -- A revision of a version that was never approved replaces it in the queue.
  if s.status in ('submitted','in_review','changes_requested') then update swms set status = 'superseded' where id = s.id; end if;
  insert into swms (org_id, project_id, series_id, ref, title, activity, contractor_id, version, status, high_risk_categories, hazards, file_path, notes, requires_reack, submitted_by)
  values (s.org_id, s.project_id, s.series_id, s.ref, trim(p ->> 'title'), trim(p ->> 'activity'), s.contractor_id, nv, 'submitted',
    coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'high_risk_categories', '[]'))), '{}'), hz,
    coalesce(nullif(p ->> 'file_path', ''), s.file_path), nullif(trim(coalesce(p ->> 'notes', '')), ''), coalesce((p ->> 'requires_reack')::boolean, true), auth.uid())
  returning id into v;
  perform _swms_link_tasks(s.project_id, v, p);
  update tasks set swms_id = v where swms_id = s.id;
  perform _audit(s.org_id, s.project_id, 'swms', v::text, 'SWMS revision submitted', null, 'submitted',
    format('%s v%s%s', s.ref, nv, case when coalesce((p ->> 'requires_reack')::boolean, true) then ' — workers must acknowledge again' else ' — minor change, acknowledgements carry over' end));
  return jsonb_build_object('id', v, 'message', format('%s v%s submitted for review.', s.ref, nv));
end $$;

-- -------------------------------------------------------------- review
create or replace function public.swms_review(p_swms uuid, p_decision text, p_comment text default '', p_review_months int default 12) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s swms; prev swms; carried int := 0;
begin
  select * into s from swms where id = p_swms for update;
  if not found then perform _fail('SWMS not found.'); end if;
  perform _require(s.org_id, 'swms.review');
  if s.status not in ('submitted','in_review') then perform _fail('This SWMS isn''t awaiting review.'); end if;
  if p_decision = 'changes' then
    if length(trim(coalesce(p_comment, ''))) = 0 then perform _fail('Say what needs to change.'); end if;
    update swms set status = 'changes_requested', reviewed_by = auth.uid(), reviewed_at = now(), review_comment = trim(p_comment) where id = s.id;
    perform _audit(s.org_id, s.project_id, 'swms', s.id::text, 'SWMS changes requested', s.status, 'changes_requested', s.ref || ' v' || s.version || ' — ' || trim(p_comment));
    return jsonb_build_object('message', s.ref || ' v' || s.version || ' returned for changes.');
  elsif p_decision = 'approve' then
    select * into prev from swms where series_id = s.series_id and status = 'approved' and id <> s.id order by version desc limit 1;
    update swms set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), review_comment = nullif(trim(coalesce(p_comment, '')), ''),
      review_due = case when coalesce(p_review_months, 0) > 0 then (current_date + make_interval(months => p_review_months))::date end
    where id = s.id;
    if prev.id is not null then
      update swms set status = 'superseded' where id = prev.id;
      if not s.requires_reack then
        insert into swms_acks (org_id, swms_id, worker_id, acknowledged_at)
        select org_id, s.id, worker_id, acknowledged_at from swms_acks where swms_id = prev.id on conflict do nothing;
        get diagnostics carried = row_count;
      end if;
    end if;
    perform _audit(s.org_id, s.project_id, 'swms', s.id::text, 'SWMS approved', s.status, 'approved',
      s.ref || ' v' || s.version || case when prev.id is not null then ' replaces v' || prev.version ||
        case when s.requires_reack then ' — workers must acknowledge again' else format(' — %s acknowledgements carried over', carried) end else '' end);
    return jsonb_build_object('message', s.ref || ' v' || s.version || ' approved' ||
      case when prev.id is not null and s.requires_reack then '. Workers must acknowledge the new version before signing in.' else '.' end);
  end if;
  perform _fail('Unknown decision.');
end $$;

create or replace function public.swms_acknowledge(p_swms uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s swms; m memberships; w workers;
begin
  select * into s from swms where id = p_swms;
  if not found then perform _fail('SWMS not found.'); end if;
  m := _me(s.org_id);
  if m.worker_id is null then perform _fail('Only workers acknowledge a SWMS.'); end if;
  if s.status = 'superseded' then perform _fail('There''s a newer version of this SWMS — acknowledge that one.'); end if;
  if s.status <> 'approved' then perform _fail('This SWMS isn''t approved yet.'); end if;
  select * into w from workers where id = m.worker_id;
  if w.contractor_id is distinct from s.contractor_id then perform _fail('This SWMS is for another company''s work.'); end if;
  insert into swms_acks (org_id, swms_id, worker_id) values (s.org_id, s.id, m.worker_id) on conflict do nothing;
  perform _audit(s.org_id, s.project_id, 'swms', s.id::text, 'SWMS acknowledged', null, null, s.ref || ' v' || s.version || ' · ' || w.name);
  return jsonb_build_object('message', 'Acknowledged ' || s.title || ' v' || s.version || '.');
end $$;

drop function if exists public.swms_review(uuid, text, text);

do $$
declare f text;
begin
  foreach f in array array['public._swms_content(jsonb)', 'public._swms_link_tasks(uuid, uuid, jsonb)', 'public.submit_swms(uuid, jsonb)',
    'public.revise_swms(uuid, jsonb)', 'public.swms_review(uuid, text, text, integer)', 'public.swms_acknowledge(uuid)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
grant execute on function public.role_can(text, text) to anon, authenticated;
-- Internal helper (used by site_sign_in); not callable from the app.
revoke execute on function public.site_blockers(uuid, uuid) from public, anon, authenticated;
