-- =====================================================================
-- Documents & drawings (blueprint §5.3)
--
--  * A document number (e.g. A-102) has revisions. Controlled categories
--    (drawings, specifications, contracts) go to review: a new revision
--    becomes current only once approved, then the previous current
--    revision is marked superseded and kept for audit.
--  * Other categories (minutes, correspondence, safety, handover…) are
--    issued straight away and supersede the previous revision.
--  * Files live in the private "documents" bucket under "<org_id>/".
-- =====================================================================

create or replace function public.role_can(p_role text, p_perm text) returns boolean
language sql immutable as $$
  select case p_role
    when 'director' then p_perm = any (array['defect.create','defect.assign','defect.verify','itp.release_hold','itp.manage','itp.submit','swms.submit','variation.create','variation.approve','swms.review','commercial.view','diary.submit','people.manage','project.manage','documents.upload','documents.approve'])
    when 'project_manager' then p_perm = any (array['defect.create','defect.assign','defect.verify','itp.release_hold','itp.manage','itp.submit','swms.submit','variation.create','variation.approve','swms.review','commercial.view','diary.submit','people.manage','project.manage','documents.upload','documents.approve'])
    when 'site_supervisor' then p_perm = any (array['defect.create','defect.assign','defect.verify','itp.submit','swms.submit','swms.review','diary.submit','people.manage','documents.upload'])
    when 'quality_manager' then p_perm = any (array['defect.create','defect.assign','defect.verify','itp.release_hold','itp.manage','itp.submit','documents.upload','documents.approve'])
    when 'subcontractor_admin' then p_perm = any (array['defect.rectify','variation.create','itp.submit','swms.submit','documents.upload'])
    when 'worker' then p_perm = any (array['defect.create'])
    else false end;
$$;

alter table public.documents
  add column if not exists file_path text,
  add column if not exists file_name text,
  add column if not exists file_size bigint,
  add column if not exists mime_type text,
  add column if not exists description text,
  add column if not exists contractor_id uuid references public.contractors (id) on delete set null,
  add column if not exists task_id uuid references public.tasks (id) on delete set null,
  add column if not exists reviewed_by uuid,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_comment text;

alter table public.documents drop constraint if exists documents_status_check;
alter table public.documents add constraint documents_status_check check (status in ('current','in_review','superseded','rejected'));
create unique index if not exists documents_number_revision on public.documents (project_id, lower(number), lower(revision));

-- Drawings, specifications and contracts need review before they're current.
create or replace function public.document_needs_review(p_category text) returns boolean
language sql immutable as $$ select coalesce(p_category, '') in ('Architectural','Structural','Services','Civil','Specification','Contract') $$;

create or replace function public.upload_document(p_project uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects; m memberships; v uuid; num text := upper(trim(coalesce(p ->> 'number', ''))); rev text := trim(coalesce(p ->> 'revision', ''));
  cat text := coalesce(nullif(trim(coalesce(p ->> 'category', '')), ''), 'Other'); cur documents; review boolean;
begin
  select * into pr from projects where id = p_project;
  if not found then perform _fail('Project not found.'); end if;
  m := _require(pr.org_id, 'documents.upload');
  if num = '' then perform _fail('Enter the document number, e.g. A-102.'); end if;
  if length(trim(coalesce(p ->> 'title', ''))) = 0 then perform _fail('Enter the document title.'); end if;
  if rev = '' then perform _fail('Enter the revision, e.g. 4 or C.'); end if;
  if nullif(p ->> 'file_path', '') is null then perform _fail('Choose the file to upload.'); end if;
  if (p ->> 'file_path') not like pr.org_id::text || '/%' then perform _fail('That file isn''t in your company''s storage.'); end if;
  if exists (select 1 from documents where project_id = pr.id and lower(number) = lower(num) and lower(revision) = lower(rev)) then
    perform _fail(format('%s revision %s already exists. Use the next revision.', num, rev));
  end if;
  if exists (select 1 from documents where project_id = pr.id and lower(number) = lower(num) and status = 'in_review') then
    perform _fail(format('A revision of %s is already waiting for review.', num));
  end if;
  if nullif(p ->> 'task_id', '') is not null and not exists (select 1 from tasks where id = (p ->> 'task_id')::uuid and project_id = pr.id) then perform _fail('That task isn''t on this project.'); end if;
  if nullif(p ->> 'contractor_id', '') is not null and not exists (select 1 from contractors where id = (p ->> 'contractor_id')::uuid and org_id = pr.org_id) then perform _fail('Contractor not found.'); end if;
  select * into cur from documents where project_id = pr.id and lower(number) = lower(num) and status = 'current' limit 1;
  review := document_needs_review(cat);
  insert into documents (org_id, project_id, number, title, category, revision, status, uploaded_by, file_path, file_name, file_size, mime_type, description, contractor_id, task_id)
  values (pr.org_id, pr.id, num, trim(p ->> 'title'), cat, rev, case when review then 'in_review' else 'current' end, auth.uid(),
    p ->> 'file_path', nullif(p ->> 'file_name', ''), nullif(p ->> 'file_size', '')::bigint, nullif(p ->> 'mime_type', ''),
    nullif(trim(coalesce(p ->> 'description', '')), ''), nullif(p ->> 'contractor_id', '')::uuid, nullif(p ->> 'task_id', '')::uuid)
  returning id into v;
  if not review and cur.id is not null then update documents set status = 'superseded' where id = cur.id; end if;
  perform _audit(pr.org_id, pr.id, 'document', v::text, case when review then 'Document uploaded for review' else 'Document issued' end,
    null, case when review then 'in_review' else 'current' end, num || ' rev ' || rev || ' · ' || trim(p ->> 'title') || case when cur.id is not null then ' (current: rev ' || cur.revision || ')' else '' end);
  return jsonb_build_object('id', v, 'message', case
    when review and cur.id is not null then format('%s rev %s uploaded for review. Rev %s stays current until it''s approved.', num, rev, cur.revision)
    when review then format('%s rev %s uploaded for review.', num, rev)
    when cur.id is not null then format('%s rev %s issued; rev %s is now superseded.', num, rev, cur.revision)
    else format('%s rev %s issued.', num, rev) end);
end $$;

create or replace function public.review_document(p_document uuid, p_decision text, p_comment text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare d documents; prev documents;
begin
  select * into d from documents where id = p_document for update;
  if not found then perform _fail('Document not found.'); end if;
  perform _require(d.org_id, 'documents.approve');
  if d.status <> 'in_review' then perform _fail('This revision isn''t waiting for review.'); end if;
  if p_decision = 'approve' then
    select * into prev from documents where project_id = d.project_id and lower(number) = lower(d.number) and status = 'current' and id <> d.id limit 1;
    if prev.id is not null then update documents set status = 'superseded' where id = prev.id; end if;
    update documents set status = 'current', reviewed_by = auth.uid(), reviewed_at = now(), review_comment = nullif(trim(coalesce(p_comment, '')), '') where id = d.id;
    perform _audit(d.org_id, d.project_id, 'document', d.id::text, d.number || ' rev ' || d.revision || ' issued for construction', 'in_review', 'current',
      case when prev.id is not null then 'supersedes rev ' || prev.revision else null end);
    return jsonb_build_object('message', format('%s rev %s is now current%s.', d.number, d.revision, case when prev.id is not null then '; rev ' || prev.revision || ' superseded' else '' end));
  elsif p_decision = 'reject' then
    if length(trim(coalesce(p_comment, ''))) = 0 then perform _fail('Say why the revision is rejected.'); end if;
    update documents set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), review_comment = trim(p_comment) where id = d.id;
    perform _audit(d.org_id, d.project_id, 'document', d.id::text, 'Document revision rejected', 'in_review', 'rejected', d.number || ' rev ' || d.revision || ' — ' || trim(p_comment));
    return jsonb_build_object('message', format('%s rev %s rejected. The current revision is unchanged.', d.number, d.revision));
  end if;
  perform _fail('Unknown decision.');
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.upload_document(uuid, jsonb)', 'public.review_document(uuid, text, text)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
grant execute on function public.role_can(text, text), public.document_needs_review(text) to anon, authenticated;
