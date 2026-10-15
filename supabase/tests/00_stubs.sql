-- Simula lo mínimo de Supabase que las migraciones dan por hecho (roles, esquema auth, auth.uid()).
-- Solo para pruebas locales: en Supabase real esto ya existe.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema public, auth to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;


-- Como en Supabase, las extensiones viven en el esquema "extensions"
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema extensions to anon, authenticated;

-- Storage mínimo (solo para probar las políticas del bucket service-images)
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid default auth.uid()
);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated;
grant select, insert, update, delete on storage.objects to authenticated;

-- Ayudantes de las pruebas
create schema if not exists test;
grant usage on schema test to public;
create or replace function test.t(name text, ok boolean) returns void language plpgsql as $$
begin raise notice '%  %', case when ok then 'PASS' else 'FAIL' end, name; end $$;
create or replace function test.sub(u uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u::text, false)
$$;
grant execute on function test.t(text, boolean), test.sub(uuid) to public;
