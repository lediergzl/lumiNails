-- Bucket público para las fotografías de los servicios.
-- Solo el propietario del estudio puede subir, sustituir o borrar sus archivos.
begin;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('service-photos', 'service-photos', true, 8388608, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "service photos are publicly readable" on storage.objects;
create policy "service photos are publicly readable" on storage.objects for select to anon, authenticated
using (bucket_id = 'service-photos');

drop policy if exists "providers upload own service photos" on storage.objects;
create policy "providers upload own service photos" on storage.objects for insert to authenticated
with check (bucket_id = 'service-photos' and exists (
  select 1 from public.provider_profiles p where p.id::text = split_part(name, '/', 1)
  and p.user_id = auth.uid() and p.deleted_at is null
));

drop policy if exists "providers update own service photos" on storage.objects;
create policy "providers update own service photos" on storage.objects for update to authenticated
using (bucket_id = 'service-photos' and exists (
  select 1 from public.provider_profiles p where p.id::text = split_part(name, '/', 1)
  and p.user_id = auth.uid() and p.deleted_at is null
))
with check (bucket_id = 'service-photos' and exists (
  select 1 from public.provider_profiles p where p.id::text = split_part(name, '/', 1)
  and p.user_id = auth.uid() and p.deleted_at is null
));

drop policy if exists "providers delete own service photos" on storage.objects;
create policy "providers delete own service photos" on storage.objects for delete to authenticated
using (bucket_id = 'service-photos' and exists (
  select 1 from public.provider_profiles p where p.id::text = split_part(name, '/', 1)
  and p.user_id = auth.uid() and p.deleted_at is null
));
commit;
