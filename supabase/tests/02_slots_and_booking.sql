-- 02: horas libres, reservas, solapes y bloqueos
\set ON_ERROR_STOP off
select d::date as mon from generate_series((now() at time zone 'America/Havana')::date + 2, (now() at time zone 'America/Havana')::date + 9, interval '1 day') d where extract(isodow from d)=1 limit 1 \gset
\set P '11111111-0000-0000-0000-000000000001'
\set S '51111111-0000-0000-0000-000000000001'
\echo Lunes de prueba: :mon
select set_config('test.mon', :'mon', false);

-- ===== horas libres (anónimo, como el catálogo público)
set role anon;
select test.t('lunes: 10 horas libres (09-12 y 14-17, 60 min, cada 30)', (select count(*) from public.luni_available_slots(:'P',:'S',:'mon'::date))=10);
select test.t('primera hora = 09:00 hora de Cuba y orden ascendente', (select (min(starts_at) at time zone 'America/Havana')::time = '09:00' from public.luni_available_slots(:'P',:'S',:'mon'::date)));
select test.t('última hora = 16:00 (acaba a las 17:00)', (select (max(starts_at) at time zone 'America/Havana')::time = '16:00' from public.luni_available_slots(:'P',:'S',:'mon'::date)));
select test.t('sábado: 0 horas', (select count(*) from public.luni_available_slots(:'P',:'S',:'mon'::date+5))=0);
select test.t('domingo: 0 horas', (select count(*) from public.luni_available_slots(:'P',:'S',:'mon'::date+6))=0);
select test.t('martes: 5 horas (09-12)', (select count(*) from public.luni_available_slots(:'P',:'S',:'mon'::date+1))=5);
select test.t('día pasado: 0 horas', (select count(*) from public.luni_available_slots(:'P',:'S',current_date-3))=0);
select test.t('a más de 90 días: 0 horas', (select count(*) from public.luni_available_slots(:'P',:'S',current_date+200))=0);
select test.t('servicio de otra manicurista con mi id: 0 horas', (select count(*) from public.luni_available_slots(:'P','52222222-0000-0000-0000-000000000002',:'mon'::date))=0);
select test.t('luni_available_days: 14 filas y el lunes marca 10', (select count(*)=14 and bool_or(day=:'mon'::date and slots=10) from public.luni_available_days(:'P',:'S',:'mon'::date,14)));
select test.t('luni_available_days limita a 60 días', (select count(*) from public.luni_available_days(:'P',:'S',:'mon'::date,9999))=60);
reset role;

-- ===== reservar (cliente B)
select test.sub('bbbbbbbb-0000-0000-0000-000000000002');
set role authenticated;
select (public.luni_create_appointment(gen_random_uuid(), :'P', :'S', (:'mon'::date + time '10:00') at time zone 'America/Havana', 'clave-lunes-10', '')).id as appt \gset
select test.t('reserva lunes 10:00 creada', :'appt' is not null);
select (public.luni_create_appointment(gen_random_uuid(), :'P', :'S', (:'mon'::date + time '10:00') at time zone 'America/Havana', 'clave-lunes-10', '')).id as appt2 \gset
select test.t('misma clave de idempotencia → misma cita', :'appt'=:'appt2');
select test.t('la cita ocupa: 10 → 7 horas libres (09:30, 10:00 y 10:30 se solapan)', (select count(*) from public.luni_available_slots(:'P',:'S',:'mon'::date))=7);
select test.t('quedan 09:00 y 11:00 (pegadas a la cita, sin solape)', (select array_agg(to_char(starts_at at time zone 'America/Havana','HH24:MI') order by starts_at) filter (where (starts_at at time zone 'America/Havana')::time < '12:00') from public.luni_available_slots(:'P',:'S',:'mon'::date)) = array['09:00','11:00']);
do $$ declare m date := current_setting('test.mon')::date; begin
  perform public.luni_create_appointment(gen_random_uuid(), '11111111-0000-0000-0000-000000000001','51111111-0000-0000-0000-000000000001',(m + time '10:30') at time zone 'America/Havana','otra-clave-1234','');
  perform test.t('solape 10:30 rechazado', false);
exception when others then perform test.t('solape 10:30 rechazado → '||sqlerrm, sqlerrm='SLOT_ALREADY_TAKEN'); end $$;
do $$ declare m date := current_setting('test.mon')::date; begin
  perform public.luni_create_appointment(gen_random_uuid(), '11111111-0000-0000-0000-000000000001','51111111-0000-0000-0000-000000000001',(m + time '13:00') at time zone 'America/Havana','clave-fuera-13','');
  perform test.t('13:00 (pausa) rechazado', false);
exception when others then perform test.t('13:00 (pausa) rechazado → '||sqlerrm, sqlerrm='OUTSIDE_WORKING_HOURS'); end $$;
do $$ declare m date := current_setting('test.mon')::date; begin
  perform public.luni_create_appointment(gen_random_uuid(), '11111111-0000-0000-0000-000000000001','51111111-0000-0000-0000-000000000001',(m + time '11:30') at time zone 'America/Havana','clave-fuera-1130','');
  perform test.t('11:30 (acabaría 12:30) rechazado', false);
exception when others then perform test.t('11:30 (acabaría 12:30) rechazado → '||sqlerrm, sqlerrm='OUTSIDE_WORKING_HOURS'); end $$;
do $$ declare m date := current_setting('test.mon')::date; begin
  perform public.luni_create_appointment(gen_random_uuid(), '11111111-0000-0000-0000-000000000001','51111111-0000-0000-0000-000000000001',(m + 5 + time '10:00') at time zone 'America/Havana','clave-sabado-10','');
  perform test.t('sábado rechazado', false);
exception when others then perform test.t('sábado rechazado → '||sqlerrm, sqlerrm='OUTSIDE_WORKING_HOURS'); end $$;
do $$ begin
  perform public.luni_create_appointment(gen_random_uuid(), '11111111-0000-0000-0000-000000000001','51111111-0000-0000-0000-000000000001', now() - interval '1 day','clave-pasado-01','');
  perform test.t('fecha pasada rechazada', false);
exception when others then perform test.t('fecha pasada rechazada → '||sqlerrm, sqlerrm='INVALID_APPOINTMENT_TIME'); end $$;
reset role;
set role anon;
do $$ begin perform public.luni_create_appointment(gen_random_uuid(), '11111111-0000-0000-0000-000000000001','51111111-0000-0000-0000-000000000001', now()+interval '3 day','clave-anonimo-1',''); perform test.t('anónimo no puede reservar', false);
exception when others then perform test.t('anónimo no puede reservar → '||sqlerrm, sqlerrm ilike '%permission denied%' or sqlerrm='AUTH_REQUIRED'); end $$;
reset role;

-- ===== bloqueo de un día (manicurista)
select test.sub('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
select (public.luni_block_day(:'mon'::date+1)).id as blk \gset
select (public.luni_block_day(:'mon'::date+1)).id as blk2 \gset
select test.t('bloquear dos veces el mismo día no duplica', :'blk'=:'blk2' and (select count(*) from public.availability where kind='block' and status='active')=1);
select test.t('el bloqueo cubre el día local completo de Cuba (24 h)', (select ends_at-starts_at = interval '24 hours' and (starts_at at time zone 'America/Havana')::time='00:00' from public.availability where id=:'blk'));
reset role; set role anon;
select test.t('martes bloqueado: 0 horas', (select count(*) from public.luni_available_slots(:'P',:'S',:'mon'::date+1))=0);
select test.t('calendario marca el martes con 0', (select slots=0 from public.luni_available_days(:'P',:'S',:'mon'::date,3) where day=:'mon'::date+1));
select test.t('lunes no se afecta (sigue en 7)', (select count(*) from public.luni_available_slots(:'P',:'S',:'mon'::date))=7);
reset role;
select test.sub('bbbbbbbb-0000-0000-0000-000000000002'); set role authenticated;
do $$ declare m date := current_setting('test.mon')::date; begin
  perform public.luni_create_appointment(gen_random_uuid(), '11111111-0000-0000-0000-000000000001','51111111-0000-0000-0000-000000000001',(m + 1 + time '09:00') at time zone 'America/Havana','clave-bloqueado-1','');
  perform test.t('reservar en día bloqueado rechazado', false);
exception when others then perform test.t('reservar en día bloqueado rechazado → '||sqlerrm, sqlerrm='SLOT_BLOCKED'); end $$;
reset role;
select test.sub('aaaaaaaa-0000-0000-0000-000000000001'); set role authenticated;
update public.availability set status='inactive' where id=:'blk';
reset role; set role anon;
select test.t('al quitar el bloqueo vuelven las 5 horas del martes', (select count(*) from public.luni_available_slots(:'P',:'S',:'mon'::date+1))=5);
reset role;
