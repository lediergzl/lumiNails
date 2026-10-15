-- Permite a cada manicurista decidir si las nuevas citas requieren aprobación manual.
begin;

alter table public.provider_profiles
  add column if not exists auto_confirm_appointments boolean not null default false;

create or replace function public.luni_apply_appointment_approval_mode()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_auto_confirm boolean;
begin
  if new.status = 'pending_confirmation' then
    select p.auto_confirm_appointments
      into v_auto_confirm
    from public.provider_profiles p
    where p.id = new.provider_id
      and p.deleted_at is null;

    if coalesce(v_auto_confirm, false) then
      new.status := 'confirmed';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_luni_appointment_approval_mode on public.appointments;
create trigger trg_luni_appointment_approval_mode
before insert on public.appointments
for each row
execute function public.luni_apply_appointment_approval_mode();

commit;
