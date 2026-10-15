-- 03: licencia, huso horario, privacidad (RLS), antelación y filas antiguas
\set ON_ERROR_STOP off
select d::date as mon from generate_series((now() at time zone 'America/Havana')::date + 2, (now() at time zone 'America/Havana')::date + 9, interval '1 day') d where extract(isodow from d)=1 limit 1 \gset
select set_config('test.mon', :'mon', false);
\set P '11111111-0000-0000-0000-000000000001'
\set S '51111111-0000-0000-0000-000000000001'

-- ===== cita cancelada libera la hora
update public.appointments set status='cancelled' where idempotency_key='clave-lunes-10';
set role anon;
select test.t('cita cancelada libera la hora: lunes vuelve a 10', (select count(*) from public.luni_available_slots(:'P',:'S',:'mon'::date))=10);
reset role;
update public.appointments set status='confirmed' where idempotency_key='clave-lunes-10';
set role anon;
select test.t('cita confirmada también ocupa (7)', (select count(*) from public.luni_available_slots(:'P',:'S',:'mon'::date))=7);
reset role;

-- ===== cambio de huso horario: 09:00 siguen siendo 09:00 LOCAL del estudio
update public.provider_profiles set timezone='Europe/Madrid' where id=:'P';
set role anon;
select test.t('timezone Madrid: primera hora = 09:00 en Madrid', (select (min(starts_at) at time zone 'Europe/Madrid')::time='09:00' from public.luni_available_slots(:'P',:'S',:'mon'::date)));
reset role;
update public.provider_profiles set timezone='America/Havana' where id=:'P';

-- ===== licencia vencida / estudio oculto
update public.provider_profiles set trial_started_at = now() - interval '30 days' where id=:'P';
set role anon;
select test.t('licencia de prueba vencida: 0 horas', (select count(*) from public.luni_available_slots(:'P',:'S',:'mon'::date))=0);
reset role;
select test.sub('bbbbbbbb-0000-0000-0000-000000000002'); set role authenticated;
do $$ declare m date := current_setting('test.mon')::date; begin
  perform public.luni_create_appointment(gen_random_uuid(), '11111111-0000-0000-0000-000000000001','51111111-0000-0000-0000-000000000001',(m + time '16:00') at time zone 'America/Havana','clave-licencia-1','');
  perform test.t('reservar con licencia vencida rechazado', false);
exception when others then perform test.t('reservar con licencia vencida rechazado → '||sqlerrm, sqlerrm='PROVIDER_LICENSE_INACTIVE'); end $$;
reset role;
select set_config('request.jwt.claim.sub','',false);
update public.provider_profiles set trial_started_at = now(), license_status='active', license_expires_at = now()+interval '30 days' where id=:'P';
set role anon;
select test.t('licencia activa vigente: 7 horas', (select count(*) from public.luni_available_slots(:'P',:'S',:'mon'::date))=7);
reset role;
update public.provider_profiles set is_published=false where id=:'P';
set role anon;
select test.t('estudio no publicado: 0 horas', (select count(*) from public.luni_available_slots(:'P',:'S',:'mon'::date))=0);
reset role;
update public.provider_profiles set is_published=true where id=:'P';
update public.services set is_active=false where id=:'S';
set role anon;
select test.t('servicio inactivo: 0 horas', (select count(*) from public.luni_available_slots(:'P',:'S',:'mon'::date))=0);
reset role;
update public.services set is_active=true where id=:'S';

-- ===== privacidad y permisos (RLS)
select test.sub('bbbbbbbb-0000-0000-0000-000000000002'); set role authenticated;
select test.t('un cliente NO ve el horario semanal de nadie', (select count(*) from public.weekly_schedule)=0);
do $$ begin perform public.luni_block_day(current_date+5); perform test.t('un cliente no puede bloquear días', false);
exception when others then perform test.t('un cliente no puede bloquear días → '||sqlerrm, sqlerrm='PROVIDER_REQUIRED'); end $$;
do $$ begin perform public.luni_save_weekly_schedule('[{"weekday":1,"start":"00:00","end":"23:00"}]'::jsonb); perform test.t('un cliente no puede guardar horario', false);
exception when others then perform test.t('un cliente no puede guardar horario → '||sqlerrm, sqlerrm='PROVIDER_REQUIRED'); end $$;
do $$ begin insert into public.weekly_schedule(provider_id,weekday,start_time,end_time) values ('11111111-0000-0000-0000-000000000001',6,'00:00','23:00'); perform test.t('un cliente no puede insertar horario ajeno', false);
exception when others then perform test.t('un cliente no puede insertar horario ajeno → RLS', sqlerrm ilike '%row-level security%'); end $$;
reset role;
select test.sub('cccccccc-0000-0000-0000-000000000003'); set role authenticated;
select test.t('otra manicurista NO ve el horario de Ana', (select count(*) from public.weekly_schedule where provider_id=:'P')=0);
select public.luni_save_weekly_schedule('[{"weekday":6,"start":"10:00","end":"12:00"}]'::jsonb);
reset role;
select test.t('guardar el horario de otra manicurista no toca el de Ana (6 tramos)', (select count(*) from public.weekly_schedule where provider_id=:'P')=6);
select test.t('el horario de la otra quedó con 1 tramo', (select count(*) from public.weekly_schedule where provider_id='22222222-0000-0000-0000-000000000002')=1);

-- ===== hora mínima de antelación (1 h) con un tramo alrededor de ahora
do $$ declare ln timestamp := now() at time zone 'America/Havana'; begin
  if ln::time between '03:00' and '19:00' then
    perform set_config('test.run_lead','1',false);
  else perform set_config('test.run_lead','0',false); end if; end $$;
select current_setting('test.run_lead')::int as runlead \gset
\if :runlead
  select ((now() at time zone 'America/Havana')::date) as hoy, extract(isodow from (now() at time zone 'America/Havana')::date)::int as wd,
         date_trunc('hour', now() at time zone 'America/Havana')::time - interval '1 hour' as ini \gset
  insert into public.weekly_schedule(provider_id,weekday,start_time,end_time) values ('22222222-0000-0000-0000-000000000002', :wd, :'ini'::time, (:'ini'::time + interval '5 hours')::time) on conflict do nothing;
  set role anon;
  select test.t('hoy: nunca se ofrece una hora que empiece en menos de 1 h', (select count(*)>0 and min(starts_at) > now()+interval '1 hour' from public.luni_available_slots('22222222-0000-0000-0000-000000000002','52222222-0000-0000-0000-000000000002',:'hoy'::date)));
  reset role;
\else
  \echo (prueba de antelación omitida: demasiado cerca de medianoche)
\endif

-- ===== filas antiguas working_hours siguen valiendo al reservar
insert into public.availability(provider_id,starts_at,ends_at,kind) values ('22222222-0000-0000-0000-000000000002', (:'mon'::date+8 + time '10:00') at time zone 'America/Havana', (:'mon'::date+8 + time '12:00') at time zone 'America/Havana','working_hours');
select test.sub('bbbbbbbb-0000-0000-0000-000000000002'); set role authenticated;
select (public.luni_create_appointment(gen_random_uuid(), '22222222-0000-0000-0000-000000000002','52222222-0000-0000-0000-000000000002',(:'mon'::date+8 + time '10:30') at time zone 'America/Havana','clave-legado-01','')).id is not null as legado_ok \gset
select test.t('fila antigua working_hours sigue aceptándose', :'legado_ok');
reset role;
