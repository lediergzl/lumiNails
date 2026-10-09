-- Repair scheduling API used by Luni Studio and Luni Cliente.
-- Safe additive migration: keeps existing profiles, services, availability and appointments.
begin;

create table if not exists public.weekly_schedule (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.provider_profiles(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time),
  unique (provider_id, weekday, start_time, end_time)
);
create index if not exists weekly_schedule_provider_day_idx
  on public.weekly_schedule(provider_id, weekday, start_time);

alter table public.weekly_schedule enable row level security;
drop policy if exists "provider reads own weekly schedule" on public.weekly_schedule;
create policy "provider reads own weekly schedule"
  on public.weekly_schedule for select to authenticated
  using (exists (
    select 1 from public.provider_profiles p
    where p.id = provider_id and p.user_id = auth.uid() and p.deleted_at is null
  ));

-- Replaces the provider's weekly schedule atomically and materializes 120 days
-- of working windows because the existing booking RPC validates availability rows.
create or replace function public.luni_save_weekly_schedule(p_windows jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_provider public.provider_profiles%rowtype;
  v_item jsonb;
  v_weekday integer;
  v_start time;
  v_end time;
  v_day date;
  v_zone constant text := 'America/Havana';
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if jsonb_typeof(p_windows) <> 'array' then
    raise exception 'INVALID_SCHEDULE' using errcode = '22023';
  end if;
  select * into v_provider from public.provider_profiles
  where user_id = auth.uid() and deleted_at is null for update;
  if not found then raise exception 'PROVIDER_REQUIRED' using errcode = 'P0001'; end if;

  for v_item in select value from jsonb_array_elements(p_windows)
  loop
    begin
      v_weekday := (v_item->>'weekday')::integer;
      v_start := (v_item->>'start')::time;
      v_end := (v_item->>'end')::time;
    exception when others then
      raise exception 'INVALID_SCHEDULE' using errcode = '22023';
    end;
    if v_weekday not between 1 and 7 or v_start is null or v_end is null or v_end <= v_start then
      raise exception 'INVALID_SCHEDULE' using errcode = '22023';
    end if;
  end loop;

  if exists (
    select 1
    from jsonb_array_elements(p_windows) a(value)
    join jsonb_array_elements(p_windows) b(value)
      on (a.value->>'weekday')::integer = (b.value->>'weekday')::integer
     and a.value <> b.value
    where (a.value->>'start')::time < (b.value->>'end')::time
      and (a.value->>'end')::time > (b.value->>'start')::time
  ) then
    raise exception 'OVERLAPPING_WINDOWS' using errcode = '22023';
  end if;

  delete from public.weekly_schedule where provider_id = v_provider.id;
  insert into public.weekly_schedule(provider_id, weekday, start_time, end_time)
  select v_provider.id, (value->>'weekday')::integer,
         (value->>'start')::time, (value->>'end')::time
  from jsonb_array_elements(p_windows);

  -- Only regenerate future working-hour rows; preserve day blocks and exceptions.
  delete from public.availability
  where provider_id = v_provider.id
    and kind = 'working_hours'
    and starts_at >= (now() at time zone v_zone)::date::timestamp at time zone v_zone;

  for v_day in
    select d::date
    from generate_series(
      (now() at time zone v_zone)::date::timestamp,
      ((now() at time zone v_zone)::date + 120)::timestamp,
      interval '1 day'
    ) d
  loop
    insert into public.availability(provider_id, starts_at, ends_at, kind, status)
    select v_provider.id,
           (v_day + w.start_time) at time zone v_zone,
           (v_day + w.end_time) at time zone v_zone,
           'working_hours', 'active'
    from public.weekly_schedule w
    where w.provider_id = v_provider.id
      and w.weekday = extract(isodow from v_day)::integer
      and (v_day + w.end_time) at time zone v_zone > now();
  end loop;
end;
$fn$;

create or replace function public.luni_available_slots(
  p_provider_id uuid,
  p_service_id uuid,
  p_day date
)
returns table(starts_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_duration integer;
  v_zone constant text := 'America/Havana';
  v_day_start timestamptz;
  v_day_end timestamptz;
begin
  if p_day is null or p_day < (now() at time zone v_zone)::date then
    return;
  end if;
  select s.duration_minutes into v_duration
  from public.services s
  join public.provider_profiles p on p.id = s.provider_id
  where s.id = p_service_id and s.provider_id = p_provider_id
    and s.is_active and s.deleted_at is null
    and p.is_published and p.deleted_at is null
    and (
      (p.license_status in ('active','grace') and p.license_expires_at > now())
      or (p.license_status = 'trial' and p.trial_started_at +
        make_interval(days => coalesce((select (value #>> '{}')::integer from public.app_settings where key='license_trial_days'),14)) > now())
    );
  if v_duration is null then return; end if;

  v_day_start := (p_day::timestamp) at time zone v_zone;
  v_day_end := ((p_day + 1)::timestamp) at time zone v_zone;

  return query
  select slots.slot
  from public.weekly_schedule w
  cross join lateral generate_series(
    (p_day + w.start_time) at time zone v_zone,
    ((p_day + w.end_time) at time zone v_zone) - make_interval(mins => v_duration),
    interval '30 minutes'
  ) as slots(slot)
  where w.provider_id = p_provider_id
    and w.weekday = extract(isodow from p_day)::integer
    and slots.slot > now()
    and slots.slot + make_interval(mins => v_duration) <= v_day_end
    and not exists (
      select 1 from public.availability a
      where a.provider_id = p_provider_id and a.kind = 'block' and a.status = 'active'
        and tstzrange(a.starts_at, a.ends_at, '[)') &&
            tstzrange(slots.slot, slots.slot + make_interval(mins => v_duration), '[)')
    )
    and not exists (
      select 1 from public.appointments a
      where a.provider_id = p_provider_id and a.status in ('pending_confirmation','confirmed')
        and a.deleted_at is null
        and tstzrange(a.starts_at, a.ends_at, '[)') &&
            tstzrange(slots.slot, slots.slot + make_interval(mins => v_duration), '[)')
    )
  order by slots.slot;
end;
$fn$;

create or replace function public.luni_available_days(
  p_provider_id uuid,
  p_service_id uuid,
  p_from date,
  p_days integer default 14
)
returns table(day date, slots integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_day date;
  v_count integer;
begin
  if p_from is null or p_days is null or p_days < 1 or p_days > 60 then
    raise exception 'INVALID_DAY' using errcode = '22023';
  end if;
  for v_day in
    select d::date from generate_series(p_from::timestamp, (p_from + p_days - 1)::timestamp, interval '1 day') d
  loop
    select count(*)::integer into v_count
    from public.luni_available_slots(p_provider_id, p_service_id, v_day) s;
    if v_count > 0 then
      day := v_day;
      slots := v_count;
      return next;
    end if;
  end loop;
end;
$fn$;

create or replace function public.luni_block_day(p_day date)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_provider public.provider_profiles%rowtype;
  v_zone constant text := 'America/Havana';
  v_start timestamptz;
  v_end timestamptz;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  if p_day is null or p_day < (now() at time zone v_zone)::date then
    raise exception 'INVALID_DAY' using errcode = '22023';
  end if;
  select * into v_provider from public.provider_profiles
  where user_id = auth.uid() and deleted_at is null for update;
  if not found then raise exception 'PROVIDER_REQUIRED' using errcode = 'P0001'; end if;
  v_start := (p_day::timestamp) at time zone v_zone;
  v_end := ((p_day + 1)::timestamp) at time zone v_zone;
  if exists (
    select 1 from public.availability a
    where a.provider_id = v_provider.id and a.kind = 'block' and a.status = 'active'
      and a.starts_at = v_start and a.ends_at = v_end
  ) then return; end if;
  insert into public.availability(provider_id, starts_at, ends_at, kind, status)
  values (v_provider.id, v_start, v_end, 'block', 'active');
end;
$fn$;

revoke all on function public.luni_save_weekly_schedule(jsonb) from public;
revoke all on function public.luni_available_slots(uuid, uuid, date) from public;
revoke all on function public.luni_available_days(uuid, uuid, date, integer) from public;
revoke all on function public.luni_block_day(date) from public;
grant execute on function public.luni_save_weekly_schedule(jsonb) to authenticated;
grant execute on function public.luni_available_slots(uuid, uuid, date) to anon, authenticated;
grant execute on function public.luni_available_days(uuid, uuid, date, integer) to anon, authenticated;
grant execute on function public.luni_block_day(date) to authenticated;

commit;
