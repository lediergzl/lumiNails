-- Luni: horario semanal real y horas libres calculadas en el servidor.
-- Aplica esta migración DESPUÉS de 20261009010000_initial_schema.sql
-- (SQL Editor de Supabase o `supabase db push`).
--
-- Modelo:
--   * weekly_schedule: tramos de atención por día de la semana (ISO: 1 = lunes … 7 = domingo),
--     en hora local del estudio (provider_profiles.timezone).
--   * availability (kind = 'block'): días u horas bloqueados (vacaciones, festivos).
--   * Las horas libres se calculan aquí (luni_available_slots) y luni_create_appointment
--     valida con las mismas reglas, de modo que lo que se muestra es lo que se puede reservar.
--   * Las filas antiguas availability.kind = 'working_hours' se siguen aceptando al reservar.

-- 1) Zona horaria del estudio ------------------------------------------------------------------
alter table public.provider_profiles
  add column if not exists timezone text not null default 'America/Havana';

-- Evita guardar una zona inexistente (rompería el cálculo de horas libres de ese estudio).
alter table public.provider_profiles
  drop constraint if exists provider_profiles_timezone_valid;
alter table public.provider_profiles
  add constraint provider_profiles_timezone_valid
  check (timezone(timezone, now()) is not null);

-- 2) Horario semanal -----------------------------------------------------------------------------
create table if not exists public.weekly_schedule (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.provider_profiles(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);

create index if not exists weekly_schedule_provider_idx
  on public.weekly_schedule(provider_id, weekday);

-- Dos tramos del mismo día no pueden solaparse.
alter table public.weekly_schedule
  drop constraint if exists weekly_schedule_no_overlap;
alter table public.weekly_schedule
  add constraint weekly_schedule_no_overlap
  exclude using gist (
    provider_id with =,
    weekday with =,
    tsrange(timestamp '2000-01-01' + start_time, timestamp '2000-01-01' + end_time, '[)') with &&
  );

alter table public.weekly_schedule enable row level security;

drop policy if exists "provider manages own weekly schedule" on public.weekly_schedule;
create policy "provider manages own weekly schedule"
  on public.weekly_schedule for all to authenticated
  using (exists (select 1 from public.provider_profiles p where p.id = provider_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.provider_profiles p where p.id = provider_id and p.user_id = auth.uid()));

-- 3) Reglas compartidas (uso interno) -------------------------------------------------------------
create or replace function public.luni_provider_license_ok(p public.provider_profiles)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_trial_days integer;
begin
  select coalesce((value #>> '{}')::integer, 14) into v_trial_days
  from public.app_settings where key = 'license_trial_days';
  v_trial_days := coalesce(v_trial_days, 14);

  return (
    p.license_status in ('active','grace')
    and p.license_expires_at is not null
    and p.license_expires_at > now()
  ) or (
    p.license_status = 'trial'
    and p.trial_started_at + make_interval(days => v_trial_days) > now()
  );
end;
$fn$;

create or replace function public.luni_within_working_hours(
  p_provider_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select
    -- Filas antiguas con intervalos concretos.
    exists (
      select 1 from public.availability a
      where a.provider_id = p_provider_id
        and a.kind = 'working_hours'
        and a.status = 'active'
        and a.starts_at <= p_start
        and a.ends_at >= p_end
    )
    or
    -- Horario semanal en la hora local del estudio (la cita no puede cruzar la medianoche).
    exists (
      select 1
      from public.provider_profiles p
      join public.weekly_schedule w on w.provider_id = p.id
      where p.id = p_provider_id
        and w.weekday = extract(isodow from (p_start at time zone p.timezone))::int
        and (p_start at time zone p.timezone)::date = (p_end at time zone p.timezone)::date
        and w.start_time <= (p_start at time zone p.timezone)::time
        and w.end_time >= (p_end at time zone p.timezone)::time
    );
$fn$;

revoke all on function public.luni_provider_license_ok(public.provider_profiles) from public;
revoke all on function public.luni_within_working_hours(uuid, timestamptz, timestamptz) from public;

-- 4) Horas libres de un día ----------------------------------------------------------------------
-- Las horas de inicio salen cada 30 min dentro de cada tramo del día. Se descartan las que
-- empiezan en menos de 1 hora, se solapan con una cita viva o caen en un bloqueo.
create or replace function public.luni_available_slots(
  p_provider_id uuid,
  p_service_id uuid,
  p_day date
)
returns table (starts_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_service public.services%rowtype;
  v_provider public.provider_profiles%rowtype;
  v_step constant interval := interval '30 minutes';
  v_lead constant interval := interval '1 hour';
  v_duration interval;
  v_today date;
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
$fn$;

-- Cuántas horas libres tiene cada día de un rango (máx. 60 días), para pintar el calendario.
create or replace function public.luni_available_days(
  p_provider_id uuid,
  p_service_id uuid,
  p_from date,
  p_days integer default 14
)
returns table (day date, slots integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select
    d::date,
    (select count(*)::integer from public.luni_available_slots(p_provider_id, p_service_id, d::date))
  from generate_series(
    p_from::timestamp,
    (p_from + (least(greatest(coalesce(p_days, 14), 1), 60) - 1))::timestamp,
    interval '1 day'
  ) as d
  order by d;
$fn$;

revoke all on function public.luni_available_slots(uuid, uuid, date) from public;
revoke all on function public.luni_available_days(uuid, uuid, date, integer) from public;
grant execute on function public.luni_available_slots(uuid, uuid, date) to anon, authenticated;
grant execute on function public.luni_available_days(uuid, uuid, date, integer) to anon, authenticated;

-- 5) Reservar: mismas reglas que las horas libres -------------------------------------------------
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
set search_path = public, pg_temp
as $fn$
declare
  v_client_id uuid := auth.uid();
  v_service public.services%rowtype;
  v_provider public.provider_profiles%rowtype;
  v_end timestamptz;
  v_existing public.appointments%rowtype;
  v_result public.appointments%rowtype;
begin
  if v_client_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode = '22023';
  end if;
  if p_starts_at is null or p_starts_at <= now() then
    raise exception 'INVALID_APPOINTMENT_TIME' using errcode = '22023';
  end if;

  select * into v_existing
  from public.appointments
  where client_id = v_client_id and idempotency_key = p_idempotency_key;
  if found then
    return v_existing;
  end if;

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

  -- Bloquear la fila del estudio serializa los intentos de reserva; la restricción de
  -- exclusión de appointments es la última barrera contra solapes.
  insert into public.appointments (
    id, provider_id, client_id, service_id, starts_at, ends_at, status,
    notes, idempotency_key, client_service_name, client_price_cents, client_currency
  ) values (
    coalesce(p_id, gen_random_uuid()), v_provider.id, v_client_id, v_service.id,
    p_starts_at, v_end, 'pending_confirmation', coalesce(p_notes, ''),
    p_idempotency_key, v_service.name, v_service.price_cents, v_service.currency
  )
  returning * into v_result;

  return v_result;
exception
  when exclusion_violation then
    raise exception 'SLOT_ALREADY_TAKEN' using errcode = '23P01';
end;
$fn$;

revoke all on function public.luni_create_appointment(uuid, uuid, uuid, timestamptz, text, text) from public;
grant execute on function public.luni_create_appointment(uuid, uuid, uuid, timestamptz, text, text) to authenticated;

-- 6) Acciones de la manicurista (se ejecutan con sus permisos: aplica RLS) -------------------------
-- p_windows: [{"weekday": 1, "start": "09:00", "end": "17:00"}, ...] — reemplaza todo el horario.
create or replace function public.luni_save_weekly_schedule(p_windows jsonb)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  v_provider_id uuid;
begin
  select id into v_provider_id
  from public.provider_profiles
  where user_id = auth.uid() and deleted_at is null;
  if v_provider_id is null then
    raise exception 'PROVIDER_REQUIRED' using errcode = 'P0002';
  end if;
  if p_windows is null or jsonb_typeof(p_windows) <> 'array' then
    raise exception 'INVALID_SCHEDULE' using errcode = '22023';
  end if;

  delete from public.weekly_schedule where provider_id = v_provider_id;

  insert into public.weekly_schedule (provider_id, weekday, start_time, end_time)
  select v_provider_id, (x->>'weekday')::smallint, (x->>'start')::time, (x->>'end')::time
  from jsonb_array_elements(p_windows) as x;
exception
  when exclusion_violation then
    raise exception 'OVERLAPPING_WINDOWS' using errcode = '23P01';
  when check_violation or invalid_text_representation
       or invalid_datetime_format or datetime_field_overflow or null_value_not_allowed then
    raise exception 'INVALID_SCHEDULE' using errcode = '22023';
end;
$fn$;

-- Bloquea un día completo (hora local del estudio). Si ya estaba bloqueado, no duplica.
create or replace function public.luni_block_day(p_day date)
returns public.availability
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  v_provider public.provider_profiles%rowtype;
  v_start timestamptz;
  v_end timestamptz;
  v_row public.availability%rowtype;
begin
  select * into v_provider
  from public.provider_profiles
  where user_id = auth.uid() and deleted_at is null;
  if not found then
    raise exception 'PROVIDER_REQUIRED' using errcode = 'P0002';
  end if;
  if p_day is null then
    raise exception 'INVALID_DAY' using errcode = '22023';
  end if;

  v_start := p_day::timestamp at time zone v_provider.timezone;
  v_end := (p_day + 1)::timestamp at time zone v_provider.timezone;

  select * into v_row
  from public.availability
  where provider_id = v_provider.id and kind = 'block' and status = 'active'
    and starts_at = v_start and ends_at = v_end
  limit 1;
  if found then
    return v_row;
  end if;

  insert into public.availability (provider_id, starts_at, ends_at, kind)
  values (v_provider.id, v_start, v_end, 'block')
  returning * into v_row;
  return v_row;
end;
$fn$;

revoke all on function public.luni_save_weekly_schedule(jsonb) from public;
revoke all on function public.luni_block_day(date) from public;
grant execute on function public.luni_save_weekly_schedule(jsonb) to authenticated;
grant execute on function public.luni_block_day(date) to authenticated;
