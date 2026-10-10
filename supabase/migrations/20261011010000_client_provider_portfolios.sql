-- LuniNails: clientas y carteras independientes por manicurista.
-- Ejecutar después de las migraciones de esquema, disponibilidad y gestión de citas.
begin;

-- pgcrypto provee gen_random_bytes() y digest() usados para los tokens de invitación.
create extension if not exists pgcrypto with schema extensions;

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

-- Conserva el historial previo: cada clienta que ya reservó queda en la cartera de ese estudio.
insert into public.client_provider_relationships(client_id, provider_id, status)
select distinct a.client_id, a.provider_id, 'active'
from public.appointments a
where a.deleted_at is null
on conflict (client_id, provider_id) do nothing;

-- Limpieza defensiva si se ejecutó una versión preliminar de esta migración.
drop trigger if exists appointments_link_client_provider on public.appointments;
drop function if exists public.luni_link_client_after_appointment();

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
set search_path = public, extensions, pg_temp
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
set search_path = public, extensions, pg_temp
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

-- Replace anonymous/public discovery policies. A client may read only studios/services
-- explicitly linked to their own account; a provider can always manage their own records.
drop policy if exists "published providers are public" on public.provider_profiles;
drop policy if exists "active availability is public" on public.availability;
drop policy if exists "linked clients read provider availability" on public.availability;
create policy "linked clients read provider availability"
  on public.availability for select to authenticated
  using (
    public.luni_is_provider_owner(provider_id)
    or (
      status = 'active'
      and public.luni_client_linked_to_provider(provider_id, auth.uid())
    )
  );

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
    or (
      is_active and deleted_at is null
      and public.luni_client_linked_to_provider(services.provider_id, auth.uid())
    )
  );

-- Las reservas requieren una relación activa creada al aceptar una invitación personal.
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
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_client_id uuid := auth.uid();
  v_service public.services%rowtype;
  v_provider public.provider_profiles%rowtype;
  v_end timestamptz;
  v_existing public.appointments%rowtype;
  v_result public.appointments%rowtype;
  v_phone text;
  v_local_start timestamp;
  v_local_end timestamp;
  v_today date;
  v_daily_count integer;
begin
  if v_client_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode = '22023';
  end if;

  select nullif(trim(phone), '') into v_phone
  from public.profiles where id = v_client_id;
  if v_phone is null then
    raise exception 'PHONE_REQUIRED' using errcode = 'P0001';
  end if;

  if p_starts_at is null or p_starts_at <= now() + interval '1 hour' then
    raise exception 'INVALID_APPOINTMENT_TIME' using errcode = '22023';
  end if;

  select * into v_existing
  from public.appointments
  where client_id = v_client_id and idempotency_key = p_idempotency_key;
  if found then return v_existing; end if;

  if not exists (
    select 1 from public.client_provider_relationships r
    where r.client_id = v_client_id
      and r.provider_id = p_provider_id
      and r.status = 'active'
  ) then
    raise exception 'CLIENT_PROVIDER_LINK_REQUIRED' using errcode = '42501';
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

  if not public.luni_provider_license_ok(v_provider) then
    raise exception 'PROVIDER_LICENSE_INACTIVE' using errcode = 'P0001';
  end if;

  v_end := p_starts_at + make_interval(mins => v_service.duration_minutes);
  v_local_start := p_starts_at at time zone v_provider.timezone;
  v_local_end := v_end at time zone v_provider.timezone;
  v_today := (now() at time zone v_provider.timezone)::date;

  if v_local_start::date < v_today or v_local_start::date > v_today + 90 then
    raise exception 'INVALID_APPOINTMENT_DATE' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.weekly_schedule w
    where w.provider_id = v_provider.id
      and w.weekday = extract(isodow from v_local_start)::int
      and v_local_start::date = v_local_end::date
      and w.start_time <= v_local_start::time
      and w.end_time >= v_local_end::time
      and mod(extract(epoch from (v_local_start::time - w.start_time)), 1800) = 0
  ) then
    raise exception 'INVALID_APPOINTMENT_SLOT' using errcode = 'P0001';
  end if;

  if not public.luni_within_working_hours(v_provider.id, p_starts_at, v_end) then
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

  select count(*)::integer into v_daily_count
  from public.appointments a
  where a.provider_id = v_provider.id
    and a.status in ('pending_confirmation','confirmed')
    and a.deleted_at is null
    and (a.starts_at at time zone v_provider.timezone)::date = v_local_start::date;

  if v_daily_count >= v_provider.daily_appointment_limit then
    raise exception 'DAILY_LIMIT_REACHED' using errcode = 'P0001';
  end if;

  insert into public.appointments (
    id, provider_id, client_id, service_id, starts_at, ends_at, status,
    notes, idempotency_key, client_service_name, client_price_cents,
    client_currency, cancellation_reason
  ) values (
    coalesce(p_id, gen_random_uuid()), v_provider.id, v_client_id, v_service.id,
    p_starts_at, v_end, 'pending_confirmation', coalesce(p_notes, ''),
    p_idempotency_key, v_service.name, v_service.price_cents, v_service.currency, ''
  )
  returning * into v_result;

  return v_result;
exception
  when exclusion_violation then
    raise exception 'SLOT_ALREADY_TAKEN' using errcode = '23P01';
end;
$function$;


revoke all on function public.luni_create_appointment(uuid, uuid, uuid, timestamptz, text, text) from public, anon;
grant execute on function public.luni_create_appointment(uuid, uuid, uuid, timestamptz, text, text) to authenticated;
-- Los horarios se calculan solo para clientas vinculadas o la propia manicurista.
create or replace function public.luni_available_slots(
  p_provider_id uuid,
  p_service_id uuid,
  p_day date
)
returns table(starts_at timestamptz)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_service public.services%rowtype;
  v_provider public.provider_profiles%rowtype;
  v_step constant interval := interval '30 minutes';
  v_lead constant interval := interval '1 hour';
  v_duration interval;
  v_today date;
  v_count integer;
  w record;
  v_cursor timestamp;
  v_start timestamptz;
  v_end timestamptz;
begin
  select * into v_service
  from public.services
  where id = p_service_id and is_active and deleted_at is null;
  if not found then return; end if;

  select * into v_provider
  from public.provider_profiles
  where id = p_provider_id and id = v_service.provider_id
    and is_published and deleted_at is null;
  if not found then return; end if;

  -- No se revelan horarios a cuentas anónimas ni a clientas fuera de esta cartera.
  if auth.uid() is null or not (
    public.luni_is_provider_owner(v_provider.id)
    or public.luni_client_linked_to_provider(v_provider.id, auth.uid())
  ) then
    return;
  end if;

  if not public.luni_provider_license_ok(v_provider) then return; end if;

  v_today := (now() at time zone v_provider.timezone)::date;
  if p_day is null or p_day < v_today or p_day > v_today + 90 then return; end if;

  select count(*)::integer into v_count
  from public.appointments a
  where a.provider_id = v_provider.id
    and a.status in ('pending_confirmation','confirmed')
    and a.deleted_at is null
    and (a.starts_at at time zone v_provider.timezone)::date = p_day;

  if v_count >= v_provider.daily_appointment_limit then return; end if;

  v_duration := make_interval(mins => v_service.duration_minutes);

  for w in
    select ws.start_time, ws.end_time
    from public.weekly_schedule ws
    where ws.provider_id = v_provider.id
      and ws.weekday = extract(isodow from p_day)::int
    order by ws.start_time
  loop
    v_cursor := p_day + w.start_time;
    while v_cursor + v_duration <= p_day + w.end_time loop
      v_start := v_cursor at time zone v_provider.timezone;
      v_end := v_start + v_duration;

      if v_start > now() + v_lead
         and not exists (
           select 1 from public.appointments a
           where a.provider_id = v_provider.id
             and a.status in ('pending_confirmation','confirmed')
             and a.deleted_at is null
             and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(v_start, v_end, '[)')
         )
         and not exists (
           select 1 from public.availability b
           where b.provider_id = v_provider.id
             and b.kind = 'block'
             and b.status = 'active'
             and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(v_start, v_end, '[)')
         )
      then
        starts_at := v_start;
        return next;
      end if;

      v_cursor := v_cursor + v_step;
    end loop;
  end loop;
end;
$function$;

-- Day-strip counts use the exact same server-side slot and capacity rules.
revoke all on function public.luni_available_slots(uuid, uuid, date) from public, anon;
revoke all on function public.luni_available_days(uuid, uuid, date, integer) from public, anon;
grant execute on function public.luni_available_slots(uuid, uuid, date) to authenticated;
grant execute on function public.luni_available_days(uuid, uuid, date, integer) to authenticated;

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
