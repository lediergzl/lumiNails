-- Luni: evita que una fecha personalizada herede solo parte del horario semanal
-- cuando ya existen filas antiguas en provider_turns.
--
-- Al activar una excepción por primera vez, agrega los turnos semanales que faltan,
-- conservando cualquier turno de esa fecha que ya existiera. Las excepciones que ya
-- estaban activas no se modifican automáticamente: pueden representar una elección
-- intencional de la manicurista.

begin;

create or replace function public.luni_set_turn_day_override(p_day date, p_enabled boolean)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  v_provider_id uuid;
  v_timezone text;
  v_had_override boolean;
begin
  select p.id, p.timezone
    into v_provider_id, v_timezone
  from public.provider_profiles p
  where p.user_id = auth.uid() and p.deleted_at is null;

  if v_provider_id is null then
    raise exception 'PROVIDER_REQUIRED' using errcode = 'P0002';
  end if;

  if p_day is null
     or p_day < (now() at time zone v_timezone)::date
     or p_day > (now() at time zone v_timezone)::date + 90 then
    raise exception 'INVALID_DAY' using errcode = '22023';
  end if;

  select exists (
    select 1 from public.provider_turn_overrides o
    where o.provider_id = v_provider_id and o.turn_date = p_day
  ) into v_had_override;

  if p_enabled then
    insert into public.provider_turn_overrides(provider_id, turn_date)
    values (v_provider_id, p_day)
    on conflict do nothing;

    -- Solo al crear la excepción nueva completamos el horario semanal.
    -- La inserción por hora evita duplicados y ya no depende de que la fecha
    -- estuviera completamente vacía en provider_turns.
    if not v_had_override then
      insert into public.provider_turns(
        provider_id, turn_date, start_time, buffer_after_minutes, status
      )
      select
        v_provider_id, p_day, w.start_time, w.buffer_after_minutes, 'active'
      from public.provider_weekly_turns w
      where w.provider_id = v_provider_id
        and w.weekday = extract(isodow from p_day)::smallint
      on conflict (provider_id, turn_date, start_time) do nothing;
    end if;
  else
    delete from public.provider_turns t
    where t.provider_id = v_provider_id and t.turn_date = p_day;

    delete from public.provider_turn_overrides o
    where o.provider_id = v_provider_id and o.turn_date = p_day;
  end if;
end;
$fn$;

revoke all on function public.luni_set_turn_day_override(date, boolean) from public, anon;
grant execute on function public.luni_set_turn_day_override(date, boolean) to authenticated;


-- Compatibilidad con turnos por fecha creados antes de introducir la tabla de excepciones.
-- Sin esta marca, luni_effective_turns ignora esas filas antiguas y puede mostrar un horario
-- distinto del que la manicurista configuró para esa fecha.
insert into public.provider_turn_overrides(provider_id, turn_date)
select distinct t.provider_id, t.turn_date
from public.provider_turns t
on conflict (provider_id, turn_date) do nothing;

commit;
