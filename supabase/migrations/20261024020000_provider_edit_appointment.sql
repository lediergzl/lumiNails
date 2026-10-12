-- Edición segura de hora y notas desde la agenda de la manicurista.
begin;
create or replace function public.luni_provider_edit_appointment(
  p_appointment_id uuid,
  p_starts_at timestamptz,
  p_notes text default ''
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_provider_id uuid;
  v_duration interval;
begin
  select a.provider_id, a.ends_at - a.starts_at
    into v_provider_id, v_duration
  from public.appointments a
  where a.id = p_appointment_id and a.deleted_at is null
    and a.status in ('pending_confirmation','confirmed');

  if v_provider_id is null or not public.luni_is_provider_owner(v_provider_id) then
    raise exception 'APPOINTMENT_NOT_FOUND_OR_FORBIDDEN' using errcode = '42501';
  end if;
  if p_starts_at <= now() then
    raise exception 'INVALID_APPOINTMENT_TIME';
  end if;

  update public.appointments
  set starts_at = p_starts_at,
      ends_at = p_starts_at + v_duration,
      notes = coalesce(p_notes, ''),
      updated_at = now(),
      version = version + 1
  where id = p_appointment_id and provider_id = v_provider_id;

  return p_appointment_id;
exception
  when exclusion_violation then
    raise exception 'SLOT_ALREADY_TAKEN';
end;
$fn$;
revoke all on function public.luni_provider_edit_appointment(uuid, timestamptz, text) from public;
grant execute on function public.luni_provider_edit_appointment(uuid, timestamptz, text) to authenticated;
commit;
