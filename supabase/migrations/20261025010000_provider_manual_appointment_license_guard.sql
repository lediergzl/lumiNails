-- Bloqueo central de nuevas citas cuando la licencia del estudio no está vigente.
-- Se aplica a cualquier ruta de inserción (reservas online y citas manuales),
-- sin impedir consultar, editar, cancelar ni cobrar citas que ya existen.
begin;

create or replace function public.luni_guard_appointment_license()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_provider public.provider_profiles%rowtype;
  v_trial_days integer;
  v_license_valid boolean := false;
begin
  select pp.* into v_provider
  from public.provider_profiles pp
  where pp.id = new.provider_id
    and pp.deleted_at is null;

  if not found then
    raise exception 'PROVIDER_NOT_AVAILABLE' using errcode = 'P0002';
  end if;

  select coalesce((s.value #>> '{}')::integer, 14)
    into v_trial_days
  from public.app_settings s
  where s.key = 'license_trial_days';
  v_trial_days := greatest(0, coalesce(v_trial_days, 14));

  v_license_valid :=
    (
      v_provider.license_status in ('active', 'grace')
      and v_provider.license_expires_at is not null
      and v_provider.license_expires_at > now()
    )
    or
    (
      v_provider.license_status = 'trial'
      and v_provider.trial_started_at is not null
      and v_provider.trial_started_at + make_interval(days => v_trial_days) > now()
    );

  if not coalesce(v_license_valid, false) then
    raise exception 'PROVIDER_LICENSE_INACTIVE' using errcode = 'P0001';
  end if;

  return new;
end;
$fn$;

revoke all on function public.luni_guard_appointment_license() from public;

drop trigger if exists trg_luni_guard_appointment_license on public.appointments;
create trigger trg_luni_guard_appointment_license
before insert on public.appointments
for each row
execute function public.luni_guard_appointment_license();

commit;
