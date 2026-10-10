-- Fix RPC return-type mismatch in role listing and allow configurable license durations.
-- Apply after 20261018030000_signup_role_by_app.sql.

begin;

create or replace function public.luni_admin_list_users()
returns table (
  user_id uuid,
  email text,
  display_name text,
  role text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $fn$
begin
  if not public.luni_is_admin() then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  return query
  select
    u.id,
    coalesce(u.email, '')::text,
    coalesce(p.display_name, coalesce(u.raw_user_meta_data ->> 'display_name', ''))::text,
    coalesce(p.role, 'client')::text,
    u.created_at
  from auth.users u
  left join public.profiles p on p.id = u.id
  order by u.created_at desc;
end;
$fn$;

revoke all on function public.luni_admin_list_users() from public;
grant execute on function public.luni_admin_list_users() to authenticated;

-- The old table only accepted 30, 90, or 365 days. Replace that constraint
-- so renewal requests can store the duration configured by the administrator.
alter table public.license_payment_requests
  drop constraint if exists license_payment_requests_duration_days_check;
alter table public.license_payment_requests
  add constraint license_payment_requests_duration_days_check
  check (duration_days between 1 and 3650);

create or replace function public.luni_admin_set_license_plans(p_plans jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if not public.luni_is_admin() then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  if jsonb_typeof(p_plans) <> 'array' or jsonb_array_length(p_plans) < 1 then
    raise exception 'INVALID_LICENSE_PLANS' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_plans) x
    where coalesce(x->>'code','') not in ('monthly','quarterly','annual')
       or coalesce((x->>'duration_days')::integer,0) not between 1 and 3650
       or coalesce((x->>'price_cents')::bigint,0) <= 0
       or coalesce(x->>'label','') = ''
       or coalesce(x->>'currency','') = ''
       or jsonb_typeof(x->'active') is distinct from 'boolean'
  ) then
    raise exception 'INVALID_LICENSE_PLANS' using errcode = '22023';
  end if;

  if (
    select count(distinct x->>'code')
    from jsonb_array_elements(p_plans) x
  ) <> jsonb_array_length(p_plans) then
    raise exception 'DUPLICATE_LICENSE_PLAN' using errcode = '22023';
  end if;

  insert into public.app_settings(key,value,updated_at)
  values ('license_prices',p_plans,now())
  on conflict (key) do update
    set value=excluded.value,updated_at=now();

  return p_plans;
end;
$fn$;
revoke all on function public.luni_admin_set_license_plans(jsonb) from public;
grant execute on function public.luni_admin_set_license_plans(jsonb) to authenticated;

create or replace function public.luni_request_license(
  p_provider_id uuid,
  p_plan_code text,
  p_payment_method text,
  p_payment_reference text default null
)
returns public.license_payment_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid uuid := auth.uid();
  v_provider public.provider_profiles%rowtype;
  v_plan jsonb;
  v_method jsonb;
  v_result public.license_payment_requests%rowtype;
  v_days integer;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  select * into v_provider
  from public.provider_profiles
  where id = p_provider_id and user_id = v_uid and deleted_at is null
  for update;
  if not found then
    raise exception 'PROVIDER_NOT_FOUND' using errcode = 'P0002';
  end if;

  select item into v_plan
  from public.app_settings s
  cross join lateral jsonb_array_elements(s.value) item
  where s.key = 'license_prices'
    and item->>'code' = p_plan_code
    and coalesce((item->>'active')::boolean, false)
    and coalesce((item->>'price_cents')::bigint, 0) > 0
    and coalesce((item->>'duration_days')::integer, 0) between 1 and 3650
  limit 1;
  if v_plan is null then
    raise exception 'LICENSE_PLAN_UNAVAILABLE' using errcode = 'P0001';
  end if;

  v_days := (v_plan->>'duration_days')::integer;

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
  if v_method is null then
    raise exception 'PAYMENT_METHOD_UNAVAILABLE' using errcode = 'P0001';
  end if;

  insert into public.license_payment_requests(
    provider_id,user_id,plan_code,plan_label,duration_days,amount_cents,currency,
    payment_method,payment_reference
  ) values (
    v_provider.id,v_uid,p_plan_code,coalesce(v_plan->>'label',p_plan_code),
    v_days,(v_plan->>'price_cents')::bigint,
    coalesce(v_plan->>'currency','CUP'),p_payment_method,
    nullif(trim(coalesce(p_payment_reference,'')),'')
  ) returning * into v_result;

  return v_result;
end;
$fn$;
revoke all on function public.luni_request_license(uuid,text,text,text) from public;
grant execute on function public.luni_request_license(uuid,text,text,text) to authenticated;

commit;
