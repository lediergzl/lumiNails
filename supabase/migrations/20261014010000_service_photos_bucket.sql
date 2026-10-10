-- LuniNails: bucket compartido de imágenes públicas de servicios y portafolio.
-- Rutas: {provider_id}/{record_id}/{hash}-{variant}.{webp|jpg}
-- Lectura pública mediante URL; gestión de objetos solo por la dueña del estudio.
begin;

create or replace function public.luni_owns_storage_path(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_first text := split_part(coalesce(p_name, ''), '/', 1);
begin
  if v_first !~ '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$' then
    return false;
  end if;
  return public.luni_is_provider_owner(v_first::uuid);
end;
$fn$;

revoke all on function public.luni_owns_storage_path(text) from public, anon;
grant execute on function public.luni_owns_storage_path(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('service-images', 'service-images', true, 524288, array['image/webp', 'image/jpeg'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "service photos are publicly readable" on storage.objects;
drop policy if exists "providers upload own service photos" on storage.objects;
drop policy if exists "providers update own service photos" on storage.objects;
drop policy if exists "providers delete own service photos" on storage.objects;
drop policy if exists "service images owner insert" on storage.objects;
drop policy if exists "service images owner select" on storage.objects;
drop policy if exists "service images owner update" on storage.objects;
drop policy if exists "service images owner delete" on storage.objects;

create policy "service images owner insert" on storage.objects for insert to authenticated
with check (bucket_id = 'service-images' and public.luni_owns_storage_path(name));
create policy "service images owner select" on storage.objects for select to authenticated
using (bucket_id = 'service-images' and public.luni_owns_storage_path(name));
create policy "service images owner update" on storage.objects for update to authenticated
using (bucket_id = 'service-images' and public.luni_owns_storage_path(name))
with check (bucket_id = 'service-images' and public.luni_owns_storage_path(name));
create policy "service images owner delete" on storage.objects for delete to authenticated
using (bucket_id = 'service-images' and public.luni_owns_storage_path(name));

commit;
