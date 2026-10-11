-- Permite que cada clienta vea y comparta el código permanente de los estudios a los que ya está vinculada.
begin;

create or replace function public.luni_my_client_provider_codes()
returns table (provider_id uuid, business_code text)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $fn$
  select p.id, p.business_code
  from public.client_provider_relationships r
  join public.provider_profiles p on p.id = r.provider_id
  where r.client_id = auth.uid()
    and r.status = 'active'
    and p.deleted_at is null
    and p.business_code is not null;
$fn$;

revoke all on function public.luni_my_client_provider_codes() from public;
revoke all on function public.luni_my_client_provider_codes() from anon;
grant execute on function public.luni_my_client_provider_codes() to authenticated;

commit;
