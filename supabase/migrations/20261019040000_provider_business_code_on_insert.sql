-- Asigna el código permanente a cada estudio NUEVO.
-- La migración 20261019020000 hizo business_code obligatorio pero solo rellenó los estudios existentes:
-- registrar un estudio nuevo desde la app fallaba con «null value in column "business_code"».
begin;

create or replace function public.luni_assign_business_code()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $fn$
declare
  v_code text;
  v_bytes bytea;
  v_tries integer := 0;
begin
  if new.business_code is not null then
    return new;
  end if;
  loop
    v_tries := v_tries + 1;
    v_bytes := gen_random_bytes(6);
    select string_agg((get_byte(v_bytes, n) % 10)::text, '' order by n)
      into v_code
      from generate_series(0, 5) as g(n);
    exit when not exists (select 1 from public.provider_profiles where business_code = v_code);
    if v_tries >= 50 then
      raise exception 'No se pudo generar un código de estudio único. Inténtalo de nuevo.';
    end if;
  end loop;
  new.business_code := v_code;
  return new;
end;
$fn$;

drop trigger if exists provider_profiles_assign_business_code on public.provider_profiles;
create trigger provider_profiles_assign_business_code
  before insert on public.provider_profiles
  for each row execute function public.luni_assign_business_code();

commit;
