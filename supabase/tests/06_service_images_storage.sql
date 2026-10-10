-- 06: solo la dueña del estudio puede escribir en su carpeta del bucket service-images
\set ON_ERROR_STOP off
create or replace function test.raises(q text, code text) returns boolean language plpgsql as $$
begin execute q; return false;
exception when others then return sqlerrm like '%' || code || '%'; end $$;
create or replace function test.updates(q text) returns boolean language plpgsql as $$
declare n integer;
begin execute q; get diagnostics n = row_count; return n = 1;
exception when others then return false; end $$;
grant execute on function test.raises(text, text), test.updates(text) to public;

\set UA '61060000-0000-0000-0000-000000000001'
\set UB '61060000-0000-0000-0000-000000000002'
\set PA '61060000-0000-0000-0000-0000000000a1'
\set PB '61060000-0000-0000-0000-0000000000b1'
insert into auth.users(id, email) values (:'UA','a6@t'), (:'UB','b6@t');
insert into public.provider_profiles(id, user_id, slug, business_name) values (:'PA', :'UA', 'img-a', 'A'), (:'PB', :'UB', 'img-b', 'B');

insert into storage.buckets(id,name,public) values ('otro','otro',true);
select test.t('el bucket service-images existe y es público', exists (select 1 from storage.buckets where id='service-images' and public));
select test.t('el bucket solo acepta webp y jpeg', (select allowed_mime_types from storage.buckets where id='service-images') = array['image/webp','image/jpeg']);

set role authenticated; select test.sub(:'UA');
select test.t('la dueña sube a su carpeta', test.updates(format($q$insert into storage.objects(bucket_id,name) values ('service-images', %L)$q$, :'PA' || '/s1/abc-card.webp')));
select test.t('la dueña NO sube a la carpeta de otra', test.raises(format($q$insert into storage.objects(bucket_id,name) values ('service-images', %L)$q$, :'PB' || '/s1/abc-card.webp'), 'row-level security'));
select test.t('la política NO da acceso a otros buckets', test.raises(format($q$insert into storage.objects(bucket_id,name) values ('otro', %L)$q$, :'PA' || '/s1/x.webp'), 'row-level security'));
select test.t('ruta sin UUID es rechazada', test.raises($q$insert into storage.objects(bucket_id,name) values ('service-images','carpeta/x.webp')$q$, 'row-level security'));
select test.t('ruta vacía es rechazada', test.raises($q$insert into storage.objects(bucket_id,name) values ('service-images','')$q$, 'row-level security'));
select test.t('la dueña ve y borra lo suyo', test.updates(format($q$delete from storage.objects where name=%L$q$, :'PA' || '/s1/abc-card.webp')));
reset role;

insert into storage.objects(bucket_id,name) values ('service-images', :'PA' || '/s2/keep-card.webp');
set role authenticated; select test.sub(:'UB');
select test.t('otra manicurista NO borra archivos ajenos', not test.updates(format($q$delete from storage.objects where name=%L$q$, :'PA' || '/s2/keep-card.webp')));
select test.t('otra manicurista NO los ve', (select count(*) from storage.objects where name like :'PA' || '%') = 0);
reset role;
set role anon;
select test.t('anon NO puede escribir', test.raises(format($q$insert into storage.objects(bucket_id,name) values ('service-images', %L)$q$, :'PA' || '/s3/x-card.webp'), 'permission denied'));
reset role;
