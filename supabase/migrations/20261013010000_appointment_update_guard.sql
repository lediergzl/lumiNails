-- LuniNails: las citas solo pueden cambiar de estado por flujos permitidos.
-- Antes, las políticas RLS dejaban a la manicurista (y a la clienta, al cancelar) modificar cualquier
-- columna de la cita —precio, hora, servicio— llamando a la API directamente.
begin;

create or replace function public.luni_guard_appointment_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  -- Sin sesión de usuario (service_role, SQL Editor, tareas internas): sin restricciones.
  if auth.uid() is null then return new; end if;

  if new.id is distinct from old.id
     or new.provider_id is distinct from old.provider_id
     or new.client_id is distinct from old.client_id
     or new.service_id is distinct from old.service_id
     or new.starts_at is distinct from old.starts_at
     or new.ends_at is distinct from old.ends_at
     or new.notes is distinct from old.notes
     or new.idempotency_key is distinct from old.idempotency_key
     or new.client_service_name is distinct from old.client_service_name
     or new.client_price_cents is distinct from old.client_price_cents
     or new.client_currency is distinct from old.client_currency
     or new.created_at is distinct from old.created_at
     or new.deleted_at is distinct from old.deleted_at then
    raise exception 'APPOINTMENT_FIELD_LOCKED' using errcode = '42501';
  end if;

  if new.status is not distinct from old.status then
    -- El motivo solo se escribe junto con un cambio de estado.
    if new.cancellation_reason is distinct from old.cancellation_reason then
      raise exception 'APPOINTMENT_FIELD_LOCKED' using errcode = '42501';
    end if;
    return new;
  end if;

  if public.luni_is_provider_owner(old.provider_id) and (
       (old.status = 'pending_confirmation' and new.status in ('confirmed', 'rejected', 'cancelled'))
    or (old.status = 'confirmed' and new.status in ('completed', 'cancelled'))
  ) then
    return new;
  end if;

  if old.client_id = auth.uid()
     and old.status in ('pending_confirmation', 'confirmed')
     and new.status = 'cancelled' then
    return new;
  end if;

  raise exception 'APPOINTMENT_STATUS_CHANGE_FORBIDDEN' using errcode = '42501';
end;
$fn$;

drop trigger if exists appointments_update_guard on public.appointments;
create trigger appointments_update_guard
  before update on public.appointments
  for each row execute function public.luni_guard_appointment_update();

commit;
