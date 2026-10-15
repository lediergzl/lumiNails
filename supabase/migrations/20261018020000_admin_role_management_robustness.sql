-- Robustez del panel de roles: listar usuarios aunque falte su perfil.
-- Aplicar después de 20261018010000_admin_role_management.sql.
begin;

create or replace function public.luni_admin_list_users()
returns table (
  user_id uuid,
  email text,
  display_name text,
  role text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $fn$
begin
  if not public.luni_is_admin() then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  return query
  select
    u.id,
    coalesce(u.email, ''),
    coalesce(p.display_name, coalesce(u.raw_user_meta_data ->> 'display_name', '')),
    coalesce(p.role, 'client'),
    u.created_at
  from auth.users u
  left join public.profiles p on p.id = u.id
  order by u.created_at desc;
end;
$fn$;
revoke all on function public.luni_admin_list_users() from public;
grant execute on function public.luni_admin_list_users() to authenticated;

create or replace function public.luni_admin_set_user_role(
  p_user_id uuid,
  p_role text
)
returns public.profiles
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $fn$
declare
  v_actor uuid := auth.uid();
  v_result public.profiles%rowtype;
  v_admin_count integer;
  v_user auth.users%rowtype;
begin
  if not public.luni_is_admin() then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if p_user_id is null or p_role not in ('client','provider','admin') then
    raise exception 'INVALID_USER_ROLE' using errcode = '22023';
  end if;
  if p_user_id = v_actor then
    raise exception 'CANNOT_CHANGE_OWN_ROLE' using errcode = '42501';
  end if;

  select * into v_user from auth.users where id = p_user_id;
  if not found then
    raise exception 'AUTH_USER_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Repair a missing profile for older or partially migrated Auth accounts.
  insert into public.profiles(id, display_name, role)
  values (v_user.id, coalesce(v_user.raw_user_meta_data ->> 'display_name', ''), 'client')
  on conflict (id) do nothing;

  perform 1 from public.profiles where id = p_user_id for update;
  select count(*) into v_admin_count from public.profiles where role = 'admin';

  if (select role from public.profiles where id = p_user_id) = 'admin'
     and p_role <> 'admin' and v_admin_count <= 1 then
    raise exception 'CANNOT_REMOVE_LAST_ADMIN' using errcode = '42501';
  end if;

  perform set_config('app.luni_admin_role_change', 'on', true);
  update public.profiles
  set role = p_role, updated_at = now()
  where id = p_user_id
  returning * into v_result;
  return v_result;
end;
$fn$;
revoke all on function public.luni_admin_set_user_role(uuid,text) from public;
grant execute on function public.luni_admin_set_user_role(uuid,text) to authenticated;

commit;
