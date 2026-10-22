-- =====================================================================
-- Worker digital wallet and contractor profiles (blueprint §6.1, §6.2)
--
--  * Credentials carry evidence, issuer, reviewer notes and the
--    verification method, reviewer and date. A stored document is not a
--    verified credential: uploads wait for review, and nobody verifies
--    their own.
--  * Each project can require extra credential types; they block sign-in
--    like the White Card.
--  * Workers and contractors keep their own records up to date through a
--    private link (no account needed). Links live in their own table that
--    only people managers can read, and uploads through a link can only go
--    into that link's own storage folder.
--  * Contractor profiles: contacts, emergency contact, trades,
--    prequalification, insurances with limits and certificates, company
--    documents.
-- =====================================================================

-- ---------------------------------------------------------------- columns
alter table public.credentials
  add column if not exists issuer text,
  add column if not exists file_path text,
  add column if not exists notes text,
  add column if not exists verified_at timestamptz,
  add column if not exists submitted_by uuid,
  add column if not exists submitted_at timestamptz not null default now(),
  add column if not exists source text not null default 'office' check (source in ('office','worker','contractor')),
  add column if not exists reject_reason text;

alter table public.contractors
  add column if not exists email text,
  add column if not exists phone text,
  add column if not exists address text,
  add column if not exists contact_name text,
  add column if not exists contact_phone text,
  add column if not exists emergency_name text,
  add column if not exists emergency_phone text,
  add column if not exists trades text[] not null default '{}',
  add column if not exists prequal_status text not null default 'not_started' check (prequal_status in ('not_started','submitted','approved','rejected','expired')),
  add column if not exists prequal_expires date,
  add column if not exists prequal_notes text;

alter table public.insurances
  add column if not exists insurer text,
  add column if not exists policy_number text,
  add column if not exists cover_limit bigint check (cover_limit >= 0),
  add column if not exists file_path text,
  add column if not exists status text not null default 'verified' check (status in ('awaiting_verification','verified','rejected')),
  add column if not exists verified_by uuid,
  add column if not exists verified_at timestamptz,
  add column if not exists notes text,
  add column if not exists source text not null default 'office' check (source in ('office','contractor'));
update public.insurances set status = case when verified then 'verified' else 'awaiting_verification' end;

create table public.contractor_docs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  contractor_id uuid not null references public.contractors (id) on delete cascade,
  kind text not null,
  title text not null,
  file_path text not null,
  expires date,
  status text not null default 'awaiting_verification' check (status in ('awaiting_verification','verified','rejected')),
  source text not null default 'office' check (source in ('office','contractor')),
  uploaded_by uuid,
  uploaded_at timestamptz not null default now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  notes text
);

create table public.project_requirements (
  org_id uuid not null references public.organisations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  type text not null,
  primary key (project_id, type)
);

create table public.portal_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  kind text not null check (kind in ('worker','contractor')),
  ref_id uuid not null,
  token text not null unique,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (kind, ref_id)
);

alter table public.contractor_docs enable row level security;
create policy "members read contractor docs" on public.contractor_docs for select using (
  is_member(org_id) and ((my_membership(org_id)).role <> 'subcontractor_admin' or contractor_id = (my_membership(org_id)).contractor_id));
alter table public.project_requirements enable row level security;
create policy "members read requirements" on public.project_requirements for select using (is_member(org_id));
alter table public.portal_links enable row level security;
create policy "people managers read links" on public.portal_links for select using (has_perm(org_id, 'people.manage'));
grant select on public.contractor_docs, public.project_requirements, public.portal_links to authenticated;

-- ---------------------------------------------------------------- helpers
create or replace function public._token() returns text language sql volatile as $$ select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '') $$;

-- A credential counts if it's verified and not expired.
create or replace function public._has_credential(p_worker uuid, p_type text) returns text
language sql stable security definer set search_path = public as $$
  select case
    when not exists (select 1 from credentials where worker_id = p_worker and lower(type) = lower(p_type) and status not in ('rejected')) then 'not uploaded'
    when exists (select 1 from credentials where worker_id = p_worker and lower(type) = lower(p_type) and status = 'verified' and (expires is null or expires >= current_date)) then null
    when exists (select 1 from credentials where worker_id = p_worker and lower(type) = lower(p_type) and status = 'verified') then 'expired'
    when exists (select 1 from credentials where worker_id = p_worker and lower(type) = lower(p_type) and status = 'unable_to_verify') then 'could not be verified'
    else 'awaiting verification' end
$$;

-- Same checks as before, plus each project's required credentials.
create or replace function public.site_blockers(p_worker uuid, p_project uuid) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare out text[] := '{}'; w workers; s swms; r record; why text;
begin
  select * into w from workers where id = p_worker;
  why := _has_credential(p_worker, 'White Card');
  if why is not null then out := out || ('White Card — ' || why); end if;
  if not exists (select 1 from inductions where worker_id = p_worker and project_id = p_project) then
    out := out || 'Site induction — not yet inducted to this site'::text;
  end if;
  for r in select type from project_requirements where project_id = p_project and lower(type) <> 'white card' order by type loop
    why := _has_credential(p_worker, r.type);
    if why is not null then out := out || (r.type || ' — ' || why); end if;
  end loop;
  for s in select * from swms where project_id = p_project and contractor_id = w.contractor_id and status = 'approved' loop
    if not exists (select 1 from swms_acks where swms_id = s.id and worker_id = p_worker) then
      out := out || format('SWMS · %s v%s — needs signing', s.title, s.version);
    end if;
  end loop;
  return out;
end $$;

create or replace function public._portal(p_token text, p_kind text) returns public.portal_links
language plpgsql stable security definer set search_path = public as $$
declare l portal_links;
begin
  select * into l from portal_links where token = p_token and kind = p_kind;
  if not found then perform _fail('This link isn''t valid any more. Ask the site office for a new one.'); end if;
  return l;
end $$;

-- Uploads through a link go to "<org_id>/portal/<token>/<file>".
create or replace function public.portal_upload_ok(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((storage.foldername(p_name))[2] = 'portal' and exists (
    select 1 from portal_links l where l.token = (storage.foldername(p_name))[3] and l.org_id::text = (storage.foldername(p_name))[1]), false)
$$;
create policy "portal uploads" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'documents' and public.portal_upload_ok(name));

create or replace function public._portal_file(l public.portal_links, p_path text) returns text
language plpgsql stable as $$
begin
  if nullif(p_path, '') is null then return null; end if;
  if p_path not like l.org_id::text || '/portal/' || l.token || '/%' then perform _fail('That file wasn''t uploaded through this link.'); end if;
  return p_path;
end $$;

-- ------------------------------------------------------- office: credentials
create or replace function public.add_credential(p_worker uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare w workers; m memberships; v uuid; office boolean; t text := trim(coalesce(p ->> 'type', '')); sighted boolean := coalesce((p ->> 'sighted')::boolean, false);
begin
  select * into w from workers where id = p_worker;
  if not found then perform _fail('Worker not found.'); end if;
  m := _me(w.org_id);
  office := role_can(m.role, 'people.manage');
  if not (office or m.worker_id = w.id or (m.role = 'subcontractor_admin' and m.contractor_id = w.contractor_id)) then perform _fail('You can''t add credentials for this worker.'); end if;
  if t = '' then perform _fail('Choose the credential type.'); end if;
  if nullif(p ->> 'file_path', '') is not null and (p ->> 'file_path') not like w.org_id::text || '/%' then perform _fail('That file isn''t in your company''s storage.'); end if;
  if sighted and not office then perform _fail('Only the site office can record a credential as sighted and verified.'); end if;
  if sighted and m.worker_id = w.id then perform _fail('Someone else needs to verify your own credential.'); end if;
  if not sighted and nullif(p ->> 'file_path', '') is null then perform _fail('Attach a photo or scan of the card, or tick that you sighted the original.'); end if;
  insert into credentials (org_id, worker_id, type, number, issuer, expires, file_path, status, verified_by, verified_method, verified_at, submitted_by, source)
  values (w.org_id, w.id, t, nullif(trim(coalesce(p ->> 'number', '')), ''), nullif(trim(coalesce(p ->> 'issuer', '')), ''), nullif(p ->> 'expires', '')::date, nullif(p ->> 'file_path', ''),
    case when sighted then 'verified' else 'awaiting_verification' end, case when sighted then auth.uid() end,
    case when sighted then coalesce(nullif(trim(p ->> 'method'), ''), 'Original sighted') end, case when sighted then now() end, auth.uid(),
    case when office then 'office' when m.worker_id = w.id then 'worker' else 'contractor' end)
  returning id into v;
  perform _audit(w.org_id, null, 'credential', v::text, case when sighted then 'Credential verified' else 'Credential uploaded' end, null, case when sighted then 'verified' else 'awaiting_verification' end, w.name || ' · ' || t);
  return jsonb_build_object('id', v, 'message', format('%s added for %s%s', t, w.name, case when sighted then ' — verified.' else ' — waiting for verification.' end));
end $$;

create or replace function public.review_credential(p_cred uuid, p_decision text, p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public as $$
declare c credentials; w workers; m memberships; note text := nullif(trim(coalesce(p ->> 'note', '')), '');
begin
  select * into c from credentials where id = p_cred for update;
  if not found then perform _fail('Credential not found.'); end if;
  select * into w from workers where id = c.worker_id;
  m := _require(c.org_id, 'people.manage');
  if m.worker_id = c.worker_id then perform _fail('Someone else needs to verify your own credential.'); end if;
  if p_decision = 'verify' then
    if length(trim(coalesce(p ->> 'method', ''))) = 0 then perform _fail('Record how you verified it (e.g. original sighted, checked the online register).'); end if;
    update credentials set status = 'verified', verified_by = auth.uid(), verified_at = now(), verified_method = trim(p ->> 'method'), notes = coalesce(note, notes), reject_reason = null,
      expires = coalesce(nullif(p ->> 'expires', '')::date, expires), number = coalesce(nullif(trim(coalesce(p ->> 'number', '')), ''), number) where id = c.id;
  elsif p_decision = 'reject' then
    if note is null then perform _fail('Say why it''s rejected so the worker can fix it.'); end if;
    update credentials set status = 'rejected', reject_reason = note, verified_by = auth.uid(), verified_at = now() where id = c.id;
  elsif p_decision = 'unable' then
    if note is null then perform _fail('Note why it couldn''t be verified (e.g. register offline, details don''t match).'); end if;
    update credentials set status = 'unable_to_verify', notes = note, verified_by = auth.uid(), verified_at = now() where id = c.id;
  else
    perform _fail('Unknown decision.');
  end if;
  select * into c from credentials where id = p_cred;
  perform _audit(c.org_id, null, 'credential', c.id::text, 'Credential ' || replace(c.status, '_', ' '), null, c.status, w.name || ' · ' || c.type || coalesce(' — ' || note, ''));
  return jsonb_build_object('message', format('%s for %s %s.', c.type, w.name, case c.status when 'verified' then 'verified' when 'rejected' then 'rejected' else 'marked as unable to verify' end));
end $$;

create or replace function public.set_project_requirements(p_project uuid, p_types jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects; t text; n int := 0;
begin
  select * into pr from projects where id = p_project;
  if not found then perform _fail('Project not found.'); end if;
  perform _require(pr.org_id, 'people.manage');
  delete from project_requirements where project_id = pr.id;
  for t in select distinct trim(x) from jsonb_array_elements_text(coalesce(p_types, '[]')) x where length(trim(x)) > 0 and lower(trim(x)) <> 'white card' loop
    insert into project_requirements (org_id, project_id, type) values (pr.org_id, pr.id, t); n := n + 1;
  end loop;
  perform _audit(pr.org_id, pr.id, 'project', pr.id::text, 'Site requirements changed', null, null, coalesce((select string_agg(type, ', ') from project_requirements where project_id = pr.id), 'White Card only'));
  return jsonb_build_object('message', case when n = 0 then 'Only the White Card and induction are required on this site.' else format('%s extra credential%s now required to sign in.', n, case when n = 1 then ' is' else 's are' end) end);
end $$;

-- ------------------------------------------------------- office: contractors
create or replace function public.save_contractor(p_contractor uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c contractors; pq text := coalesce(nullif(p ->> 'prequal_status', ''), null);
begin
  select * into c from contractors where id = p_contractor for update;
  if not found then perform _fail('Contractor not found.'); end if;
  perform _require(c.org_id, 'people.manage');
  if length(trim(coalesce(p ->> 'trading_name', c.trading_name))) = 0 then perform _fail('Enter the trading name.'); end if;
  if pq = 'approved' and nullif(p ->> 'prequal_expires', '') is null and c.prequal_expires is null then perform _fail('Set when the prequalification expires.'); end if;
  update contractors set trading_name = trim(coalesce(p ->> 'trading_name', trading_name)), legal_name = coalesce(nullif(trim(coalesce(p ->> 'legal_name', '')), ''), legal_name),
    abn = coalesce(p ->> 'abn', abn), trade = coalesce(p ->> 'trade', trade), email = coalesce(p ->> 'email', email), phone = coalesce(p ->> 'phone', phone), address = coalesce(p ->> 'address', address),
    contact_name = coalesce(p ->> 'contact_name', contact_name), contact_phone = coalesce(p ->> 'contact_phone', contact_phone), emergency_name = coalesce(p ->> 'emergency_name', emergency_name),
    emergency_phone = coalesce(p ->> 'emergency_phone', emergency_phone),
    trades = coalesce((select array_agg(trim(x)) from jsonb_array_elements_text(p -> 'trades') x where length(trim(x)) > 0), case when p ? 'trades' then '{}'::text[] else trades end),
    prequal_status = coalesce(pq, prequal_status), prequal_expires = coalesce(nullif(p ->> 'prequal_expires', '')::date, prequal_expires), prequal_notes = coalesce(p ->> 'prequal_notes', prequal_notes)
  where id = c.id;
  perform _audit(c.org_id, null, 'contractor', c.id::text, 'Contractor details changed', c.prequal_status, coalesce(pq, c.prequal_status), c.trading_name);
  return jsonb_build_object('message', c.trading_name || ' saved.');
end $$;

create or replace function public.add_insurance(p_contractor uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c contractors; v uuid; t text := trim(coalesce(p ->> 'type', '')); sighted boolean := coalesce((p ->> 'sighted')::boolean, false);
begin
  select * into c from contractors where id = p_contractor;
  if not found then perform _fail('Contractor not found.'); end if;
  perform _require(c.org_id, 'people.manage');
  if t = '' then perform _fail('Choose the insurance type.'); end if;
  if nullif(p ->> 'expires', '') is null then perform _fail('Enter the expiry date from the certificate of currency.'); end if;
  if nullif(p ->> 'file_path', '') is not null and (p ->> 'file_path') not like c.org_id::text || '/%' then perform _fail('That file isn''t in your company''s storage.'); end if;
  if not sighted and nullif(p ->> 'file_path', '') is null then perform _fail('Attach the certificate of currency, or tick that you sighted it.'); end if;
  insert into insurances (org_id, contractor_id, type, expires, verified, insurer, policy_number, cover_limit, file_path, status, verified_by, verified_at, source)
  values (c.org_id, c.id, t, (p ->> 'expires')::date, sighted, nullif(trim(coalesce(p ->> 'insurer', '')), ''), nullif(trim(coalesce(p ->> 'policy_number', '')), ''), nullif(p ->> 'cover_limit', '')::bigint,
    nullif(p ->> 'file_path', ''), case when sighted then 'verified' else 'awaiting_verification' end, case when sighted then auth.uid() end, case when sighted then now() end, 'office')
  returning id into v;
  perform _audit(c.org_id, null, 'insurance', v::text, 'Insurance added', null, case when sighted then 'verified' else 'awaiting_verification' end, c.trading_name || ' · ' || t);
  return jsonb_build_object('id', v, 'message', format('%s for %s added%s', t, c.trading_name, case when sighted then '.' else ' — waiting for verification.' end));
end $$;

create or replace function public.review_compliance_item(p_kind text, p_id uuid, p_decision text, p_note text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare org uuid; label text; note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if p_kind = 'insurance' then select i.org_id, c.trading_name || ' · ' || i.type into org, label from insurances i join contractors c on c.id = i.contractor_id where i.id = p_id;
  elsif p_kind = 'doc' then select d.org_id, c.trading_name || ' · ' || d.title into org, label from contractor_docs d join contractors c on c.id = d.contractor_id where d.id = p_id;
  else perform _fail('Unknown item.'); end if;
  if org is null then perform _fail('Not found.'); end if;
  perform _require(org, 'people.manage');
  if p_decision not in ('verify','reject') then perform _fail('Unknown decision.'); end if;
  if p_decision = 'reject' and note is null then perform _fail('Say why it''s rejected.'); end if;
  if p_kind = 'insurance' then
    update insurances set status = case when p_decision = 'verify' then 'verified' else 'rejected' end, verified = p_decision = 'verify', verified_by = auth.uid(), verified_at = now(), notes = coalesce(note, notes) where id = p_id;
  else
    update contractor_docs set status = case when p_decision = 'verify' then 'verified' else 'rejected' end, reviewed_by = auth.uid(), reviewed_at = now(), notes = coalesce(note, notes) where id = p_id;
  end if;
  perform _audit(org, null, p_kind, p_id::text, case when p_decision = 'verify' then 'Compliance item verified' else 'Compliance item rejected' end, null, null, label || coalesce(' — ' || note, ''));
  return jsonb_build_object('message', label || case when p_decision = 'verify' then ' verified.' else ' rejected.' end);
end $$;

create or replace function public.add_contractor_doc(p_contractor uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c contractors; v uuid;
begin
  select * into c from contractors where id = p_contractor;
  if not found then perform _fail('Contractor not found.'); end if;
  perform _require(c.org_id, 'people.manage');
  if length(trim(coalesce(p ->> 'title', ''))) = 0 then perform _fail('Give the document a title.'); end if;
  if nullif(p ->> 'file_path', '') is null or (p ->> 'file_path') not like c.org_id::text || '/%' then perform _fail('Choose the file to upload.'); end if;
  insert into contractor_docs (org_id, contractor_id, kind, title, file_path, expires, status, uploaded_by, reviewed_by, reviewed_at)
  values (c.org_id, c.id, coalesce(nullif(trim(p ->> 'kind'), ''), 'Other'), trim(p ->> 'title'), p ->> 'file_path', nullif(p ->> 'expires', '')::date, 'verified', auth.uid(), auth.uid(), now())
  returning id into v;
  perform _audit(c.org_id, null, 'contractor', c.id::text, 'Company document added', null, null, c.trading_name || ' · ' || trim(p ->> 'title'));
  return jsonb_build_object('id', v, 'message', trim(p ->> 'title') || ' added.');
end $$;

-- A private self-service link for a worker or contractor (created on first use).
create or replace function public.portal_link(p_kind text, p_id uuid, p_reset boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare org uuid; l portal_links;
begin
  if p_kind = 'worker' then select org_id into org from workers where id = p_id; elsif p_kind = 'contractor' then select org_id into org from contractors where id = p_id; else perform _fail('Unknown link.'); end if;
  if org is null then perform _fail('Not found.'); end if;
  perform _require(org, 'people.manage');
  if p_reset then delete from portal_links where kind = p_kind and ref_id = p_id; end if;
  select * into l from portal_links where kind = p_kind and ref_id = p_id;
  if not found then insert into portal_links (org_id, kind, ref_id, token, created_by) values (org, p_kind, p_id, _token(), auth.uid()) returning * into l; end if;
  if p_reset then perform _audit(org, null, p_kind, p_id::text, 'Self-service link replaced'); end if;
  return jsonb_build_object('token', l.token, 'message', case when p_reset then 'New link created — the old one no longer works.' else 'Link ready.' end);
end $$;

-- --------------------------------------------- self-service (no account)
create or replace function public._worker_wallet(w public.workers) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('org_id', w.org_id, 'name', w.name, 'company', (select trading_name from contractors where id = w.contractor_id), 'org', (select name from organisations where id = w.org_id),
    'credentials', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'type', c.type, 'number', c.number, 'issuer', c.issuer, 'expires', c.expires,
      'status', case when c.status = 'verified' and c.expires < current_date then 'expired' else c.status end, 'reason', c.reject_reason) order by c.type) from credentials c where c.worker_id = w.id), '[]'),
    'required', coalesce((select jsonb_agg(distinct r.type) from project_requirements r join inductions i on i.project_id = r.project_id where i.worker_id = w.id), '[]'))
$$;

create or replace function public.wallet_info(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l portal_links := _portal(p_token, 'worker'); w workers;
begin
  select * into w from workers where id = l.ref_id;
  return _worker_wallet(w);
end $$;

create or replace function public.wallet_add(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l portal_links := _portal(p_token, 'worker'); w workers; v uuid; f text;
begin
  select * into w from workers where id = l.ref_id;
  if length(trim(coalesce(p ->> 'type', ''))) = 0 then perform _fail('Choose what you''re uploading.'); end if;
  f := _portal_file(l, p ->> 'file_path');
  if f is null then perform _fail('Take a photo of the card or certificate.'); end if;
  if (select count(*) from credentials where worker_id = w.id and status = 'awaiting_verification') >= 20 then perform _fail('You have 20 uploads waiting for review. Ask the site office to check them.'); end if;
  insert into credentials (org_id, worker_id, type, number, issuer, expires, file_path, status, source)
  values (w.org_id, w.id, left(trim(p ->> 'type'), 80), left(nullif(trim(coalesce(p ->> 'number', '')), ''), 60), left(nullif(trim(coalesce(p ->> 'issuer', '')), ''), 80), nullif(p ->> 'expires', '')::date, f, 'awaiting_verification', 'worker')
  returning id into v;
  perform _audit(w.org_id, null, 'credential', v::text, 'Credential uploaded by the worker', null, 'awaiting_verification', w.name || ' · ' || trim(p ->> 'type'));
  return jsonb_build_object('id', v, 'message', 'Thanks — the site office will check it.');
end $$;

create or replace function public.supplier_info(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l portal_links := _portal(p_token, 'contractor'); c contractors;
begin
  select * into c from contractors where id = l.ref_id;
  return jsonb_build_object('org_id', c.org_id, 'company', c.trading_name, 'legal_name', c.legal_name, 'abn', c.abn, 'org', (select name from organisations where id = c.org_id),
    'email', c.email, 'phone', c.phone, 'address', c.address, 'contact_name', c.contact_name, 'contact_phone', c.contact_phone, 'emergency_name', c.emergency_name, 'emergency_phone', c.emergency_phone,
    'insurances', coalesce((select jsonb_agg(jsonb_build_object('type', i.type, 'insurer', i.insurer, 'expires', i.expires, 'cover_limit', i.cover_limit, 'status', case when i.expires < current_date then 'expired' else i.status end) order by i.type) from insurances i where i.contractor_id = c.id), '[]'),
    'docs', coalesce((select jsonb_agg(jsonb_build_object('kind', d.kind, 'title', d.title, 'expires', d.expires, 'status', d.status) order by d.uploaded_at desc) from contractor_docs d where d.contractor_id = c.id), '[]'),
    'workers', coalesce((select jsonb_agg(jsonb_build_object('name', w.name, 'issues', (select count(*) from credentials x where x.worker_id = w.id and (x.status in ('rejected','awaiting_verification','unable_to_verify') or x.expires < current_date)),
      'white_card', _has_credential(w.id, 'White Card') is null) order by w.name) from workers w where w.contractor_id = c.id), '[]'));
end $$;

create or replace function public.supplier_update(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l portal_links := _portal(p_token, 'contractor'); c contractors;
begin
  select * into c from contractors where id = l.ref_id;
  update contractors set email = left(coalesce(nullif(trim(p ->> 'email'), ''), email), 120), phone = left(coalesce(nullif(trim(p ->> 'phone'), ''), phone), 40), address = left(coalesce(nullif(trim(p ->> 'address'), ''), address), 200),
    contact_name = left(coalesce(nullif(trim(p ->> 'contact_name'), ''), contact_name), 120), contact_phone = left(coalesce(nullif(trim(p ->> 'contact_phone'), ''), contact_phone), 40),
    emergency_name = left(coalesce(nullif(trim(p ->> 'emergency_name'), ''), emergency_name), 120), emergency_phone = left(coalesce(nullif(trim(p ->> 'emergency_phone'), ''), emergency_phone), 40)
  where id = c.id;
  perform _audit(c.org_id, null, 'contractor', c.id::text, 'Contact details updated by the contractor', null, null, c.trading_name);
  return jsonb_build_object('message', 'Details saved.');
end $$;

create or replace function public.supplier_add(p_token text, p_what text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l portal_links := _portal(p_token, 'contractor'); c contractors; v uuid; f text;
begin
  select * into c from contractors where id = l.ref_id;
  f := _portal_file(l, p ->> 'file_path');
  if f is null then perform _fail('Choose the file to upload.'); end if;
  if (select count(*) from insurances where contractor_id = c.id and status = 'awaiting_verification') + (select count(*) from contractor_docs where contractor_id = c.id and status = 'awaiting_verification') >= 30 then
    perform _fail('There are 30 uploads waiting for review. Ask the head contractor to check them.');
  end if;
  if p_what = 'insurance' then
    if length(trim(coalesce(p ->> 'type', ''))) = 0 then perform _fail('Choose the insurance type.'); end if;
    if nullif(p ->> 'expires', '') is null then perform _fail('Enter the expiry date from the certificate.'); end if;
    insert into insurances (org_id, contractor_id, type, expires, verified, insurer, policy_number, cover_limit, file_path, status, source)
    values (c.org_id, c.id, left(trim(p ->> 'type'), 60), (p ->> 'expires')::date, false, left(nullif(trim(coalesce(p ->> 'insurer', '')), ''), 80), left(nullif(trim(coalesce(p ->> 'policy_number', '')), ''), 60),
      nullif(p ->> 'cover_limit', '')::bigint, f, 'awaiting_verification', 'contractor') returning id into v;
  elsif p_what = 'doc' then
    if length(trim(coalesce(p ->> 'title', ''))) = 0 then perform _fail('Give the document a title.'); end if;
    insert into contractor_docs (org_id, contractor_id, kind, title, file_path, expires, status, source)
    values (c.org_id, c.id, left(coalesce(nullif(trim(p ->> 'kind'), ''), 'Other'), 60), left(trim(p ->> 'title'), 120), f, nullif(p ->> 'expires', '')::date, 'awaiting_verification', 'contractor') returning id into v;
  else
    perform _fail('Unknown upload.');
  end if;
  perform _audit(c.org_id, null, p_what, v::text, 'Uploaded by the contractor', null, 'awaiting_verification', c.trading_name);
  return jsonb_build_object('id', v, 'message', 'Uploaded — the head contractor will check it.');
end $$;

-- ---------------------------------------------------------------- grants
do $$
declare f text;
begin
  foreach f in array array['public.add_credential(uuid, jsonb)', 'public.review_credential(uuid, text, jsonb)', 'public.set_project_requirements(uuid, jsonb)', 'public.save_contractor(uuid, jsonb)',
    'public.add_insurance(uuid, jsonb)', 'public.review_compliance_item(text, uuid, text, text)', 'public.add_contractor_doc(uuid, jsonb)', 'public.portal_link(text, uuid, boolean)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array['public.wallet_info(text)', 'public.wallet_add(text, jsonb)', 'public.supplier_info(text)', 'public.supplier_update(text, jsonb)', 'public.supplier_add(text, text, jsonb)', 'public.portal_upload_ok(text)'] loop
    execute format('revoke execute on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
  foreach f in array array['public._token()', 'public._has_credential(uuid, text)', 'public._portal(text, text)', 'public._portal_file(public.portal_links, text)', 'public._worker_wallet(public.workers)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;
revoke execute on function public.site_blockers(uuid, uuid) from public, anon, authenticated;
