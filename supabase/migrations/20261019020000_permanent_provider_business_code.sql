-- Codigo corto, unico y permanente para identificar cada estudio.
-- Las invitaciones anteriores siguen aceptandose durante la transicion.
-- Ejecutar en Supabase SQL Editor despues de las migraciones previas.

begin;

alter table public.provider_profiles
  add column if not exists business_code text;

create unique index if not exists provider_profiles_business_code_uidx
  on public.provider_profiles (business_code)
  where business_code is not null;

-- Asignar un codigo permanente a los estudios existentes que aun no tengan uno.
do $block$
declare
  v_provider record;
  v_code text;
  v_bytes bytea;
begin
  for v_provider in
    select id from public.provider_profiles where business_code is null
  loop
    loop
      v_bytes := gen_random_bytes(6);
      select string_agg((get_byte(v_bytes, n) % 10)::text, '' order by n)
        into v_code
        from generate_series(0, 5) as g(n);
      begin
        update public.provider_profiles
          set business_code = v_code
          where id = v_provider.id and business_code is null;
        exit;
      exception when unique_violation then
        -- Si dos estudios generan el mismo codigo, probar otro.
        null;
      end;
      exit when exists (
        select 1 from public.provider_profiles
        where id = v_provider.id and business_code is not null
      );
    end loop;
  end loop;
end;
$block$;

alter table public.provider_profiles
  alter column business_code set not null;

alter table public.provider_profiles
  add constraint provider_profiles_business_code_format
  check (business_code ~ '^[0-9]{6}$');

-- Entrega el codigo permanente del estudio autenticado; no genera uno nuevo
-- cada vez que se pulsa el boton.
create or replace function public.luni_create_provider_invite(p_provider_id uuid)
returns table (token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  select p.business_code into v_code
  from public.provider_profiles p
  where p.id = p_provider_id
    and p.user_id = auth.uid()
    and p.deleted_at is null;

  if v_code is null then
    raise exception 'PROVIDER_FORBIDDEN' using errcode = '42501';
  end if;

  token := v_code;
  expires_at := null;
  return next;
end;
$fn$;

-- El codigo permanente identifica al estudio y no vence.
-- Los tokens anteriores de provider_invites se mantienen validos hasta vencer.
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
  (select p.id, p.business_name, p.slug, p.bio, true
   from public.provider_profiles p
   where p.deleted_at is null
     and p.business_code = regexp_replace(coalesce(btrim(p_token), ''), '[^0-9]', '', 'g')
   limit 1)
  union all
  (select p.id, p.business_name, p.slug, p.bio, true
   from public.provider_invites i
   join public.provider_profiles p on p.id = i.provider_id
   where p.deleted_at is null
     and i.revoked_at is null
     and i.expires_at > now()
     and i.token_hash = public.luni_provider_invite_hash(p_token)
     and not exists (
       select 1 from public.provider_profiles p2
       where p2.business_code = regexp_replace(coalesce(btrim(p_token), ''), '[^0-9]', '', 'g')
     )
   limit 1)
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
  v_clean_code text := regexp_replace(coalesce(btrim(p_token), ''), '[^0-9]', '', 'g');
begin
  if v_client_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  select p.id, p.business_name into v_provider_id, v_business_name
  from public.provider_profiles p
  where p.business_code = v_clean_code
    and p.deleted_at is null
  limit 1;

  if v_provider_id is null then
    select p.id, p.business_name into v_provider_id, v_business_name
    from public.provider_invites i
    join public.provider_profiles p on p.id = i.provider_id
    where i.token_hash = public.luni_provider_invite_hash(p_token)
      and i.revoked_at is null
      and i.expires_at > now()
      and p.deleted_at is null
    limit 1;
  end if;

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
