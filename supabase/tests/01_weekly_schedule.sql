\set ON_ERROR_STOP off
-- 01: horario semanal (guardar, reemplazar, validar)
begin;
-- ===== datos
insert into auth.users(id,email) values ('aaaaaaaa-0000-0000-0000-000000000001','ana@x.cu'),('bbbbbbbb-0000-0000-0000-000000000002','cli@x.cu'),('cccccccc-0000-0000-0000-000000000003','otra@x.cu');
insert into public.provider_profiles(id,user_id,slug,business_name,is_published) values ('11111111-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','ana-1','Studio Ana',true);
insert into public.provider_profiles(id,user_id,slug,business_name,is_published) values ('22222222-0000-0000-0000-000000000002','cccccccc-0000-0000-0000-000000000003','otra-1','Studio Otra',true);
insert into public.services(id,provider_id,name,price_cents,duration_minutes) values ('51111111-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001','Manicura',80000,60);
insert into public.services(id,provider_id,name,price_cents,duration_minutes) values ('52222222-0000-0000-0000-000000000002','22222222-0000-0000-0000-000000000002','Pedicura',90000,45);
select test.t('timezone por defecto = America/Havana', (select timezone from public.provider_profiles where slug='ana-1')='America/Havana');

-- ===== sin horario: nada reservable
set role anon;
select test.t('sin horario → 0 horas libres', (select count(*) from public.luni_available_slots('11111111-0000-0000-0000-000000000001','51111111-0000-0000-0000-000000000001', (now() at time zone 'America/Havana')::date + 3))=0);
reset role;

-- ===== la manicurista guarda su horario (lun-vie 09:00-12:00 y 14:00-17:00)
select test.sub('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
select public.luni_save_weekly_schedule('[
 {"weekday":1,"start":"09:00","end":"12:00"},{"weekday":1,"start":"14:00","end":"17:00"},
 {"weekday":2,"start":"09:00","end":"12:00"},{"weekday":3,"start":"09:00","end":"12:00"},
 {"weekday":4,"start":"09:00","end":"12:00"},{"weekday":5,"start":"09:00","end":"12:00"}]'::jsonb);
select test.t('horario guardado: 6 tramos', (select count(*) from public.weekly_schedule)=6);
-- reemplazo atómico
select public.luni_save_weekly_schedule('[{"weekday":1,"start":"09:00","end":"12:00"},{"weekday":1,"start":"14:00","end":"17:00"},{"weekday":2,"start":"09:00","end":"12:00"},{"weekday":3,"start":"09:00","end":"12:00"},{"weekday":4,"start":"09:00","end":"12:00"},{"weekday":5,"start":"09:00","end":"12:00"}]'::jsonb);
select test.t('guardar dos veces no duplica', (select count(*) from public.weekly_schedule)=6);
reset role;
commit;

-- ===== validaciones del guardado (cada una en su transacción)
select test.sub('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
do $$ begin perform public.luni_save_weekly_schedule('[{"weekday":1,"start":"09:00","end":"12:00"},{"weekday":1,"start":"11:00","end":"13:00"}]'::jsonb); perform test.t('tramos solapados rechazados', false);
exception when others then perform test.t('tramos solapados rechazados → '||sqlerrm, sqlerrm='OVERLAPPING_WINDOWS'); end $$;
do $$ begin perform public.luni_save_weekly_schedule('[{"weekday":1,"start":"12:00","end":"09:00"}]'::jsonb); perform test.t('fin antes que inicio rechazado', false);
exception when others then perform test.t('fin antes que inicio rechazado → '||sqlerrm, sqlerrm='INVALID_SCHEDULE'); end $$;
do $$ begin perform public.luni_save_weekly_schedule('[{"weekday":9,"start":"09:00","end":"12:00"}]'::jsonb); perform test.t('día 9 rechazado', false);
exception when others then perform test.t('día 9 rechazado → '||sqlerrm, sqlerrm='INVALID_SCHEDULE'); end $$;
do $$ begin perform public.luni_save_weekly_schedule('[{"weekday":1,"start":"nueve","end":"12:00"}]'::jsonb); perform test.t('hora basura rechazada', false);
exception when others then perform test.t('hora basura rechazada → '||sqlerrm, sqlerrm='INVALID_SCHEDULE'); end $$;
select test.t('tras errores el horario previo sigue intacto (6 tramos)', (select count(*) from public.weekly_schedule)=6);
reset role;
