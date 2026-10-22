-- AI help: reading uploaded documents into forms, and the in-app help chat (blueprint §13).
-- The AI itself runs in the "ai" Edge Function, which holds the API key as a Supabase secret.
-- The database decides who may use it, how often, and keeps a record of every call.
-- Nothing the AI returns is saved by itself: it only fills in a form that a person checks and submits.

alter table public.organisations add column if not exists ai_enabled boolean not null default true;

create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  user_id uuid not null,
  kind text not null check (kind in ('read', 'chat')),
  doc_type text,
  status text not null default 'started' check (status in ('started', 'done', 'failed')),
  input_tokens int,
  output_tokens int,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index ai_usage_user on public.ai_usage (user_id, created_at desc);
create index ai_usage_org on public.ai_usage (org_id, created_at desc);

alter table public.ai_usage enable row level security;
create policy "own or managers read ai usage" on public.ai_usage for select using (
  user_id = auth.uid() or has_perm(org_id, 'project.manage'));

-- Called by the Edge Function (as the signed-in person) before every AI call.
-- Per person: 40 document reads and 80 chat messages an hour. Per company: 1,000 calls a day.
create or replace function public.ai_begin(p_org uuid, p_kind text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m memberships; n int; v uuid;
begin
  m := _me(p_org);
  if p_kind not in ('read', 'chat') then perform _fail('Unknown AI request.'); end if;
  if not (select ai_enabled from organisations where id = p_org) then
    perform _fail('AI help is switched off for this company. A director or project manager can turn it on in Team & roles.');
  end if;
  select count(*) into n from ai_usage where user_id = auth.uid() and kind = p_kind and created_at > now() - interval '1 hour';
  if n >= (case p_kind when 'read' then 40 else 80 end) then
    perform _fail(case p_kind when 'read' then 'You''ve read a lot of documents in the last hour. Please wait a little and try again.'
      else 'You''ve sent a lot of questions in the last hour. Please wait a little and try again.' end);
  end if;
  select count(*) into n from ai_usage where org_id = p_org and created_at > now() - interval '1 day';
  if n >= 1000 then perform _fail('Your company has reached today''s AI limit. It resets over the next 24 hours.'); end if;
  insert into ai_usage (org_id, user_id, kind) values (p_org, auth.uid(), p_kind) returning id into v;
  return jsonb_build_object('id', v);
end $$;

create or replace function public.ai_finish(p_id uuid, p_status text, p_doc_type text, p_input_tokens int, p_output_tokens int, p_error text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update ai_usage set status = case when p_status = 'done' then 'done' else 'failed' end,
    doc_type = left(p_doc_type, 40), input_tokens = greatest(p_input_tokens, 0), output_tokens = greatest(p_output_tokens, 0),
    error = left(p_error, 300), finished_at = now()
  where id = p_id and user_id = auth.uid() and status = 'started';
end $$;

create or replace function public.set_ai_enabled(p_org uuid, p_enabled boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _require(p_org, 'project.manage');
  update organisations set ai_enabled = coalesce(p_enabled, true) where id = p_org;
  perform _audit(p_org, null, 'company', p_org::text, case when p_enabled then 'Turned AI help on' else 'Turned AI help off' end);
  return jsonb_build_object('message', case when p_enabled then 'AI help is on.' else 'AI help is off.' end);
end $$;

-- ---------------------------------------------------------------- grants
do $$
declare f text;
begin
  foreach f in array array['public.ai_begin(uuid, text)', 'public.ai_finish(uuid, text, text, int, int, text)', 'public.set_ai_enabled(uuid, boolean)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
