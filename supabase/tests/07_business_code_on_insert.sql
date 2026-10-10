-- 07: un estudio creado como lo hace la app (sin business_code) recibe un código único de 6 dígitos
\set ON_ERROR_STOP off
\set U1 '71070000-0000-0000-0000-000000000001'
\set U2 '71070000-0000-0000-0000-000000000002'
insert into auth.users(id, email) values (:'U1','a7@t'), (:'U2','b7@t');
insert into public.provider_profiles(user_id, slug, business_name) values (:'U1','biz-a','A'), (:'U2','biz-b','B');
select test.t('el estudio nuevo recibe un código de 6 dígitos', (select bool_and(business_code ~ '^[0-9]{6}$') from public.provider_profiles where user_id in (:'U1',:'U2')));
select test.t('cada estudio recibe un código distinto', (select count(distinct business_code) from public.provider_profiles where user_id in (:'U1',:'U2')) = 2);
insert into auth.users(id, email) select ('71070000-0000-0000-0000-0000000001' || lpad(i::text,2,'0'))::uuid, 'm' || i || '@t' from generate_series(1,40) i;
insert into public.provider_profiles(user_id, slug, business_name) select ('71070000-0000-0000-0000-0000000001' || lpad(i::text,2,'0'))::uuid, 'bulk-' || i, 'Bulk ' || i from generate_series(1,40) i;
select test.t('40 altas seguidas generan códigos únicos', (select count(distinct business_code) from public.provider_profiles where slug like 'bulk-%') = 40);
insert into auth.users(id, email) values ('71070000-0000-0000-0000-000000000099','z7@t');
insert into public.provider_profiles(user_id, slug, business_name, business_code) values ('71070000-0000-0000-0000-000000000099','manual','M','123456');
select test.t('un código indicado a mano se respeta', (select business_code from public.provider_profiles where slug='manual') = '123456');
