-- Luni: una sola cita activa por clienta y modificación segura de fecha/hora.
begin;

-- Impide que dos reservas concurrentes creen dos citas activas para la misma clienta.
-- Se usa bloqueo de fila en profiles para serializar también solicitudes simultáneas.
create or replace function public.luni_guard_one_active_client_appointment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_client_id uuid;
  v_current_id uuid;
begin
  v_client_id := new.client_id;
  v_current_id := new.id;

  if new.deleted_at is not null or new.status not in ('pending_confirmation','confirmed') then
    return new;
  end if;

  perform 1 from public.profiles where id = v_client_id for update;
  if not found then
    raise exception 'CLIENT_PROFILE_NOT_FOUND' using errcode = '23503';
  end if;

  if exists (
    select 1
    from public.appointments a
    where a.client_id = v_client_id
      and a.id <> v_current_id
      and a.deleted_at is null
      and a.status in ('pending_confirmation','confirmed')
  ) then
    raise exception 'CLIENT_HAS_ACTIVE_APPOINTMENT' using errcode = '23505';
  end if;
  return new;
end;
$fn$;

drop trigger if exists appointments_one_active_per_client on public.appointments;
create trigger appointments_one_active_per_client
  before insert or update of client_id, status, deleted_at on public.appointments
  for each row execute function public.luni_guard_one_active_client_appointment();

-- La clienta puede mover la cita existente, pero no crear otra para sustituirla.
create or replace function public.luni_reschedule_appointment(
  p_appointment_id uuid,
  p_starts_at timestamptz
)
returns public.appointments
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_client_id uuid := auth.uid();
  v_appointment public.appointments%rowtype;
  v_service public.services%rowtype;
  v_provider public.provider_profiles%rowtype;
  v_end timestamptz;
  v_result public.appointments%rowtype;
  v_trial_days integer;
  v_local_start timestamp;
  v_local_end timestamp;
  v_today date;
  v_turn record;
  v_daily_count integer;
begin
  if v_client_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if p_starts_at is null or p_starts_at <= now() then
    raise exception 'INVALID_APPOINTMENT_TIME' using errcode = '22023';
  end if;

  -- La fila de perfil también se bloquea en la creación: no se puede colar otra reserva.
  perform 1 from public.profiles where id = v_client_id for update;

  select * into v_appointment
  from public.appointments
  where id = p_appointment_id and client_id = v_client_id and deleted_at is null
  for update;
  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_appointment.status not in ('pending_confirmation','confirmed') then
    raise exception 'APPOINTMENT_NOT_ACTIVE' using errcode = 'P0001';
  end if;

  select * into v_service
  from public.services
  where id = v_appointment.service_id and provider_id = v_appointment.provider_id
    and deleted_at is null;
  if not found then
    raise exception 'SERVICE_NOT_AVAILABLE' using errcode = 'P0002';
  end if;

  select * into v_provider
  from public.provider_profiles
  where id = v_appointment.provider_id and is_published and deleted_at is null
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
  if v_local_start::date < v_today or v_local_start::date > v_today + 90
     or v_local_end::date <> v_local_start::date then
    raise exception 'INVALID_APPOINTMENT_DATE' using errcode = '22023';
  end if;

  select e.start_time, e.buffer_after_minutes into v_turn
  from public.luni_effective_turns(v_provider.id, v_local_start::date) e
  where e.start_time = v_local_start::time;
  if not found then
    raise exception 'INVALID_APPOINTMENT_SLOT' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.luni_effective_turns(v_provider.id, v_local_start::date) n
    where n.start_time > v_turn.start_time
      and v_local_end + make_interval(mins => v_turn.buffer_after_minutes)
          > (v_local_start::date + n.start_time)
  ) then
    raise exception 'SERVICE_DOES_NOT_FIT_BEFORE_NEXT_TURN' using errcode = 'P0001';
  end if;

  if not public.luni_within_working_hours(v_provider.id, p_starts_at, v_end) then
    raise exception 'OUTSIDE_WORKING_HOURS' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.availability a
    where a.provider_id = v_provider.id and a.kind = 'block' and a.status = 'active'
      and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(p_starts_at, v_end, '[)')
  ) then
    raise exception 'SLOT_BLOCKED' using errcode = 'P0001';
  end if;

  select count(*)::integer into v_daily_count
  from public.appointments a
  where a.provider_id = v_provider.id
    and a.id <> v_appointment.id
    and a.status in ('pending_confirmation','confirmed')
    and a.deleted_at is null
    and (a.starts_at at time zone v_provider.timezone)::date = v_local_start::date;
  if v_daily_count >= v_provider.daily_appointment_limit then
    raise exception 'DAILY_LIMIT_REACHED' using errcode = 'P0001';
  end if;

  -- Señal transaccional para que el trigger de seguridad autorice SOLO este cambio de hora.
  perform set_config('luni.reschedule_appointment', v_appointment.id::text, true);
  update public.appointments
  set starts_at = p_starts_at, ends_at = v_end, updated_at = now(), version = version + 1
  where id = v_appointment.id
  returning * into v_result;
  return v_result;
exception
  when exclusion_violation then
    raise exception 'SLOT_ALREADY_TAKEN' using errcode = '23P01';
end;
$fn$;

revoke all on function public.luni_reschedule_appointment(uuid, timestamptz) from public;
grant execute on function public.luni_reschedule_appointment(uuid, timestamptz) to authenticated;


-- La creación comprueba la cita activa bajo bloqueo de la fila de la clienta.
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

  -- Serializa reservas de la misma clienta y vuelve a consultar con una nueva instantánea.
  perform 1 from public.profiles where id = v_client_id for update;
  if exists (
    select 1 from public.appointments a
    where a.client_id = v_client_id
      and a.deleted_at is null
      and a.status in ('pending_confirmation','confirmed')
  ) then
    raise exception 'CLIENT_HAS_ACTIVE_APPOINTMENT' using errcode='P0001';
  end if;

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

revoke all on function public.luni_create_appointment(uuid,uuid,uuid,timestamptz,text,text) from public, anon;
grant execute on function public.luni_create_appointment(uuid,uuid,uuid,timestamptz,text,text) to authenticated;

commit;
