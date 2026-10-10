-- Datos de contacto y ubicación propios de cada estudio.
-- Ejecutar una sola vez en Supabase SQL Editor antes de desplegar el nuevo código.
begin;


-- Consulta client_provider_relationships (se crea en 20261011…): sin esto falla la validación del cuerpo
-- de la función al aplicar las migraciones desde cero.
set local check_function_bodies = off;
alter table public.provider_profiles
  add column if not exists business_phone text,
  add column if not exists business_location text;

create or replace function public.luni_my_client_provider_business_details()
returns table (
  provider_id uuid,
  business_phone text,
  business_location text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select
    p.id,
    p.business_phone,
    p.business_location
  from public.client_provider_relationships r
  join public.provider_profiles p on p.id = r.provider_id
  where r.client_id = auth.uid()
    and r.status = 'active'
    and p.deleted_at is null;
$fn$;

revoke all on function public.luni_my_client_provider_business_details() from public, anon;
grant execute on function public.luni_my_client_provider_business_details() to authenticated;

commit;
