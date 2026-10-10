-- Permite a las clientas ver el logotipo/icono de los estudios que añadieron por invitación,
-- incluso si el estudio pausó las reservas o no está publicado en el catálogo público.
begin;


-- Consulta client_provider_relationships (se crea en 20261011…): sin esto falla la validación del cuerpo
-- de la función al aplicar las migraciones desde cero.
set local check_function_bodies = off;
create or replace function public.luni_my_client_provider_branding()
returns table (provider_id uuid, brand_icon text, avatar_path text)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select p.id, coalesce(nullif(btrim(p.brand_icon), ''), '💅'), p.avatar_path
  from public.client_provider_relationships r
  join public.provider_profiles p on p.id = r.provider_id
  where r.client_id = auth.uid()
    and r.status = 'active'
    and p.deleted_at is null;
$fn$;

revoke all on function public.luni_my_client_provider_branding() from public, anon;
grant execute on function public.luni_my_client_provider_branding() to authenticated;

commit;
