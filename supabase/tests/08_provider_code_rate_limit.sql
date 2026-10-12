-- 08: la limitación de intentos queda persistida incluso cuando se alcanza el límite.
\set ON_ERROR_STOP off
\set U '81080000-0000-0000-0000-000000000001'
insert into auth.users(id, email) values (:'U', 'rate-limit@t');

create temporary table rate_limit_results (
  preview_first_30 boolean,
  preview_31st_denied boolean,
  preview_count integer,
  accept_first_8 boolean,
  accept_9th_denied boolean,
  accept_count integer
);

do $$
declare
  i integer;
  v_ok boolean;
  v_preview_all boolean := true;
  v_accept_all boolean := true;
  v_preview_31 boolean;
  v_accept_9 boolean;
  v_preview_count integer;
  v_accept_count integer;
begin
  perform set_config('request.jwt.claim.sub', '81080000-0000-0000-0000-000000000001', false);

  for i in 1..30 loop
    v_ok := public.luni_take_provider_code_attempt('preview');
    if not v_ok then v_preview_all := false; end if;
  end loop;
  v_preview_31 := public.luni_take_provider_code_attempt('preview');
  select attempts into v_preview_count
  from public.provider_code_attempt_limits
  where user_id = auth.uid()
    and action = 'preview'
    and window_start = to_timestamp(floor(extract(epoch from now()) / 900) * 900);

  for i in 1..8 loop
    v_ok := public.luni_take_provider_code_attempt('accept');
    if not v_ok then v_accept_all := false; end if;
  end loop;
  v_accept_9 := public.luni_take_provider_code_attempt('accept');
  select attempts into v_accept_count
  from public.provider_code_attempt_limits
  where user_id = auth.uid()
    and action = 'accept'
    and window_start = to_timestamp(floor(extract(epoch from now()) / 900) * 900);

  insert into rate_limit_results values (
    v_preview_all, not v_preview_31, v_preview_count,
    v_accept_all, not v_accept_9, v_accept_count
  );
end $$;

select test.t('permite 30 vistas previas y rechaza la número 31',
  (select preview_first_30 and preview_31st_denied and preview_count = 31 from rate_limit_results));
select test.t('permite 8 vinculaciones y rechaza la número 9',
  (select accept_first_8 and accept_9th_denied and accept_count = 9 from rate_limit_results));
