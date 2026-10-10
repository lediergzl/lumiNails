-- Allow the in-app admin license dashboard to list studies.
-- License mutations still go through SECURITY DEFINER RPCs that check luni_is_admin().
begin;
drop policy if exists "admins read provider licenses" on public.provider_profiles;
create policy "admins read provider licenses"
  on public.provider_profiles for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
commit;
