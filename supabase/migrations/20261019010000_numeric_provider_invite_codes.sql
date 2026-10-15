-- Invitaciones numericas para que sea facil dictarlas o introducirlas en el telefono.
-- Los codigos antiguos siguen funcionando: solo cambia la generacion de invitaciones nuevas.
-- Ejecutar en Supabase SQL Editor despues de las migraciones anteriores.

begin;

create or replace function public.luni_create_provider_invite(p_provider_id uuid)
returns table (token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  v_token text;
  v_hash text;
  v_bytes bytea;
  v_expires timestamptz;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  if not exists (
    select 1 from public.provider_profiles p
    where p.id = p_provider_id
      and p.user_id = auth.uid()
      and p.deleted_at is null
  ) then
    raise exception 'PROVIDER_FORBIDDEN' using errcode = '42501';
  end if;

  -- Ocho digitos aleatorios, incluyendo ceros iniciales. Se comprueba
  -- la unicidad del hash antes de insertar para evitar codigos duplicados.
  loop
    v_bytes := gen_random_bytes(8);
    select string_agg((get_byte(v_bytes, n) % 10)::text, '' order by n)
      into v_token
      from generate_series(0, 7) as g(n);

    v_hash := public.luni_provider_invite_hash(v_token);
    exit when not exists (
      select 1 from public.provider_invites i where i.token_hash = v_hash
    );
  end loop;

  -- Una vigencia menor reduce el tiempo durante el que puede reutilizarse
  -- un codigo numerico si alguien lo comparte por error.
  v_expires := now() + interval '30 days';

  insert into public.provider_invites(provider_id, token_hash, expires_at)
  values (p_provider_id, v_hash, v_expires);

  token := v_token;
  expires_at := v_expires;
  return next;
end;
$fn$;

commit;
