-- LuniNails: turnos individuales definidos por la manicurista.
-- La hora de inicio se configura manualmente por fecha; la duración sale del servicio.
begin;

create table if not exists public.provider_turns (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.provider_profiles(id) on delete cascade,
  turn_date date not null,
  start_time time not null,
  buffer_after_minutes integer not null default 0 check (buffer_after_minutes between 0 and 180),
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider_id, turn_date, start_time)
);
create index if not exists provider_turns_day_idx
  on public.provider_turns(provider_id, turn_date, start_time) where status = 'active';
alter table public.provider_turns enable row level security;
drop policy if exists "provider manages own individual turns" on public.provider_turns;
create policy "provider manages own individual turns"
  on public.provider_turns for all to authenticated
  using (public.luni_is_provider_owner(provider_id))
  with check (public.luni_is_provider_owner(provider_id));

create or replace function public.luni_guard_turn_changes()
returns trigger language plpgsql set search_path=public,pg_temp as $fn$
begin
  if tg_op in ('UPDATE','DELETE') and exists (
    select 1 from public.appointments a
    where a.provider_id=old.provider_id
      and a.starts_at = ((old.turn_date + old.start_time) at time zone
        (select p.timezone from public.provider_profiles p where p.id=old.provider_id))
      and a.status in ('pending_confirmation','confirmed') and a.deleted_at is null
  ) then
    raise exception 'TURN_HAS_ACTIVE_APPOINTMENT' using errcode='P0001';
  end if;
  if tg_op='DELETE' then return old; end if;
  new.updated_at := now();
  return new;
end;
$fn$;
drop trigger if exists provider_turns_guard on public.provider_turns;
create trigger provider_turns_guard before update or delete on public.provider_turns
for each row execute function public.luni_guard_turn_changes();

create or replace function public.luni_available_slots(
  p_provider_id uuid, p_service_id uuid, p_day date
) returns table(starts_at timestamptz)
language plpgsql stable security definer set search_path=public,pg_temp as $function$
declare
  v_service public.services%rowtype;
  v_provider public.provider_profiles%rowtype;
  v_turn record;
  v_start timestamptz;
  v_end timestamptz;
  v_count integer;
  v_today date;
begin
  select * into v_service from public.services
  where id=p_service_id and provider_id=p_provider_id and is_active and deleted_at is null;
  if not found then return; end if;
  select * into v_provider from public.provider_profiles
  where id=p_provider_id and is_published and deleted_at is null;
  if not found then return; end if;
  if auth.uid() is null or not (public.luni_is_provider_owner(v_provider.id)
    or public.luni_client_linked_to_provider(v_provider.id,auth.uid())) then return; end if;
  if not public.luni_provider_license_ok(v_provider) then return; end if;
  v_today := (now() at time zone v_provider.timezone)::date;
  if p_day is null or p_day<v_today or p_day>v_today+90 then return; end if;

  select count(*)::integer into v_count from public.appointments a
  where a.provider_id=v_provider.id and a.status in ('pending_confirmation','confirmed')
    and a.deleted_at is null and (a.starts_at at time zone v_provider.timezone)::date=p_day;
  if v_count>=v_provider.daily_appointment_limit then return; end if;

  for v_turn in
    select t.start_time,t.buffer_after_minutes
    from public.provider_turns t
    where t.provider_id=v_provider.id and t.turn_date=p_day and t.status='active'
    order by t.start_time
  loop
    v_start := (p_day + v_turn.start_time) at time zone v_provider.timezone;
    v_end := v_start + make_interval(mins=>v_service.duration_minutes);
    if v_start <= now()+interval '1 hour' then continue; end if;
    -- A service must finish, including the configured cleanup buffer, before the next manually-defined turn.
    if exists (
      select 1 from public.provider_turns n
      where n.provider_id=v_provider.id and n.turn_date=p_day and n.status='active'
        and n.start_time>v_turn.start_time
        and (v_end at time zone v_provider.timezone)
            + make_interval(mins=>v_turn.buffer_after_minutes) > p_day+n.start_time
    ) then continue; end if;
    if exists (select 1 from public.appointments a
      where a.provider_id=v_provider.id and a.status in ('pending_confirmation','confirmed')
        and a.deleted_at is null and tstzrange(a.starts_at,a.ends_at,'[)') && tstzrange(v_start,v_end,'[)')) then continue; end if;
    if exists (select 1 from public.availability b
      where b.provider_id=v_provider.id and b.kind='block' and b.status='active'
        and tstzrange(b.starts_at,b.ends_at,'[)') && tstzrange(v_start,v_end,'[)')) then continue; end if;
    starts_at:=v_start; return next;
  end loop;
end;
$function$;

create or replace function public.luni_create_appointment(
  p_id uuid, p_provider_id uuid, p_service_id uuid, p_starts_at timestamptz,
  p_idempotency_key text, p_notes text default ''
) returns public.appointments
language plpgsql security definer set search_path=public,pg_temp as $function$
declare
  v_client_id uuid:=auth.uid();
  v_service public.services%rowtype;
  v_provider public.provider_profiles%rowtype;
  v_turn public.provider_turns%rowtype;
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
  if p_idempotency_key is null or length(trim(p_idempotency_key))<8 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023'; end if;
  select nullif(trim(phone),'') into v_phone from public.profiles where id=v_client_id;
  if v_phone is null then raise exception 'PHONE_REQUIRED' using errcode='P0001'; end if;
  if p_starts_at is null or p_starts_at<=now()+interval '1 hour' then
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
  v_end:=p_starts_at+make_interval(mins=>v_service.duration_minutes);
  v_local_start:=p_starts_at at time zone v_provider.timezone;
  v_local_end:=v_end at time zone v_provider.timezone;
  v_today:=(now() at time zone v_provider.timezone)::date;
  if v_local_start::date<v_today or v_local_start::date>v_today+90 or v_local_start::date<>v_local_end::date then
    raise exception 'INVALID_APPOINTMENT_DATE' using errcode='22023'; end if;

  select * into v_turn from public.provider_turns t
  where t.provider_id=v_provider.id and t.turn_date=v_local_start::date
    and t.start_time=v_local_start::time and t.status='active';
  if not found then raise exception 'INVALID_APPOINTMENT_SLOT' using errcode='P0001'; end if;
  if exists (
    select 1 from public.provider_turns n
    where n.provider_id=v_provider.id and n.turn_date=v_turn.turn_date and n.status='active'
      and n.start_time>v_turn.start_time
      and v_local_end + make_interval(mins=>v_turn.buffer_after_minutes)>v_turn.turn_date+n.start_time
  ) then raise exception 'SERVICE_DOES_NOT_FIT_BEFORE_NEXT_TURN' using errcode='P0001'; end if;
  if exists (select 1 from public.availability b where b.provider_id=v_provider.id
    and b.kind='block' and b.status='active'
    and tstzrange(b.starts_at,b.ends_at,'[)') && tstzrange(p_starts_at,v_end,'[)')) then
    raise exception 'SLOT_BLOCKED' using errcode='P0001'; end if;
  select count(*)::integer into v_daily_count from public.appointments a
  where a.provider_id=v_provider.id and a.status in ('pending_confirmation','confirmed')
    and a.deleted_at is null and (a.starts_at at time zone v_provider.timezone)::date=v_local_start::date;
  if v_daily_count>=v_provider.daily_appointment_limit then
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

revoke all on function public.luni_available_slots(uuid,uuid,date) from public,anon;
grant execute on function public.luni_available_slots(uuid,uuid,date) to authenticated;
revoke all on function public.luni_create_appointment(uuid,uuid,uuid,timestamptz,text,text) from public,anon;
grant execute on function public.luni_create_appointment(uuid,uuid,uuid,timestamptz,text,text) to authenticated;
commit;
