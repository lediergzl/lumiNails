-- 04: la manicurista no puede darse licencia; sí puede editar su timezone
select d::date as mon from generate_series((now() at time zone 'America/Havana')::date + 2, (now() at time zone 'America/Havana')::date + 9, interval '1 day') d where extract(isodow from d)=1 limit 1 \gset
\set P '11111111-0000-0000-0000-000000000001'
\set S '51111111-0000-0000-0000-000000000001'
select set_config('request.jwt.claim.sub','',false);
update public.provider_profiles set trial_started_at = now(), license_status='active', license_expires_at = now()+interval '30 days' where id=:'P';
set role anon;
select test.t('licencia activa vigente: 7 horas', (select count(*) from public.luni_available_slots(:'P',:'S',:'mon'::date))=7);
reset role;
update public.provider_profiles set license_expires_at = now()-interval '1 day' where id=:'P';
set role anon;
select test.t('licencia activa pero vencida: 0 horas', (select count(*) from public.luni_available_slots(:'P',:'S',:'mon'::date))=0);
reset role;
-- la manicurista NO puede cambiarse la licencia (protección del esquema original)
select test.sub('aaaaaaaa-0000-0000-0000-000000000001'); set role authenticated;
do $$ begin update public.provider_profiles set license_status='active', license_expires_at=now()+interval '1 year' where id='11111111-0000-0000-0000-000000000001'; perform test.t('la manicurista no puede darse licencia', false);
exception when others then perform test.t('la manicurista no puede darse licencia → '||sqlerrm, sqlerrm='PROVIDER_LICENSE_CHANGE_FORBIDDEN'); end $$;
-- y sí puede cambiar su zona horaria sin tocar la licencia
update public.provider_profiles set timezone='America/Havana' where id='11111111-0000-0000-0000-000000000001';
select test.t('la manicurista puede editar su timezone', true);
reset role;
