-- Configurable LumiNails licensing: monthly, quarterly and annual plans.
-- Apply after 20261009010000_initial_schema.sql. No payment provider is assumed.
begin;

insert into public.app_settings(key, value)
values
  ('license_prices', '[
    {"code":"monthly","label":"Mensual","duration_days":30,"price_cents":0,"currency":"CUP","active":true},
    {"code":"quarterly","label":"Trimestral","duration_days":90,"price_cents":0,"currency":"CUP","active":true},
    {"code":"annual","label":"Anual","duration_days":365,"price_cents":0,"currency":"CUP","active":true}
  ]'::jsonb),
  ('payment_methods', '[]'::jsonb)
on conflict (key) do nothing;

create table if not exists public.license_payment_requests (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.provider_profiles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_code text not null check (plan_code in ('monthly','quarterly','annual')),
  plan_label text not null,
  duration_days integer not null check (duration_days in (30,90,365)),
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'CUP',
  payment_method text not null,
  payment_reference text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_note text not null default '',
  processed_by uuid references public.profiles(id),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists license_requests_provider_created_idx
  on public.license_payment_requests(provider_id, created_at desc);
create index if not exists license_requests_status_created_idx
  on public.license_payment_requests(status, created_at desc);

alter table public.license_payment_requests enable row level security;
drop policy if exists "provider reads own license requests" on public.license_payment_requests;
create policy "provider reads own license requests"
  on public.license_payment_requests for select to authenticated
  using (user_id = auth.uid());
drop policy if exists "admins read license requests" on public.license_payment_requests;
create policy "admins read license requests"
  on public.license_payment_requests for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

create or replace function public.luni_is_admin()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $fn$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$fn$;
revoke all on function public.luni_is_admin() from public;
grant execute on function public.luni_is_admin() to authenticated;

create or replace function public.luni_request_license(
  p_provider_id uuid,
  p_plan_code text,
  p_payment_method text,
  p_payment_reference text default null
)
returns public.license_payment_requests
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid uuid := auth.uid();
  v_provider public.provider_profiles%rowtype;
  v_plan jsonb;
  v_method jsonb;
  v_result public.license_payment_requests%rowtype;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  select * into v_provider from public.provider_profiles
    where id = p_provider_id and user_id = v_uid and deleted_at is null for update;
  if not found then raise exception 'PROVIDER_NOT_FOUND' using errcode = 'P0002'; end if;

  select item into v_plan
  from public.app_settings s
  cross join lateral jsonb_array_elements(s.value) item
  where s.key = 'license_prices'
    and item->>'code' = p_plan_code
    and coalesce((item->>'active')::boolean, false)
    and coalesce((item->>'price_cents')::bigint, 0) > 0
    and (item->>'duration_days')::integer in (30,90,365)
  limit 1;
  if v_plan is null then raise exception 'LICENSE_PLAN_UNAVAILABLE' using errcode = 'P0001'; end if;

  select item into v_method
  from public.app_settings s
  cross join lateral jsonb_array_elements(s.value) item
  where s.key = 'payment_methods'
    and (
      (jsonb_typeof(item) = 'string' and trim(both '"' from item::text) = p_payment_method)
      or (jsonb_typeof(item) = 'object' and item->>'code' = p_payment_method
          and coalesce((item->>'active')::boolean, true))
    )
  limit 1;
  if v_method is null then raise exception 'PAYMENT_METHOD_UNAVAILABLE' using errcode = 'P0001'; end if;

  insert into public.license_payment_requests(
    provider_id,user_id,plan_code,plan_label,duration_days,amount_cents,currency,
    payment_method,payment_reference
  ) values (
    v_provider.id,v_uid,p_plan_code,coalesce(v_plan->>'label',p_plan_code),
    (v_plan->>'duration_days')::integer,(v_plan->>'price_cents')::bigint,
    coalesce(v_plan->>'currency','CUP'),p_payment_method,nullif(trim(coalesce(p_payment_reference,'')),'')
  ) returning * into v_result;
  return v_result;
end;
$fn$;
revoke all on function public.luni_request_license(uuid,text,text,text) from public;
grant execute on function public.luni_request_license(uuid,text,text,text) to authenticated;

create or replace function public.luni_admin_set_license_plans(p_plans jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
begin
  if not public.luni_is_admin() then raise exception 'ADMIN_REQUIRED' using errcode = '42501'; end if;
  if jsonb_typeof(p_plans) <> 'array' or jsonb_array_length(p_plans) < 1 then
    raise exception 'INVALID_LICENSE_PLANS' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_plans) x
    where x->>'code' not in ('monthly','quarterly','annual')
      or (x->>'duration_days')::integer not in (30,90,365)
      or coalesce((x->>'price_cents')::bigint,0) <= 0
      or coalesce(x->>'label','') = ''
      or coalesce(x->>'currency','') = ''
      or jsonb_typeof(x->'active') <> 'boolean'
  ) then raise exception 'INVALID_LICENSE_PLANS' using errcode = '22023'; end if;
  if (select count(distinct x->>'code') from jsonb_array_elements(p_plans) x) <> jsonb_array_length(p_plans) then
    raise exception 'DUPLICATE_LICENSE_PLAN' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_plans) x
    where (x->>'code' = 'monthly' and (x->>'duration_days')::integer <> 30)
       or (x->>'code' = 'quarterly' and (x->>'duration_days')::integer <> 90)
       or (x->>'code' = 'annual' and (x->>'duration_days')::integer <> 365)
  ) then raise exception 'LICENSE_PLAN_DURATION_MISMATCH' using errcode = '22023'; end if;
  insert into public.app_settings(key,value,updated_at)
  values ('license_prices',p_plans,now())
  on conflict (key) do update set value=excluded.value,updated_at=now();
  return p_plans;
end;
$fn$;
revoke all on function public.luni_admin_set_license_plans(jsonb) from public;
grant execute on function public.luni_admin_set_license_plans(jsonb) to authenticated;

create or replace function public.luni_admin_set_payment_methods(p_methods jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
begin
  if not public.luni_is_admin() then raise exception 'ADMIN_REQUIRED' using errcode = '42501'; end if;
  if jsonb_typeof(p_methods) <> 'array' then raise exception 'INVALID_PAYMENT_METHODS' using errcode = '22023'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_methods) x
    where jsonb_typeof(x) <> 'object'
       or coalesce(x->>'code','') = ''
       or coalesce(x->>'label','') = ''
       or jsonb_typeof(x->'active') <> 'boolean'
  ) then raise exception 'INVALID_PAYMENT_METHODS' using errcode = '22023'; end if;
  if (select count(distinct x->>'code') from jsonb_array_elements(p_methods) x) <> jsonb_array_length(p_methods) then
    raise exception 'DUPLICATE_PAYMENT_METHOD' using errcode = '22023';
  end if;
  insert into public.app_settings(key,value,updated_at)
  values ('payment_methods',p_methods,now())
  on conflict (key) do update set value=excluded.value,updated_at=now();
  return p_methods;
end;
$fn$;
revoke all on function public.luni_admin_set_payment_methods(jsonb) from public;
grant execute on function public.luni_admin_set_payment_methods(jsonb) to authenticated;

create or replace function public.luni_admin_process_license_request(
  p_request_id uuid,
  p_approve boolean,
  p_note text default ''
)
returns public.license_payment_requests
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare
  v_request public.license_payment_requests%rowtype;
  v_provider public.provider_profiles%rowtype;
  v_base timestamptz;
begin
  if not public.luni_is_admin() then raise exception 'ADMIN_REQUIRED' using errcode = '42501'; end if;
  select * into v_request from public.license_payment_requests where id=p_request_id for update;
  if not found then raise exception 'LICENSE_REQUEST_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_request.status <> 'pending' then raise exception 'LICENSE_REQUEST_ALREADY_PROCESSED' using errcode = 'P0001'; end if;

  select * into v_provider from public.provider_profiles where id=v_request.provider_id for update;
  if not found then raise exception 'PROVIDER_NOT_FOUND' using errcode = 'P0002'; end if;

  if p_approve then
    v_base := case when v_provider.license_status in ('active','grace')
                       and v_provider.license_expires_at > now()
                   then v_provider.license_expires_at else now() end;
    update public.provider_profiles
      set license_status='active',
          license_expires_at=v_base + make_interval(days => v_request.duration_days),
          updated_at=now(), version=version+1
      where id=v_provider.id;
    update public.license_payment_requests
      set status='approved',admin_note=coalesce(p_note,''),processed_by=auth.uid(),
          processed_at=now(),updated_at=now()
      where id=p_request_id returning * into v_request;
  else
    update public.license_payment_requests
      set status='rejected',admin_note=coalesce(p_note,''),processed_by=auth.uid(),
          processed_at=now(),updated_at=now()
      where id=p_request_id returning * into v_request;
  end if;
  return v_request;
end;
$fn$;
revoke all on function public.luni_admin_process_license_request(uuid,boolean,text) from public;
grant execute on function public.luni_admin_process_license_request(uuid,boolean,text) to authenticated;

create or replace function public.luni_admin_set_provider_license(
  p_provider_id uuid,
  p_status text,
  p_expires_at timestamptz default null,
  p_note text default ''
)
returns public.provider_profiles
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare v_provider public.provider_profiles%rowtype;
begin
  if not public.luni_is_admin() then raise exception 'ADMIN_REQUIRED' using errcode = '42501'; end if;
  if p_status not in ('active','grace','suspended','expired') then
    raise exception 'INVALID_LICENSE_STATUS' using errcode = '22023';
  end if;
  if p_status in ('active','grace') and p_expires_at is null then
    raise exception 'LICENSE_EXPIRY_REQUIRED' using errcode = '22023';
  end if;
  update public.provider_profiles set license_status=p_status,license_expires_at=p_expires_at,
    updated_at=now(),version=version+1
    where id=p_provider_id and deleted_at is null returning * into v_provider;
  if not found then raise exception 'PROVIDER_NOT_FOUND' using errcode = 'P0002'; end if;
  return v_provider;
end;
$fn$;
revoke all on function public.luni_admin_set_provider_license(uuid,text,timestamptz,text) from public;
grant execute on function public.luni_admin_set_provider_license(uuid,text,timestamptz,text) to authenticated;

commit;
