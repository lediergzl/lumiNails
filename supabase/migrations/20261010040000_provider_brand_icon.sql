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

commit;
