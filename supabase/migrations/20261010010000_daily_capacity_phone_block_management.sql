-- LuniNails: daily booking capacity, required client phone and reviewed day blocks.
begin;

alter table public.provider_profiles
  add column if not exists daily_appointment_limit integer not null default 8;

alter table public.provider_profiles
  drop constraint if exists provider_profiles_daily_appointment_limit_check;
alter table public.provider_profiles
  add constraint provider_profiles_daily_appointment_limit_check
  check (daily_appointment_limit between 1 and 50);

alter table public.profiles
  add column if not exists phone text;

alter table public.appointments
  add column if not exists cancellation_reason text not null default '';

-- Public availability must reflect the provider's daily capacity.
create or replace function public.luni_available_slots(
  p_provider_id uuid,
  p_service_id uuid,
  p_day date
)
returns table(starts_at timestamptz)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_service public.services%rowtype;
  v_provider public.provider_profiles%rowtype;
  v_step constant interval := interval '30 minutes';
  v_lead constant interval := interval '1 hour';
  v_duration interval;
  v_today date;
  v_count integer;
  w record;
  v_cursor timestamp;
  v_start timestamptz;
  v_end timestamptz;
begin
  select * into v_service
  from public.services
  where id = p_service_id and is_active and deleted_at is null;
  if not found then return; end if;

  select * into v_provider
  from public.provider_profiles
  where id = p_provider_id and id = v_service.provider_id
    and is_published and deleted_at is null;
  if not found then return; end if;

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

  v_duration := make_interval(mins => v_service.duration_minutes);

  for w in
    select ws.start_time, ws.end_time
    from public.weekly_schedule ws
    where ws.provider_id = v_provider.id
      and ws.weekday = extract(isodow from p_day)::int
    order by ws.start_time
  loop
    v_cursor := p_day + w.start_time;
    while v_cursor + v_duration <= p_day + w.end_time loop
      v_start := v_cursor at time zone v_provider.timezone;
      v_end := v_start + v_duration;

      if v_start > now() + v_lead
         and not exists (
           select 1 from public.appointments a
           where a.provider_id = v_provider.id
             and a.status in ('pending_confirmation','confirmed')
             and a.deleted_at is null
             and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(v_start, v_end, '[)')
         )
         and not exists (
           select 1 from public.availability b
           where b.provider_id = v_provider.id
             and b.kind = 'block'
             and b.status = 'active'
             and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(v_start, v_end, '[)')
         )
      then
        starts_at := v_start;
        return next;
      end if;

      v_cursor := v_cursor + v_step;
    end loop;
  end loop;
end;
$function$;

-- Day-strip counts use the exact same server-side slot and capacity rules.
create or replace function public.luni_available_days(
  p_provider_id uuid,
  p_service_id uuid,
  p_from date,
  p_days integer
)
returns table(day date, slots integer)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_day date;
begin
  if p_from is null or p_days is null or p_days < 1 then return; end if;
  for v_day in
    select gs::date
    from generate_series(
      p_from::timestamp,
      (p_from + least(p_days, 91) - 1)::timestamp,
      interval '1 day'
    ) gs
  loop
    day := v_day;
    select count(*)::integer into slots
    from public.luni_available_slots(p_provider_id, p_service_id, v_day);
    return next;
  end loop;
end;
$function$;

create or replace function public.luni_create_appointment(
  p_id uuid,
  p_provider_id uuid,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_idempotency_key text,
  p_notes text default ''
)
returns public.appointments
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_client_id uuid := auth.uid();
  v_service public.services%rowtype;
  v_provider public.provider_profiles%rowtype;
  v_end timestamptz;
  v_existing public.appointments%rowtype;
  v_result public.appointments%rowtype;
  v_phone text;
  v_local_start timestamp;
  v_local_end timestamp;
  v_today date;
  v_daily_count integer;
begin
  if v_client_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode = '22023';
  end if;

  select nullif(trim(phone), '') into v_phone
  from public.profiles where id = v_client_id;
  if v_phone is null then
    raise exception 'PHONE_REQUIRED' using errcode = 'P0001';
  end if;

  if p_starts_at is null or p_starts_at <= now() + interval '1 hour' then
    raise exception 'INVALID_APPOINTMENT_TIME' using errcode = '22023';
  end if;

  select * into v_existing
  from public.appointments
  where client_id = v_client_id and idempotency_key = p_idempotency_key;
  if found then return v_existing; end if;

  select * into v_service
  from public.services
  where id = p_service_id and is_active and deleted_at is null;
  if not found then
    raise exception 'SERVICE_NOT_AVAILABLE' using errcode = 'P0002';
  end if;

  select * into v_provider
  from public.provider_profiles
  where id = p_provider_id and id = v_service.provider_id
    and is_published and deleted_at is null
  for update;
  if not found then
    raise exception 'PROVIDER_NOT_AVAILABLE' using errcode = 'P0002';
  end if;

  if not public.luni_provider_license_ok(v_provider) then
    raise exception 'PROVIDER_LICENSE_INACTIVE' using errcode = 'P0001';
  end if;

  v_end := p_starts_at + make_interval(mins => v_service.duration_minutes);
  v_local_start := p_starts_at at time zone v_provider.timezone;
  v_local_end := v_end at time zone v_provider.timezone;
  v_today := (now() at time zone v_provider.timezone)::date;

  if v_local_start::date < v_today or v_local_start::date > v_today + 90 then
    raise exception 'INVALID_APPOINTMENT_DATE' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.weekly_schedule w
    where w.provider_id = v_provider.id
      and w.weekday = extract(isodow from v_local_start)::int
      and v_local_start::date = v_local_end::date
      and w.start_time <= v_local_start::time
      and w.end_time >= v_local_end::time
      and mod(extract(epoch from (v_local_start::time - w.start_time)), 1800) = 0
  ) then
    raise exception 'INVALID_APPOINTMENT_SLOT' using errcode = 'P0001';
  end if;

  if not public.luni_within_working_hours(v_provider.id, p_starts_at, v_end) then
    raise exception 'OUTSIDE_WORKING_HOURS' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.availability a
    where a.provider_id = v_provider.id
      and a.kind = 'block'
      and a.status = 'active'
      and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(p_starts_at, v_end, '[)')
  ) then
    raise exception 'SLOT_BLOCKED' using errcode = 'P0001';
  end if;

  select count(*)::integer into v_daily_count
  from public.appointments a
  where a.provider_id = v_provider.id
    and a.status in ('pending_confirmation','confirmed')
    and a.deleted_at is null
    and (a.starts_at at time zone v_provider.timezone)::date = v_local_start::date;

  if v_daily_count >= v_provider.daily_appointment_limit then
    raise exception 'DAILY_LIMIT_REACHED' using errcode = 'P0001';
  end if;

  insert into public.appointments (
    id, provider_id, client_id, service_id, starts_at, ends_at, status,
    notes, idempotency_key, client_service_name, client_price_cents,
    client_currency, cancellation_reason
  ) values (
    coalesce(p_id, gen_random_uuid()), v_provider.id, v_client_id, v_service.id,
    p_starts_at, v_end, 'pending_confirmation', coalesce(p_notes, ''),
    p_idempotency_key, v_service.name, v_service.price_cents, v_service.currency, ''
  )
  returning * into v_result;

  return v_result;
exception
  when exclusion_violation then
    raise exception 'SLOT_ALREADY_TAKEN' using errcode = '23P01';
end;
$function$;

revoke all on function public.luni_create_appointment(uuid, uuid, uuid, timestamptz, text, text) from public, anon;
grant execute on function public.luni_create_appointment(uuid, uuid, uuid, timestamptz, text, text) to authenticated;
grant execute on function public.luni_available_slots(uuid, uuid, date) to anon, authenticated;
grant execute on function public.luni_available_days(uuid, uuid, date, integer) to anon, authenticated;


-- Provider-only contact view: exposes client contact data only to the owner of this studio.
create or replace function public.luni_provider_appointments_with_contacts(p_provider_id uuid)
returns table (
  id uuid,
  provider_id uuid,
  client_id uuid,
  service_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  notes text,
  client_service_name text,
  client_price_cents bigint,
  client_currency text,
  cancellation_reason text,
  client_display_name text,
  client_phone text
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.uid() is null or not exists (
    select 1 from public.provider_profiles p
    where p.id = p_provider_id and p.user_id = auth.uid()
  ) then
    raise exception 'PROVIDER_ACCESS_DENIED' using errcode = '42501';
  end if;

  return query
  select a.id, a.provider_id, a.client_id, a.service_id, a.starts_at, a.ends_at,
         a.status, a.notes, a.client_service_name, a.client_price_cents,
         a.client_currency, a.cancellation_reason, pr.display_name, pr.phone
  from public.appointments a
  join public.profiles pr on pr.id = a.client_id
  where a.provider_id = p_provider_id and a.deleted_at is null
  order by a.starts_at;
end;
$function$;

revoke all on function public.luni_provider_appointments_with_contacts(uuid) from public, anon;
grant execute on function public.luni_provider_appointments_with_contacts(uuid) to authenticated;


commit;
