-- Luni initial Supabase schema
-- Apply this migration in the Supabase SQL Editor or with Supabase CLI.
-- Configuration such as trial length, license prices and payment methods is stored
-- in app_settings; do not hardcode commercial values in the application.

begin;

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.app_settings(key, value)
values
  ('license_trial_days', '14'::jsonb),
  ('license_prices', '[]'::jsonb),
  ('payment_methods', '[]'::jsonb)
on conflict (key) do nothing;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  phone text,
  role text not null default 'client' check (role in ('client','provider','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Prevent users from changing their own authorization role through profile updates.
create or replace function public.luni_protect_profile_role()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if auth.uid() is not null and new.role is distinct from old.role then
    raise exception 'PROFILE_ROLE_CHANGE_FORBIDDEN' using errcode = '42501';
  end if;
  return new;
end;
$fn$;

drop trigger if exists protect_profile_role_luni on public.profiles;
create trigger protect_profile_role_luni
  before update of role on public.profiles
  for each row execute procedure public.luni_protect_profile_role();

create table if not exists public.provider_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  slug text not null unique,
  business_name text not null,
  bio text not null default '',
  avatar_path text,
  trial_started_at timestamptz not null default now(),
  license_expires_at timestamptz,
  license_status text not null default 'trial' check (license_status in ('trial','active','grace','expired','suspended')),
  is_published boolean not null default false,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- License and trial state must be changed only by trusted backend/admin operations.
create or replace function public.luni_protect_provider_license()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if auth.uid() is not null then
    if tg_op = 'INSERT' then
      if new.license_status <> 'trial' or new.license_expires_at is not null then
        raise exception 'PROVIDER_LICENSE_CHANGE_FORBIDDEN' using errcode = '42501';
      end if;
      new.trial_started_at := now();
    elsif (
      new.trial_started_at is distinct from old.trial_started_at
      or new.license_expires_at is distinct from old.license_expires_at
      or new.license_status is distinct from old.license_status
    ) then
      raise exception 'PROVIDER_LICENSE_CHANGE_FORBIDDEN' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$fn$;

drop trigger if exists protect_provider_license_luni on public.provider_profiles;
create trigger protect_provider_license_luni
  before insert or update on public.provider_profiles
  for each row execute procedure public.luni_protect_provider_license();

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.provider_profiles(id) on delete cascade,
  name text not null,
  description text not null default '',
  price_cents bigint not null check (price_cents >= 0),
  currency text not null default 'CUP',
  duration_minutes integer not null check (duration_minutes between 1 and 1440),
  thumb_path text,
  card_path text,
  detail_path text,
  original_path text,
  blurhash text,
  image_hash text,
  image_version text,
  is_active boolean not null default true,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists services_provider_active_idx
  on public.services(provider_id, is_active) where deleted_at is null;

create table if not exists public.availability (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.provider_profiles(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  kind text not null check (kind in ('working_hours','exception','block')),
  status text not null default 'active' check (status in ('active','inactive')),
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists availability_provider_time_idx
  on public.availability(provider_id, starts_at, ends_at);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.provider_profiles(id),
  client_id uuid not null references public.profiles(id),
  service_id uuid not null references public.services(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'pending_confirmation'
    check (status in ('pending_confirmation','confirmed','cancelled','rejected','completed')),
  notes text not null default '',
  idempotency_key text not null,
  client_service_name text not null,
  client_price_cents bigint not null check (client_price_cents >= 0),
  client_currency text not null default 'CUP',
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (ends_at > starts_at),
  unique (client_id, idempotency_key)
);

create index if not exists appointments_provider_time_idx
  on public.appointments(provider_id, starts_at, ends_at)
  where status in ('pending_confirmation','confirmed') and deleted_at is null;
create index if not exists appointments_client_time_idx
  on public.appointments(client_id, starts_at desc);

-- Database-level protection against overlapping live appointments for a provider.
alter table public.appointments
  drop constraint if exists appointments_no_overlapping_live_slots;
alter table public.appointments
  add constraint appointments_no_overlapping_live_slots
  exclude using gist (
    provider_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  )
  where (status in ('pending_confirmation','confirmed') and deleted_at is null);

create table if not exists public.sync_changes (
  cursor bigint generated always as identity primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  entity text not null,
  entity_id uuid not null,
  operation text not null check (operation in ('upsert','delete')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists sync_changes_owner_cursor_idx on public.sync_changes(owner_id, cursor);

create or replace function public.luni_create_appointment(
  p_id uuid,
  p_provider_id uuid,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_idempotency_key text,
  p_notes text default ''
)
returns public.appointments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_client_id uuid := auth.uid();
  v_service public.services%rowtype;
  v_provider public.provider_profiles%rowtype;
  v_trial_days integer;
  v_end timestamptz;
  v_existing public.appointments%rowtype;
  v_result public.appointments%rowtype;
begin
  if v_client_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode = '22023';
  end if;
  if p_starts_at is null or p_starts_at <= now() then
    raise exception 'INVALID_APPOINTMENT_TIME' using errcode = '22023';
  end if;

  select * into v_existing
  from public.appointments
  where client_id = v_client_id and idempotency_key = p_idempotency_key;
  if found then
    return v_existing;
  end if;

  select * into v_service
  from public.services
  where id = p_service_id and is_active and deleted_at is null;
  if not found then
    raise exception 'SERVICE_NOT_AVAILABLE' using errcode = 'P0002';
  end if;

  select * into v_provider
  from public.provider_profiles
  where id = p_provider_id and id = v_service.provider_id
    and is_published and deleted_at is null
  for update;
  if not found then
    raise exception 'PROVIDER_NOT_AVAILABLE' using errcode = 'P0002';
  end if;

  select coalesce((value #>> '{}')::integer, 14) into v_trial_days
  from public.app_settings where key = 'license_trial_days';
  v_trial_days := coalesce(v_trial_days, 14);

  if not (
    (v_provider.license_status in ('active','grace')
      and v_provider.license_expires_at is not null
      and v_provider.license_expires_at > now())
    or
    (v_provider.license_status = 'trial'
      and v_provider.trial_started_at + make_interval(days => v_trial_days) > now())
  ) then
    raise exception 'PROVIDER_LICENSE_INACTIVE' using errcode = 'P0001';
  end if;

  v_end := p_starts_at + make_interval(mins => v_service.duration_minutes);

  if not exists (
    select 1 from public.availability a
    where a.provider_id = v_provider.id
      and a.kind = 'working_hours'
      and a.status = 'active'
      and a.starts_at <= p_starts_at
      and a.ends_at >= v_end
  ) then
    raise exception 'OUTSIDE_WORKING_HOURS' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.availability a
    where a.provider_id = v_provider.id
      and a.kind = 'block'
      and a.status = 'active'
      and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(p_starts_at, v_end, '[)')
  ) then
    raise exception 'SLOT_BLOCKED' using errcode = 'P0001';
  end if;

  -- Locking the provider row serializes slot creation attempts for that provider.
  -- The exclusion constraint is the final guard against overlapping appointments.
  insert into public.appointments (
    id, provider_id, client_id, service_id, starts_at, ends_at, status,
    notes, idempotency_key, client_service_name, client_price_cents, client_currency
  ) values (
    coalesce(p_id, gen_random_uuid()), v_provider.id, v_client_id, v_service.id,
    p_starts_at, v_end, 'pending_confirmation', coalesce(p_notes, ''),
    p_idempotency_key, v_service.name, v_service.price_cents, v_service.currency
  )
  returning * into v_result;

  return v_result;
exception
  when exclusion_violation then
    raise exception 'SLOT_ALREADY_TAKEN' using errcode = '23P01';
end;
$fn$;

revoke all on function public.luni_create_appointment(uuid, uuid, uuid, timestamptz, text, text) from public;
grant execute on function public.luni_create_appointment(uuid, uuid, uuid, timestamptz, text, text) to authenticated;

alter table public.app_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.provider_profiles enable row level security;
alter table public.services enable row level security;
alter table public.availability enable row level security;
alter table public.appointments enable row level security;
alter table public.sync_changes enable row level security;

drop policy if exists "settings readable by authenticated users" on public.app_settings;
create policy "settings readable by authenticated users"
  on public.app_settings for select to authenticated using (true);

drop policy if exists "profiles read self" on public.profiles;
create policy "profiles read self"
  on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists "profiles update self" on public.profiles;
create policy "profiles update self"
  on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "published providers are public" on public.provider_profiles;
create policy "published providers are public"
  on public.provider_profiles for select to anon, authenticated
  using (is_published and deleted_at is null);
drop policy if exists "provider manages own profile" on public.provider_profiles;
create policy "provider manages own profile"
  on public.provider_profiles for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "active services are public" on public.services;
create policy "active services are public"
  on public.services for select to anon, authenticated
  using (is_active and deleted_at is null);
drop policy if exists "provider manages own services" on public.services;
create policy "provider manages own services"
  on public.services for all to authenticated
  using (exists (select 1 from public.provider_profiles p where p.id = provider_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.provider_profiles p where p.id = provider_id and p.user_id = auth.uid()));

drop policy if exists "active availability is public" on public.availability;
create policy "active availability is public"
  on public.availability for select to anon, authenticated using (status = 'active');
drop policy if exists "provider manages own availability" on public.availability;
create policy "provider manages own availability"
  on public.availability for all to authenticated
  using (exists (select 1 from public.provider_profiles p where p.id = provider_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.provider_profiles p where p.id = provider_id and p.user_id = auth.uid()));

drop policy if exists "appointment participants read" on public.appointments;
create policy "appointment participants read"
  on public.appointments for select to authenticated
  using (
    client_id = auth.uid()
    or exists (select 1 from public.provider_profiles p where p.id = provider_id and p.user_id = auth.uid())
  );
drop policy if exists "client can cancel own appointment" on public.appointments;
create policy "client can cancel own appointment"
  on public.appointments for update to authenticated
  using (client_id = auth.uid())
  with check (client_id = auth.uid() and status = 'cancelled');
drop policy if exists "provider can update own appointments" on public.appointments;
create policy "provider can update own appointments"
  on public.appointments for update to authenticated
  using (exists (select 1 from public.provider_profiles p where p.id = provider_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.provider_profiles p where p.id = provider_id and p.user_id = auth.uid()));

drop policy if exists "owner reads own sync changes" on public.sync_changes;
create policy "owner reads own sync changes"
  on public.sync_changes for select to authenticated using (owner_id = auth.uid());

-- Create a profile automatically after signup; the user cannot self-assign provider/admin role.
create or replace function public.luni_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  insert into public.profiles(id, display_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', ''),
    'client'
  )
  on conflict (id) do nothing;
  return new;
end;
$fn$;

drop trigger if exists on_auth_user_created_luni on auth.users;
create trigger on_auth_user_created_luni
  after insert on auth.users
  for each row execute procedure public.luni_handle_new_user();

commit;
