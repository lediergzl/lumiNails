-- Protege el código permanente del estudio contra intentos automatizados.
-- Solo cuentas autenticadas pueden consultar/aceptar códigos; los intentos se limitan
-- por usuario en ventanas de 15 minutos. La limitación por IP requiere una capa HTTP
-- (Edge Function/proxy), porque una RPC PostgreSQL no recibe una IP fiable por defecto.

begin;

create table if not exists public.provider_code_attempt_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('preview', 'accept')),
  window_start timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  primary key (user_id, action, window_start)
);

alter table public.provider_code_attempt_limits enable row level security;
revoke all on public.provider_code_attempt_limits from public, anon, authenticated;

create or replace function public.luni_take_provider_code_attempt(p_action text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_user_id uuid := auth.uid();
  v_window timestamptz;
  v_attempts integer;
  v_limit integer;
begin
  if v_user_id is null or p_action not in ('preview', 'accept') then
    return false;
  end if;

  v_limit := case when p_action = 'preview' then 30 else 8 end;
  v_window := to_timestamp(floor(extract(epoch from now()) / 900) * 900);

  insert into public.provider_code_attempt_limits(user_id, action, window_start, attempts)
  values (v_user_id, p_action, v_window, 1)
  on conflict (user_id, action, window_start)
  do update set attempts = public.provider_code_attempt_limits.attempts + 1
  returning attempts into v_attempts;

  -- No se lanza una excepción al exceder el límite: una excepción revertiría
  -- también el contador de intentos dentro de la misma transacción.
  return v_attempts <= v_limit;
end;
$fn$;

revoke all on function public.luni_take_provider_code_attempt(text) from public, anon, authenticated;

create or replace function public.luni_preview_provider_invite(p_token text)
returns table (
  provider_id uuid,
  business_name text,
  slug text,
  bio text,
  invite_valid boolean
)
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  v_clean_code text := regexp_replace(coalesce(btrim(p_token), ''), '[^0-9]', '', 'g');
begin
  if auth.uid() is null or not public.luni_take_provider_code_attempt('preview') then
    return;
  end if;

  if v_clean_code ~ '^[0-9]{6}$' and exists (
    select 1 from public.provider_profiles p
    where p.business_code = v_clean_code and p.deleted_at is null
  ) then
    return query
      select p.id, p.business_name, p.slug, p.bio, true
      from public.provider_profiles p
      where p.business_code = v_clean_code and p.deleted_at is null
      limit 1;
    return;
  end if;

  return query
    select p.id, p.business_name, p.slug, p.bio, true
    from public.provider_invites i
    join public.provider_profiles p on p.id = i.provider_id
    where p.deleted_at is null
      and i.revoked_at is null
      and i.expires_at > now()
      and i.token_hash = public.luni_provider_invite_hash(p_token)
    limit 1;
end;
$fn$;

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
  if v_client_id is null or not public.luni_take_provider_code_attempt('accept') then
    return;
  end if;

  select p.id, p.business_name
    into v_provider_id, v_business_name
  from public.provider_profiles p
  where p.business_code = v_clean_code
    and p.deleted_at is null
  limit 1;

  if v_provider_id is null then
    select p.id, p.business_name
      into v_provider_id, v_business_name
    from public.provider_invites i
    join public.provider_profiles p on p.id = i.provider_id
    where i.token_hash = public.luni_provider_invite_hash(p_token)
      and i.revoked_at is null
      and i.expires_at > now()
      and p.deleted_at is null
    limit 1;
  end if;

  -- Devuelve cero filas en vez de lanzar una excepción: así queda registrado
  -- el intento fallido y no se revierte el contador por rollback.
  if v_provider_id is null then
    return;
  end if;

  insert into public.client_provider_relationships as rel
    (client_id, provider_id, status)
  values (v_client_id, v_provider_id, 'active')
  on conflict (client_id, provider_id)
  do update set status = 'active', updated_at = now()
  returning rel.id into v_relationship_id;

  return query select v_provider_id, v_business_name, v_relationship_id;
end;
$fn$;

revoke all on function public.luni_preview_provider_invite(text) from public, anon;
revoke all on function public.luni_accept_provider_invite(text) from public, anon;
grant execute on function public.luni_preview_provider_invite(text) to authenticated;
grant execute on function public.luni_accept_provider_invite(text) to authenticated;

commit;
