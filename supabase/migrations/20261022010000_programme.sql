-- =====================================================================
-- Programme: create and edit tasks and milestones, dependencies,
-- progress updates, delay reasons and re-baselining (blueprint §5.2).
--
-- Rules:
--  * Baseline dates are set when a task is created and only change when a
--    project manager re-baselines the whole programme.
--  * Moving a forecast finish later needs a delay reason.
--  * Dependencies are finish-to-start, within one project, and can't loop.
--  * Progress is physical progress only; it never signs off an ITP.
-- =====================================================================

alter table public.tasks
  add column if not exists actual_start date,
  add column if not exists actual_finish date,
  add column if not exists delay_reason text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- Validates a task's predecessors: same project, not itself, no loops.
create or replace function public._check_predecessors(p_project uuid, p_task uuid, p_preds uuid[]) returns void
language plpgsql stable security definer set search_path = public as $$
declare bad int; loops boolean;
begin
  if p_task is not null and p_task = any (p_preds) then perform _fail('A task can''t depend on itself.'); end if;
  select count(*) into bad from unnest(p_preds) x where not exists (select 1 from tasks t where t.id = x and t.project_id = p_project);
  if bad > 0 then perform _fail('Predecessors must be tasks on the same project.'); end if;
  if p_task is null or cardinality(p_preds) = 0 then return; end if;
  -- Walk back from the proposed predecessors; reaching this task means a loop.
  with recursive up(id) as (
    select unnest(p_preds)
    union
    select unnest(t.predecessor_ids) from tasks t join up on t.id = up.id where t.id <> p_task
  ) select exists (select 1 from up where id = p_task) into loops;
  if loops then perform _fail('That link would create a loop — a task can''t (indirectly) depend on itself.'); end if;
end $$;

create or replace function public._task_input(p jsonb, out v_start date, out v_finish date, out v_milestone boolean, out v_preds uuid[])
language plpgsql as $$
begin
  v_milestone := coalesce((p ->> 'is_milestone')::boolean, false);
  v_start := nullif(p ->> 'forecast_start', '')::date;
  v_finish := case when v_milestone then v_start else nullif(p ->> 'forecast_finish', '')::date end;
  v_preds := coalesce(array(select (jsonb_array_elements_text(coalesce(p -> 'predecessor_ids', '[]'::jsonb)))::uuid), '{}');
  if v_start is null then perform _fail(case when v_milestone then 'Choose the milestone date.' else 'Choose a start date.' end); end if;
  if v_finish is null then perform _fail('Choose a finish date.'); end if;
  if v_finish < v_start then perform _fail('The finish date can''t be before the start date.'); end if;
end $$;

create or replace function public._check_links(p_org uuid, p_project uuid, p jsonb) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if nullif(p ->> 'contractor_id', '') is not null and not exists (select 1 from contractors where id = (p ->> 'contractor_id')::uuid and org_id = p_org) then perform _fail('Contractor not found.'); end if;
  if nullif(p ->> 'itp_id', '') is not null and not exists (select 1 from itps where id = (p ->> 'itp_id')::uuid and project_id = p_project) then perform _fail('That ITP isn''t on this project.'); end if;
  if nullif(p ->> 'swms_id', '') is not null and not exists (select 1 from swms where id = (p ->> 'swms_id')::uuid and project_id = p_project) then perform _fail('That SWMS isn''t on this project.'); end if;
end $$;

create or replace function public.create_task(p_project uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects; i record; v uuid;
begin
  select * into pr from projects where id = p_project;
  if not found then perform _fail('Project not found.'); end if;
  perform _require(pr.org_id, 'project.manage');
  if length(trim(coalesce(p ->> 'name', ''))) = 0 then perform _fail('Name the task.'); end if;
  select * into i from _task_input(p);
  perform _check_predecessors(pr.id, null, i.v_preds);
  perform _check_links(pr.org_id, pr.id, p);
  insert into tasks (org_id, project_id, name, trade, contractor_id, baseline_start, baseline_finish, forecast_start, forecast_finish,
    is_milestone, predecessor_ids, cost_code, itp_id, swms_id)
  values (pr.org_id, pr.id, trim(p ->> 'name'), nullif(trim(coalesce(p ->> 'trade', '')), ''), nullif(p ->> 'contractor_id', '')::uuid,
    i.v_start, i.v_finish, i.v_start, i.v_finish, i.v_milestone, i.v_preds, nullif(trim(coalesce(p ->> 'cost_code', '')), ''),
    nullif(p ->> 'itp_id', '')::uuid, nullif(p ->> 'swms_id', '')::uuid)
  returning id into v;
  -- Keep the ITP pointing back at the task it covers.
  if nullif(p ->> 'itp_id', '') is not null then update itps set task_id = v where id = (p ->> 'itp_id')::uuid and task_id is null; end if;
  perform _audit(pr.org_id, pr.id, 'task', v::text, case when i.v_milestone then 'Milestone added' else 'Task added' end, null, null,
    trim(p ->> 'name') || ' · ' || to_char(i.v_start, 'DD Mon') || case when i.v_milestone then '' else '–' || to_char(i.v_finish, 'DD Mon') end);
  return jsonb_build_object('id', v, 'message', case when i.v_milestone then 'Milestone added.' else 'Task added.' end);
end $$;

create or replace function public.update_task(p_task uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t tasks; i record; reason text := nullif(trim(coalesce(p ->> 'delay_reason', '')), ''); changes text[] := '{}';
begin
  select * into t from tasks where id = p_task for update;
  if not found then perform _fail('Task not found.'); end if;
  perform _require(t.org_id, 'project.manage');
  if length(trim(coalesce(p ->> 'name', ''))) = 0 then perform _fail('Name the task.'); end if;
  select * into i from _task_input(p);
  -- Pushing the forecast finish out is a delay: say why, so it can support an EOT claim.
  if i.v_finish > t.forecast_finish and reason is null then
    perform _fail(format('The finish moves from %s to %s — add a delay reason.', to_char(t.forecast_finish, 'DD Mon'), to_char(i.v_finish, 'DD Mon')));
  end if;
  perform _check_predecessors(t.project_id, t.id, i.v_preds);
  perform _check_links(t.org_id, t.project_id, p);
  if i.v_start <> t.forecast_start or i.v_finish <> t.forecast_finish then
    changes := changes || format('forecast %s–%s → %s–%s', to_char(t.forecast_start, 'DD Mon'), to_char(t.forecast_finish, 'DD Mon'), to_char(i.v_start, 'DD Mon'), to_char(i.v_finish, 'DD Mon'));
  end if;
  if i.v_preds is distinct from t.predecessor_ids then changes := changes || 'dependencies changed'::text; end if;
  if trim(p ->> 'name') <> t.name then changes := changes || format('renamed from "%s"', t.name); end if;
  update tasks set name = trim(p ->> 'name'), trade = nullif(trim(coalesce(p ->> 'trade', '')), ''), contractor_id = nullif(p ->> 'contractor_id', '')::uuid,
    forecast_start = i.v_start, forecast_finish = i.v_finish, is_milestone = i.v_milestone, predecessor_ids = i.v_preds,
    cost_code = nullif(trim(coalesce(p ->> 'cost_code', '')), ''), itp_id = nullif(p ->> 'itp_id', '')::uuid, swms_id = nullif(p ->> 'swms_id', '')::uuid,
    delay_reason = coalesce(reason, delay_reason), updated_at = now()
  where id = t.id;
  if nullif(p ->> 'itp_id', '') is not null then update itps set task_id = t.id where id = (p ->> 'itp_id')::uuid and task_id is null; end if;
  perform _audit(t.org_id, t.project_id, 'task', t.id::text, case when i.v_finish > t.forecast_finish then 'Task delayed' else 'Task updated' end, null, null,
    nullif(array_to_string(changes || case when reason is not null then array['reason: ' || reason] else '{}'::text[] end, '; '), ''));
  return jsonb_build_object('message', case when i.v_finish > t.forecast_finish then 'Task updated — delay recorded.' else 'Task updated.' end);
end $$;

-- Site progress. Status follows the percentage unless the task is flagged blocked.
create or replace function public.update_task_progress(p_task uuid, p_progress int, p_blocked boolean default false, p_note text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare t tasks; m memberships; s text;
begin
  select * into t from tasks where id = p_task for update;
  if not found then perform _fail('Task not found.'); end if;
  m := _me(t.org_id);
  if not (role_can(m.role, 'project.manage') or role_can(m.role, 'diary.submit')) then perform _fail('Only the site team or project manager can update progress.'); end if;
  if p_progress is null or p_progress < 0 or p_progress > 100 then perform _fail('Progress must be between 0 and 100%.'); end if;
  if p_blocked and length(trim(coalesce(p_note, ''))) = 0 then perform _fail('Say what''s blocking the task.'); end if;
  s := case when p_blocked then 'blocked' when p_progress = 100 then 'complete' when p_progress > 0 then 'in_progress' else 'not_started' end;
  update tasks set progress = p_progress, status = s,
    actual_start = case when p_progress > 0 then coalesce(actual_start, current_date) else actual_start end,
    actual_finish = case when p_progress = 100 then coalesce(actual_finish, current_date) else null end,
    updated_at = now()
  where id = t.id;
  perform _audit(t.org_id, t.project_id, 'task', t.id::text, case when s = 'blocked' then 'Task blocked' when s = 'complete' then 'Task complete' else 'Progress updated' end,
    t.status, s, format('%s%% → %s%%', t.progress, p_progress) || coalesce(' — ' || nullif(trim(p_note), ''), ''));
  return jsonb_build_object('message', t.name || ': ' || p_progress || '%' || case when s = 'blocked' then ', blocked.' when s = 'complete' then ', complete.' else '.' end);
end $$;

create or replace function public.delete_task(p_task uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t tasks;
begin
  select * into t from tasks where id = p_task for update;
  if not found then perform _fail('Task not found.'); end if;
  perform _require(t.org_id, 'project.manage');
  if t.progress > 0 then perform _fail('This task has progress recorded, so it can''t be removed. Set it to 0% first if it was entered by mistake.'); end if;
  update tasks set predecessor_ids = array_remove(predecessor_ids, t.id) where project_id = t.project_id and t.id = any (predecessor_ids);
  delete from tasks where id = t.id;
  perform _audit(t.org_id, t.project_id, 'task', t.id::text, 'Task removed', null, null, t.name);
  return jsonb_build_object('message', t.name || ' removed.');
end $$;

-- Copies every forecast to the baseline. History is kept in the audit log.
create or replace function public.rebaseline_programme(p_project uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects; n int;
begin
  select * into pr from projects where id = p_project;
  if not found then perform _fail('Project not found.'); end if;
  perform _require(pr.org_id, 'project.manage');
  if length(trim(coalesce(p_reason, ''))) = 0 then perform _fail('Give a reason for re-baselining (e.g. approved EOT).'); end if;
  update tasks set baseline_start = forecast_start, baseline_finish = forecast_finish, updated_at = now() where project_id = pr.id;
  get diagnostics n = row_count;
  perform _audit(pr.org_id, pr.id, 'programme', pr.id::text, 'Programme re-baselined', null, null, n || ' tasks — ' || trim(p_reason));
  return jsonb_build_object('message', format('Baseline reset for %s tasks.', n));
end $$;

do $$
declare f text;
begin
  foreach f in array array['public._check_predecessors(uuid, uuid, uuid[])', 'public._task_input(jsonb)', 'public._check_links(uuid, uuid, jsonb)',
    'public.create_task(uuid, jsonb)', 'public.update_task(uuid, jsonb)', 'public.update_task_progress(uuid, integer, boolean, text)',
    'public.delete_task(uuid)', 'public.rebaseline_programme(uuid, text)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
