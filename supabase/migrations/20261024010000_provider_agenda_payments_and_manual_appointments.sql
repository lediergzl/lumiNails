-- Agenda de Luni Estudio: registro de cobro y citas manuales.
begin;

alter table public.appointments
  add column if not exists payment_received boolean not null default false,
  add column if not exists payment_received_at timestamptz;

create or replace function public.luni_provider_set_appointment_payment(
  p_appointment_id uuid,
  p_paid boolean
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_provider_id uuid;
begin
  select a.provider_id into v_provider_id
  from public.appointments a
  where a.id = p_appointment_id and a.deleted_at is null;

  if v_provider_id is null or not public.luni_is_provider_owner(v_provider_id) then
    raise exception 'APPOINTMENT_NOT_FOUND_OR_FORBIDDEN' using errcode = '42501';
  end if;

  update public.appointments
  set payment_received = p_paid,
      payment_received_at = case when p_paid then now() else null end,
      updated_at = now()
  where id = p_appointment_id and provider_id = v_provider_id;

  return p_paid;
end;
$fn$;

create or replace function public.luni_provider_create_manual_appointment(
  p_client_id uuid,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_notes text default ''
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_provider_id uuid;
  v_service public.services%rowtype;
  v_appointment_id uuid := gen_random_uuid();
  v_timezone text;
  v_auto_confirm boolean;
begin
  select pp.id, pp.timezone, pp.auto_confirm_appointments
    into v_provider_id, v_timezone, v_auto_confirm
  from public.provider_profiles pp
  where pp.user_id = auth.uid() and pp.deleted_at is null
  limit 1;

  if v_provider_id is null then
    raise exception 'PROVIDER_PROFILE_REQUIRED' using errcode = '42501';
  end if;

  select s.* into v_service
  from public.services s
  where s.id = p_service_id and s.provider_id = v_provider_id
    and s.is_active and s.deleted_at is null;

  if v_service.id is null then
    raise exception 'SERVICE_NOT_AVAILABLE';
  end if;

  if not exists (
    select 1 from public.profiles p where p.id = p_client_id
  ) or not exists (
    select 1 from public.appointments a
    where a.provider_id = v_provider_id and a.client_id = p_client_id
      and a.deleted_at is null
  ) then
    raise exception 'CLIENT_NOT_IN_STUDIO_LIST';
  end if;

  if p_starts_at <= now() then
    raise exception 'INVALID_APPOINTMENT_TIME';
  end if;

  insert into public.appointments (
    id, provider_id, client_id, service_id, starts_at, ends_at, status,
    notes, idempotency_key, client_service_name, client_price_cents, client_currency
  ) values (
    v_appointment_id, v_provider_id, p_client_id, v_service.id, p_starts_at,
    p_starts_at + make_interval(mins => v_service.duration_minutes),
    'confirmed', coalesce(p_notes, ''), 'manual-' || v_appointment_id::text,
    v_service.name, v_service.price_cents, v_service.currency
  );

  return v_appointment_id;
exception
  when exclusion_violation then
    raise exception 'SLOT_ALREADY_TAKEN';
end;
$fn$;

revoke all on function public.luni_provider_set_appointment_payment(uuid, boolean) from public;
grant execute on function public.luni_provider_set_appointment_payment(uuid, boolean) to authenticated;
revoke all on function public.luni_provider_create_manual_appointment(uuid, uuid, timestamptz, text) from public;
grant execute on function public.luni_provider_create_manual_appointment(uuid, uuid, timestamptz, text) to authenticated;

commit;
