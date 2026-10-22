-- =====================================================================
-- Costs & claims (blueprint §7)
--
--  * Budget by cost code (standard, provisional sum or prime cost item).
--  * Purchase orders commit cost; supplier bills, approved receipts,
--    internal charges and processed labour are actual cost; agreed
--    backcharges to a subcontractor reduce it. The running-cost ledger is
--    worked out from these records (app/js/core.js costLedger).
--  * Bills: entered by one person and approved by another where there is
--    one; a bill that takes a PO over its value needs a reason.
--  * Progress claims: lump sum (schedule of contract items + approved
--    variations, retention to a cap) or cost-plus (unclaimed costs + fee,
--    labour at chargeout). Draft → submitted → certified → paid; a
--    submitted claim is never edited.
--  * All amounts are cents, excluding GST unless named gst.
-- =====================================================================

create or replace function public.role_can(p_role text, p_perm text) returns boolean
language sql immutable as $$
  select case p_role
    when 'director' then p_perm = any (array['defect.create','defect.assign','defect.verify','itp.release_hold','itp.manage','itp.submit','swms.submit','variation.create','variation.approve','swms.review','commercial.view','diary.submit','people.manage','project.manage','documents.upload','documents.approve','ncr.manage','permit.request','permit.approve','safety.report','safety.manage','attendance.manage','timesheet.submit','timesheet.approve','timesheet.process','rates.manage','task.assign','cost.manage','receipt.submit'])
    when 'project_manager' then p_perm = any (array['defect.create','defect.assign','defect.verify','itp.release_hold','itp.manage','itp.submit','swms.submit','variation.create','variation.approve','swms.review','commercial.view','diary.submit','people.manage','project.manage','documents.upload','documents.approve','ncr.manage','permit.request','permit.approve','safety.report','safety.manage','attendance.manage','timesheet.submit','timesheet.approve','timesheet.process','rates.manage','task.assign','cost.manage','receipt.submit'])
    when 'site_supervisor' then p_perm = any (array['defect.create','defect.assign','defect.verify','itp.submit','swms.submit','swms.review','diary.submit','people.manage','documents.upload','ncr.manage','permit.request','permit.approve','safety.report','safety.manage','attendance.manage','timesheet.submit','timesheet.approve','task.assign','receipt.submit'])
    when 'quality_manager' then p_perm = any (array['defect.create','defect.assign','defect.verify','itp.release_hold','itp.manage','itp.submit','documents.upload','documents.approve','ncr.manage','safety.report','task.assign','receipt.submit'])
    when 'subcontractor_admin' then p_perm = any (array['defect.rectify','variation.create','itp.submit','swms.submit','documents.upload','permit.request','safety.report','timesheet.submit'])
    when 'worker' then p_perm = any (array['defect.create','permit.request','safety.report','timesheet.submit','receipt.submit'])
    else false end;
$$;

-- ------------------------------------------------------------ contract set-up
alter table public.projects
  add column if not exists contract_type text not null default 'lump_sum' check (contract_type in ('lump_sum','cost_plus')),
  add column if not exists retention_pct numeric(5,2) not null default 5 check (retention_pct between 0 and 20),
  add column if not exists retention_cap_pct numeric(5,2) not null default 5 check (retention_cap_pct between 0 and 20),
  add column if not exists fee_pct numeric(5,2) not null default 0 check (fee_pct between 0 and 100);

alter table public.budget_lines
  add column if not exists kind text not null default 'standard' check (kind in ('standard','ps','pc')),
  add column if not exists forecast_override bigint check (forecast_override >= 0);

create table public.contract_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  seq int not null default 0,
  description text not null,
  value bigint not null check (value >= 0)
);

-- --------------------------------------------------------------- costs
create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  ref text not null,
  contractor_id uuid not null references public.contractors (id),
  cost_code text not null,
  description text not null,
  amount bigint not null check (amount > 0),
  status text not null default 'issued' check (status in ('issued','closed','cancelled')),
  issued_by uuid,
  issued_at timestamptz not null default now(),
  closed_by uuid,
  closed_at timestamptz,
  unique (project_id, ref)
);

create table public.bills (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  contractor_id uuid not null references public.contractors (id),
  invoice_number text not null,
  invoice_date date not null,
  due_date date,
  amount bigint not null check (amount >= 0),
  gst bigint not null default 0 check (gst >= 0),
  cost_code text not null,
  po_id uuid references public.purchase_orders (id),
  description text,
  file_path text,
  status text not null default 'received' check (status in ('received','approved','paid','disputed')),
  entered_by uuid,
  entered_at timestamptz not null default now(),
  approved_by uuid,
  approved_at timestamptz,
  over_po_reason text,
  dispute_reason text,
  paid_at date,
  claim_id uuid references public.claims (id) on delete set null
);
create unique index bills_invoice on public.bills (org_id, contractor_id, lower(invoice_number));

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  supplier text not null,
  date date not null,
  amount bigint not null check (amount > 0),
  gst bigint not null default 0 check (gst >= 0),
  cost_code text,
  paid_with text not null check (paid_with in ('company_card','personal','cash','account')),
  photo_path text,
  note text,
  submitted_by uuid,
  submitted_at timestamptz not null default now(),
  status text not null default 'submitted' check (status in ('submitted','approved','rejected')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  reject_reason text,
  reimbursed_at timestamptz,
  claim_id uuid references public.claims (id) on delete set null
);

create table public.internal_charges (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  date date not null,
  cost_code text not null,
  description text not null,
  amount bigint not null check (amount > 0),
  entered_by uuid,
  entered_at timestamptz not null default now(),
  claim_id uuid references public.claims (id) on delete set null
);

create table public.backcharges (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  ref text not null,
  contractor_id uuid not null references public.contractors (id),
  cost_code text not null,
  reason text not null,
  amount bigint not null check (amount > 0),
  defect_id uuid references public.defects (id) on delete set null,
  status text not null default 'notified' check (status in ('notified','agreed','withdrawn')),
  raised_by uuid,
  raised_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  unique (project_id, ref)
);

-- Claims grow the full breakdown; older rows only have claimed / certified / paid.
alter table public.claims
  add column if not exists claim_type text not null default 'lump_sum' check (claim_type in ('lump_sum','cost_plus')),
  add column if not exists lines jsonb not null default '[]',
  add column if not exists works_to_date bigint,
  add column if not exists previous_gross bigint,
  add column if not exists retention_to_date bigint,
  add column if not exists previous_net bigint,
  add column if not exists gst bigint,
  add column if not exists created_by uuid,
  add column if not exists submitted_at timestamptz,
  add column if not exists certified_at timestamptz,
  add column if not exists certified_by uuid,
  add column if not exists schedule_reason text,
  add column if not exists paid_at date;
create unique index if not exists claims_ref on public.claims (project_id, ref);

alter table public.timesheets add column if not exists claim_id uuid references public.claims (id) on delete set null;

do $$
declare t text;
begin
  foreach t in array array['contract_items','purchase_orders','bills','internal_charges','backcharges'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "commercial roles read" on public.%I for select using (has_perm(org_id, ''commercial.view''))', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
alter table public.receipts enable row level security;
-- Whoever sent a receipt can follow it; the commercial team sees all of them.
create policy "receipts read" on public.receipts for select using (has_perm(org_id, 'commercial.view') or submitted_by = auth.uid());
grant select on public.receipts to authenticated;

-- ---------------------------------------------------------------- helpers
create or replace function public._cost_project(p_project uuid) returns public.projects
language plpgsql stable security definer set search_path = public as $$
declare pr projects;
begin
  select * into pr from projects where id = p_project;
  if not found then perform _fail('Project not found.'); end if;
  perform _require(pr.org_id, 'cost.manage');
  return pr;
end $$;

create or replace function public._code(p text) returns text
language plpgsql immutable as $$
declare c text := nullif(upper(trim(coalesce(p, ''))), '');
begin
  if c is null then perform _fail('Choose the cost code.'); end if;
  if length(c) > 20 then perform _fail('Cost codes are at most 20 characters.'); end if;
  return c;
end $$;

-- PM limit, as for variations: $50,000. Directors have no limit.
create or replace function public._cost_limit(m public.memberships, p_amount bigint, p_what text) returns void
language plpgsql as $$
begin
  if m.role <> 'director' and p_amount > 5000000 then
    perform _fail(format('%s over $50,000 need a director.', p_what));
  end if;
end $$;

-- ---------------------------------------------------------------- budget
create or replace function public.save_budget_line(p_project uuid, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects := _cost_project(p_project); code text := _code(p ->> 'cost_code'); v uuid; b bigint := coalesce(nullif(p ->> 'budget', '')::bigint, 0);
  k text := coalesce(nullif(p ->> 'kind', ''), 'standard'); fo bigint := nullif(p ->> 'forecast_override', '')::bigint;
begin
  if b < 0 or fo < 0 then perform _fail('Amounts can''t be negative.'); end if;
  if k not in ('standard','ps','pc') then perform _fail('Unknown budget type.'); end if;
  if exists (select 1 from budget_lines where project_id = pr.id and lower(cost_code) = lower(code) and id is distinct from p_id) then
    perform _fail(code || ' is already in the budget.');
  end if;
  if p_id is null then
    insert into budget_lines (org_id, project_id, cost_code, description, original_budget, kind, forecast_override)
    values (pr.org_id, pr.id, code, nullif(trim(coalesce(p ->> 'description', '')), ''), b, k, fo) returning id into v;
  else
    update budget_lines set cost_code = code, description = nullif(trim(coalesce(p ->> 'description', '')), ''), original_budget = b, kind = k, forecast_override = fo
    where id = p_id and project_id = pr.id returning id into v;
    if v is null then perform _fail('Budget line not found.'); end if;
  end if;
  perform _audit(pr.org_id, pr.id, 'budget', v::text, case when p_id is null then 'Budget line added' else 'Budget line changed' end, null, null,
    code || ' · ' || _money(b) || case k when 'ps' then ' (provisional sum)' when 'pc' then ' (prime cost)' else '' end || coalesce(' · forecast ' || _money(fo), ''));
  return jsonb_build_object('id', v, 'message', code || ' saved.');
end $$;

create or replace function public.save_contract_setup(p_project uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects := _cost_project(p_project); it jsonb; n int := 0;
begin
  if exists (select 1 from claims where project_id = pr.id and status <> 'draft' and coalesce(claim_type, 'lump_sum') <> coalesce(nullif(p ->> 'contract_type', ''), pr.contract_type)) then
    perform _fail('Claims have been made under the current contract type — it can''t be changed now.');
  end if;
  update projects set contract_type = coalesce(nullif(p ->> 'contract_type', ''), contract_type),
    retention_pct = coalesce(nullif(p ->> 'retention_pct', '')::numeric, retention_pct),
    retention_cap_pct = coalesce(nullif(p ->> 'retention_cap_pct', '')::numeric, retention_cap_pct),
    fee_pct = coalesce(nullif(p ->> 'fee_pct', '')::numeric, fee_pct)
  where id = pr.id;
  if p ? 'items' then
    if exists (select 1 from claims where project_id = pr.id and status <> 'draft' and claim_type = 'lump_sum') then
      perform _fail('The claim schedule is locked once a claim has been submitted. Add changes as variations.');
    end if;
    delete from contract_items where project_id = pr.id;
    for it in select * from jsonb_array_elements(p -> 'items') loop
      if length(trim(coalesce(it ->> 'description', ''))) = 0 then continue; end if;
      if coalesce((it ->> 'value')::bigint, -1) < 0 then perform _fail('Enter a value for ' || (it ->> 'description') || '.'); end if;
      n := n + 1;
      insert into contract_items (org_id, project_id, seq, description, value) values (pr.org_id, pr.id, n, trim(it ->> 'description'), (it ->> 'value')::bigint);
    end loop;
    if n > 0 and (select sum(value) from contract_items where project_id = pr.id) <> pr.contract_sum then
      perform _fail(format('The schedule adds up to %s but the contract sum is %s.', _money((select sum(value) from contract_items where project_id = pr.id)::bigint), _money(pr.contract_sum)));
    end if;
  end if;
  perform _audit(pr.org_id, pr.id, 'project', pr.id::text, 'Contract set-up changed');
  return jsonb_build_object('message', 'Contract set-up saved.');
end $$;

-- ------------------------------------------------------- purchase orders
create or replace function public.create_po(p_project uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects := _cost_project(p_project); m memberships := _me(pr.org_id); v uuid; ref text; amt bigint := nullif(p ->> 'amount', '')::bigint; c contractors;
begin
  select * into c from contractors where id = nullif(p ->> 'contractor_id', '')::uuid and org_id = pr.org_id;
  if not found then perform _fail('Choose the supplier or subcontractor.'); end if;
  if length(trim(coalesce(p ->> 'description', ''))) = 0 then perform _fail('Describe what''s being ordered.'); end if;
  if amt is null or amt <= 0 then perform _fail('Enter the order value (excl. GST).'); end if;
  perform _cost_limit(m, amt, 'Purchase orders');
  ref := _next_ref('purchase_orders', pr.id, 'PO', 4);
  insert into purchase_orders (org_id, project_id, ref, contractor_id, cost_code, description, amount, issued_by)
  values (pr.org_id, pr.id, ref, c.id, _code(p ->> 'cost_code'), trim(p ->> 'description'), amt, auth.uid()) returning id into v;
  perform _audit(pr.org_id, pr.id, 'po', v::text, 'Purchase order issued', null, 'issued', ref || ' · ' || c.trading_name || ' · ' || _money(amt));
  return jsonb_build_object('id', v, 'message', format('%s issued to %s for %s.', ref, c.trading_name, _money(amt)));
end $$;

create or replace function public.po_action(p_po uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x purchase_orders; billed bigint;
begin
  select * into x from purchase_orders where id = p_po for update;
  if not found then perform _fail('Purchase order not found.'); end if;
  perform _cost_project(x.project_id);
  if x.status <> 'issued' then perform _fail(x.ref || ' is already ' || x.status || '.'); end if;
  select coalesce(sum(amount), 0) into billed from bills where po_id = x.id and status <> 'disputed';
  if p_action = 'cancel' and billed > 0 then perform _fail(x.ref || ' has bills against it — close it instead.'); end if;
  if p_action not in ('close','cancel') then perform _fail('Unknown action.'); end if;
  update purchase_orders set status = case when p_action = 'close' then 'closed' else 'cancelled' end, closed_by = auth.uid(), closed_at = now() where id = x.id;
  perform _audit(x.org_id, x.project_id, 'po', x.id::text, 'Purchase order ' || case when p_action = 'close' then 'closed' else 'cancelled' end, 'issued', case when p_action = 'close' then 'closed' else 'cancelled' end,
    x.ref || case when p_action = 'close' then ' · billed ' || _money(billed) || ' of ' || _money(x.amount) else '' end);
  return jsonb_build_object('message', x.ref || case when p_action = 'close' then format(' closed — %s unbilled is no longer committed.', _money(x.amount - billed)) else ' cancelled.' end);
end $$;

-- ------------------------------------------------------------------ bills
create or replace function public.enter_bill(p_project uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects := _cost_project(p_project); v uuid; c contractors; po purchase_orders; amt bigint := nullif(p ->> 'amount', '')::bigint; inv text := trim(coalesce(p ->> 'invoice_number', ''));
begin
  select * into c from contractors where id = nullif(p ->> 'contractor_id', '')::uuid and org_id = pr.org_id;
  if not found then perform _fail('Choose who the bill is from.'); end if;
  if inv = '' then perform _fail('Enter the invoice number.'); end if;
  if amt is null or amt < 0 then perform _fail('Enter the amount (excl. GST).'); end if;
  if exists (select 1 from bills where org_id = pr.org_id and contractor_id = c.id and lower(invoice_number) = lower(inv)) then
    perform _fail(format('Invoice %s from %s is already entered.', inv, c.trading_name));
  end if;
  if nullif(p ->> 'po_id', '') is not null then
    select * into po from purchase_orders where id = (p ->> 'po_id')::uuid and project_id = pr.id;
    if not found then perform _fail('That purchase order isn''t on this project.'); end if;
    if po.contractor_id <> c.id then perform _fail(po.ref || ' was issued to a different company.'); end if;
    if po.status = 'cancelled' then perform _fail(po.ref || ' is cancelled.'); end if;
  end if;
  if nullif(p ->> 'file_path', '') is not null and (p ->> 'file_path') not like pr.org_id::text || '/%' then perform _fail('That file isn''t in your company''s storage.'); end if;
  insert into bills (org_id, project_id, contractor_id, invoice_number, invoice_date, due_date, amount, gst, cost_code, po_id, description, file_path, entered_by)
  values (pr.org_id, pr.id, c.id, inv, coalesce(nullif(p ->> 'invoice_date', '')::date, current_date), nullif(p ->> 'due_date', '')::date, amt,
    coalesce(nullif(p ->> 'gst', '')::bigint, round(amt * 0.1)::bigint), coalesce(po.cost_code, _code(p ->> 'cost_code')), po.id,
    nullif(trim(coalesce(p ->> 'description', '')), ''), nullif(p ->> 'file_path', ''), auth.uid())
  returning id into v;
  perform _audit(pr.org_id, pr.id, 'bill', v::text, 'Bill entered', null, 'received', c.trading_name || ' ' || inv || ' · ' || _money(amt) || coalesce(' · ' || po.ref, ''));
  return jsonb_build_object('id', v, 'message', format('Invoice %s from %s entered for approval.', inv, c.trading_name));
end $$;

create or replace function public.bill_action(p_bill uuid, p_action text, p_note text default '', p_paid date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b bills; m memberships; po purchase_orders; billed bigint; others boolean; note text := nullif(trim(coalesce(p_note, '')), '');
begin
  select * into b from bills where id = p_bill for update;
  if not found then perform _fail('Bill not found.'); end if;
  perform _cost_project(b.project_id);
  m := _me(b.org_id);
  if p_action = 'approve' then
    if b.status not in ('received','disputed') then perform _fail('This bill is already ' || b.status || '.'); end if;
    others := exists (select 1 from memberships where org_id = b.org_id and user_id <> auth.uid() and role_can(role, 'cost.manage'));
    if b.entered_by = auth.uid() and others then perform _fail('You entered this bill — someone else needs to approve it.'); end if;
    perform _cost_limit(m, b.amount, 'Bills');
    if b.po_id is not null then
      select * into po from purchase_orders where id = b.po_id;
      select coalesce(sum(amount), 0) into billed from bills where po_id = po.id and status in ('approved','paid') and id <> b.id;
      if billed + b.amount > po.amount and note is null then
        perform _fail(format('This takes %s to %s, over its %s value. Give a reason to approve it.', po.ref, _money(billed + b.amount), _money(po.amount)));
      end if;
    end if;
    update bills set status = 'approved', approved_by = auth.uid(), approved_at = now(), over_po_reason = case when po.id is not null and billed + b.amount > po.amount then note end, dispute_reason = null where id = b.id;
  elsif p_action = 'dispute' then
    if b.status <> 'received' then perform _fail('Only a bill waiting for approval can be disputed.'); end if;
    if note is null then perform _fail('Say what''s wrong with the bill.'); end if;
    update bills set status = 'disputed', dispute_reason = note where id = b.id;
  elsif p_action = 'paid' then
    if b.status <> 'approved' then perform _fail('Approve the bill before marking it paid.'); end if;
    update bills set status = 'paid', paid_at = coalesce(p_paid, current_date) where id = b.id;
  else
    perform _fail('Unknown action.');
  end if;
  select * into b from bills where id = p_bill;
  perform _audit(b.org_id, b.project_id, 'bill', b.id::text, 'Bill ' || b.status, null, b.status, b.invoice_number || ' · ' || _money(b.amount) || coalesce(' — ' || note, ''));
  return jsonb_build_object('message', format('Invoice %s %s.', b.invoice_number, b.status));
end $$;

-- --------------------------------------------------------------- receipts
create or replace function public.submit_receipt(p_project uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects; v uuid; amt bigint := nullif(p ->> 'amount', '')::bigint; pw text := coalesce(nullif(p ->> 'paid_with', ''), 'company_card'); dt date := coalesce(nullif(p ->> 'date', '')::date, current_date);
begin
  select * into pr from projects where id = p_project;
  if not found then perform _fail('Project not found.'); end if;
  perform _require(pr.org_id, 'receipt.submit');
  if length(trim(coalesce(p ->> 'supplier', ''))) = 0 then perform _fail('Who was it from (e.g. Bunnings)?'); end if;
  if amt is null or amt <= 0 then perform _fail('Enter the total on the receipt.'); end if;
  if pw not in ('company_card','personal','cash','account') then perform _fail('How was it paid?'); end if;
  if dt > current_date + 1 then perform _fail('The receipt date can''t be in the future.'); end if;
  if nullif(p ->> 'photo_path', '') is null then perform _fail('Take a photo of the receipt.'); end if;
  if (p ->> 'photo_path') not like pr.org_id::text || '/%' then perform _fail('That photo isn''t in your company''s storage.'); end if;
  -- The total on a receipt includes GST; store it excluding GST like every other cost.
  insert into receipts (org_id, project_id, supplier, date, amount, gst, cost_code, paid_with, photo_path, note, submitted_by)
  values (pr.org_id, pr.id, left(trim(p ->> 'supplier'), 120), dt, amt - round(amt / 11.0)::bigint, round(amt / 11.0)::bigint,
    nullif(upper(trim(coalesce(p ->> 'cost_code', ''))), ''), pw, p ->> 'photo_path', nullif(trim(coalesce(p ->> 'note', '')), ''), auth.uid())
  returning id into v;
  return jsonb_build_object('id', v, 'message', format('Receipt for %s sent to the office%s.', _money(amt), case when pw = 'personal' then ' — you''ll be reimbursed once it''s approved' else '' end));
end $$;

create or replace function public.receipt_action(p_receipt uuid, p_action text, p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public as $$
declare r receipts;
begin
  select * into r from receipts where id = p_receipt for update;
  if not found then perform _fail('Receipt not found.'); end if;
  perform _cost_project(r.project_id);
  if p_action = 'approve' then
    if r.status <> 'submitted' then perform _fail('This receipt has already been reviewed.'); end if;
    update receipts set status = 'approved', cost_code = _code(coalesce(nullif(p ->> 'cost_code', ''), r.cost_code)), reviewed_by = auth.uid(), reviewed_at = now() where id = r.id;
  elsif p_action = 'reject' then
    if r.status <> 'submitted' then perform _fail('This receipt has already been reviewed.'); end if;
    if length(trim(coalesce(p ->> 'reason', ''))) = 0 then perform _fail('Say why the receipt is rejected.'); end if;
    update receipts set status = 'rejected', reject_reason = trim(p ->> 'reason'), reviewed_by = auth.uid(), reviewed_at = now() where id = r.id;
  elsif p_action = 'reimbursed' then
    if r.status <> 'approved' or r.paid_with <> 'personal' then perform _fail('Only approved receipts paid personally are reimbursed.'); end if;
    if r.reimbursed_at is not null then perform _fail('Already reimbursed.'); end if;
    update receipts set reimbursed_at = now() where id = r.id;
  else
    perform _fail('Unknown action.');
  end if;
  select * into r from receipts where id = p_receipt;
  perform _audit(r.org_id, r.project_id, 'receipt', r.id::text, 'Receipt ' || case when p_action = 'reimbursed' then 'reimbursed' else r.status end, null, r.status, r.supplier || ' · ' || _money(r.amount + r.gst));
  return jsonb_build_object('message', format('Receipt from %s %s.', r.supplier, case when p_action = 'reimbursed' then 'marked reimbursed' else r.status end));
end $$;

-- -------------------------------------------------- internal charges & backcharges
create or replace function public.add_internal_charge(p_project uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects := _cost_project(p_project); v uuid; amt bigint := nullif(p ->> 'amount', '')::bigint;
begin
  if length(trim(coalesce(p ->> 'description', ''))) = 0 then perform _fail('Describe the charge (e.g. company excavator, 3 days).'); end if;
  if amt is null or amt <= 0 then perform _fail('Enter the amount.'); end if;
  insert into internal_charges (org_id, project_id, date, cost_code, description, amount, entered_by)
  values (pr.org_id, pr.id, coalesce(nullif(p ->> 'date', '')::date, current_date), _code(p ->> 'cost_code'), trim(p ->> 'description'), amt, auth.uid()) returning id into v;
  perform _audit(pr.org_id, pr.id, 'charge', v::text, 'Internal charge added', null, null, trim(p ->> 'description') || ' · ' || _money(amt));
  return jsonb_build_object('id', v, 'message', 'Internal charge of ' || _money(amt) || ' added.');
end $$;

create or replace function public.raise_backcharge(p_project uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects := _cost_project(p_project); v uuid; ref text; c contractors; amt bigint := nullif(p ->> 'amount', '')::bigint;
begin
  select * into c from contractors where id = nullif(p ->> 'contractor_id', '')::uuid and org_id = pr.org_id;
  if not found then perform _fail('Choose the subcontractor to backcharge.'); end if;
  if length(trim(coalesce(p ->> 'reason', ''))) = 0 then perform _fail('Say what the backcharge is for.'); end if;
  if amt is null or amt <= 0 then perform _fail('Enter the amount.'); end if;
  if nullif(p ->> 'defect_id', '') is not null and not exists (select 1 from defects where id = (p ->> 'defect_id')::uuid and project_id = pr.id) then perform _fail('That defect isn''t on this project.'); end if;
  ref := _next_ref('backcharges', pr.id, 'BC');
  insert into backcharges (org_id, project_id, ref, contractor_id, cost_code, reason, amount, defect_id, raised_by)
  values (pr.org_id, pr.id, ref, c.id, _code(p ->> 'cost_code'), trim(p ->> 'reason'), amt, nullif(p ->> 'defect_id', '')::uuid, auth.uid()) returning id into v;
  perform _audit(pr.org_id, pr.id, 'backcharge', v::text, 'Backcharge notified', null, 'notified', ref || ' · ' || c.trading_name || ' · ' || _money(amt));
  return jsonb_build_object('id', v, 'message', format('%s notified to %s for %s. It reduces cost once agreed.', ref, c.trading_name, _money(amt)));
end $$;

create or replace function public.backcharge_action(p_bc uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x backcharges;
begin
  select * into x from backcharges where id = p_bc for update;
  if not found then perform _fail('Backcharge not found.'); end if;
  perform _cost_project(x.project_id);
  if x.status <> 'notified' then perform _fail(x.ref || ' is already ' || x.status || '.'); end if;
  if p_action not in ('agree','withdraw') then perform _fail('Unknown action.'); end if;
  update backcharges set status = case when p_action = 'agree' then 'agreed' else 'withdrawn' end, decided_by = auth.uid(), decided_at = now() where id = x.id;
  perform _audit(x.org_id, x.project_id, 'backcharge', x.id::text, 'Backcharge ' || case when p_action = 'agree' then 'agreed' else 'withdrawn' end, 'notified', case when p_action = 'agree' then 'agreed' else 'withdrawn' end, x.ref);
  return jsonb_build_object('message', x.ref || case when p_action = 'agree' then ' agreed — deduct it from their next payment.' else ' withdrawn.' end);
end $$;

-- ----------------------------------------------------------------- claims
-- Lump sum: p.items = [{ id, to_date }] (cumulative), p.variations = [{ id, to_date }].
-- Cost-plus: every unclaimed approved cost up to the period end, labour at chargeout, plus the fee.
create or replace function public.create_claim(p_project uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr projects := _cost_project(p_project); v uuid; v_ref text; pe date := nullif(p ->> 'period_end', '')::date; prev claims;
  lines jsonb := '[]'; it record; x jsonb; amt bigint; gross bigint := 0; ret bigint; cap bigint; net bigint; prev_gross bigint := 0; prev_net bigint := 0;
  approved_vars bigint; fee bigint; costs bigint := 0; labour bigint := 0;
begin
  if pe is null then perform _fail('Choose the claim period end date.'); end if;
  if exists (select 1 from claims where project_id = pr.id and status = 'draft') then perform _fail('There''s already a draft claim. Submit or delete it first.'); end if;
  select * into prev from claims where project_id = pr.id and status <> 'draft' order by coalesce(submitted_at, period_end::timestamptz) desc limit 1;
  if prev.id is not null and pe <= prev.period_end then perform _fail('The period end must be after the last claim''s (' || to_char(prev.period_end, 'FMDD Mon YYYY') || ').'); end if;
  prev_gross := coalesce(prev.works_to_date, 0); prev_net := coalesce(prev.works_to_date, 0) - coalesce(prev.retention_to_date, 0);
  if prev.id is not null and prev.works_to_date is null then
    -- A claim from before the full breakdown: treat its total as gross and net.
    select coalesce(sum(claimed), 0) into prev_gross from claims where project_id = pr.id and status <> 'draft';
    prev_net := prev_gross;
  end if;
  select coalesce(sum(coalesce(approved_amount, amount)), 0) into approved_vars from variations where project_id = pr.id and status in ('approved','included_in_claim');

  if pr.contract_type = 'lump_sum' then
    for it in select ci.*, coalesce((select (e ->> 'to_date')::bigint from jsonb_array_elements(coalesce(p -> 'items', '[]')) e where e ->> 'id' = ci.id::text), 0) as td
      from contract_items ci where ci.project_id = pr.id order by seq loop
      if it.td < 0 or it.td > it.value then perform _fail(format('%s can be claimed up to %s.', it.description, _money(it.value))); end if;
      lines := lines || jsonb_build_object('kind', 'item', 'id', it.id, 'description', it.description, 'value', it.value, 'to_date', it.td);
      gross := gross + it.td;
    end loop;
    if not exists (select 1 from contract_items where project_id = pr.id) then
      amt := coalesce((select (e ->> 'to_date')::bigint from jsonb_array_elements(coalesce(p -> 'items', '[]')) e where e ->> 'id' = 'contract'), 0);
      if amt < 0 or amt > pr.contract_sum then perform _fail(format('Contract works can be claimed up to %s.', _money(pr.contract_sum))); end if;
      lines := lines || jsonb_build_object('kind', 'item', 'id', 'contract', 'description', 'Contract works', 'value', pr.contract_sum, 'to_date', amt);
      gross := gross + amt;
    end if;
    for it in select va.*, coalesce((select (e ->> 'to_date')::bigint from jsonb_array_elements(coalesce(p -> 'variations', '[]')) e where e ->> 'id' = va.id::text), 0) as td
      from variations va where va.project_id = pr.id and va.status in ('approved','included_in_claim') order by ref loop
      if it.td < 0 or it.td > coalesce(it.approved_amount, it.amount) then perform _fail(format('%s can be claimed up to %s.', it.ref, _money(coalesce(it.approved_amount, it.amount)))); end if;
      lines := lines || jsonb_build_object('kind', 'variation', 'id', it.id, 'description', it.ref || ' ' || it.title, 'value', coalesce(it.approved_amount, it.amount), 'to_date', it.td);
      gross := gross + it.td;
    end loop;
    -- Amounts claimed before can't go backwards without a credit; flag it rather than silently reduce.
    if gross < prev_gross then perform _fail(format('Work to date (%s) is less than already claimed (%s). Check the amounts.', _money(gross), _money(prev_gross))); end if;
  else
    for it in select 'bill' as k, b.id, c.trading_name || ' ' || b.invoice_number as d, b.amount as a from bills b join contractors c on c.id = b.contractor_id
        where b.project_id = pr.id and b.status in ('approved','paid') and b.claim_id is null and b.invoice_date <= pe
      union all select 'receipt', r.id, r.supplier || ' receipt', r.amount from receipts r where r.project_id = pr.id and r.status = 'approved' and r.claim_id is null and r.date <= pe
      union all select 'charge', i.id, i.description, i.amount from internal_charges i where i.project_id = pr.id and i.claim_id is null and i.date <= pe loop
      lines := lines || jsonb_build_object('kind', it.k, 'id', it.id, 'description', it.d, 'to_date', it.a);
      costs := costs + it.a;
    end loop;
    for it in select t.id, w.name || ' ' || to_char(t.date, 'DD Mon') || ' ' || _hours(t.hours) as d, round(t.hours * c.charge_rate)::bigint as a
      from timesheets t join timesheet_costs c on c.timesheet_id = t.id join workers w on w.id = t.worker_id
      where t.project_id = pr.id and t.status = 'processed' and t.billable and t.claim_id is null and t.date <= pe loop
      lines := lines || jsonb_build_object('kind', 'labour', 'id', it.id, 'description', it.d, 'to_date', it.a);
      labour := labour + it.a;
    end loop;
    select coalesce(sum(amount), 0) into amt from backcharges where project_id = pr.id and status = 'agreed';
    fee := round(costs * pr.fee_pct / 100)::bigint;
    lines := lines || jsonb_build_object('kind', 'fee', 'description', format('Builder''s fee %s%% on costs', trim(to_char(pr.fee_pct, 'FM990.##'))), 'to_date', fee);
    if costs + labour = 0 then perform _fail('There are no approved, unclaimed costs up to that date.'); end if;
    gross := prev_gross + costs + labour + fee;
  end if;

  cap := round((pr.contract_sum + approved_vars) * pr.retention_cap_pct / 100)::bigint;
  ret := least(round(gross * pr.retention_pct / 100)::bigint, case when pr.contract_type = 'cost_plus' then round(gross * pr.retention_cap_pct / 100)::bigint else cap end);
  net := gross - ret;
  v_ref := 'PC-' || lpad(((select count(*) from claims where project_id = pr.id) + 1)::text, 2, '0');
  while exists (select 1 from claims c where c.project_id = pr.id and c.ref = v_ref) loop v_ref := v_ref || 'a'; end loop;
  insert into claims (org_id, project_id, ref, period_end, due_date, claimed, status, claim_type, lines, works_to_date, previous_gross, retention_to_date, previous_net, gst, created_by)
  values (pr.org_id, pr.id, v_ref, pe, nullif(p ->> 'due_date', '')::date, net - prev_net, 'draft', pr.contract_type, lines, gross, prev_gross, ret, prev_net, round((net - prev_net) * 0.1)::bigint, auth.uid())
  returning id into v;
  if pr.contract_type = 'cost_plus' then
    update bills set claim_id = v where id in (select (e ->> 'id')::uuid from jsonb_array_elements(lines) e where e ->> 'kind' = 'bill');
    update receipts set claim_id = v where id in (select (e ->> 'id')::uuid from jsonb_array_elements(lines) e where e ->> 'kind' = 'receipt');
    update internal_charges set claim_id = v where id in (select (e ->> 'id')::uuid from jsonb_array_elements(lines) e where e ->> 'kind' = 'charge');
    update timesheets set claim_id = v where id in (select (e ->> 'id')::uuid from jsonb_array_elements(lines) e where e ->> 'kind' = 'labour');
  end if;
  perform _audit(pr.org_id, pr.id, 'claim', v::text, 'Draft claim prepared', null, 'draft', v_ref || ' · ' || _money(net - prev_net) || ' excl. GST');
  return jsonb_build_object('id', v, 'message', format('%s drafted: %s excl. GST this claim.', v_ref, _money(net - prev_net)));
end $$;

create or replace function public.claim_action(p_claim uuid, p_action text, p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public as $$
declare c claims; amt bigint := nullif(p ->> 'amount', '')::bigint; note text := nullif(trim(coalesce(p ->> 'note', '')), '');
begin
  select * into c from claims where id = p_claim for update;
  if not found then perform _fail('Claim not found.'); end if;
  perform _cost_project(c.project_id);
  if p_action = 'delete' then
    if c.status <> 'draft' then perform _fail('Only a draft claim can be deleted.'); end if;
    update bills set claim_id = null where claim_id = c.id; update receipts set claim_id = null where claim_id = c.id;
    update internal_charges set claim_id = null where claim_id = c.id; update timesheets set claim_id = null where claim_id = c.id;
    delete from claims where id = c.id;
    perform _audit(c.org_id, c.project_id, 'claim', c.id::text, 'Draft claim deleted', 'draft', null, c.ref);
    return jsonb_build_object('message', c.ref || ' deleted.');
  elsif p_action = 'submit' then
    if c.status <> 'draft' then perform _fail('This claim has already been submitted.'); end if;
    update claims set status = 'submitted', submitted_at = now(), due_date = coalesce(nullif(p ->> 'due_date', '')::date, due_date, current_date + 15) where id = c.id;
    update variations set status = 'included_in_claim' where status = 'approved' and id in (select (e ->> 'id')::uuid from jsonb_array_elements(c.lines) e where e ->> 'kind' = 'variation' and (e ->> 'to_date')::bigint > 0);
  elsif p_action = 'certify' then
    if c.status not in ('submitted','assessed') then perform _fail('Only a submitted claim can be certified.'); end if;
    if amt is null or amt < 0 then perform _fail('Enter the amount certified (excl. GST).'); end if;
    if amt < c.claimed and note is null then perform _fail('The certificate is less than claimed — record the reason from the payment schedule.'); end if;
    update claims set status = 'certified', certified = amt, certified_at = now(), certified_by = auth.uid(), schedule_reason = note where id = c.id;
  elsif p_action = 'paid' then
    if c.status <> 'certified' then perform _fail('Record the certificate first.'); end if;
    if amt is null or amt < 0 then perform _fail('Enter the amount received (excl. GST).'); end if;
    update claims set status = 'paid', paid = amt, paid_at = coalesce(nullif(p ->> 'date', '')::date, current_date) where id = c.id;
  else
    perform _fail('Unknown action.');
  end if;
  select * into c from claims where id = p_claim;
  perform _audit(c.org_id, c.project_id, 'claim', c.id::text, 'Claim ' || c.status, null, c.status, c.ref || coalesce(' · ' || _money(amt), '') || coalesce(' — ' || note, ''));
  return jsonb_build_object('message', c.ref || ' ' || c.status || case when p_action = 'certify' and amt < c.claimed then format(' — %s short of the claim.', _money(c.claimed - amt)) else '.' end);
end $$;

-- ---------------------------------------------------------------- grants
do $$
declare f text;
begin
  foreach f in array array['public.save_budget_line(uuid, uuid, jsonb)', 'public.save_contract_setup(uuid, jsonb)', 'public.create_po(uuid, jsonb)', 'public.po_action(uuid, text)',
    'public.enter_bill(uuid, jsonb)', 'public.bill_action(uuid, text, text, date)', 'public.submit_receipt(uuid, jsonb)', 'public.receipt_action(uuid, text, jsonb)',
    'public.add_internal_charge(uuid, jsonb)', 'public.raise_backcharge(uuid, jsonb)', 'public.backcharge_action(uuid, text)', 'public.create_claim(uuid, jsonb)', 'public.claim_action(uuid, text, jsonb)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array['public._cost_project(uuid)', 'public._code(text)', 'public._cost_limit(public.memberships, bigint, text)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;
grant execute on function public.role_can(text, text) to anon, authenticated;
