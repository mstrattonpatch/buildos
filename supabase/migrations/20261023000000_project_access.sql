-- Project-level access (Setout 2.0, Phase 1).
-- A company chooses who sees which project:
--   'all'      — everyone in the company sees every project (the behaviour until now, and still the default);
--   'assigned' — people see only the projects they've been added to. Directors and company admins still see every
--                project; subcontractor admins and workers also see projects their company or crew is working on.
-- Reads are limited by row-level security; writes are refused by a trigger on every project table, so no database
-- function (old or new) can change a project the person can't see.

alter table public.organisations add column if not exists project_access text not null default 'all'
  check (project_access in ('all', 'assigned'));

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  org_id uuid not null references public.organisations (id) on delete cascade,
  added_by uuid,
  added_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index project_members_user on public.project_members (user_id);

-- Is a subcontractor company working on this project? (Its workers are inducted, or it has tasks, defects, SWMS or orders there.)
create or replace function public._contractor_on_project(p_contractor uuid, p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from inductions i join workers w on w.id = i.worker_id where i.project_id = p_project and w.contractor_id = p_contractor)
      or exists (select 1 from tasks where project_id = p_project and contractor_id = p_contractor)
      or exists (select 1 from defects where project_id = p_project and contractor_id = p_contractor)
      or exists (select 1 from swms where project_id = p_project and contractor_id = p_contractor)
      or exists (select 1 from purchase_orders where project_id = p_project and contractor_id = p_contractor);
$$;

-- Can the signed-in person see this project? Records with no project (company-level) are not restricted here.
create or replace function public.can_see_project(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_project is null or exists (
    select 1 from projects pr
    join organisations o on o.id = pr.org_id
    join memberships m on m.org_id = pr.org_id and m.user_id = auth.uid()
    where pr.id = p_project and (
      o.project_access = 'all' or m.role = 'director' or m.is_admin
      or exists (select 1 from project_members pm where pm.project_id = pr.id and pm.user_id = auth.uid())
      or (m.contractor_id is not null and _contractor_on_project(m.contractor_id, pr.id))
      or (m.worker_id is not null and exists (select 1 from inductions i where i.worker_id = m.worker_id and i.project_id = pr.id))
    ));
$$;

-- ---------------------------------------------------------------- reads: add the project check to every policy
do $$
declare r record; child record;
begin
  for r in select p.tablename, p.policyname, p.qual from pg_policies p
           where p.schemaname = 'public' and p.cmd = 'SELECT'
             and exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = p.tablename and c.column_name = 'project_id') loop
    execute format('alter policy %I on public.%I using ((%s) and can_see_project(project_id))', r.policyname, r.tablename, r.qual);
  end loop;
  for r in select policyname, qual from pg_policies where schemaname = 'public' and tablename = 'projects' and cmd = 'SELECT' loop
    execute format('alter policy %I on public.projects using ((%s) and can_see_project(id))', r.policyname, r.qual);
  end loop;
  -- Records that belong to a project through their parent.
  for child in select * from (values
      ('itp_points', 'exists (select 1 from itps x where x.id = itp_points.itp_id and can_see_project(x.project_id))'),
      ('itp_signoffs', 'exists (select 1 from itp_points pt join itps x on x.id = pt.itp_id where pt.id = itp_signoffs.point_id and can_see_project(x.project_id))'),
      ('swms_acks', 'exists (select 1 from swms x where x.id = swms_acks.swms_id and can_see_project(x.project_id))'),
      ('toolbox_attendees', 'exists (select 1 from toolbox_talks x where x.id = toolbox_attendees.talk_id and can_see_project(x.project_id))'),
      ('timesheet_costs', 'exists (select 1 from timesheets x where x.id = timesheet_costs.timesheet_id and can_see_project(x.project_id))')
    ) v(tbl, cond) loop
    for r in select policyname, qual from pg_policies where schemaname = 'public' and tablename = child.tbl and cmd = 'SELECT' loop
      execute format('alter policy %I on public.%I using ((%s) and %s)', r.policyname, child.tbl, r.qual, child.cond);
    end loop;
  end loop;
end $$;

alter table public.project_members enable row level security;
create policy "members read project teams" on public.project_members for select using (is_member(org_id) and can_see_project(project_id));

-- ---------------------------------------------------------------- writes: refuse changes to projects the person can't see
-- Runs only for signed-in requests; the no-account QR gate and self-service links are scoped by their own tokens.
create or replace function public._guard_project_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare row_ jsonb := to_jsonb(coalesce(new, old)); pid uuid;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  pid := case tg_table_name
    when 'projects' then (row_ ->> 'id')::uuid
    when 'itp_points' then (select project_id from itps where id = (row_ ->> 'itp_id')::uuid)
    when 'itp_signoffs' then (select x.project_id from itp_points pt join itps x on x.id = pt.itp_id where pt.id = (row_ ->> 'point_id')::uuid)
    when 'swms_acks' then (select project_id from swms where id = (row_ ->> 'swms_id')::uuid)
    when 'toolbox_attendees' then (select project_id from toolbox_talks where id = (row_ ->> 'talk_id')::uuid)
    when 'timesheet_costs' then (select project_id from timesheets where id = (row_ ->> 'timesheet_id')::uuid)
    else (row_ ->> 'project_id')::uuid end;
  -- A brand-new project isn't visible yet to anyone; creating it is checked by create_project's own permission.
  if tg_table_name = 'projects' and tg_op = 'INSERT' then return new; end if;
  if pid is not null and not can_see_project(pid) then perform _fail('You don''t have access to that project.'); end if;
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  -- project_members is managed by set_project_members (which checks access itself) and the creator trigger.
  for t in select table_name from information_schema.columns where table_schema = 'public' and column_name = 'project_id' and table_name <> 'project_members'
           union select unnest(array['projects', 'itp_points', 'itp_signoffs', 'swms_acks', 'toolbox_attendees', 'timesheet_costs']) loop
    execute format('drop trigger if exists guard_project_write on public.%I', t);
    execute format('create trigger guard_project_write before insert or update or delete on public.%I for each row execute function public._guard_project_write()', t);
  end loop;
end $$;

-- The person who creates a project is on its team.
create or replace function public._project_creator_joins() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    insert into project_members (project_id, user_id, org_id, added_by) values (new.id, auth.uid(), new.org_id, auth.uid()) on conflict do nothing;
  end if;
  return new;
end $$;
create trigger project_creator_joins after insert on public.projects for each row execute function public._project_creator_joins();

-- Until now everyone saw every project, so put everyone on every existing project's team.
insert into public.project_members (project_id, user_id, org_id)
select p.id, m.user_id, p.org_id from public.projects p join public.memberships m on m.org_id = p.org_id
on conflict do nothing;

-- ---------------------------------------------------------------- managing access
create or replace function public.set_project_access(p_org uuid, p_mode text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m memberships;
begin
  m := _me(p_org);
  if not m.is_admin then perform _fail('Only company admins can change who sees which project.'); end if;
  if p_mode not in ('all', 'assigned') then perform _fail('Choose who can see projects.'); end if;
  update organisations set project_access = p_mode where id = p_org;
  perform _audit(p_org, null, 'company', p_org::text, case when p_mode = 'all' then 'Everyone sees every project' else 'People see only their projects' end);
  return jsonb_build_object('message', case when p_mode = 'all' then 'Everyone in the company now sees every project.' else 'People now see only the projects they''re added to. Directors and admins still see all of them.' end);
end $$;

create or replace function public.set_project_members(p_project uuid, p_users uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects; m memberships; added int; removed int;
begin
  select * into pr from projects where id = p_project;
  if not found then perform _fail('Project not found.'); end if;
  m := _require(pr.org_id, 'project.manage');
  if not can_see_project(p_project) then perform _fail('You don''t have access to that project.'); end if;
  if exists (select 1 from unnest(coalesce(p_users, '{}')) u where not exists (select 1 from memberships x where x.org_id = pr.org_id and x.user_id = u)) then
    perform _fail('Everyone on the project team must be in the company.');
  end if;
  with del as (delete from project_members where project_id = p_project and not (user_id = any (coalesce(p_users, '{}'))) returning 1) select count(*) into removed from del;
  with ins as (insert into project_members (project_id, user_id, org_id, added_by)
               select p_project, u, pr.org_id, auth.uid() from unnest(coalesce(p_users, '{}')) u on conflict do nothing returning 1) select count(*) into added from ins;
  perform _audit(pr.org_id, p_project, 'project', p_project::text, 'Project team updated', null, null, format('%s added, %s removed', added, removed));
  return jsonb_build_object('message', format('Project team saved: %s added, %s removed.', added, removed));
end $$;

-- ---------------------------------------------------------------- grants
do $$
declare f text;
begin
  foreach f in array array['public.set_project_access(uuid, text)', 'public.set_project_members(uuid, uuid[])'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array['public._guard_project_write()', 'public._project_creator_joins()', 'public._contractor_on_project(uuid, uuid)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;
grant execute on function public.can_see_project(uuid) to authenticated, anon;
