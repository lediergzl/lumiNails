-- Asigna el rol inicial según la aplicación donde se registra la cuenta.
-- LuniClients => client; LuniManicurista => provider.
-- Nunca acepta "admin" desde metadatos de registro.
-- Aplicar después de las migraciones de roles 20261018010000 y 20261018020000.

begin;

create or replace function public.luni_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_requested_role text;
  v_role text;
begin
  v_requested_role := coalesce(new.raw_user_meta_data ->> 'signup_role', 'client');

  -- La lista está cerrada: ningún registro público puede crear administradores.
  v_role := case
    when v_requested_role = 'provider' then 'provider'
    else 'client'
  end;

  insert into public.profiles(id, display_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', ''),
    v_role
  )
  on conflict (id) do nothing;

  return new;
end;
$fn$;

commit;
