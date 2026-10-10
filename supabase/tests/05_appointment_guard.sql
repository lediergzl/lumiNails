-- 05: el trigger de citas bloquea cambios de precio/hora y transiciones de estado no permitidas
\set ON_ERROR_STOP off
create or replace function test.raises(q text, code text) returns boolean language plpgsql as $$
begin execute q; return false;
exception when others then return sqlerrm like '%' || code || '%'; end $$;
create or replace function test.updates(q text) returns boolean language plpgsql as $$
declare n integer;
begin execute q; get diagnostics n = row_count; return n = 1;
exception when others then return false; end $$;
grant execute on function test.raises(text, text), test.updates(text) to public;

\set UP '51050000-0000-0000-0000-000000000001'
\set UC '51050000-0000-0000-0000-000000000002'
\set UO '51050000-0000-0000-0000-000000000003'
\set P  '51050000-0000-0000-0000-0000000000a1'
\set S  '51050000-0000-0000-0000-0000000000b1'
insert into auth.users(id, email) values (:'UP','p5@t'), (:'UC','c5@t'), (:'UO','o5@t');
insert into public.provider_profiles(id, user_id, slug, business_name) values (:'P', :'UP', 'guard-p', 'Guard');
insert into public.services(id, provider_id, name, price_cents, duration_minutes) values (:'S', :'P', 'Manicura', 80000, 60);
insert into public.appointments(id, provider_id, client_id, service_id, starts_at, ends_at, status, idempotency_key, client_service_name, client_price_cents)
select ('51050000-0000-0000-0000-0000000001' || lpad(i::text, 2, '0'))::uuid, :'P', :'UC', :'S',
       now() + (i || ' days')::interval, now() + (i || ' days')::interval + interval '1 hour',
       st, 'k' || i, 'Manicura', 80000
from (values (1,'pending_confirmation'),(2,'pending_confirmation'),(3,'confirmed'),(4,'completed'),(5,'pending_confirmation'),(6,'pending_confirmation'),(7,'confirmed')) v(i, st);

\set A1 '51050000-0000-0000-0000-000000000101'
\set A2 '51050000-0000-0000-0000-000000000102'
\set A3 '51050000-0000-0000-0000-000000000103'
\set A4 '51050000-0000-0000-0000-000000000104'
\set A5 '51050000-0000-0000-0000-000000000105'
\set A6 '51050000-0000-0000-0000-000000000106'
\set A7 '51050000-0000-0000-0000-000000000107'

-- ===== manicurista
set role authenticated; select test.sub(:'UP');
select test.t('manicurista NO puede cambiar el precio', test.raises(format($q$update public.appointments set client_price_cents=1 where id=%L$q$, :'A1'), 'APPOINTMENT_FIELD_LOCKED'));
select test.t('manicurista NO puede mover la hora', test.raises(format($q$update public.appointments set starts_at=starts_at + interval '1 day' where id=%L$q$, :'A1'), 'APPOINTMENT_FIELD_LOCKED'));
select test.t('manicurista NO puede cambiar el motivo sin cambiar el estado', test.raises(format($q$update public.appointments set cancellation_reason='x' where id=%L$q$, :'A1'), 'APPOINTMENT_FIELD_LOCKED'));
select test.t('manicurista confirma una cita pendiente', test.updates(format($q$update public.appointments set status='confirmed' where id=%L$q$, :'A1')));
select test.t('manicurista rechaza con motivo', test.updates(format($q$update public.appointments set status='rejected', cancellation_reason='No puedo ese día' where id=%L$q$, :'A2')));
select test.t('manicurista completa una cita confirmada', test.updates(format($q$update public.appointments set status='completed' where id=%L$q$, :'A3')));
select test.t('manicurista NO puede reabrir una cita completada', test.raises(format($q$update public.appointments set status='confirmed' where id=%L$q$, :'A4'), 'APPOINTMENT_STATUS_CHANGE_FORBIDDEN'));
select test.t('manicurista NO puede completar una cita pendiente', test.raises(format($q$update public.appointments set status='completed' where id=%L$q$, :'A5'), 'APPOINTMENT_STATUS_CHANGE_FORBIDDEN'));
reset role;

-- ===== clienta
set role authenticated; select test.sub(:'UC');
select test.t('clienta NO puede confirmar su propia cita', test.raises(format($q$update public.appointments set status='confirmed' where id=%L$q$, :'A5'), 'APPOINTMENT_STATUS_CHANGE_FORBIDDEN'));
select test.t('clienta NO puede cambiar notas al cancelar', test.raises(format($q$update public.appointments set status='cancelled', notes='x' where id=%L$q$, :'A5'), 'APPOINTMENT_FIELD_LOCKED'));
select test.t('clienta NO puede cancelar una cita completada', test.raises(format($q$update public.appointments set status='cancelled' where id=%L$q$, :'A4'), 'APPOINTMENT_STATUS_CHANGE_FORBIDDEN'));
select test.t('clienta cancela su cita pendiente', test.updates(format($q$update public.appointments set status='cancelled', cancellation_reason='Imprevisto' where id=%L$q$, :'A5')));
select test.t('clienta cancela su cita confirmada', test.updates(format($q$update public.appointments set status='cancelled' where id=%L$q$, :'A7')));
reset role;

-- ===== tercera persona
set role authenticated; select test.sub(:'UO');
select test.t('otra persona no puede tocar la cita (0 filas)', not test.updates(format($q$update public.appointments set status='cancelled' where id=%L$q$, :'A6')));
reset role;
select set_config('request.jwt.claim.sub', '', false);
select test.t('sin sesión de usuario (service_role) no hay restricción', test.updates(format($q$update public.appointments set client_price_cents=90000 where id=%L$q$, :'A6')));
