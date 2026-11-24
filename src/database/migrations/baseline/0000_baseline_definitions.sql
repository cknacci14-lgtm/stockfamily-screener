-- BASELINE DEFINISI SKEMA SUPABASE (diambil 24 Nov 2026 via pg_get_functiondef/pg_get_viewdef/pg_get_triggerdef)
-- DOKUMENTASI SAJA: jangan dijalankan ulang apa adanya. Ekspor melewati penampil tabel, jadi pemisah baris dipulihkan secara otomatis;
-- bandingkan dengan definisi asli di Supabase sebelum dipakai untuk membangun ulang database.
-- Tabel dan kolom: lihat docs/CHARTNALIST_DATA_DICTIONARY.md.

-- ===== FUNCTIONS =====
-- audit.refresh_all()
CREATE OR REPLACE FUNCTION audit.refresh_all()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
  perform set_config('statement_timeout', '30min', true);
  refresh materialized view audit.mv_daily;
  refresh materialized view audit.mv_rank;
  refresh materialized view audit.mv_features;
end;
$function$;

-- audit.refresh_if_stale()
CREATE OR REPLACE FUNCTION audit.refresh_if_stale()
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare
  v_mv date; v_raw date; v_n int; v_prev int;
begin
  select max(trade_date) into v_mv  from audit.mv_features;
  select max(trade_date) into v_raw from public.daily_stock_data;

  if v_raw is null or (v_mv is not null and v_raw <= v_mv) then
    return 'skip: sudah terbaru (' || coalesce(v_mv::text, '-') || ')';
  end if;

  select count(*) into v_n from public.daily_stock_data where trade_date = v_raw;
  select count(*) into v_prev from public.daily_stock_data
   where trade_date = (select max(trade_date) from public.daily_stock_data where trade_date < v_raw);

  if v_prev > 0 and v_n < 0.95 * v_prev then
    return 'skip: data ' || v_raw || ' belum lengkap (' || v_n || ' dari ' || v_prev || ')';
  end if;

  perform audit.refresh_all();
  return 'refreshed sampai ' || v_raw;
end;
$function$;

-- public.admin_activate_subscription(p_subscription_id uuid, p_duration_days integer, p_amount numeric, p_provider text, p_provider_reference text, p_metadata jsonb)
CREATE OR REPLACE FUNCTION public.admin_activate_subscription(p_subscription_id uuid, p_duration_days integer, p_amount numeric DEFAULT NULL::numeric, p_provider text DEFAULT 'manual'::text, p_provider_reference text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_subscription public.subscriptions%ROWTYPE;
    v_started_at timestamptz;
    v_expires_at timestamptz;
    v_feature text;
BEGIN
    -- Validate input before any mutation.
    IF p_duration_days IS NULL OR p_duration_days <= 0 THEN
        RAISE EXCEPTION 'durationDays must be a positive integer';
    END IF;

    IF p_amount IS NOT NULL AND p_amount < 0 THEN
        RAISE EXCEPTION 'amount cannot be negative';
    END IF;

    IF p_provider IS NULL OR btrim(p_provider) = '' THEN
        RAISE EXCEPTION 'provider is required';
    END IF;

    IF p_metadata IS NULL
       OR jsonb_typeof(p_metadata) <> 'object' THEN
        RAISE EXCEPTION 'metadata must be a JSON object';
    END IF;

    -- Lock the row to prevent concurrent activation.
    SELECT *
      INTO v_subscription
      FROM public.subscriptions
     WHERE id = p_subscription_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Subscription not found';
    END IF;

    IF v_subscription.status <> 'pending'
       OR v_subscription.plan <> 'premium' THEN
        RAISE EXCEPTION
            'Only pending premium subscriptions can be activated';
    END IF;

    v_started_at := clock_timestamp();
    v_expires_at :=
        v_started_at + make_interval(days => p_duration_days);

    -- Activate subscription.
    UPDATE public.subscriptions
       SET plan = 'premium',
           status = 'active',
           started_at = v_started_at,
           expires_at = v_expires_at,
           provider = p_provider,
           provider_reference = p_provider_reference,
           updated_at = v_started_at
     WHERE id = p_subscription_id;

    -- Grant both Premium features.
    FOREACH v_feature IN ARRAY
        ARRAY['signals', 'signal_performance']::text[]
    LOOP
        INSERT INTO public.entitlements (
            user_id,
            feature,
            enabled,
            starts_at,
            expires_at,
            updated_at
        )
        VALUES (
            v_subscription.user_id,
            v_feature,
            true,
            v_started_at,
            v_expires_at,
            v_started_at
        )
        ON CONFLICT (user_id, feature)
        DO UPDATE SET
            enabled = true,
            starts_at = EXCLUDED.starts_at,
            expires_at = EXCLUDED.expires_at,
            updated_at = EXCLUDED.updated_at;

        INSERT INTO public.billing_events (
            user_id,
            subscription_id,
            event_type,
            status,
            provider,
            provider_reference,
            metadata
        )
        VALUES (
            v_subscription.user_id,
            p_subscription_id,
            'entitlement_granted',
            'success',
            p_provider,
            p_provider_reference,
            jsonb_build_object('feature', v_feature)
        );
    END LOOP;

    -- Record activation.
    INSERT INTO public.billing_events (
        user_id,
        subscription_id,
        event_type,
        status,
        provider,
        provider_reference,
        metadata
    )
    VALUES (
        v_subscription.user_id,
        p_subscription_id,
        'subscription_activated',
        'success',
        p_provider,
        p_provider_reference,
        p_metadata || jsonb_build_object(
            'durationDays', p_duration_days,
            'expiresAt', v_expires_at
        )
    );

    -- Record payment confirmation and amount once.
    INSERT INTO public.billing_events (
        user_id,
        subscription_id,
        event_type,
        status,
        amount,
        currency,
        provider,
        provider_reference,
        metadata
    )
    VALUES (
        v_subscription.user_id,
        p_subscription_id,
        'payment_confirmed',
        'success',
        p_amount,
        'IDR',
        p_provider,
        p_provider_reference,
        p_metadata
    );

    RETURN jsonb_build_object(
        'success', true,
        'subscriptionId', p_subscription_id,
        'userId', v_subscription.user_id,
        'status', 'active',
        'startedAt', v_started_at,
        'expiresAt', v_expires_at,
        'features', jsonb_build_array(
            'signals',
            'signal_performance'
        )
    );
END;
$function$;

-- public.admin_create_pending_subscription(p_user_id uuid, p_duration_days integer, p_amount numeric, p_provider text, p_provider_reference text, p_metadata jsonb)
CREATE OR REPLACE FUNCTION public.admin_create_pending_subscription(p_user_id uuid, p_duration_days integer, p_amount numeric DEFAULT NULL::numeric, p_provider text DEFAULT 'manual'::text, p_provider_reference text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_subscription public.subscriptions%ROWTYPE;
    v_event_id uuid;
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'userId is required';
    END IF;

    IF p_duration_days IS NULL OR p_duration_days <= 0 THEN
        RAISE EXCEPTION 'durationDays must be a positive integer';
    END IF;

    IF p_amount IS NOT NULL AND p_amount < 0 THEN
        RAISE EXCEPTION 'amount cannot be negative';
    END IF;

    IF p_provider IS NULL OR btrim(p_provider) = '' THEN
        RAISE EXCEPTION 'provider is required';
    END IF;

    IF p_provider_reference IS NOT NULL
       AND length(p_provider_reference) > 255 THEN
        RAISE EXCEPTION 'providerReference must be at most 255 characters';
    END IF;

    IF p_metadata IS NULL
       OR jsonb_typeof(p_metadata) <> 'object' THEN
        RAISE EXCEPTION 'metadata must be a JSON object';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE id = p_user_id
    ) THEN
        RAISE EXCEPTION 'User profile not found';
    END IF;

    INSERT INTO public.subscriptions (
        user_id,
        plan,
        status,
        provider,
        provider_reference
    )
    VALUES (
        p_user_id,
        'premium',
        'pending',
        p_provider,
        p_provider_reference
    )
    RETURNING * INTO v_subscription;

    INSERT INTO public.billing_events (
        user_id,
        subscription_id,
        event_type,
        status,
        amount,
        currency,
        provider,
        provider_reference,
        metadata
    )
    VALUES (
        p_user_id,
        v_subscription.id,
        'subscription_created',
        'recorded',
        p_amount,
        'IDR',
        p_provider,
        p_provider_reference,
        p_metadata || jsonb_build_object(
            'durationDays', p_duration_days
        )
    )
    RETURNING id INTO v_event_id;

    RETURN jsonb_build_object(
        'success', true,
        'subscriptionId', v_subscription.id,
        'userId', p_user_id,
        'plan', 'premium',
        'status', 'pending',
        'eventId', v_event_id
    );
END;
$function$;

-- public.admin_forward_summary()
CREATE OR REPLACE FUNCTION public.admin_forward_summary()
 RETURNS json
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with uni as (
    select log_date, avg(ret_5d) as a5, avg(ret_10d) as a10
    from verdict_forward_log where verdict = 'UNIVERSE' group by log_date
  ),
  bbase as (
    select log_date, avg(ret_5d) as a5, avg(ret_10d) as a10
    from verdict_forward_log where verdict = 'BROKER_BASE' group by log_date
  ),
  sig as (
    select l.verdict, l.ret_5d, l.ret_10d,
           case when l.verdict in ('BROKER_ACC', 'BROKER_DIST') then b.a5 else u.a5 end as a5,
           case when l.verdict in ('BROKER_ACC', 'BROKER_DIST') then b.a10 else u.a10 end as a10
    from verdict_forward_log l
    left join uni u on u.log_date = l.log_date
    left join bbase b on b.log_date = l.log_date
    where l.verdict in ('BREAKOUT_ASING', 'BREAKDOWN', 'BROKER_ACC', 'BROKER_DIST', 'QBS_PULLBACK_V18')
  )
  select json_build_object(
    'days', (select count(distinct log_date) from verdict_forward_log),
    'last_log_date', (select max(log_date) from verdict_forward_log),
    'summary', (select coalesce(json_agg(r), '[]'::json) from (
      select verdict, 5 as horizon, count(ret_5d) as n,
             round(100.0 * count(*) filter (where ret_5d > 0) / nullif(count(ret_5d), 0), 1) as up_pct,
             round(100 * avg(ret_5d)::numeric, 2) as avg_pct,
             round(100 * avg(ret_5d - a5)::numeric, 2) as vs_universe_pp
      from sig group by verdict
      union all
      select verdict, 10, count(ret_10d),
             round(100.0 * count(*) filter (where ret_10d > 0) / nullif(count(ret_10d), 0), 1),
             round(100 * avg(ret_10d)::numeric, 2),
             round(100 * avg(ret_10d - a10)::numeric, 2)
      from sig group by verdict
    ) r),
    'latest', (select coalesce(json_agg(r), '[]'::json) from (
      select stock_code, verdict, ref_close, round(foreign_ratio_20d::numeric, 3) as foreign_ratio, avg_value_20d
      from verdict_forward_log
      where log_date = (select max(log_date) from verdict_forward_log)
        and verdict in ('BREAKOUT_ASING', 'BREAKDOWN', 'BROKER_ACC', 'BROKER_DIST', 'QBS_PULLBACK_V18')
      order by verdict, avg_value_20d desc
    ) r)
  );
$function$;

-- public.admin_monitor_stats()
CREATE OR REPLACE FUNCTION public.admin_monitor_stats()
 RETURNS json
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  with t as (select (date_trunc('day', now() at time zone 'Asia/Jakarta')) at time zone 'Asia/Jakarta' as d0)
  select json_build_object(
    'generated_at', now(),
    'total_users', (select count(*) from auth.users),
    'new_users_7d', (select count(*) from auth.users where created_at >= now() - interval '7 days'),
    'views_today', (select count(*) from page_views, t where viewed_at >= t.d0),
    'views_7d', (select count(*) from page_views where viewed_at >= now() - interval '7 days'),
    'views_30d', (select count(*) from page_views where viewed_at >= now() - interval '30 days'),
    'visitors_today', (select count(distinct session_id) from page_views, t where viewed_at >= t.d0),
    'visitors_7d', (select count(distinct session_id) from page_views where viewed_at >= now() - interval '7 days'),
    'visitors_30d', (select count(distinct session_id) from page_views where viewed_at >= now() - interval '30 days'),
    'active_users_1d', (select count(distinct user_id) from page_views where user_id is not null and viewed_at >= now() - interval '1 day'),
    'active_users_7d', (select count(distinct user_id) from page_views where user_id is not null and viewed_at >= now() - interval '7 days'),
    'active_users_30d', (select count(distinct user_id) from page_views where user_id is not null and viewed_at >= now() - interval '30 days'),
    'daily', (select coalesce(json_agg(x order by x.day), '[]'::json) from (
      select (viewed_at at time zone 'Asia/Jakarta')::date as day, count(*) as views,
             count(distinct session_id) as visitors,
             count(distinct user_id) filter (where user_id is not null) as users
      from page_views where viewed_at >= now() - interval '14 days' group by 1) x),
    'top_pages', (select coalesce(json_agg(x), '[]'::json) from (
      select path, count(*) as views, count(distinct session_id) as visitors
      from page_views where viewed_at >= now() - interval '7 days'
      group by path order by views desc limit 10) x)
  );
$function$;

-- public.api_usage_add(p_provider text, p_n integer)
CREATE OR REPLACE FUNCTION public.api_usage_add(p_provider text, p_n integer)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into api_usage(day, provider, count)
  values ((now() at time zone 'Asia/Jakarta')::date, p_provider, p_n)
  on conflict (day, provider) do update set count = api_usage.count + p_n
  returning count;
$function$;

-- public.broker_radar_latest(p_min_value numeric, p_n integer)
CREATE OR REPLACE FUNCTION public.broker_radar_latest(p_min_value numeric DEFAULT '25000000000'::bigint, p_n integer DEFAULT 5)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with d as (select max(trade_date) as dt from broker_summary_daily),
  base as (
    select b.stock_code, b.total_value, b.top3_buy_net, b.top3_sell_net,
           (b.top3_buy_net + b.top3_sell_net) / b.total_value * 100 as score,
           b.top_buyers -> 0 as tb, b.top_sellers -> 0 as ts
    from broker_summary_daily b join d on b.trade_date = d.dt
    where b.total_value >= p_min_value
  ),
  acc as (select * from base where score > 0 order by score desc limit p_n),
  dist as (select * from base where score < 0 order by score asc limit p_n)
  select json_build_object(
    'date', (select dt from d),
    'universe', (select count(*) from base),
    'acc', (select coalesce(json_agg(a order by a.score desc), '[]'::json) from (
      select stock_code, round(score::numeric, 2) as score, total_value, top3_buy_net, top3_sell_net,
             tb ->> 'c' as top_buyer, ts ->> 'c' as top_seller from acc) a),
    'dist', (select coalesce(json_agg(a order by a.score asc), '[]'::json) from (
      select stock_code, round(score::numeric, 2) as score, total_value, top3_buy_net, top3_sell_net,
             tb ->> 'c' as top_buyer, ts ->> 'c' as top_seller from dist) a)
  );
$function$;

-- public.capture_chartnalist_liquid_gainer_snapshot_v1(p_target_date date)
CREATE OR REPLACE FUNCTION public.capture_chartnalist_liquid_gainer_snapshot_v1(p_target_date date)
 RETURNS TABLE(result_status text, out_signal_date date, out_target_date date, snapshot_rows integer)
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_signal_date date;

    v_source_rows bigint;
    v_unique_tickers bigint;
    v_momentum_rows bigint;
    v_discovery_rows bigint;

    v_existing_rows bigint;
    v_existing_target_min date;
    v_existing_target_max date;

    v_saved_rows integer;
BEGIN
    SELECT MAX(d.trade_date)
    INTO v_signal_date
    FROM public.daily_stock_data d;

    IF v_signal_date IS NULL THEN
        RETURN QUERY
        SELECT 'NO_DATA'::text, NULL::date, p_target_date, 0;
        RETURN;
    END IF;

    IF p_target_date IS NULL
       OR p_target_date <= v_signal_date THEN
        RETURN QUERY
        SELECT
            'INVALID_TARGET_DATE'::text,
            v_signal_date,
            p_target_date,
            0;
        RETURN;
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtext('chartnalist_liquid_gainer_snapshot_v1'),
        hashtext(v_signal_date::text)
    );

    SELECT
        COUNT(*),
        COUNT(DISTINCT UPPER(BTRIM(v.ticker))),
        COUNT(*) FILTER (
            WHERE v.model_lane = 'MOMENTUM_CONTINUATION'
        ),
        COUNT(*) FILTER (
            WHERE v.model_lane = 'EARLY_DISCOVERY'
        )
    INTO
        v_source_rows,
        v_unique_tickers,
        v_momentum_rows,
        v_discovery_rows
    FROM public.chartnalist_liquid_gainer_predictions_v1 v
    WHERE v.signal_date = v_signal_date
      AND v.model_version = '1.0.0-shadow';

    IF v_source_rows <> 20
       OR v_unique_tickers <> 20
       OR v_momentum_rows <> 10
       OR v_discovery_rows <> 10 THEN
        RETURN QUERY
        SELECT
            'SOURCE_NOT_READY'::text,
            v_signal_date,
            p_target_date,
            v_source_rows::integer;
        RETURN;
    END IF;

    SELECT
        COUNT(*),
        MIN(s.target_date),
        MAX(s.target_date)
    INTO
        v_existing_rows,
        v_existing_target_min,
        v_existing_target_max
    FROM public.chartnalist_liquid_gainer_snapshots_v1 s
    WHERE s.signal_date = v_signal_date
      AND s.model_version = '1.0.0-shadow';

    IF v_existing_rows > 0 THEN
        IF v_existing_rows = 20
           AND v_existing_target_min = p_target_date
           AND v_existing_target_max = p_target_date THEN
            RETURN QUERY
            SELECT
                'ALREADY_SAVED'::text,
                v_signal_date,
                p_target_date,
                v_existing_rows::integer;
        ELSE
            RETURN QUERY
            SELECT
                'EXISTING_SNAPSHOT_CHECK'::text,
                v_signal_date,
                p_target_date,
                v_existing_rows::integer;
        END IF;

        RETURN;
    END IF;

    INSERT INTO public.chartnalist_liquid_gainer_snapshots_v1 (
        signal_date,
        target_date,
        model_version,
        final_rank,
        model_lane,
        lane_rank,
        ticker,
        close_price,
        return_1d_pct,
        return_3d_pct,
        volume,
        daily_value,
        volume_ratio_20,
        value_ratio_20,
        momentum_score,
        discovery_score,
        selected_score
    )
    SELECT
        v.signal_date,
        p_target_date,
        v.model_version,
        v.final_rank,
        v.model_lane,
        v.lane_rank,
        UPPER(BTRIM(v.ticker)),
        v.close_price,
        v.return_1d_pct,
        v.return_3d_pct,
        v.volume,
        v.daily_value,
        v.volume_ratio_20,
        v.value_ratio_20,
        v.momentum_score,
        v.discovery_score,
        v.selected_score
    FROM public.chartnalist_liquid_gainer_predictions_v1 v
    WHERE v.signal_date = v_signal_date
      AND v.model_version = '1.0.0-shadow'
    ON CONFLICT (
        signal_date,
        model_version,
        ticker
    ) DO NOTHING;

    GET DIAGNOSTICS v_saved_rows = ROW_COUNT;

    IF v_saved_rows = 20 THEN
        RETURN QUERY
        SELECT
            'SAVED'::text,
            v_signal_date,
            p_target_date,
            v_saved_rows;
    ELSE
        RAISE EXCEPTION
            'Snapshot insert mismatch: signal_date=%, target_date=%, inserted_rows=%, expected=20',
            v_signal_date,
            p_target_date,
            v_saved_rows;
    END IF;

    RETURN;
END;
$function$;

-- public.cn_forward_log_run()
CREATE OR REPLACE FUNCTION public.cn_forward_log_run()
 RETURNS TABLE(dicatat integer, dievaluasi integer)
 LANGUAGE plpgsql
AS $function$
declare
  v_ins integer;
  v_upd integer;
begin
  insert into cn_screener_forward_log
    (signal_date, code, rule, lane, naik_pct, nilai_miliar, rvol, clv,
     rank_hari_ini, top20_5hari, risiko_suspensi)
  select s.signal_date, s.code, s.rule, s.lane, s.naik_pct, s.nilai_miliar,
         s.rvol, s.clv, s.rank_hari_ini, s.top20_5hari, s.risiko_suspensi
  from cn_screener() s
  on conflict (signal_date, code, rule) do nothing;
  get diagnostics v_ins = row_count;

  with todo as (
    select distinct l.signal_date, l.code,
           (select min(d.trade_date) from daily_stock_data d
             where d.trade_date > l.signal_date) as nd
    from cn_screener_forward_log l
    where l.evaluated_at is null
  ),
  ready as (select * from todo where nd is not null),
  day_rank as (
    select s.trade_date as d, st.code, s.close, s.previous_price as pc,
           rank() over (partition by s.trade_date
                        order by (s.close / s.previous_price - 1) desc) as rk
    from daily_stock_data s
    join stocks st on st.id = s.stock_id
    where s.trade_date in (select nd from ready)
      and s.close > 0 and s.previous_price > 0
      and s.value >= 500000000 and s.frequency >= 100
  )
  update cn_screener_forward_log l
  set target_date       = r.nd,
      masuk_top20_besok = coalesce(dr.rk <= 20 and dr.close > dr.pc, false),
      suspensi_besok    = coalesce(n.volume = 0 or n.frequency = 0, false),
      ret_besok_pct     = round(100 * (n.close / nullif(c.close, 0) - 1), 2),
      evaluated_at      = now()
  from ready r
  left join stocks st on st.code = r.code
  left join daily_stock_data n on n.stock_id = st.id and n.trade_date = r.nd
  left join daily_stock_data c on c.stock_id = st.id and c.trade_date = r.signal_date
  left join day_rank dr on dr.d = r.nd and dr.code = r.code
  where l.signal_date = r.signal_date
    and l.code = r.code
    and l.evaluated_at is null;
  get diagnostics v_upd = row_count;

  return query select v_ins, v_upd;
end;
$function$;

-- public.cn_riwayat_refresh()
CREATE OR REPLACE FUNCTION public.cn_riwayat_refresh()
 RETURNS TABLE(pick integer, hari integer)
 LANGUAGE plpgsql
AS $function$
declare
  v_all  date[];
  v_redo date[];
  v_pick integer;
  v_hari integer;
begin
  select coalesce(array_agg(x order by x desc), '{}') into v_all from cn_riwayat_tanggal(15) x;
  if cardinality(v_all) = 0 then
    return query select 0, 0;
    return;
  end if;

  select coalesce(array_agg(t.d), '{}') into v_redo
  from unnest(v_all) with ordinality as t(d, n)
  where t.n <= 3
     or not exists (select 1 from cn_screener_riwayat_hari h where h.d = t.d)
     or exists (select 1 from cn_screener_riwayat r where r.signal_date = t.d and r.target_date is null);

  with fresh as materialized (
    select * from cn_screener_history_d(v_redo)
  ), del as (
    delete from cn_screener_riwayat
    where signal_date = any(v_redo) or signal_date < v_all[cardinality(v_all)]
    returning 1
  )
  insert into cn_screener_riwayat
    (signal_date, code, rule, lane, naik_pct, nilai_miliar, risiko_suspensi,
     target_date, masuk_top20_besok, suspensi_besok, ret_besok_pct)
  select signal_date, code, rule, lane, naik_pct, nilai_miliar, risiko_suspensi,
         target_date, masuk_top20_besok, suspensi_besok, ret_besok_pct
  from fresh;

  delete from cn_screener_riwayat_hari where d <> all(v_all);
  insert into cn_screener_riwayat_hari (d) select unnest(v_all) on conflict do nothing;

  select count(*) into v_pick from cn_screener_riwayat;
  select count(*) into v_hari from cn_screener_riwayat_hari;
  return query select v_pick, v_hari;
end;
$function$;

-- public.cn_riwayat_tanggal(p_hari integer)
CREATE OR REPLACE FUNCTION public.cn_riwayat_tanggal(p_hari integer DEFAULT 15)
 RETURNS SETOF date
 LANGUAGE sql
 STABLE
AS $function$
  select distinct trade_date from daily_stock_data
  order by trade_date desc limit greatest(least(coalesce(p_hari, 15), 30), 1);
$function$;

-- public.cn_screener(p_date date)
CREATE OR REPLACE FUNCTION public.cn_screener(p_date date DEFAULT NULL::date)
 RETURNS TABLE(signal_date date, code text, rule text, lane text, naik_pct numeric, nilai_miliar numeric, freq bigint, rvol numeric, clv numeric, rank_hari_ini bigint, top20_5hari bigint, atr20_pct numeric, risiko_suspensi boolean, catatan text)
 LANGUAGE sql
 STABLE
AS $function$
with p as (
  select coalesce(p_date, (select max(trade_date) from daily_stock_data)) as d_to
),
raw as (
  select st.code,
         s.trade_date as d,
         s.high, s.low, s.close,
         s.previous_price as pc,
         s.value as val,
         s.frequency as freq,
         (s.high - s.low) / nullif(s.previous_price, 0) as rng
  from daily_stock_data s
  join stocks st on st.id = s.stock_id
  cross join p
  where s.trade_date between p.d_to - 45 and p.d_to
    and s.close > 0 and s.previous_price > 0
),
w1 as (
  select r.*,
    avg(val) over (partition by code order by d rows between 20 preceding and 1 preceding) as avg_val20,
    avg(rng) over (partition by code order by d rows between 20 preceding and 1 preceding) as atr20,
    max(high) over (partition by code order by d rows between 19 preceding and current row) as hi20
  from raw r
),
w2 as (
  select w1.*,
         close / pc - 1 as pct,
         (val >= 500000000 and freq >= 100) as liquid
  from w1
),
w3 as (
  select w2.*,
    case when liquid
         then rank() over (partition by d, liquid order by pct desc)
    end as rk
  from w2
),
w4 as (
  select w3.*, (liquid and rk <= 20 and pct > 0) as is_top20
  from w3
),
w5 as (
  select w4.*,
    coalesce(sum(is_top20::int) over (partition by code order by d
             rows between 5 preceding and 1 preceding), 0) as top20_cnt5
  from w4
),
w6 as (
  select w5.*,
         val / nullif(avg_val20, 0)          as rvol,
         (close - low) / nullif(high - low, 0) as clv,
         close / nullif(hi20, 0) - 1         as dist_hi20
  from w5
)
select a.d::date,
       a.code::text,
       v.rule::text,
       v.lane::text,
       round((a.pct * 100)::numeric, 1),
       round((a.val / 1e9)::numeric, 1),
       a.freq::bigint,
       round(a.rvol::numeric, 1),
       round(a.clv::numeric, 2),
       a.rk::bigint,
       a.top20_cnt5::bigint,
       round((a.atr20 * 100)::numeric, 1),
       (a.pct >= .15 and a.top20_cnt5 >= 2),
       v.catatan::text
from w6 a
cross join p
cross join lateral (values
  ('A_L1', 'A',
     a.is_top20 and a.val >= 5000000000 and a.pct >= .05 and a.clv >= .6
       and a.dist_hi20 >= -.0001 and a.rk <= 20 and a.atr20 <= .02,
     'Perkiraan peluang masuk top 20 besok ~63% (n=35). Eksperimental. Biasanya terkunci ARA: daftar pantau, bukan sinyal beli.'),
  ('A_S2R', 'A',
     a.is_top20 and a.val < 5000000000 and a.pct >= .05 and a.clv >= .6
       and a.dist_hi20 >= -.0001 and a.rk <= 5 and a.top20_cnt5 >= 1
       and not (a.top20_cnt5 >= 2 and a.pct >= .15),
     'Perkiraan peluang masuk top 20 besok ~47% (n=38, sampel kecil). Eksperimental. Biasanya terkunci ARA: daftar pantau.'),
  ('B_L', 'B',
     not a.is_top20 and a.val >= 5000000000 and a.pct >= .03 and a.rvol >= 2.5
       and a.clv >= .85 and a.dist_hi20 >= -.05 and a.atr20 >= .05,
     'Radar: perkiraan peluang ~14% (n=157), sekitar 5x acak tapi 6 dari 7 tetap gagal.')
) v(rule, lane, ok, catatan)
where a.d = p.d_to
  and a.liquid
  and v.ok is true
order by v.lane, v.rule, a.rk;
$function$;

-- public.cn_screener_history(p_hari integer)
CREATE OR REPLACE FUNCTION public.cn_screener_history(p_hari integer DEFAULT 15)
 RETURNS TABLE(signal_date date, code text, rule text, lane text, naik_pct numeric, nilai_miliar numeric, risiko_suspensi boolean, target_date date, masuk_top20_besok boolean, suspensi_besok boolean, ret_besok_pct numeric)
 LANGUAGE sql
 STABLE
AS $function$
  with ds as (
    select distinct trade_date as d from daily_stock_data
    order by d desc limit greatest(least(coalesce(p_hari, 15), 30), 1)
  ),
  picks as (
    select s.signal_date, s.code, s.rule, s.lane, s.naik_pct, s.nilai_miliar, s.risiko_suspensi
    from ds, lateral cn_screener(ds.d) s
  ),
  nxt as (
    select p.*, (select min(x.trade_date) from daily_stock_data x where x.trade_date > p.signal_date) as nd
    from picks p
  ),
  day_rank as (
    select s.trade_date as d, st.code, s.close, s.previous_price as pc,
           rank() over (partition by s.trade_date
                        order by (s.close / s.previous_price - 1) desc) as rk
    from daily_stock_data s
    join stocks st on st.id = s.stock_id
    where s.trade_date in (select nd from nxt where nd is not null)
      and s.close > 0 and s.previous_price > 0
      and s.value >= 500000000 and s.frequency >= 100
  )
  select n.signal_date, n.code, n.rule, n.lane, n.naik_pct::numeric, n.nilai_miliar::numeric,
         n.risiko_suspensi::boolean,
         n.nd,
         case when n.nd is null then null else coalesce(dr.rk <= 20 and dr.close > dr.pc, false) end,
         case when n.nd is null then null else coalesce(nx.volume = 0 or nx.frequency = 0, false) end,
         case when n.nd is null then null else round(100 * (nx.close / nullif(c.close, 0) - 1), 2) end
  from nxt n
  left join stocks st on st.code = n.code
  left join daily_stock_data nx on nx.stock_id = st.id and nx.trade_date = n.nd
  left join daily_stock_data c  on c.stock_id  = st.id and c.trade_date  = n.signal_date
  left join day_rank dr on dr.d = n.nd and dr.code = n.code
  order by n.signal_date desc, n.lane, n.code;
$function$;

-- public.cn_screener_history_d(p_dates date[])
CREATE OR REPLACE FUNCTION public.cn_screener_history_d(p_dates date[])
 RETURNS TABLE(signal_date date, code text, rule text, lane text, naik_pct numeric, nilai_miliar numeric, risiko_suspensi boolean, target_date date, masuk_top20_besok boolean, suspensi_besok boolean, ret_besok_pct numeric)
 LANGUAGE sql
 STABLE
AS $function$
  with ds as (
    select distinct unnest(p_dates) as d
  ),
  picks as (
    select s.signal_date, s.code, s.rule, s.lane, s.naik_pct, s.nilai_miliar, s.risiko_suspensi
    from ds, lateral cn_screener(ds.d) s
  ),
  nxt as (
    select p.*, (select min(x.trade_date) from daily_stock_data x where x.trade_date > p.signal_date) as nd
    from picks p
  ),
  day_rank as (
    select s.trade_date as d, st.code, s.close, s.previous_price as pc,
           rank() over (partition by s.trade_date
                        order by (s.close / s.previous_price - 1) desc) as rk
    from daily_stock_data s
    join stocks st on st.id = s.stock_id
    where s.trade_date in (select nd from nxt where nd is not null)
      and s.close > 0 and s.previous_price > 0
      and s.value >= 500000000 and s.frequency >= 100
  )
  select n.signal_date, n.code, n.rule, n.lane, n.naik_pct::numeric, n.nilai_miliar::numeric,
         n.risiko_suspensi::boolean,
         n.nd,
         case when n.nd is null then null else coalesce(dr.rk <= 20 and dr.close > dr.pc, false) end,
         case when n.nd is null then null else coalesce(nx.volume = 0 or nx.frequency = 0, false) end,
         case when n.nd is null then null else round(100 * (nx.close / nullif(c.close, 0) - 1), 2) end
  from nxt n
  left join stocks st on st.code = n.code
  left join daily_stock_data nx on nx.stock_id = st.id and nx.trade_date = n.nd
  left join daily_stock_data c  on c.stock_id  = st.id and c.trade_date  = n.signal_date
  left join day_rank dr on dr.d = n.nd and dr.code = n.code
  order by n.signal_date desc, n.lane, n.code;
$function$;

-- public.cn_watch_forward_run()
CREATE OR REPLACE FUNCTION public.cn_watch_forward_run()
 RETURNS TABLE(dicatat integer, dievaluasi integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'audit', 'pg_temp'
AS $function$
declare
  v_ins integer;
  v_upd integer;
begin
  -- refresh audit.mv_features TIDAK dilakukan di sini (terlalu berat lewat PostgREST, kena timeout 57014);
  -- itu sudah dijadwalkan lewat pg_cron.

  insert into cn_watch_forward_log
    (signal_date, ticker, aturan, status, is_ara, ret_hari_ini, gainer_rank,
     streak_top, gate_ratio, value_hari_ini, n_dasar, p_top20_besok, p_ara_besok)
  select w.trade_date, w.ticker, w.aturan, w.status, w.is_ara, w.ret_hari_ini, w.gainer_rank,
         w.streak_top, w.gate_ratio, w.value_hari_ini, w.n_dasar, w.p_top20_besok, w.p_ara_besok
  from public.v_watchlist_harian w
  on conflict (signal_date, ticker, aturan) do nothing;
  get diagnostics v_ins = row_count;

  with todo as (
    select distinct l.signal_date, l.ticker,
           (select min(d.trade_date) from daily_stock_data d
             where d.trade_date > l.signal_date) as nd
    from cn_watch_forward_log l
    where l.evaluated_at is null
  ),
  ready as (select * from todo where nd is not null),
  day_rank as (
    select s.trade_date as d, st.code, s.close, s.previous_price as pc,
           rank() over (partition by s.trade_date
                        order by (s.close / s.previous_price - 1) desc) as rk
    from daily_stock_data s
    join stocks st on st.id = s.stock_id
    where s.trade_date in (select nd from ready)
      and s.close > 0 and s.previous_price > 0
      and s.value >= 500000000 and s.frequency >= 100
  )
  update cn_watch_forward_log l
  set target_date       = r.nd,
      masuk_top20_besok = coalesce(dr.rk <= 20 and dr.close > dr.pc, false),
      suspensi_besok    = coalesce(n.volume = 0 or n.frequency = 0, false),
      ret_besok_pct     = round(100 * (n.close / nullif(c.close, 0) - 1), 2),
      evaluated_at      = now()
  from ready r
  left join stocks st on st.code = r.ticker
  left join daily_stock_data n on n.stock_id = st.id and n.trade_date = r.nd
  left join daily_stock_data c on c.stock_id = st.id and c.trade_date = r.signal_date
  left join day_rank dr on dr.d = r.nd and dr.code = r.ticker
  where l.signal_date = r.signal_date
    and l.ticker = r.ticker
    and l.evaluated_at is null;
  get diagnostics v_upd = row_count;

  return query select v_ins, v_upd;
end;
$function$;

-- public.handle_new_user()
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin

  insert into public.profiles (
    id,
    email,
    display_name,
    avatar_url,
    role,
    plan
  )
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      ''
    ),
    coalesce(
      new.raw_user_meta_data ->> 'avatar_url',
      ''
    ),
    'user',
    'free'
  )
  on conflict (id) do nothing;

  return new;
end;
$function$;

-- public.market_period_summary(p_start_date date, p_end_date date)
CREATE OR REPLACE FUNCTION public.market_period_summary(p_start_date date, p_end_date date)
 RETURNS TABLE(code character varying, name text, latest_date date, latest_close numeric, period_high numeric, period_low numeric, foreign_buy numeric, foreign_sell numeric, foreign_net numeric, volume numeric, value numeric, frequency numeric, active_days bigint)
 LANGUAGE sql
 STABLE
AS $function$
  with ranked as (
    select s.code, s.name, d.trade_date, d.close, d.high, d.low, d.foreign_buy, d.foreign_sell, d.volume, d.value, d.frequency,
           row_number() over(partition by s.id order by d.trade_date desc) rn
    from daily_stock_data d join stocks s on s.id=d.stock_id
    where (p_start_date is null or d.trade_date>=p_start_date) and (p_end_date is null or d.trade_date<=p_end_date)
  )
  select code, max(name) name, max(trade_date) latest_date,
         max(close) filter(where rn=1) latest_close, max(high) period_high, min(low) period_low,
         sum(foreign_buy) foreign_buy, sum(foreign_sell) foreign_sell,
         sum(foreign_buy-foreign_sell) foreign_net, sum(volume) volume, sum(value) value, sum(frequency) frequency,
         count(*) filter(where volume>0) active_days
  from ranked group by code order by code;
$function$;

-- public.reject_liquid_gainer_walkforward_mutation()
CREATE OR REPLACE FUNCTION public.reject_liquid_gainer_walkforward_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    RAISE EXCEPTION
        'Walk-forward prediction archive is append-only. Mutation rejected.';
END;
$function$;

-- public.reject_lowvalue_walkforward_mutation()
CREATE OR REPLACE FUNCTION public.reject_lowvalue_walkforward_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    RAISE EXCEPTION
        'Low-value walk-forward archive is append-only. Operation % rejected.',
        TG_OP;
END;
$function$;

-- public.replace_market_snapshot(p_trade_date date, p_filename text, p_rows jsonb)
CREATE OR REPLACE FUNCTION public.replace_market_snapshot(p_trade_date date, p_filename text, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r jsonb; v_stock_id bigint; v_count integer := 0;
begin
  -- Delete the whole date first. This guarantees re-upload of the same date replaces it.
  delete from daily_stock_data where trade_date = p_trade_date;

  for r in select * from jsonb_array_elements(p_rows) loop
    insert into stocks(code, name, remarks, updated_at)
    values (r->>'code', coalesce(r->>'name',''), coalesce(r->>'remarks',''), now())
    on conflict(code) do update set name=excluded.name, remarks=excluded.remarks, updated_at=now()
    returning id into v_stock_id;

    insert into daily_stock_data(
      stock_id, trade_date, previous_price, open, first_trade, high, low, close, change_price,
      volume, value, frequency, index_individual, offer, offer_volume, bid, bid_volume,
      listed_shares, tradeable_shares, weight_for_index, foreign_sell, foreign_buy,
      non_regular_volume, non_regular_value, non_regular_frequency
    ) values (
      v_stock_id, p_trade_date,
      coalesce((r->>'previous_price')::numeric,0), coalesce((r->>'open')::numeric,0), coalesce((r->>'first_trade')::numeric,0),
      coalesce((r->>'high')::numeric,0), coalesce((r->>'low')::numeric,0), coalesce((r->>'close')::numeric,0), coalesce((r->>'change_price')::numeric,0),
      coalesce((r->>'volume')::bigint,0), coalesce((r->>'value')::numeric,0), coalesce((r->>'frequency')::bigint,0),
      coalesce((r->>'index_individual')::numeric,0), coalesce((r->>'offer')::numeric,0), coalesce((r->>'offer_volume')::bigint,0),
      coalesce((r->>'bid')::numeric,0), coalesce((r->>'bid_volume')::bigint,0), coalesce((r->>'listed_shares')::bigint,0),
      coalesce((r->>'tradeable_shares')::bigint,0), coalesce((r->>'weight_for_index')::numeric,0),
      coalesce((r->>'foreign_sell')::bigint,0), coalesce((r->>'foreign_buy')::bigint,0),
      coalesce((r->>'non_regular_volume')::bigint,0), coalesce((r->>'non_regular_value')::numeric,0), coalesce((r->>'non_regular_frequency')::bigint,0)
    );
    v_count := v_count + 1;
  end loop;

  insert into upload_batches(filename, trade_date, row_count, uploaded_at)
  values(p_filename, p_trade_date, v_count, now())
  on conflict(trade_date) do update set filename=excluded.filename, row_count=excluded.row_count, uploaded_at=now();

  return jsonb_build_object('trade_date', p_trade_date, 'rows', v_count, 'replaced', true);
end $function$;

-- public.set_updated_at()
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

-- public.update_updated_at_column()
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

-- ===== VIEWS (view biasa: create or replace; materialized view: lihat catatan) =====
-- audit.mv_daily (materialized view)
create materialized view audit.mv_daily as
 SELECT b.trade_date,
    b.ticker,
    b.stock_id,
    b.previous_price,
    b.close,
    b.volume,
    b.value,
    b.frequency,
    cal.d_idx,
    cal.is_complete,
    cal.prev_date,
    cal.next_date,
    (b.close / b.previous_price - 1::numeric) * 100::numeric AS ret,
        CASE
            WHEN b.previous_price <= 200::numeric THEN 35
            WHEN b.previous_price <= 5000::numeric THEN 25
            ELSE 20
        END AS ara_limit,
    LEAST(b.value / p.min_value, b.frequency / p.min_frequency, b.volume / p.min_volume) AS gate_ratio
   FROM audit.v_base b
     JOIN audit.v_calendar cal USING (trade_date)
     CROSS JOIN audit.params p;

-- audit.mv_features (materialized view)
create materialized view audit.mv_features as
 WITH isl AS (
         SELECT mv_rank.ticker,
            mv_rank.d_idx,
            mv_rank.is_top,
            row_number() OVER (PARTITION BY mv_rank.ticker, mv_rank.is_top ORDER BY mv_rank.d_idx) AS rn
           FROM audit.mv_rank
        ), streak AS (
         SELECT isl.ticker,
            isl.d_idx,
                CASE
                    WHEN isl.is_top THEN row_number() OVER (PARTITION BY isl.ticker, isl.is_top, (isl.d_idx - isl.rn) ORDER BY isl.d_idx)
                    ELSE 0::bigint
                END AS streak_top
           FROM isl
        )
 SELECT r.trade_date,
    r.d_idx,
    r.ticker,
    r.stock_id,
    r.previous_price,
    r.close,
    r.volume,
    r.value,
    r.frequency,
    r.ret,
    r.ara_limit,
    r.gate_ratio,
    r.eligible,
    r.is_ara,
    r.gainer_rank,
    r.is_top,
    r.is_complete,
    p1.trade_date AS prev_date,
        CASE
            WHEN p1.ticker IS NULL THEN 'NO_PREVIOUS_TRADE'::text
            WHEN NOT p1.eligible THEN 'NOT_LIQUID_ELIGIBLE'::text
            WHEN p1.ret <= 0::numeric THEN 'NOT_POSITIVE_GAINER'::text
            WHEN p1.gainer_rank <= (( SELECT params.top_n
               FROM audit.params)) THEN 'PREVIOUS_TOP20'::text
            ELSE 'PREVIOUS_RANK_21_PLUS'::text
        END AS prev_status,
    p1.gainer_rank AS prev_rank,
    p1.ret AS prev_ret,
    p1.value AS prev_value,
    p1.volume AS prev_volume,
    p1.frequency AS prev_frequency,
    p1.gate_ratio AS prev_gate_ratio,
    p1.eligible AS prev_eligible,
    (r.close / c3.close - 1::numeric) * 100::numeric AS ret_3d,
    (r.close / c5.close - 1::numeric) * 100::numeric AS ret_5d,
    (r.close / c10.close - 1::numeric) * 100::numeric AS ret_10d,
    r.ret / r.ara_limit::numeric AS ara_prox,
    r.close / NULLIF(max(r.close) OVER (PARTITION BY r.ticker ORDER BY r.d_idx RANGE BETWEEN 19 PRECEDING AND CURRENT ROW), 0::numeric) - 1::numeric AS close_to_hi20,
    sum((r.ret > 0::numeric)::integer) OVER (PARTITION BY r.ticker ORDER BY r.d_idx RANGE BETWEEN 4 PRECEDING AND CURRENT ROW) AS pos5,
    r.value / NULLIF(avg(r.value) OVER (PARTITION BY r.ticker ORDER BY r.d_idx RANGE BETWEEN 20 PRECEDING AND 1 PRECEDING), 0::numeric) AS val_ratio20,
    r.volume / NULLIF(avg(r.volume) OVER (PARTITION BY r.ticker ORDER BY r.d_idx RANGE BETWEEN 20 PRECEDING AND 1 PRECEDING), 0::numeric) AS vol_ratio20,
    r.frequency / NULLIF(avg(r.frequency) OVER (PARTITION BY r.ticker ORDER BY r.d_idx RANGE BETWEEN 20 PRECEDING AND 1 PRECEDING), 0::numeric) AS freq_ratio20,
    percent_rank() OVER (PARTITION BY r.trade_date ORDER BY r.value) AS value_pct,
    sum(r.is_top::integer) OVER (PARTITION BY r.ticker ORDER BY r.d_idx RANGE BETWEEN 4 PRECEDING AND CURRENT ROW) AS n_top5,
    sum(r.is_top::integer) OVER (PARTITION BY r.ticker ORDER BY r.d_idx RANGE BETWEEN 9 PRECEDING AND CURRENT ROW) AS n_top10,
    sum(r.is_top::integer) OVER (PARTITION BY r.ticker ORDER BY r.d_idx RANGE BETWEEN 19 PRECEDING AND CURRENT ROW) AS n_top20,
    sum(r.is_top::integer) OVER (PARTITION BY r.ticker ORDER BY r.d_idx RANGE BETWEEN 59 PRECEDING AND CURRENT ROW) AS n_top60,
    sum(r.is_ara::integer) OVER (PARTITION BY r.ticker ORDER BY r.d_idx RANGE BETWEEN 9 PRECEDING AND CURRENT ROW) AS n_ara10,
    s.streak_top,
    r.d_idx - max(
        CASE
            WHEN r.is_top THEN r.d_idx
            ELSE NULL::bigint
        END) OVER (PARTITION BY r.ticker ORDER BY r.d_idx ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS days_since_top,
    r.is_complete AND COALESCE(cn.is_complete, false) AS label_ok,
    COALESCE(nx.is_top, false) AS y_top_next,
    COALESCE(nx.is_ara, false) AS y_ara_next,
    nx.ret AS ret_next
   FROM audit.mv_rank r
     LEFT JOIN streak s ON s.ticker = r.ticker AND s.d_idx = r.d_idx
     LEFT JOIN audit.mv_rank p1 ON p1.ticker = r.ticker AND p1.d_idx = (r.d_idx - 1)
     LEFT JOIN audit.mv_rank nx ON nx.ticker = r.ticker AND nx.d_idx = (r.d_idx + 1)
     LEFT JOIN audit.mv_rank c3 ON c3.ticker = r.ticker AND c3.d_idx = (r.d_idx - 3)
     LEFT JOIN audit.mv_rank c5 ON c5.ticker = r.ticker AND c5.d_idx = (r.d_idx - 5)
     LEFT JOIN audit.mv_rank c10 ON c10.ticker = r.ticker AND c10.d_idx = (r.d_idx - 10)
     LEFT JOIN audit.v_calendar cn ON cn.d_idx = (r.d_idx + 1);

-- audit.mv_rank (materialized view)
create materialized view audit.mv_rank as
 WITH e AS (
         SELECT mv_daily.trade_date,
            mv_daily.ticker,
            row_number() OVER (PARTITION BY mv_daily.trade_date ORDER BY mv_daily.ret DESC, mv_daily.value DESC, mv_daily.ticker) AS gainer_rank
           FROM audit.mv_daily
          WHERE mv_daily.gate_ratio >= 1::numeric AND mv_daily.ret > 0::numeric
        )
 SELECT d.trade_date,
    d.ticker,
    d.stock_id,
    d.previous_price,
    d.close,
    d.volume,
    d.value,
    d.frequency,
    d.d_idx,
    d.is_complete,
    d.prev_date,
    d.next_date,
    d.ret,
    d.ara_limit,
    d.gate_ratio,
    d.gate_ratio >= 1::numeric AS eligible,
    d.ret >= (p.ara_tol * d.ara_limit::numeric) AS is_ara,
    e.gainer_rank,
    COALESCE(e.gainer_rank <= p.top_n, false) AS is_top
   FROM audit.mv_daily d
     CROSS JOIN audit.params p
     LEFT JOIN e ON e.trade_date = d.trade_date AND e.ticker = d.ticker;

-- audit.v_base (view)
create or replace view audit.v_base as
 SELECT d.trade_date,
    s.code::text AS ticker,
    d.stock_id,
    d.previous_price::numeric AS previous_price,
    d.close::numeric AS close,
    d.volume::numeric AS volume,
    d.value::numeric AS value,
    d.frequency::numeric AS frequency
   FROM daily_stock_data d
     JOIN stocks s ON s.id = d.stock_id
  WHERE d.close IS NOT NULL AND d.previous_price IS NOT NULL AND d.previous_price > 0::numeric;

-- audit.v_calendar (view)
create or replace view audit.v_calendar as
 WITH c AS (
         SELECT v_base.trade_date,
            count(*) AS n_rows
           FROM audit.v_base
          GROUP BY v_base.trade_date
        ), m AS (
         SELECT percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (c_1.n_rows::double precision)) AS med
           FROM c c_1
        )
 SELECT c.trade_date,
    c.n_rows,
    row_number() OVER (ORDER BY c.trade_date) AS d_idx,
    lag(c.trade_date) OVER (ORDER BY c.trade_date) AS prev_date,
    lead(c.trade_date) OVER (ORDER BY c.trade_date) AS next_date,
    c.n_rows::double precision >= ((( SELECT params.min_day_rows_ratio
           FROM audit.params))::double precision * m.med) AS is_complete
   FROM c
     CROSS JOIN m;

-- audit.v_watch_flag (view)
create or replace view audit.v_watch_flag as
 WITH lim AS (
         SELECT f.trade_date,
            f.d_idx,
            f.ticker,
            f.stock_id,
            f.previous_price,
            f.close,
            f.volume,
            f.value,
            f.frequency,
            f.ret,
            f.ara_limit,
            f.gate_ratio,
            f.eligible,
            f.is_ara,
            f.gainer_rank,
            f.is_top,
            f.is_complete,
            f.prev_date,
            f.prev_status,
            f.prev_rank,
            f.prev_ret,
            f.prev_value,
            f.prev_volume,
            f.prev_frequency,
            f.prev_gate_ratio,
            f.prev_eligible,
            f.ret_3d,
            f.ret_5d,
            f.ret_10d,
            f.ara_prox,
            f.close_to_hi20,
            f.pos5,
            f.val_ratio20,
            f.vol_ratio20,
            f.freq_ratio20,
            f.value_pct,
            f.n_top5,
            f.n_top10,
            f.n_top20,
            f.n_top60,
            f.n_ara10,
            f.streak_top,
            f.days_since_top,
            f.label_ok,
            f.y_top_next,
            f.y_ara_next,
            f.ret_next,
            f.previous_price * (1::numeric + f.ara_limit::numeric / 100.0) AS raw_limit
           FROM audit.mv_features f
          WHERE f.d_idx > 20
        ), tk AS (
         SELECT l.trade_date,
            l.d_idx,
            l.ticker,
            l.stock_id,
            l.previous_price,
            l.close,
            l.volume,
            l.value,
            l.frequency,
            l.ret,
            l.ara_limit,
            l.gate_ratio,
            l.eligible,
            l.is_ara,
            l.gainer_rank,
            l.is_top,
            l.is_complete,
            l.prev_date,
            l.prev_status,
            l.prev_rank,
            l.prev_ret,
            l.prev_value,
            l.prev_volume,
            l.prev_frequency,
            l.prev_gate_ratio,
            l.prev_eligible,
            l.ret_3d,
            l.ret_5d,
            l.ret_10d,
            l.ara_prox,
            l.close_to_hi20,
            l.pos5,
            l.val_ratio20,
            l.vol_ratio20,
            l.freq_ratio20,
            l.value_pct,
            l.n_top5,
            l.n_top10,
            l.n_top20,
            l.n_top60,
            l.n_ara10,
            l.streak_top,
            l.days_since_top,
            l.label_ok,
            l.y_top_next,
            l.y_ara_next,
            l.ret_next,
            l.raw_limit,
                CASE
                    WHEN l.raw_limit < 200::numeric THEN 1
                    WHEN l.raw_limit < 500::numeric THEN 2
                    WHEN l.raw_limit < 2000::numeric THEN 5
                    WHEN l.raw_limit < 5000::numeric THEN 10
                    ELSE 25
                END AS tick_limit
           FROM lim l
        ), mx AS (
         SELECT t.trade_date,
            t.d_idx,
            t.ticker,
            t.stock_id,
            t.previous_price,
            t.close,
            t.volume,
            t.value,
            t.frequency,
            t.ret,
            t.ara_limit,
            t.gate_ratio,
            t.eligible,
            t.is_ara,
            t.gainer_rank,
            t.is_top,
            t.is_complete,
            t.prev_date,
            t.prev_status,
            t.prev_rank,
            t.prev_ret,
            t.prev_value,
            t.prev_volume,
            t.prev_frequency,
            t.prev_gate_ratio,
            t.prev_eligible,
            t.ret_3d,
            t.ret_5d,
            t.ret_10d,
            t.ara_prox,
            t.close_to_hi20,
            t.pos5,
            t.val_ratio20,
            t.vol_ratio20,
            t.freq_ratio20,
            t.value_pct,
            t.n_top5,
            t.n_top10,
            t.n_top20,
            t.n_top60,
            t.n_ara10,
            t.streak_top,
            t.days_since_top,
            t.label_ok,
            t.y_top_next,
            t.y_ara_next,
            t.ret_next,
            t.raw_limit,
            t.tick_limit,
            floor(t.raw_limit / t.tick_limit::numeric + 0.000000001) * t.tick_limit::numeric AS max_price
           FROM tk t
        ), adj AS (
         SELECT m.trade_date,
            m.d_idx,
            m.ticker,
            m.stock_id,
            m.previous_price,
            m.close,
            m.volume,
            m.value,
            m.frequency,
            m.ret,
            m.ara_limit,
            m.gate_ratio,
            m.eligible,
            m.is_ara,
            m.gainer_rank,
            m.is_top,
            m.is_complete,
            m.prev_date,
            m.prev_status,
            m.prev_rank,
            m.prev_ret,
            m.prev_value,
            m.prev_volume,
            m.prev_frequency,
            m.prev_gate_ratio,
            m.prev_eligible,
            m.ret_3d,
            m.ret_5d,
            m.ret_10d,
            m.ara_prox,
            m.close_to_hi20,
            m.pos5,
            m.val_ratio20,
            m.vol_ratio20,
            m.freq_ratio20,
            m.value_pct,
            m.n_top5,
            m.n_top10,
            m.n_top20,
            m.n_top60,
            m.n_ara10,
            m.streak_top,
            m.days_since_top,
            m.label_ok,
            m.y_top_next,
            m.y_ara_next,
            m.ret_next,
            m.raw_limit,
            m.tick_limit,
            m.max_price,
            m.is_ara OR m.close >= (m.max_price - 0.000000001) AS is_ara_adj
           FROM mx m
        )
 SELECT trade_date,
    d_idx,
    ticker,
    stock_id,
    previous_price,
    close,
    volume,
    value,
    frequency,
    ret,
    ara_limit,
    gate_ratio,
    eligible,
    is_ara,
    gainer_rank,
    is_top,
    is_complete,
    prev_date,
    prev_status,
    prev_rank,
    prev_ret,
    prev_value,
    prev_volume,
    prev_frequency,
    prev_gate_ratio,
    prev_eligible,
    ret_3d,
    ret_5d,
    ret_10d,
    ara_prox,
    close_to_hi20,
    pos5,
    val_ratio20,
    vol_ratio20,
    freq_ratio20,
    value_pct,
    n_top5,
    n_top10,
    n_top20,
    n_top60,
    n_ara10,
    streak_top,
    days_since_top,
    label_ok,
    y_top_next,
    y_ara_next,
    ret_next,
    raw_limit,
    tick_limit,
    max_price,
    is_ara_adj,
        CASE
            WHEN is_top AND is_ara_adj AND streak_top >= 2 THEN 'R2'::text
            WHEN is_top AND is_ara_adj THEN 'R1'::text
            WHEN is_top AND gainer_rank <= 5 AND NOT is_ara_adj THEN 'R3'::text
            WHEN NOT eligible AND gate_ratio >= 0.5 AND gate_ratio <= 1::numeric AND ret >= 15::numeric THEN 'R8'::text
            ELSE NULL::text
        END AS rule
   FROM adj a;

-- audit.v_watch_stat (view)
create or replace view audit.v_watch_stat as
 SELECT rule,
    count(*) AS n_dasar,
    round(100.0 * avg(y_top_next::integer), 1) AS p_top20_besok,
    round(100.0 * avg(y_ara_next::integer), 1) AS p_ara_besok,
    round(percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (ret_next::double precision))::numeric, 2) AS ret_cc_med,
    round(100.0 * avg((ret_next > 0::numeric)::integer), 1) AS p_ret_positif,
    min(trade_date) AS data_dari,
    max(trade_date) AS data_sampai
   FROM audit.v_watch_flag f
  WHERE rule IS NOT NULL AND label_ok
  GROUP BY rule;

-- public.audit_bren_feat (view)
create or replace view public.audit_bren_feat as
 WITH base AS (
         SELECT d.trade_date,
            d.previous_price AS pc,
            d.open AS o,
            d.high AS h,
            d.low AS l,
            d.close AS c,
            d.volume AS v,
            lag(d.close, 5) OVER w AS c5,
            lag(d.close, 20) OVER w AS c20,
            avg(d.volume) OVER (ORDER BY d.trade_date ROWS BETWEEN 20 PRECEDING AND 1 PRECEDING) AS v20,
            avg(d.close) OVER (ORDER BY d.trade_date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) AS sma20,
            stddev_pop(d.close) OVER (ORDER BY d.trade_date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) AS sd20,
            max(d.high) OVER (ORDER BY d.trade_date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) AS hi20,
            min(d.low) OVER (ORDER BY d.trade_date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) AS lo20,
            lead(d.close) OVER w AS n_close,
            lead(d.previous_price) OVER w AS n_pc
           FROM daily_stock_data d
             JOIN stocks s ON s.id = d.stock_id
          WHERE s.code::text = 'BREN'::text AND d.volume > 0 AND d.frequency > 0 AND d.close > 0::numeric AND d.previous_price > 0::numeric
          WINDOW w AS (ORDER BY d.trade_date)
        )
 SELECT trade_date,
    c / pc - 1::numeric AS ret1,
    c / NULLIF(c5, 0::numeric) - 1::numeric AS ret5,
    c / NULLIF(c20, 0::numeric) - 1::numeric AS ret20,
        CASE
            WHEN o > 0::numeric THEN o / pc - 1::numeric
            ELSE NULL::numeric
        END AS gap,
    (h - l) / pc AS rng,
        CASE
            WHEN h > l THEN (c - l) / (h - l)
            ELSE NULL::numeric
        END AS clv,
    v::numeric / NULLIF(v20, 0::numeric) AS volr20,
    c / NULLIF(sma20, 0::numeric) - 1::numeric AS d_sma20,
        CASE
            WHEN sd20 > 0::numeric THEN (c - (sma20 - 2::numeric * sd20)) / (4::numeric * sd20)
            ELSE NULL::numeric
        END AS bbpos,
    c / NULLIF(hi20, 0::numeric) - 1::numeric AS d_hi20,
    c / NULLIF(lo20, 0::numeric) - 1::numeric AS d_lo20,
        CASE
            WHEN n_close > n_pc THEN 1
            WHEN n_close < n_pc THEN 0
            ELSE NULL::integer
        END AS y_besok_hijau
   FROM base;

-- public.chartnalist_liquid_gainer_predictions_v1 (view)
create or replace view public.chartnalist_liquid_gainer_predictions_v1 as
 WITH normalized_daily AS (
         SELECT DISTINCT ON (d.stock_id, d.trade_date) d.stock_id,
            d.trade_date,
            d.id,
            d.previous_price,
            d.open,
            d.high,
            d.low,
            d.close,
            d.volume,
            d.value
           FROM daily_stock_data d
          ORDER BY d.stock_id, d.trade_date, d.id DESC
        ), latest_session AS (
         SELECT max(normalized_daily.trade_date) AS signal_date
           FROM normalized_daily
        ), history AS (
         SELECT d.stock_id,
            d.trade_date,
            d.previous_price,
            d.high,
            d.low,
            d.close,
            d.volume,
            d.value,
            lag(d.close, 3) OVER (PARTITION BY d.stock_id ORDER BY d.trade_date) AS close_lag_3,
            avg(d.volume::numeric) OVER (PARTITION BY d.stock_id ORDER BY d.trade_date ROWS BETWEEN 20 PRECEDING AND 1 PRECEDING) AS volume_avg_20_prev,
            avg(d.value) OVER (PARTITION BY d.stock_id ORDER BY d.trade_date ROWS BETWEEN 20 PRECEDING AND 1 PRECEDING) AS value_avg_20_prev
           FROM normalized_daily d
        ), feature_history AS (
         SELECT h.stock_id,
            h.trade_date,
            h.previous_price,
            h.high,
            h.low,
            h.close,
            h.volume,
            h.value,
            h.close_lag_3,
            h.volume_avg_20_prev,
            h.value_avg_20_prev,
            100.0 * (h.close / NULLIF(h.previous_price, 0::numeric) - 1::numeric) AS return_1d_pct,
            100.0 * (h.close / NULLIF(h.close_lag_3, 0::numeric) - 1::numeric) AS return_3d_pct,
            h.volume::numeric / NULLIF(h.volume_avg_20_prev, 0::numeric) AS volume_ratio_20,
            h.value / NULLIF(h.value_avg_20_prev, 0::numeric) AS value_ratio_20
           FROM history h
        ), latest_candidates AS (
         SELECT ls.signal_date,
            s.code AS ticker,
            f.close,
            f.high,
            f.low,
            f.volume,
            f.value,
            f.return_1d_pct,
            f.return_3d_pct,
            f.volume_ratio_20,
            f.value_ratio_20
           FROM latest_session ls
             JOIN feature_history f ON f.trade_date = ls.signal_date
             JOIN stocks s ON s.id = f.stock_id
          WHERE f.close > 0::numeric AND f.previous_price > 0::numeric AND f.volume > 0 AND f.value > 0::numeric AND f.return_1d_pct IS NOT NULL
        ), percentile_ranks AS (
         SELECT c.signal_date,
            c.ticker,
            c.close,
            c.high,
            c.low,
            c.volume,
            c.value,
            c.return_1d_pct,
            c.return_3d_pct,
            c.volume_ratio_20,
            c.value_ratio_20,
            percent_rank() OVER (ORDER BY c.return_1d_pct DESC NULLS LAST) AS pr_return_1,
            percent_rank() OVER (ORDER BY c.return_3d_pct DESC NULLS LAST) AS pr_return_3,
            percent_rank() OVER (ORDER BY c.value_ratio_20 DESC NULLS LAST) AS pr_value,
            percent_rank() OVER (ORDER BY c.volume_ratio_20 DESC NULLS LAST) AS pr_volume
           FROM latest_candidates c
        ), scored AS (
         SELECT p.signal_date,
            p.ticker,
            p.close,
            p.high,
            p.low,
            p.volume,
            p.value,
            p.return_1d_pct,
            p.return_3d_pct,
            p.volume_ratio_20,
            p.value_ratio_20,
            p.pr_return_1,
            p.pr_return_3,
            p.pr_value,
            p.pr_volume,
                CASE
                    WHEN p.return_1d_pct IS NOT NULL THEN 1.0::double precision - p.pr_return_1
                    ELSE 0.0::double precision
                END AS rank_return_1,
                CASE
                    WHEN p.return_3d_pct IS NOT NULL THEN 1.0::double precision - p.pr_return_3
                    ELSE 0.0::double precision
                END AS rank_return_3,
                CASE
                    WHEN p.value_ratio_20 IS NOT NULL THEN 1.0::double precision - p.pr_value
                    ELSE 0.0::double precision
                END AS rank_value,
                CASE
                    WHEN p.volume_ratio_20 IS NOT NULL THEN 1.0::double precision - p.pr_volume
                    ELSE 0.0::double precision
                END AS rank_volume
           FROM percentile_ranks p
        ), model_scores AS (
         SELECT s.signal_date,
            s.ticker,
            s.close,
            s.high,
            s.low,
            s.volume,
            s.value,
            s.return_1d_pct,
            s.return_3d_pct,
            s.volume_ratio_20,
            s.value_ratio_20,
            s.pr_return_1,
            s.pr_return_3,
            s.pr_value,
            s.pr_volume,
            s.rank_return_1,
            s.rank_return_3,
            s.rank_value,
            s.rank_volume,
            0.50::double precision * s.rank_value + 0.50::double precision * s.rank_return_3 AS score_value_return_3,
            0.35::double precision * s.rank_value + 0.35::double precision * s.rank_return_3 + 0.30::double precision * s.rank_volume AS score_value_return_3_volume
           FROM scored s
        ), momentum_ranked AS (
         SELECT m.signal_date,
            m.ticker,
            m.close,
            m.high,
            m.low,
            m.volume,
            m.value,
            m.return_1d_pct,
            m.return_3d_pct,
            m.volume_ratio_20,
            m.value_ratio_20,
            m.pr_return_1,
            m.pr_return_3,
            m.pr_value,
            m.pr_volume,
            m.rank_return_1,
            m.rank_return_3,
            m.rank_value,
            m.rank_volume,
            m.score_value_return_3,
            m.score_value_return_3_volume,
            row_number() OVER (ORDER BY m.return_1d_pct DESC NULLS LAST, m.ticker) AS momentum_rank
           FROM model_scores m
        ), momentum_picks AS (
         SELECT momentum_ranked.signal_date,
            momentum_ranked.ticker,
            momentum_ranked.close,
            momentum_ranked.high,
            momentum_ranked.low,
            momentum_ranked.volume,
            momentum_ranked.value,
            momentum_ranked.return_1d_pct,
            momentum_ranked.return_3d_pct,
            momentum_ranked.volume_ratio_20,
            momentum_ranked.value_ratio_20,
            momentum_ranked.pr_return_1,
            momentum_ranked.pr_return_3,
            momentum_ranked.pr_value,
            momentum_ranked.pr_volume,
            momentum_ranked.rank_return_1,
            momentum_ranked.rank_return_3,
            momentum_ranked.rank_value,
            momentum_ranked.rank_volume,
            momentum_ranked.score_value_return_3,
            momentum_ranked.score_value_return_3_volume,
            momentum_ranked.momentum_rank
           FROM momentum_ranked
          WHERE momentum_ranked.momentum_rank <= 10
        ), discovery_pool AS (
         SELECT m.signal_date,
            m.ticker,
            m.close,
            m.high,
            m.low,
            m.volume,
            m.value,
            m.return_1d_pct,
            m.return_3d_pct,
            m.volume_ratio_20,
            m.value_ratio_20,
            m.pr_return_1,
            m.pr_return_3,
            m.pr_value,
            m.pr_volume,
            m.rank_return_1,
            m.rank_return_3,
            m.rank_value,
            m.rank_volume,
            m.score_value_return_3,
            m.score_value_return_3_volume
           FROM model_scores m
          WHERE m.return_3d_pct IS NOT NULL AND m.value_ratio_20 IS NOT NULL AND NOT (EXISTS ( SELECT 1
                   FROM momentum_picks p
                  WHERE p.ticker::text = m.ticker::text))
        ), discovery_ranked AS (
         SELECT d.signal_date,
            d.ticker,
            d.close,
            d.high,
            d.low,
            d.volume,
            d.value,
            d.return_1d_pct,
            d.return_3d_pct,
            d.volume_ratio_20,
            d.value_ratio_20,
            d.pr_return_1,
            d.pr_return_3,
            d.pr_value,
            d.pr_volume,
            d.rank_return_1,
            d.rank_return_3,
            d.rank_value,
            d.rank_volume,
            d.score_value_return_3,
            d.score_value_return_3_volume,
            row_number() OVER (ORDER BY d.score_value_return_3 DESC, d.rank_value DESC, d.rank_return_3 DESC, d.return_1d_pct DESC NULLS LAST, d.ticker) AS discovery_rank
           FROM discovery_pool d
        ), selected_picks AS (
         SELECT momentum_picks.signal_date,
            momentum_picks.ticker,
            momentum_picks.close,
            momentum_picks.volume,
            momentum_picks.value,
            momentum_picks.return_1d_pct,
            momentum_picks.return_3d_pct,
            momentum_picks.volume_ratio_20,
            momentum_picks.value_ratio_20,
            momentum_picks.momentum_rank AS lane_rank,
            momentum_picks.momentum_rank AS final_rank,
            'MOMENTUM_CONTINUATION'::text AS model_lane,
            momentum_picks.rank_return_1 AS momentum_score,
            momentum_picks.score_value_return_3 AS discovery_score,
            momentum_picks.rank_return_1 AS selected_score
           FROM momentum_picks
        UNION ALL
         SELECT discovery_ranked.signal_date,
            discovery_ranked.ticker,
            discovery_ranked.close,
            discovery_ranked.volume,
            discovery_ranked.value,
            discovery_ranked.return_1d_pct,
            discovery_ranked.return_3d_pct,
            discovery_ranked.volume_ratio_20,
            discovery_ranked.value_ratio_20,
            discovery_ranked.discovery_rank AS lane_rank,
            10 + discovery_ranked.discovery_rank AS final_rank,
            'EARLY_DISCOVERY'::text AS model_lane,
            discovery_ranked.rank_return_1 AS momentum_score,
            discovery_ranked.score_value_return_3 AS discovery_score,
            discovery_ranked.score_value_return_3 AS selected_score
           FROM discovery_ranked
          WHERE discovery_ranked.discovery_rank <= 10
        )
 SELECT signal_date,
    CURRENT_TIMESTAMP AS queried_at,
    '1.0.0-shadow'::text AS model_version,
    final_rank,
    model_lane,
    lane_rank,
    upper(btrim(ticker::text)) AS ticker,
    close AS close_price,
    round(return_1d_pct, 2) AS return_1d_pct,
    round(return_3d_pct, 2) AS return_3d_pct,
    volume,
    value AS daily_value,
    round(volume_ratio_20, 3) AS volume_ratio_20,
    round(value_ratio_20, 3) AS value_ratio_20,
    round(momentum_score::numeric, 5) AS momentum_score,
    round(discovery_score::numeric, 5) AS discovery_score,
    round(selected_score::numeric, 5) AS selected_score
   FROM selected_picks;

-- public.v_raw_signals (view)
create or replace view public.v_raw_signals as
 SELECT elem.value ->> 'code'::text AS ticker,
    (elem.value ->> 'date'::text)::date AS trade_date,
    (elem.value ->> 'close'::text)::numeric AS signal_close,
    (elem.value ->> 'return_pct'::text)::numeric AS return_pct_sinyal,
    (elem.value ->> 'volume_surge_ratio'::text)::numeric AS volume_surge_ratio,
    (elem.value ->> 'foreign_net_value'::text)::numeric AS foreign_net_value,
    (elem.value ->> 'upper_wick_pct'::text)::numeric AS upper_wick_pct
   FROM screener_history,
    LATERAL jsonb_array_elements(screener_history.signals_payload) elem(value);

-- public.v_val_calibration (view)
create or replace view public.v_val_calibration as
 SELECT s.run_id,
        CASE
            WHEN s.total_score >= 75 THEN '1. Score 75-100'::text
            WHEN s.total_score >= 60 THEN '2. Score 60-74'::text
            WHEN s.total_score >= 45 THEN '3. Score 45-59'::text
            WHEN s.total_score >= 30 THEN '4. Score 30-44'::text
            ELSE '5. Score 0-29'::text
        END AS score_band,
    count(*) AS total_signals,
    round(avg(r.return_5d), 2) AS avg_ret_5d,
    round(avg(r.return_10d), 2) AS avg_ret_10d,
    round(100.0 * sum(
        CASE
            WHEN r.return_5d > 0::numeric THEN 1
            ELSE 0
        END)::numeric / count(*)::numeric, 1) AS win_rate_5d
   FROM bt_signals s
     JOIN bt_results r USING (run_id, stock_code, trade_date)
  GROUP BY s.run_id, (
        CASE
            WHEN s.total_score >= 75 THEN '1. Score 75-100'::text
            WHEN s.total_score >= 60 THEN '2. Score 60-74'::text
            WHEN s.total_score >= 45 THEN '3. Score 45-59'::text
            WHEN s.total_score >= 30 THEN '4. Score 30-44'::text
            ELSE '5. Score 0-29'::text
        END)
  ORDER BY s.run_id DESC, (
        CASE
            WHEN s.total_score >= 75 THEN '1. Score 75-100'::text
            WHEN s.total_score >= 60 THEN '2. Score 60-74'::text
            WHEN s.total_score >= 45 THEN '3. Score 45-59'::text
            WHEN s.total_score >= 30 THEN '4. Score 30-44'::text
            ELSE '5. Score 0-29'::text
        END);

-- public.v_val_signal_hitrate (view)
create or replace view public.v_val_signal_hitrate as
 SELECT s.run_id,
    s.signal_type,
    count(*) AS signals,
    round(avg(r.return_1d), 2) AS ret_1d,
    round(avg(r.return_5d), 2) AS ret_5d,
    round(100.0 * sum(
        CASE
            WHEN r.return_5d > 0::numeric THEN 1
            ELSE 0
        END)::numeric / count(*)::numeric, 1) AS hit_rate_5d
   FROM bt_signals s
     JOIN bt_results r USING (run_id, stock_code, trade_date)
  GROUP BY s.run_id, s.signal_type
  ORDER BY s.run_id DESC, s.signal_type;

-- public.v_val_trade_stats (view)
create or replace view public.v_val_trade_stats as
 SELECT run_id,
    count(*) AS total_trades,
    sum(
        CASE
            WHEN pnl_pct > 0::numeric THEN 1
            ELSE 0
        END) AS wins,
    sum(
        CASE
            WHEN pnl_pct < 0::numeric THEN 1
            ELSE 0
        END) AS losses,
    round(100.0 * sum(
        CASE
            WHEN pnl_pct > 0::numeric THEN 1
            ELSE 0
        END)::numeric / count(*)::numeric, 1) AS win_rate_pct,
    round(avg(r_multiple), 2) AS expectancy_r,
    round(sum(
        CASE
            WHEN r_multiple > 0::numeric THEN r_multiple
            ELSE 0::numeric
        END) / abs(NULLIF(sum(
        CASE
            WHEN r_multiple < 0::numeric THEN r_multiple
            ELSE 0::numeric
        END), 0::numeric)), 2) AS profit_factor,
    round(avg(hold_days), 1) AS avg_hold_days
   FROM bt_results
  WHERE exit_reason IS NOT NULL
  GROUP BY run_id;

-- public.v_watch_forward_riwayat (view)
create or replace view public.v_watch_forward_riwayat as
 SELECT signal_date,
    ticker,
    aturan,
    status,
    ret_hari_ini,
    p_top20_besok,
    target_date,
    masuk_top20_besok,
    suspensi_besok,
    ret_besok_pct,
    evaluated_at IS NOT NULL AS selesai
   FROM cn_watch_forward_log
  WHERE (signal_date IN ( SELECT DISTINCT cn_watch_forward_log_1.signal_date
           FROM cn_watch_forward_log cn_watch_forward_log_1
          ORDER BY cn_watch_forward_log_1.signal_date DESC
         LIMIT 15));

-- public.v_watchlist_harian (view)
create or replace view public.v_watchlist_harian as
 SELECT f.trade_date,
    f.ticker,
    st.name AS nama,
    f.rule AS aturan,
        CASE
            WHEN f.rule = 'R3'::text THEN 'HINDARI'::text
            ELSE 'PANTAU'::text
        END AS status,
        CASE f.rule
            WHEN 'R2'::text THEN 'ARA, streak >= 2'::text
            WHEN 'R1'::text THEN 'ARA'::text
            WHEN 'R8'::text THEN 'Dekat gerbang likuid'::text
            WHEN 'R3'::text THEN 'Rank <= 5 tanpa ARA'::text
            ELSE NULL::text
        END AS label,
        CASE f.rule
            WHEN 'R3'::text THEN 'tinggi'::text
            WHEN 'R8'::text THEN 'rendah'::text
            ELSE 'sedang'::text
        END AS keyakinan,
        CASE f.rule
            WHEN 'R2'::text THEN 1
            WHEN 'R1'::text THEN 2
            WHEN 'R8'::text THEN 3
            ELSE 4
        END AS prioritas,
    f.gainer_rank,
    round(f.ret, 2) AS ret_hari_ini,
    f.is_ara_adj AS is_ara,
    f.streak_top,
    f.n_top5,
    f.n_top10,
    f.days_since_top,
    f.prev_status,
    round(f.gate_ratio, 2) AS gate_ratio,
    f.value AS value_hari_ini,
    s.n_dasar,
    s.p_top20_besok,
    s.p_ara_besok,
    s.ret_cc_med,
    s.p_ret_positif,
    s.data_sampai AS statistik_hingga
   FROM audit.v_watch_flag f
     JOIN audit.v_watch_stat s USING (rule)
     LEFT JOIN stocks st ON st.id = f.stock_id
  WHERE f.rule IS NOT NULL AND f.trade_date = (( SELECT max(mv_features.trade_date) AS max
           FROM audit.mv_features));

-- public.v_watchlist_riwayat (view)
create or replace view public.v_watchlist_riwayat as
 SELECT f.trade_date,
    f.ticker,
    st.name AS nama,
    f.rule AS aturan,
        CASE
            WHEN f.rule = 'R3'::text THEN 'HINDARI'::text
            ELSE 'PANTAU'::text
        END AS status,
    f.gainer_rank,
    round(f.ret, 2) AS ret_hari_ini,
    f.is_ara_adj AS is_ara,
    f.streak_top,
    f.n_top5,
    f.n_top10,
    f.days_since_top,
    f.prev_status,
    round(f.gate_ratio, 2) AS gate_ratio,
    f.value AS value_hari_ini,
        CASE
            WHEN f.label_ok THEN f.y_top_next
            ELSE NULL::boolean
        END AS top20_besok_nyata,
        CASE
            WHEN f.label_ok THEN f.y_ara_next
            ELSE NULL::boolean
        END AS ara_besok_nyata,
        CASE
            WHEN f.label_ok THEN round(f.ret_next, 2)
            ELSE NULL::numeric
        END AS ret_besok_nyata
   FROM audit.v_watch_flag f
     LEFT JOIN stocks st ON st.id = f.stock_id
  WHERE f.rule IS NOT NULL;

-- ===== TRIGGERS =====
CREATE TRIGGER trg_signals_updated_at BEFORE UPDATE ON public.signals FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_lg_wf_immutable BEFORE DELETE OR UPDATE OR TRUNCATE ON public.chartnalist_liquid_gainer_walkforward_predictions_v1 FOR EACH STATEMENT EXECUTE FUNCTION reject_liquid_gainer_walkforward_mutation();
CREATE TRIGGER trg_lv_wf_no_update_delete BEFORE DELETE OR UPDATE ON public.chartnalist_liquid_gainer_lowvalue_walkforward_v1 FOR EACH ROW EXECUTE FUNCTION reject_lowvalue_walkforward_mutation();
CREATE TRIGGER trg_lv_wf_no_truncate BEFORE TRUNCATE ON public.chartnalist_liquid_gainer_lowvalue_walkforward_v1 FOR EACH STATEMENT EXECUTE FUNCTION reject_lowvalue_walkforward_mutation();

-- ===== PG_CRON =====
-- job=refresh-watchlist-if-stale schedule='5 * * * *' active=True
select cron.schedule('refresh-watchlist-if-stale', '5 * * * *', $$ select audit.refresh_if_stale() $$);
