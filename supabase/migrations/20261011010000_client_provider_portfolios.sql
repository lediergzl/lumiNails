-- LuniNails: clientas y carteras independientes por manicurista.
-- Ejecutar después de las migraciones de esquema, disponibilidad y gestión de citas.
begin;

create table if not exists public.client_provider_relationships (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles(id) on delete cascade,
  provider_id uuid not null references public.provider_profiles(id) on delete cascade,
  status text not null default 'active' check (status in ('active','removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, provider_id)
);

create index if not exists client_provider_relationships_provider_idx
  on public.client_provider_relationships(provider_id, status, created_at desc);
create index if not exists client_provider_relationships_client_idx
  on public.client_provider_relationships(client_id, status, created_at desc);

create table if not exists public.provider_invites (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.provider_profiles(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '365 days'),
  revoked_at timestamptz
);

create index if not exists provider_invites_provider_idx
  on public.provider_invites(provider_id, created_at desc);

alter table public.client_provider_relationships enable row level security;
alter table public.provider_invites enable row level security;

drop policy if exists "client reads own provider relationships" on public.client_provider_relationships;
create policy "client reads own provider relationships"
  on public.client_provider_relationships for select to authenticated
  using (client_id = auth.uid());

drop policy if exists "provider reads own client relationships" on public.client_provider_relationships;
create policy "provider reads own client relationships"
  on public.client_provider_relationships for select to authenticated
  using (public.luni_is_provider_owner(provider_id));

-- No direct insert/update/delete policies: relationship changes must pass through checked RPCs.
drop policy if exists "provider reads own invites" on public.provider_invites;
create policy "provider reads own invites"
  on public.provider_invites for select to authenticated
  using (exists (
    select 1 from public.provider_profiles p
    where p.id = provider_id and p.user_id = auth.uid()
  ));

create or replace function public.luni_create_provider_invite(p_provider_id uuid)
returns table (token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_token text;
  v_expires timestamptz;
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

  v_token := encode(gen_random_bytes(24), 'hex');
  v_expires := now() + interval '365 days';
  insert into public.provider_invites(provider_id, token_hash, expires_at)
  values (p_provider_id, encode(digest(v_token, 'sha256'), 'hex'), v_expires);

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
set search_path = public, pg_temp
as $fn$
  select p.id, p.business_name, p.slug, p.bio, true
  from public.provider_invites i
  join public.provider_profiles p on p.id = i.provider_id
  where p.deleted_at is null
    and i.revoked_at is null
    and i.expires_at > now()
    and i.token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
  limit 1;
$fn$;

create or replace function public.luni_accept_provider_invite(p_token text)
returns table (provider_id uuid, business_name text, relationship_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
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
  where i.token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and i.revoked_at is null and i.expires_at > now() and p.deleted_at is null
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

create or replace function public.luni_my_client_providers()
returns table (
  provider_id uuid,
  business_name text,
  slug text,
  bio text,
  relationship_id uuid,
  linked_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select p.id, p.business_name, p.slug, p.bio, r.id, r.created_at
  from public.client_provider_relationships r
  join public.provider_profiles p on p.id = r.provider_id
  where r.client_id = auth.uid()
    and r.status = 'active'
    and p.deleted_at is null
  order by r.created_at desc;
$fn$;

create or replace function public.luni_remove_client_provider(p_provider_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  update public.client_provider_relationships
  set status = 'removed', updated_at = now()
  where client_id = auth.uid() and provider_id = p_provider_id and status = 'active';
end;
$fn$;

create or replace function public.luni_provider_clients(p_provider_id uuid)
returns table (
  client_id uuid,
  display_name text,
  phone text,
  linked_at timestamptz,
  appointment_count bigint,
  last_appointment_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  if auth.uid() is null or not exists (
    select 1 from public.provider_profiles p
    where p.id = p_provider_id and p.user_id = auth.uid()
  ) then
    raise exception 'PROVIDER_FORBIDDEN' using errcode = '42501';
  end if;

  return query
  select r.client_id,
         coalesce(pr.display_name, ''),
         pr.phone,
         r.created_at,
         count(a.id) filter (where a.deleted_at is null),
         max(a.starts_at) filter (where a.deleted_at is null)
  from public.client_provider_relationships r
  join public.profiles pr on pr.id = r.client_id
  left join public.appointments a on a.provider_id = r.provider_id and a.client_id = r.client_id
  where r.provider_id = p_provider_id and r.status = 'active'
  group by r.client_id, pr.display_name, pr.phone, r.created_at
  order by max(a.starts_at) desc nulls last, pr.display_name;
end;
$fn$;

-- Each booking also establishes this client/provider relationship, so the client's
-- portfolio is created even if a reservation began from a valid invitation deep link.
create or replace function public.luni_link_client_after_appointment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  insert into public.client_provider_relationships(client_id, provider_id, status)
  values (new.client_id, new.provider_id, 'active')
  on conflict (client_id, provider_id)
  do update set status = 'active', updated_at = now();
  return new;
end;
$fn$;

drop trigger if exists appointments_link_client_provider on public.appointments;
create trigger appointments_link_client_provider
  after insert on public.appointments
  for each row execute procedure public.luni_link_client_after_appointment();

-- SECURITY DEFINER helpers avoid recursive RLS checks between relationship and profile policies.
create or replace function public.luni_is_provider_owner(p_provider_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1 from public.provider_profiles p
    where p.id = p_provider_id and p.user_id = auth.uid()
  );
$fn$;

create or replace function public.luni_client_linked_to_provider(p_provider_id uuid, p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1 from public.client_provider_relationships r
    where r.provider_id = p_provider_id
      and r.client_id = p_client_id
      and r.status = 'active'
  );
$fn$;

revoke all on function public.luni_is_provider_owner(uuid) from public;
revoke all on function public.luni_client_linked_to_provider(uuid, uuid) from public;
grant execute on function public.luni_is_provider_owner(uuid) to authenticated;
grant execute on function public.luni_client_linked_to_provider(uuid, uuid) to authenticated;

-- Replace anonymous/public discovery policies. A client may read only studios/services
-- explicitly linked to their own account; a provider can always manage their own records.
drop policy if exists "published providers are public" on public.provider_profiles;
drop policy if exists "active services are public" on public.services;

drop policy if exists "linked clients read provider profiles" on public.provider_profiles;
create policy "linked clients read provider profiles"
  on public.provider_profiles for select to authenticated
  using (
    public.luni_is_provider_owner(id)
    or public.luni_client_linked_to_provider(id, auth.uid())
  );

drop policy if exists "linked clients read provider services" on public.services;
create policy "linked clients read provider services"
  on public.services for select to authenticated
  using (
    public.luni_is_provider_owner(services.provider_id)
    or public.luni_client_linked_to_provider(services.provider_id, auth.uid())
  );

revoke all on function public.luni_create_provider_invite(uuid) from public;
revoke all on function public.luni_preview_provider_invite(text) from public;
revoke all on function public.luni_accept_provider_invite(text) from public;
revoke all on function public.luni_my_client_providers() from public;
revoke all on function public.luni_remove_client_provider(uuid) from public;
revoke all on function public.luni_provider_clients(uuid) from public;
grant execute on function public.luni_create_provider_invite(uuid) to authenticated;
grant execute on function public.luni_preview_provider_invite(text) to anon, authenticated;
grant execute on function public.luni_accept_provider_invite(text) to authenticated;
grant execute on function public.luni_my_client_providers() to authenticated;
grant execute on function public.luni_remove_client_provider(uuid) to authenticated;
grant execute on function public.luni_provider_clients(uuid) to authenticated;

commit;
