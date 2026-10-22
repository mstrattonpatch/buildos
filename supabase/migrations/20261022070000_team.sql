-- =====================================================================
-- Team chat & phone tasks (blueprint §6.6)
--
--  * Project chat for everyone in the company, with photos. Task events
--    post a line in the chat so the team sees what's been handed out.
--  * Tasks are given to a person (they show on their phone), optionally
--    linked to a defect or ITP point. Open → done (note + photos) →
--    accepted, or sent back with a note. The person who did the work
--    can't accept their own task.
--  * Site notes: anyone sends a note and photos for the day's site diary;
--    a supervisor accepts them into the record or dismisses them.
-- =====================================================================

create or replace function public.role_can(p_role text, p_perm text) returns boolean
language sql immutable as $$
  select case p_role
    when 'director' then p_perm = any (array['defect.create','defect.assign','defect.verify','itp.release_hold','itp.manage','itp.submit','swms.submit','variation.create','variation.approve','swms.review','commercial.view','diary.submit','people.manage','project.manage','documents.upload','documents.approve','ncr.manage','permit.request','permit.approve','safety.report','safety.manage','attendance.manage','timesheet.submit','timesheet.approve','timesheet.process','rates.manage','task.assign'])
    when 'project_manager' then p_perm = any (array['defect.create','defect.assign','defect.verify','itp.release_hold','itp.manage','itp.submit','swms.submit','variation.create','variation.approve','swms.review','commercial.view','diary.submit','people.manage','project.manage','documents.upload','documents.approve','ncr.manage','permit.request','permit.approve','safety.report','safety.manage','attendance.manage','timesheet.submit','timesheet.approve','timesheet.process','rates.manage','task.assign'])
    when 'site_supervisor' then p_perm = any (array['defect.create','defect.assign','defect.verify','itp.submit','swms.submit','swms.review','diary.submit','people.manage','documents.upload','ncr.manage','permit.request','permit.approve','safety.report','safety.manage','attendance.manage','timesheet.submit','timesheet.approve','task.assign'])
    when 'quality_manager' then p_perm = any (array['defect.create','defect.assign','defect.verify','itp.release_hold','itp.manage','itp.submit','documents.upload','documents.approve','ncr.manage','safety.report','task.assign'])
    when 'subcontractor_admin' then p_perm = any (array['defect.rectify','variation.create','itp.submit','swms.submit','documents.upload','permit.request','safety.report','timesheet.submit'])
    when 'worker' then p_perm = any (array['defect.create','permit.request','safety.report','timesheet.submit'])
    else false end;
$$;

-- ---------------------------------------------------------------- tables
create table public.site_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  ref text not null,
  title text not null,
  details text,
  assignee_id uuid not null,
  due_date date,
  photos_required int not null default 0 check (photos_required between 0 and 10),
  defect_id uuid references public.defects (id) on delete set null,
  itp_point_id uuid references public.itp_points (id) on delete set null,
  status text not null default 'open' check (status in ('open','submitted','accepted','cancelled')),
  created_by uuid,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  submit_note text,
  evidence text[] not null default '{}',
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  sent_back int not null default 0,
  unique (project_id, ref)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  author_id uuid,
  body text not null default '',
  photos text[] not null default '{}',
  task_id uuid references public.site_tasks (id) on delete set null,
  kind text not null default 'message' check (kind in ('message','event')),
  created_at timestamptz not null default now()
);
create index on public.messages (project_id, created_at);

create table public.chat_reads (
  org_id uuid not null references public.organisations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null,
  read_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table public.site_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  date date not null,
  body text not null,
  photos text[] not null default '{}',
  author_id uuid,
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','accepted','dismissed')),
  reviewed_by uuid,
  reviewed_at timestamptz
);

do $$
declare t text;
begin
  foreach t in array array['site_tasks','messages','site_notes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "members read" on public.%I for select using (is_member(org_id))', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
alter table public.chat_reads enable row level security;
create policy "own reads" on public.chat_reads for select using (user_id = auth.uid());
grant select on public.chat_reads to authenticated;

-- ---------------------------------------------------------------- helpers
create or replace function public._clean_photos(p_org uuid, p jsonb) returns text[]
language plpgsql stable as $$
declare out text[] := '{}'; x text;
begin
  for x in select jsonb_array_elements_text(coalesce(p, '[]')) loop
    if x not like p_org::text || '/%' then perform _fail('That photo isn''t in your company''s storage.'); end if;
    out := out || x;
  end loop;
  if cardinality(out) > 10 then perform _fail('Attach up to 10 photos.'); end if;
  return out;
end $$;

create or replace function public._post_event(pr public.projects, p_task uuid, p_body text) returns void
language sql security definer set search_path = public as $$
  insert into messages (org_id, project_id, author_id, body, task_id, kind) values (pr.org_id, pr.id, auth.uid(), p_body, p_task, 'event');
$$;

-- ------------------------------------------------------------------ chat
create or replace function public.post_message(p_project uuid, p_body text, p_photos jsonb default '[]') returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects; v uuid; ph text[]; b text := trim(coalesce(p_body, ''));
begin
  select * into pr from projects where id = p_project;
  if not found then perform _fail('Project not found.'); end if;
  perform _me(pr.org_id);
  ph := _clean_photos(pr.org_id, p_photos);
  if b = '' and cardinality(ph) = 0 then perform _fail('Write a message or add a photo.'); end if;
  if length(b) > 4000 then perform _fail('Keep messages under 4,000 characters.'); end if;
  insert into messages (org_id, project_id, author_id, body, photos) values (pr.org_id, pr.id, auth.uid(), b, ph) returning id into v;
  insert into chat_reads (org_id, project_id, user_id, read_at) values (pr.org_id, pr.id, auth.uid(), now())
  on conflict (project_id, user_id) do update set read_at = now();
  return jsonb_build_object('id', v, 'message', 'Sent.');
end $$;

create or replace function public.mark_chat_read(p_project uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects;
begin
  select * into pr from projects where id = p_project;
  if not found then perform _fail('Project not found.'); end if;
  perform _me(pr.org_id);
  insert into chat_reads (org_id, project_id, user_id, read_at) values (pr.org_id, pr.id, auth.uid(), now())
  on conflict (project_id, user_id) do update set read_at = now();
  return jsonb_build_object('message', 'Read.');
end $$;

-- ----------------------------------------------------------------- tasks
create or replace function public.create_site_task(p_project uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects; v uuid; ref text; who uuid := nullif(p ->> 'assignee_id', '')::uuid; nm text; d defects; pt itp_points; due date := nullif(p ->> 'due_date', '')::date;
begin
  select * into pr from projects where id = p_project;
  if not found then perform _fail('Project not found.'); end if;
  perform _require(pr.org_id, 'task.assign');
  if length(trim(coalesce(p ->> 'title', ''))) = 0 then perform _fail('Say what needs doing.'); end if;
  if who is null or not exists (select 1 from memberships where org_id = pr.org_id and user_id = who) then perform _fail('Choose who the task is for.'); end if;
  if due < current_date then perform _fail('The due date has passed.'); end if;
  if nullif(p ->> 'defect_id', '') is not null then
    select * into d from defects where id = (p ->> 'defect_id')::uuid and project_id = pr.id;
    if not found then perform _fail('That defect isn''t on this project.'); end if;
  end if;
  if nullif(p ->> 'itp_point_id', '') is not null then
    select x.* into pt from itp_points x join itps i on i.id = x.itp_id where x.id = (p ->> 'itp_point_id')::uuid and i.project_id = pr.id;
    if not found then perform _fail('That inspection point isn''t on this project.'); end if;
  end if;
  ref := _next_ref('site_tasks', pr.id, 'T');
  insert into site_tasks (org_id, project_id, ref, title, details, assignee_id, due_date, photos_required, defect_id, itp_point_id, created_by)
  values (pr.org_id, pr.id, ref, trim(p ->> 'title'), nullif(trim(coalesce(p ->> 'details', '')), ''), who, due,
    least(greatest(coalesce(nullif(p ->> 'photos_required', '')::int, 0), 0), 10), d.id, pt.id, auth.uid())
  returning id into v;
  select coalesce(nullif(full_name, ''), email, 'someone') into nm from profiles where id = who;
  perform _post_event(pr, v, format('gave %s a task: %s%s', nm, trim(p ->> 'title'), coalesce(' · due ' || to_char(due, 'FMDD Mon'), '')));
  perform _audit(pr.org_id, pr.id, 'task', v::text, 'Task given', null, 'open', ref || ' · ' || trim(p ->> 'title') || ' → ' || nm);
  return jsonb_build_object('id', v, 'message', format('%s sent to %s''s phone.', ref, nm));
end $$;

create or replace function public.site_task_action(p_task uuid, p_action text, p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public as $$
declare t site_tasks; pr projects; m memberships; ph text[]; note text := nullif(trim(coalesce(p ->> 'note', '')), '');
begin
  select * into t from site_tasks where id = p_task for update;
  if not found then perform _fail('Task not found.'); end if;
  select * into pr from projects where id = t.project_id;
  m := _me(t.org_id);
  if p_action = 'submit' then
    if t.assignee_id <> auth.uid() then perform _fail('Only the person the task was given to can mark it done.'); end if;
    if t.status <> 'open' then perform _fail('This task isn''t open.'); end if;
    ph := _clean_photos(t.org_id, p -> 'photos');
    if cardinality(ph) < t.photos_required then perform _fail(format('Add at least %s photo%s of the finished work.', t.photos_required, case when t.photos_required = 1 then '' else 's' end)); end if;
    if note is null and cardinality(ph) = 0 then perform _fail('Add a note or a photo to show it''s done.'); end if;
    update site_tasks set status = 'submitted', submitted_at = now(), submit_note = note, evidence = ph where id = t.id;
    perform _post_event(pr, t.id, format('finished %s: %s — waiting for a check', t.ref, t.title));
  elsif p_action in ('accept','send_back') then
    if not (role_can(m.role, 'task.assign') or t.created_by = auth.uid()) then perform _fail('Only the person who gave the task, or a supervisor, can check it.'); end if;
    if t.status <> 'submitted' then perform _fail('This task hasn''t been marked done.'); end if;
    if t.assignee_id = auth.uid() then perform _fail('Someone else needs to check your work.'); end if;
    if p_action = 'send_back' and note is null then perform _fail('Say what still needs doing.'); end if;
    update site_tasks set status = case when p_action = 'accept' then 'accepted' else 'open' end, reviewed_by = auth.uid(), reviewed_at = now(), review_note = note,
      sent_back = sent_back + case when p_action = 'send_back' then 1 else 0 end where id = t.id;
    perform _post_event(pr, t.id, case when p_action = 'accept' then format('accepted %s: %s', t.ref, t.title) else format('sent %s back: %s', t.ref, note) end);
  elsif p_action = 'cancel' then
    if not (role_can(m.role, 'task.assign') or t.created_by = auth.uid()) then perform _fail('Only the person who gave the task, or a supervisor, can cancel it.'); end if;
    if t.status in ('accepted','cancelled') then perform _fail('This task is already finished.'); end if;
    update site_tasks set status = 'cancelled', reviewed_by = auth.uid(), reviewed_at = now(), review_note = note where id = t.id;
  else
    perform _fail('Unknown action.');
  end if;
  select * into t from site_tasks where id = p_task;
  perform _audit(t.org_id, t.project_id, 'task', t.id::text, case p_action when 'submit' then 'Task done' when 'accept' then 'Task accepted' when 'send_back' then 'Task sent back' else 'Task cancelled' end, null, t.status, t.ref || coalesce(' — ' || note, ''));
  return jsonb_build_object('message', t.ref || case p_action when 'submit' then ' marked done. It''ll be checked.' when 'accept' then ' accepted.' when 'send_back' then ' sent back.' else ' cancelled.' end);
end $$;

-- ------------------------------------------------------------ site notes
create or replace function public.send_site_note(p_project uuid, p_body text, p_photos jsonb default '[]', p_date date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects; v uuid; dt date := coalesce(p_date, (now() at time zone 'Australia/Sydney')::date);
begin
  select * into pr from projects where id = p_project;
  if not found then perform _fail('Project not found.'); end if;
  perform _me(pr.org_id);
  if length(trim(coalesce(p_body, ''))) = 0 then perform _fail('Write what happened on site.'); end if;
  if dt > (now() at time zone 'Australia/Sydney')::date or dt < (now() at time zone 'Australia/Sydney')::date - 7 then perform _fail('Site notes are for today or the last 7 days.'); end if;
  insert into site_notes (org_id, project_id, date, body, photos, author_id) values (pr.org_id, pr.id, dt, left(trim(p_body), 4000), _clean_photos(pr.org_id, p_photos), auth.uid()) returning id into v;
  return jsonb_build_object('id', v, 'message', 'Note sent to the site diary for checking.');
end $$;

create or replace function public.site_note_action(p_note uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n site_notes; late boolean;
begin
  select * into n from site_notes where id = p_note for update;
  if not found then perform _fail('Note not found.'); end if;
  perform _require(n.org_id, 'diary.submit');
  if n.status <> 'pending' then perform _fail('This note has already been reviewed.'); end if;
  if p_action not in ('accept','dismiss') then perform _fail('Unknown action.'); end if;
  update site_notes set status = case when p_action = 'accept' then 'accepted' else 'dismissed' end, reviewed_by = auth.uid(), reviewed_at = now() where id = n.id;
  late := exists (select 1 from diary where project_id = n.project_id and date = n.date and submitted);
  perform _audit(n.org_id, n.project_id, 'diary', n.id::text, case when p_action = 'accept' then 'Site note added to diary' else 'Site note dismissed' end, 'pending',
    case when p_action = 'accept' then 'accepted' else 'dismissed' end, to_char(n.date, 'DD Mon') || case when late and p_action = 'accept' then ' (after the diary was submitted)' else '' end);
  return jsonb_build_object('message', case when p_action = 'dismiss' then 'Note dismissed.' when late then 'Added to the ' || to_char(n.date, 'FMDD Mon') || ' diary as a late addition.' else 'Added to the ' || to_char(n.date, 'FMDD Mon') || ' diary.' end);
end $$;

-- ---------------------------------------------------------------- grants
do $$
declare f text;
begin
  foreach f in array array['public.post_message(uuid, text, jsonb)', 'public.mark_chat_read(uuid)', 'public.create_site_task(uuid, jsonb)',
    'public.site_task_action(uuid, text, jsonb)', 'public.send_site_note(uuid, text, jsonb, date)', 'public.site_note_action(uuid, text)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array['public._clean_photos(uuid, jsonb)', 'public._post_event(public.projects, uuid, text)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;
grant execute on function public.role_can(text, text) to anon, authenticated;
