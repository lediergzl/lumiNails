-- Corrige el error PostgreSQL 42702 en luni_accept_provider_invite.
-- La funcion RETURNS TABLE declara provider_id como variable de salida.
-- "use_column" hace que las referencias ambiguas se resuelvan como columnas.
-- Ejecutar una vez en Supabase SQL Editor.

begin;

create or replace function public.luni_accept_provider_invite(p_token text)
returns table (provider_id uuid, business_name text, relationship_id uuid)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
#variable_conflict use_column
declare
  v_client_id uuid := auth.uid();
  v_provider_id uuid;
  v_business_name text;
  v_relationship_id uuid;
  v_clean_code text := regexp_replace(coalesce(btrim(p_token), ''), '[^0-9]', '', 'g');
begin
  if v_client_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  select p.id, p.business_name
    into v_provider_id, v_business_name
  from public.provider_profiles as p
  where p.business_code = v_clean_code
    and p.deleted_at is null
  limit 1;

  if v_provider_id is null then
    select p.id, p.business_name
      into v_provider_id, v_business_name
    from public.provider_invites as i
    join public.provider_profiles as p on p.id = i.provider_id
    where i.token_hash = public.luni_provider_invite_hash(p_token)
      and i.revoked_at is null
      and i.expires_at > now()
      and p.deleted_at is null
    limit 1;
  end if;

  if v_provider_id is null then
    raise exception 'INVITE_INVALID_OR_EXPIRED' using errcode = 'P0002';
  end if;

  insert into public.client_provider_relationships as rel
    (client_id, provider_id, status)
  values (v_client_id, v_provider_id, 'active')
  on conflict (client_id, provider_id)
  do update
    set status = 'active',
        updated_at = now()
  returning rel.id into v_relationship_id;

  return query
    select v_provider_id, v_business_name, v_relationship_id;
end;
$fn$;

commit;
