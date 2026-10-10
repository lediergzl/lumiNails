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

  select coalesce((value #>> '{}')::integer, 14) into v_trial_days
  from public.app_settings where key = 'license_trial_days';
  v_trial_days := coalesce(v_trial_days, 14);
  if not (
    (v_provider.license_status in ('active','grace')
      and v_provider.license_expires_at is not null
      and v_provider.license_expires_at > now())
    or (v_provider.license_status = 'trial'
      and v_provider.trial_started_at + make_interval(days => v_trial_days) > now())
  ) then
    raise exception 'PROVIDER_LICENSE_INACTIVE' using errcode = 'P0001';
  end if;

  v_end := p_starts_at + make_interval(mins => v_service.duration_minutes);

  if not exists (
    select 1 from public.availability a
    where a.provider_id = v_provider.id and a.kind = 'working_hours'
      and a.status = 'active' and a.starts_at <= p_starts_at and a.ends_at >= v_end
  ) then
    raise exception 'OUTSIDE_WORKING_HOURS' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.availability a
    where a.provider_id = v_provider.id and a.kind = 'block' and a.status = 'active'
      and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(p_starts_at, v_end, '[)')
  ) then
    raise exception 'SLOT_BLOCKED' using errcode = 'P0001';
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

commit;
