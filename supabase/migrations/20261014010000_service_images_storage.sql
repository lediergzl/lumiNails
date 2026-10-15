-- LuniNails: bucket de fotos de servicios (plan gratuito de Supabase Storage).
-- Lectura pública por URL con rutas imposibles de adivinar (UUID/hash); escritura solo de la dueña del estudio.
-- Ruta de cada archivo: {provider_id}/{service_id}/{hash}-{variante}.{webp|jpg}
begin;

-- ¿La carpeta raíz de la ruta es el id de un estudio de la usuaria actual?
create or replace function public.luni_owns_storage_path(p_name text)
returns boolean
language plpgsql
stable
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

do $do$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'Storage no está disponible en esta base: se omite el bucket service-images.';
    return;
  end if;

  -- 512 KB por archivo es un tope de seguridad; la app sube ~10-60 KB.
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('service-images', 'service-images', true, 524288, array['image/webp', 'image/jpeg'])
  on conflict (id) do update
    set public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  drop policy if exists "service images owner insert" on storage.objects;
  create policy "service images owner insert" on storage.objects for insert to authenticated
    with check (bucket_id = 'service-images' and public.luni_owns_storage_path(name));

  drop policy if exists "service images owner select" on storage.objects;
  create policy "service images owner select" on storage.objects for select to authenticated
    using (bucket_id = 'service-images' and public.luni_owns_storage_path(name));

  drop policy if exists "service images owner update" on storage.objects;
  create policy "service images owner update" on storage.objects for update to authenticated
    using (bucket_id = 'service-images' and public.luni_owns_storage_path(name))
    with check (bucket_id = 'service-images' and public.luni_owns_storage_path(name));

  drop policy if exists "service images owner delete" on storage.objects;
  create policy "service images owner delete" on storage.objects for delete to authenticated
    using (bucket_id = 'service-images' and public.luni_owns_storage_path(name));
end
$do$;

commit;
