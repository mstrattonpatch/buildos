-- =====================================================================
-- Dates follow Sydney time
--
-- The app works in Australian Eastern time, but the server runs on UTC,
-- so between about 11 am and midnight UTC "today" disagreed: a site note
-- (Sydney date) could land a day after the diary it belonged to (UTC
-- date). Set the database's time zone so every current_date agrees, and
-- make the diary use the Sydney date explicitly.
-- =====================================================================

do $$
begin
  execute format('alter database %I set timezone to %L', current_database(), 'Australia/Sydney');
exception when insufficient_privilege then
  raise notice 'Could not set the database time zone; the functions below still use Sydney dates.';
end $$;

create or replace function public.submit_diary(p_project uuid, p_weather text, p_notes text, p_delays text, p_date date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects; v uuid; n int; c int; today date := (now() at time zone 'Australia/Sydney')::date; dt date := coalesce(p_date, today);
begin
  select * into pr from projects where id = p_project;
  if not found then perform _fail('Project not found.'); end if;
  perform _require(pr.org_id, 'diary.submit');
  if length(trim(coalesce(p_notes, ''))) = 0 then perform _fail('Add a note about today''s work.'); end if;
  if dt > today + 1 then perform _fail('The diary can''t be dated in the future.'); end if;
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
