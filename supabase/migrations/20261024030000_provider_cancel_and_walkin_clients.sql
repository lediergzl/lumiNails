-- Agenda: permitir cancelar desde el estudio y crear citas para clientas sin cuenta Luni.
begin;

create or replace function public.luni_provider_cancel_appointment(
  p_appointment_id uuid,
  p_reason text default ''
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_provider_id uuid;
  v_status text;
begin
  select a.provider_id, a.status into v_provider_id, v_status
  from public.appointments a
  where a.id = p_appointment_id and a.deleted_at is null
  for update;

  if v_provider_id is null or not public.luni_is_provider_owner(v_provider_id) then
    raise exception 'APPOINTMENT_NOT_FOUND_OR_FORBIDDEN' using errcode = '42501';
  end if;
  if v_status not in ('pending_confirmation','confirmed') then
    raise exception 'APPOINTMENT_STATUS_CHANGE_FORBIDDEN' using errcode = '42501';
  end if;

  update public.appointments
  set status = 'cancelled',
      cancellation_reason = left(coalesce(nullif(trim(p_reason), ''), 'Cancelada por la manicurista'), 500),
      updated_at = now(),
      version = version + 1
  where id = p_appointment_id and provider_id = v_provider_id;

  return p_appointment_id;
end;
$fn$;

create or replace function public.luni_provider_create_manual_client_appointment(
  p_client_name text,
  p_client_phone text,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_notes text default ''
) returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $fn$
declare
  v_provider_id uuid;
  v_service public.services%rowtype;
  v_client_id uuid;
  v_appointment_id uuid := gen_random_uuid();
  v_phone text := regexp_replace(coalesce(p_client_phone, ''), '[^0-9+]', '', 'g');
  v_name text := trim(coalesce(p_client_name, ''));
  v_timezone text;
begin
  select pp.id, pp.timezone into v_provider_id, v_timezone
  from public.provider_profiles pp
  where pp.user_id = auth.uid() and pp.deleted_at is null
  limit 1;

  if v_provider_id is null then
    raise exception 'PROVIDER_PROFILE_REQUIRED' using errcode = '42501';
  end if;
  if length(v_name) < 2 or length(v_phone) < 6 then
    raise exception 'INVALID_CLIENT_DETAILS' using errcode = '22023';
  end if;
  if p_starts_at is null or p_starts_at <= now() then
    raise exception 'INVALID_APPOINTMENT_TIME';
  end if;

  select s.* into v_service
  from public.services s
  where s.id = p_service_id and s.provider_id = v_provider_id
    and s.is_active and s.deleted_at is null;
  if v_service.id is null then
    raise exception 'SERVICE_NOT_AVAILABLE';
  end if;

  -- Reutilizar una clienta ya registrada con el mismo teléfono evita duplicados.
  select p.id into v_client_id
  from public.profiles p
  where regexp_replace(coalesce(p.phone, ''), '[^0-9+]', '', 'g') = v_phone
    and exists (
      select 1 from public.appointments a
      where a.provider_id = v_provider_id
        and a.client_id = p.id
        and a.deleted_at is null
    )
  order by p.created_at
  limit 1;

  if v_client_id is null then
    v_client_id := gen_random_uuid();
    insert into auth.users (
      id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new
    ) values (
      v_client_id, 'authenticated', 'authenticated',
      'walkin+' || replace(v_client_id::text, '-', '') || '@clients.luni.invalid',
      crypt(gen_random_uuid()::text, gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('display_name', v_name, 'created_by_provider', v_provider_id::text),
      now(), now(), '', '', '', ''
    );
  end if;

  update public.profiles
  set display_name = case when trim(coalesce(display_name,'')) = '' then v_name else display_name end,
      phone = v_phone,
      updated_at = now()
  where id = v_client_id;

  insert into public.appointments (
    id, provider_id, client_id, service_id, starts_at, ends_at, status,
    notes, idempotency_key, client_service_name, client_price_cents, client_currency
  ) values (
    v_appointment_id, v_provider_id, v_client_id, v_service.id, p_starts_at,
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

revoke all on function public.luni_provider_cancel_appointment(uuid, text) from public;
grant execute on function public.luni_provider_cancel_appointment(uuid, text) to authenticated;
revoke all on function public.luni_provider_create_manual_client_appointment(text, text, uuid, timestamptz, text) from public;
grant execute on function public.luni_provider_create_manual_client_appointment(text, text, uuid, timestamptz, text) to authenticated;

commit;
