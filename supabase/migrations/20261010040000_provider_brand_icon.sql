-- Personalización visible del estudio en Luni Cliente.
-- Ejecutar una sola vez en Supabase SQL Editor.
begin;

alter table public.provider_profiles
  add column if not exists brand_icon text not null default '💅';

alter table public.provider_profiles
  alter column brand_icon set default '💅';

update public.provider_profiles
set brand_icon = '💅'
where brand_icon is null or btrim(brand_icon) = '';

create or replace function public.luni_my_client_provider_brand_icons()
returns table (provider_id uuid, brand_icon text)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select p.id, coalesce(nullif(btrim(p.brand_icon), ''), '💅')
  from public.client_provider_relationships r
  join public.provider_profiles p on p.id = r.provider_id
  where r.client_id = auth.uid()
    and r.status = 'active'
    and p.deleted_at is null;
$fn$;

revoke all on function public.luni_my_client_provider_brand_icons() from public, anon;
grant execute on function public.luni_my_client_provider_brand_icons() to authenticated;

commit;
