-- Codigos de invitacion cortos, dictables y compatibles con invitaciones antiguas.
-- Ejecutar despues de las migraciones anteriores en Supabase SQL Editor.
begin;

-- Los codigos nuevos tienen 8 caracteres en formato XXXX-XXXX.
-- Se excluyen I, O, 0 y 1 para reducir confusiones al dictarlos.
-- Las invitaciones antiguas (48 caracteres hexadecimales en minuscula)
-- conservan su hash y siguen siendo validas.
create or replace function public.luni_provider_invite_hash(p_token text)
returns text
language sql
immutable
set search_path = pg_catalog, extensions
as $fn$
  select encode(
    digest(
      case
        when btrim(coalesce(p_token, '')) ~ '^[0-9a-f]{48}$'
          then btrim(p_token)
        else upper(regexp_replace(coalesce(p_token, ''), '[^A-Za-z0-9]', '', 'g'))
      end,
      'sha256'
    ),
    'hex'
  );
$fn$;

revoke all on function public.luni_provider_invite_hash(text) from public, anon, authenticated;

create or replace function public.luni_create_provider_invite(p_provider_id uuid)
returns table (token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  v_token text;
  v_raw text;
  v_hash text;
  v_bytes bytea;
  v_expires timestamptz;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  if not exists (
    select 1 from public.provider_profiles p
    where p.id = p_provider_id and p.user_id = auth.uid() and p.deleted_at is null
  ) then
    raise exception 'PROVIDER_FORBIDDEN' using errcode = '42501';
  end if;

  -- Ocho caracteres aleatorios (~40 bits), agrupados para poder dictarlos.
  loop
    v_bytes := gen_random_bytes(8);
    select string_agg(
      substr(v_alphabet, (get_byte(v_bytes, n) % length(v_alphabet)) + 1, 1),
      '' order by n
    )
    into v_raw
    from generate_series(0, 7) as g(n);

    v_token := substr(v_raw, 1, 4) || '-' || substr(v_raw, 5, 4);
    v_hash := public.luni_provider_invite_hash(v_token);
    exit when not exists (
      select 1 from public.provider_invites i where i.token_hash = v_hash
    );
  end loop;

  v_expires := now() + interval '365 days';
  insert into public.provider_invites(provider_id, token_hash, expires_at)
  values (p_provider_id, v_hash, v_expires);

  token := v_token;
  expires_at := v_expires;
  return next;
end;
$fn$;

create or replace function public.luni_preview_provider_invite(p_token text)
returns table (
  provider_id uuid,
  business_name text,
  slug text,
  bio text,
  invite_valid boolean
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $fn$
  select p.id, p.business_name, p.slug, p.bio, true
  from public.provider_invites i
  join public.provider_profiles p on p.id = i.provider_id
  where p.deleted_at is null
    and i.revoked_at is null
    and i.expires_at > now()
    and i.token_hash = public.luni_provider_invite_hash(p_token)
  limit 1;
$fn$;

create or replace function public.luni_accept_provider_invite(p_token text)
returns table (provider_id uuid, business_name text, relationship_id uuid)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  v_client_id uuid := auth.uid();
  v_provider_id uuid;
  v_business_name text;
  v_relationship_id uuid;
begin
  if v_client_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  select p.id, p.business_name into v_provider_id, v_business_name
  from public.provider_invites i
  join public.provider_profiles p on p.id = i.provider_id
  where i.token_hash = public.luni_provider_invite_hash(p_token)
    and i.revoked_at is null
    and i.expires_at > now()
    and p.deleted_at is null
  limit 1;

  if v_provider_id is null then
    raise exception 'INVITE_INVALID_OR_EXPIRED' using errcode = 'P0002';
  end if;

  insert into public.client_provider_relationships(client_id, provider_id, status)
  values (v_client_id, v_provider_id, 'active')
  on conflict (client_id, provider_id)
  do update set status = 'active', updated_at = now()
  returning id into v_relationship_id;

  return query select v_provider_id, v_business_name, v_relationship_id;
end;
$fn$;

commit;
