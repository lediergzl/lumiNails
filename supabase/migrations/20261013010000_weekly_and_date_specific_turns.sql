-- LuniNails: turnos semanales reutilizables y excepciones por fecha.
-- La plantilla semanal se aplica a cada fecha; si una fecha está marcada como excepción,
-- solo se utilizan los turnos individuales guardados para esa fecha (incluso si está vacía).
begin;

create table if not exists public.provider_weekly_turns (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.provider_profiles(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  start_time time not null,
  buffer_after_minutes integer not null default 0 check (buffer_after_minutes between 0 and 180),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_id, weekday, start_time)
);
create index if not exists provider_weekly_turns_lookup_idx
  on public.provider_weekly_turns(provider_id, weekday, start_time);

alter table public.provider_weekly_turns enable row level security;
drop policy if exists "provider manages own weekly turns" on public.provider_weekly_turns;
create policy "provider manages own weekly turns"
  on public.provider_weekly_turns for all to authenticated
  using (public.luni_is_provider_owner(provider_id))
  with check (public.luni_is_provider_owner(provider_id));
grant select, insert, update, delete on public.provider_weekly_turns to authenticated;

create table if not exists public.provider_turn_overrides (
  provider_id uuid not null references public.provider_profiles(id) on delete cascade,
  turn_date date not null,
  created_at timestamptz not null default now(),
  primary key (provider_id, turn_date)
);
alter table public.provider_turn_overrides enable row level security;
drop policy if exists "provider manages own turn overrides" on public.provider_turn_overrides;
create policy "provider manages own turn overrides"
  on public.provider_turn_overrides for all to authenticated
  using (public.luni_is_provider_owner(provider_id))
  with check (public.luni_is_provider_owner(provider_id));
grant select, insert, update, delete on public.provider_turn_overrides to authenticated;

create or replace function public.luni_effective_turns(p_provider_id uuid, p_day date)
returns table(start_time time, buffer_after_minutes integer)
language sql stable security definer
set search_path = public, pg_temp
as $fn$
  select t.start_time, t.buffer_after_minutes
  from public.provider_turns t
  where t.provider_id = p_provider_id
    and t.turn_date = p_day
    and t.status = 'active'
    and exists (
      select 1 from public.provider_turn_overrides o
      where o.provider_id = p_provider_id and o.turn_date = p_day
    )
  union all
  select wt.start_time, wt.buffer_after_minutes
  from public.provider_weekly_turns wt
  where wt.provider_id = p_provider_id
    and wt.weekday = extract(isodow from p_day)::smallint
    and not exists (
      select 1 from public.provider_turn_overrides o
      where o.provider_id = p_provider_id and o.turn_date = p_day
    )
  order by 1
$fn$;
revoke all on function public.luni_effective_turns(uuid,date) from public, anon;

create or replace function public.luni_available_slots(
  p_provider_id uuid, p_service_id uuid, p_day date
) returns table(starts_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp
as $function$
declare
  v_service public.services%rowtype;
  v_provider public.provider_profiles%rowtype;
  v_turn record;
  v_start timestamptz;
  v_end timestamptz;
  v_count integer;
  v_today date;
  v_local_start timestamp;
  v_local_end timestamp;
begin
  select * into v_service from public.services
  where id = p_service_id and provider_id = p_provider_id
    and is_active and deleted_at is null;
  if not found then return; end if;

  select * into v_provider from public.provider_profiles
  where id = p_provider_id and is_published and deleted_at is null;
  if not found then return; end if;

  if auth.uid() is null or not (
    public.luni_is_provider_owner(v_provider.id)
    or public.luni_client_linked_to_provider(v_provider.id, auth.uid())
  ) then return; end if;
  if not public.luni_provider_license_ok(v_provider) then return; end if;

  v_today := (now() at time zone v_provider.timezone)::date;
  if p_day is null or p_day < v_today or p_day > v_today + 90 then return; end if;

  select count(*)::integer into v_count
  from public.appointments a
  where a.provider_id = v_provider.id
    and a.status in ('pending_confirmation','confirmed')
    and a.deleted_at is null
    and (a.starts_at at time zone v_provider.timezone)::date = p_day;
  if v_count >= v_provider.daily_appointment_limit then return; end if;

  for v_turn in
    select e.start_time, e.buffer_after_minutes
    from public.luni_effective_turns(v_provider.id, p_day) e
    order by e.start_time
  loop
    v_local_start := p_day + v_turn.start_time;
    v_start := v_local_start at time zone v_provider.timezone;
    v_end := v_start + make_interval(mins => v_service.duration_minutes);
    v_local_end := v_end at time zone v_provider.timezone;

    if v_start <= now() + interval '1 hour' or v_local_end::date <> p_day then
      continue;
    end if;

    if exists (
      select 1 from public.luni_effective_turns(v_provider.id, p_day) n
      where n.start_time > v_turn.start_time
        and v_local_end + make_interval(mins => v_turn.buffer_after_minutes)
            > p_day + n.start_time
    ) then continue; end if;

    if exists (
      select 1 from public.appointments a
      where a.provider_id = v_provider.id
        and a.status in ('pending_confirmation','confirmed')
        and a.deleted_at is null
        and tstzrange(a.starts_at,a.ends_at,'[)') && tstzrange(v_start,v_end,'[)')
    ) then continue; end if;

    if exists (
      select 1 from public.availability b
      where b.provider_id = v_provider.id and b.kind = 'block' and b.status = 'active'
        and tstzrange(b.starts_at,b.ends_at,'[)') && tstzrange(v_start,v_end,'[)')
    ) then continue; end if;

    starts_at := v_start;
    return next;
  end loop;
end;
$function$;

create or replace function public.luni_create_appointment(
  p_id uuid, p_provider_id uuid, p_service_id uuid, p_starts_at timestamptz,
  p_idempotency_key text, p_notes text default ''
) returns public.appointments
language plpgsql security definer set search_path = public, pg_temp
as $function$
declare
  v_client_id uuid := auth.uid();
  v_service public.services%rowtype;
  v_provider public.provider_profiles%rowtype;
  v_turn record;
  v_end timestamptz;
  v_existing public.appointments%rowtype;
  v_result public.appointments%rowtype;
  v_phone text;
  v_local_start timestamp;
  v_local_end timestamp;
  v_today date;
  v_daily_count integer;
begin
  if v_client_id is null then raise exception 'AUTH_REQUIRED' using errcode='28000'; end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023'; end if;
  select nullif(trim(phone),'') into v_phone from public.profiles where id=v_client_id;
  if v_phone is null then raise exception 'PHONE_REQUIRED' using errcode='P0001'; end if;
  if p_starts_at is null or p_starts_at <= now()+interval '1 hour' then
    raise exception 'INVALID_APPOINTMENT_TIME' using errcode='22023'; end if;

  select * into v_existing from public.appointments
  where client_id=v_client_id and idempotency_key=p_idempotency_key;
  if found then return v_existing; end if;

  if not public.luni_client_linked_to_provider(p_provider_id,v_client_id) then
    raise exception 'CLIENT_PROVIDER_LINK_REQUIRED' using errcode='42501'; end if;

  select * into v_service from public.services
  where id=p_service_id and provider_id=p_provider_id and is_active and deleted_at is null;
  if not found then raise exception 'SERVICE_NOT_AVAILABLE' using errcode='P0002'; end if;

  select * into v_provider from public.provider_profiles
  where id=p_provider_id and is_published and deleted_at is null for update;
  if not found then raise exception 'PROVIDER_NOT_AVAILABLE' using errcode='P0002'; end if;
  if not public.luni_provider_license_ok(v_provider) then
    raise exception 'PROVIDER_LICENSE_INACTIVE' using errcode='P0001'; end if;

  v_end := p_starts_at + make_interval(mins => v_service.duration_minutes);
  v_local_start := p_starts_at at time zone v_provider.timezone;
  v_local_end := v_end at time zone v_provider.timezone;
  v_today := (now() at time zone v_provider.timezone)::date;
  if v_local_start::date < v_today or v_local_start::date > v_today+90 or v_local_end::date <> v_local_start::date then
    raise exception 'INVALID_APPOINTMENT_DATE' using errcode='22023'; end if;

  select e.start_time, e.buffer_after_minutes into v_turn
  from public.luni_effective_turns(v_provider.id,v_local_start::date) e
  where e.start_time = v_local_start::time;
  if not found then raise exception 'INVALID_APPOINTMENT_SLOT' using errcode='P0001'; end if;

  if exists (
    select 1 from public.luni_effective_turns(v_provider.id,v_local_start::date) n
    where n.start_time > v_turn.start_time
      and v_local_end + make_interval(mins=>v_turn.buffer_after_minutes)
          > (v_local_start::date+n.start_time)
  ) then raise exception 'SERVICE_DOES_NOT_FIT_BEFORE_NEXT_TURN' using errcode='P0001'; end if;

  if exists (select 1 from public.appointments a
    where a.provider_id=v_provider.id and a.status in ('pending_confirmation','confirmed')
      and a.deleted_at is null and tstzrange(a.starts_at,a.ends_at,'[)') && tstzrange(p_starts_at,v_end,'[)')) then
    raise exception 'SLOT_ALREADY_TAKEN' using errcode='23P01'; end if;

  if exists (select 1 from public.availability b
    where b.provider_id=v_provider.id and b.kind='block' and b.status='active'
      and tstzrange(b.starts_at,b.ends_at,'[)') && tstzrange(p_starts_at,v_end,'[)')) then
    raise exception 'SLOT_BLOCKED' using errcode='P0001'; end if;

  select count(*)::integer into v_daily_count from public.appointments a
  where a.provider_id=v_provider.id and a.status in ('pending_confirmation','confirmed')
    and a.deleted_at is null and (a.starts_at at time zone v_provider.timezone)::date=v_local_start::date;
  if v_daily_count >= v_provider.daily_appointment_limit then
    raise exception 'DAILY_LIMIT_REACHED' using errcode='P0001'; end if;

  insert into public.appointments (
    id,provider_id,client_id,service_id,starts_at,ends_at,status,notes,idempotency_key,
    client_service_name,client_price_cents,client_currency,cancellation_reason
  ) values (
    coalesce(p_id,gen_random_uuid()),v_provider.id,v_client_id,v_service.id,p_starts_at,v_end,
    'pending_confirmation',coalesce(p_notes,''),p_idempotency_key,v_service.name,
    v_service.price_cents,v_service.currency,''
  ) returning * into v_result;
  return v_result;
exception when exclusion_violation then
  raise exception 'SLOT_ALREADY_TAKEN' using errcode='23P01';
end;
$function$;

create or replace function public.luni_set_turn_day_override(p_day date, p_enabled boolean)
returns void
language plpgsql security invoker set search_path = public, pg_temp
as $fn$
declare
  v_provider_id uuid;
begin
  select p.id into v_provider_id
  from public.provider_profiles p
  where p.user_id = auth.uid() and p.deleted_at is null;
  if v_provider_id is null then raise exception 'PROVIDER_REQUIRED' using errcode='P0002'; end if;
  if p_day is null or p_day < (now() at time zone (select p.timezone from public.provider_profiles p where p.id=v_provider_id))::date
     or p_day > (now() at time zone (select p.timezone from public.provider_profiles p where p.id=v_provider_id))::date + 90 then
    raise exception 'INVALID_DAY' using errcode='22023';
  end if;

  if p_enabled then
    insert into public.provider_turn_overrides(provider_id,turn_date)
    values(v_provider_id,p_day) on conflict do nothing;
    -- Copy the weekly template only the first time the date becomes an exception.
    if not exists (select 1 from public.provider_turns t where t.provider_id=v_provider_id and t.turn_date=p_day) then
      insert into public.provider_turns(provider_id,turn_date,start_time,buffer_after_minutes,status)
      select v_provider_id,p_day,w.start_time,w.buffer_after_minutes,'active'
      from public.provider_weekly_turns w
      where w.provider_id=v_provider_id
        and w.weekday=extract(isodow from p_day)::smallint
      on conflict(provider_id,turn_date,start_time) do nothing;
    end if;
  else
    delete from public.provider_turns t
    where t.provider_id=v_provider_id and t.turn_date=p_day;
    delete from public.provider_turn_overrides o
    where o.provider_id=v_provider_id and o.turn_date=p_day;
  end if;
end;
$fn$;

revoke all on function public.luni_set_turn_day_override(date,boolean) from public, anon;
grant execute on function public.luni_set_turn_day_override(date,boolean) to authenticated;

revoke all on function public.luni_available_slots(uuid,uuid,date) from public,anon;
grant execute on function public.luni_available_slots(uuid,uuid,date) to authenticated;
revoke all on function public.luni_create_appointment(uuid,uuid,uuid,timestamptz,text,text) from public,anon;
grant execute on function public.luni_create_appointment(uuid,uuid,uuid,timestamptz,text,text) to authenticated;
commit;
