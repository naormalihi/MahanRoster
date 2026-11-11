-- =============================================================================
-- Duty types open only to שח"ר.
--
-- A duty type's שח"ר rule is now one of three:
--   * not for שח"ר   (shachar_compatible = false)                – as before
--   * also for שח"ר  (shachar_compatible = true)                 – as before
--   * only for שח"ר  (shachar_compatible = true, shachar_only)   – new: everyone who is
--     not a mandatory-service שח"ר soldier is blocked (reason 'shachar_only'). שח"ר is
--     mandatory service only.
-- A שח"ר soldier keeps every other duty marked for שח"ר.
--
-- The rule is checked in the potential, a slot's candidates and the engine (which gets
-- shachar_only in its input); the three are redefined here from their latest versions
-- (030 and 034) with that one line added.
-- =============================================================================

alter table task_types add column if not exists shachar_only boolean not null default false;
alter table task_types drop constraint if exists task_types_shachar_only_compatible;
alter table task_types add constraint task_types_shachar_only_compatible check (not shachar_only or shachar_compatible);

create or replace function app.potential_static(p_cycle uuid)
returns table (soldier_id uuid, task_type_id uuid, category_id uuid, reasons text[])
language sql stable security definer set search_path = public, pg_temp as $$
  with c as (select * from cycles where id = p_cycle),
  sn as (
    select sn.*, s.gender, app.home_nightly_on(s, c.start_date) as home_nightly
    from cycle_soldier_snapshot sn join soldiers s on s.id = sn.soldier_id cross join c
    where sn.cycle_id = p_cycle
  ),
  night as (
    select split_part(app.setting('night_window') #>> '{}', '-', 1)::time as n_from,
           split_part(app.setting('night_window') #>> '{}', '-', 2)::time as n_to
  ),
  tasks as (
    select t.*, rmin.sort_order as rank_min, rmax.sort_order as rank_max,
      -- covers night hours by its default times (no times = assume a 24-hour duty)
      (t.default_start_time is null or t.default_end_time is null
        or t.default_end_time <= t.default_start_time
        or t.default_start_time < (select n_to from night)
        or t.default_end_time > (select n_from from night)) as overnight
    from task_types t
    left join ranks rmin on rmin.id = t.rank_min_id
    left join ranks rmax on rmax.id = t.rank_max_id
    where t.is_active and t.category_id is not null
  )
  select sn.soldier_id, t.id, t.category_id,
    array_remove(array[
      case when t.service_restriction <> 'any' and sn.service_type::text <> t.service_restriction then 'service' end,
      case when t.qualifying_duty and not (sn.qualifies_day_only
             or (cardinality(t.eligible_populations) > 0 and t.eligible_populations && sn.populations)
             -- an approved exemption that permits this duty (פטור רפואי → ממלכ"ת יום) during the cycle
             or exists (select 1 from exemptions e
                        join exemption_type_duties d on d.exemption_type_id = e.exemption_type_id
                                                    and d.effect = 'qualifies' and d.task_type_id = t.id
                        where e.soldier_id = sn.soldier_id and e.status = 'approved'
                          and e.start_date <= (select end_date from cycles where id = p_cycle)
                          and e.end_date >= (select start_date from cycles where id = p_cycle))) then 'not_qualifying' end,
      case when not t.qualifying_duty and sn.qualifies_day_only then 'qualifying_only' end,
      case when not t.qualifying_duty and cardinality(t.eligible_populations) > 0
             and not (t.eligible_populations && sn.populations) then 'population' end,
      case when (t.rank_min is not null and coalesce(sn.rank_order, 0) < t.rank_min)
             or (t.rank_max is not null and coalesce(sn.rank_order, 0) > t.rank_max) then 'rank' end,
      case when t.allowed_rank_ids is not null and not exists (
             select 1 from ranks r where r.id = any(t.allowed_rank_ids) and r.sort_order = coalesce(sn.rank_order, 0))
           then 'rank' end,
      case when t.gender is not null and sn.gender is distinct from t.gender then 'gender' end,
      case when sn.is_shachar and sn.service_type = 'mandatory' and not t.shachar_compatible then 'shachar' end,
      case when t.shachar_only and not (sn.is_shachar and sn.service_type = 'mandatory') then 'shachar_only' end,
      case when sn.home_nightly and t.overnight then 'home_nightly' end
    ], null)
  from sn cross join tasks t
$$;


create or replace function public.slot_candidates(p_slot uuid)
returns table (soldier_id uuid, reasons text[], conflicts jsonb, cycle_points numeric, cycle_duties int, in_slot text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  s        slots;
  t        task_types;
  c        cycles;
  first_d  date;
  last_d   date;
  from_ts  timestamptz;
  last_slot_day date;
  night_hit boolean;
begin
  perform app.require_staff();
  select * into s from slots where id = p_slot;
  if not found then raise exception 'slot % not found', p_slot; end if;
  select * into t from task_types where id = s.task_type_id;
  select * into c from cycles where id = s.cycle_id;
  first_d := (s.starts_at at time zone app.tz())::date;
  last_d  := ((s.ends_at - interval '1 microsecond') at time zone app.tz())::date;
  from_ts := least(coalesce(s.briefing_at, s.starts_at), s.starts_at);
  select greatest(c.end_date, max((x.ends_at at time zone app.tz())::date)) into last_slot_day
  from slots x where x.cycle_id = c.id and x.cancelled_at is null;
  night_hit := app.slot_window_minutes(app.setting('night_window') #>> '{}', s) > 0;

  return query
  with sn as (
    select sn.*, so.gender, so.enlistment_date, so.release_date, so.unit_join_date, so.range_valid_until,
           app.home_nightly_on(so, c.start_date) as home_nightly
    from cycle_soldier_snapshot sn join soldiers so on so.id = sn.soldier_id
    where sn.cycle_id = c.id
  ),
  rk as (
    select coalesce(rmin.sort_order, tmin.sort_order) as lo, coalesce(rmax.sort_order, tmax.sort_order) as hi
    from (select 1) d
    left join ranks rmin on rmin.id = s.rank_min_id left join ranks rmax on rmax.id = s.rank_max_id
    left join ranks tmin on tmin.id = t.rank_min_id left join ranks tmax on tmax.id = t.rank_max_id
  ),
  mine as (   -- the soldier's other live duties in any cycle, with rest
    select a.soldier_id, a.slot_id, a.role, x.starts_at, x.ends_at, tt.name as task_name, tt.min_rest_hours
    from assignments a join slots x on x.id = a.slot_id join task_types tt on tt.id = x.task_type_id
    where a.status not in ('dropped', 'cancelled_approved', 'swapped_out') and x.cancelled_at is null
  )
  select sn.soldier_id,
    array_remove(array[
      case when t.service_restriction <> 'any' and sn.service_type::text <> t.service_restriction then 'service' end,
      case when t.qualifying_duty and not (sn.qualifies_day_only
             or (cardinality(t.eligible_populations) > 0 and t.eligible_populations && sn.populations)
             or exists (select 1 from exemptions e join exemption_type_duties d on d.exemption_type_id = e.exemption_type_id
                        where e.soldier_id = sn.soldier_id and e.status = 'approved' and d.effect = 'qualifies'
                          and d.task_type_id = t.id and e.start_date <= first_d and e.end_date >= last_d))
           then 'not_qualifying' end,
      case when not t.qualifying_duty and sn.qualifies_day_only then 'qualifying_only' end,
      case when not t.qualifying_duty and cardinality(t.eligible_populations) > 0
             and not (t.eligible_populations && sn.populations) then 'population' end,
      case when s.allowed_rank_ids is not null
             then case when not exists (select 1 from ranks r where r.id = any(s.allowed_rank_ids) and r.sort_order = coalesce(sn.rank_order, 0)) then 'rank' end
           when t.allowed_rank_ids is not null
             then case when not exists (select 1 from ranks r where r.id = any(t.allowed_rank_ids) and r.sort_order = coalesce(sn.rank_order, 0)) then 'rank' end
           when ((select lo from rk) is not null and coalesce(sn.rank_order, 0) < (select lo from rk))
             or ((select hi from rk) is not null and coalesce(sn.rank_order, 0) > (select hi from rk)) then 'rank' end,
      case when coalesce(s.gender, t.gender) is not null and sn.gender is distinct from coalesce(s.gender, t.gender) then 'gender' end,
      case when sn.is_shachar and sn.service_type = 'mandatory' and not t.shachar_compatible then 'shachar' end,
      case when t.shachar_only and not (sn.is_shachar and sn.service_type = 'mandatory') then 'shachar_only' end,
      case when sn.home_nightly and night_hit then 'home_nightly' end,
      case when t.requires_weapon and coalesce(sn.range_valid_until,
             case when coalesce((app.setting('assume_range_valid') #>> '{}')::boolean, false) then last_slot_day end) is distinct from null
             and coalesce(sn.range_valid_until, last_slot_day) < last_d then 'weapon_range'
           when t.requires_weapon and sn.range_valid_until is null
             and not coalesce((app.setting('assume_range_valid') #>> '{}')::boolean, false) then 'weapon_range' end,
      case when sn.enlistment_date is not null and first_d < sn.enlistment_date then 'not_enlisted' end,
      case when sn.release_date is not null and last_d > sn.release_date then 'released' end,
      case when sn.unit_join_date is not null
             and first_d < sn.unit_join_date + coalesce((app.setting('grace_days') #>> '{}')::int, 0) then 'grace' end,
      case when exists (
             select 1 from exemptions e join exemption_types et on et.id = e.exemption_type_id
             cross join lateral (select app.exemption_scope(e.exemption_type_id, e.excluded_task_type_ids) as scope) sc
             where e.soldier_id = sn.soldier_id and e.status = 'approved' and not et.qualifies_day_only
               and e.start_date <= last_d and e.end_date >= first_d
               and (sc.scope is null or t.id = any(sc.scope))
               and (e.restricted_hours is null or app.slot_window_minutes(e.restricted_hours, s) > 0)) then 'exemption' end,
      case when exists (select 1 from absences a where a.soldier_id = sn.soldier_id and a.status = 'active'
                        and a.starts_at < s.ends_at and a.ends_at > from_ts) then 'absence' end,
      case when exists (select 1 from date_blocks b where b.soldier_id = sn.soldier_id and b.status = 'active'
                        and b.day between (from_ts at time zone app.tz())::date and last_d) then 'date_block' end,
      case when exists (select 1 from personal_constraints pc where pc.soldier_id = sn.soldier_id
                        and (pc.valid_until is null or pc.valid_until >= first_d)
                        and (pc.task_type_id is null or pc.task_type_id = t.id)
                        and (pc.time_window is null or app.slot_window_minutes(pc.time_window, s) > 0)) then 'personal_constraint' end
    ], null),
    coalesce((
      select jsonb_agg(jsonb_build_object('slot_id', m.slot_id, 'task', m.task_name, 'role', m.role,
                                          'starts_at', m.starts_at, 'ends_at', m.ends_at) order by m.starts_at)
      from mine m
      where m.soldier_id = sn.soldier_id and m.slot_id <> s.id
        and m.starts_at < s.ends_at + make_interval(hours => t.min_rest_hours)
        and m.ends_at + make_interval(hours => m.min_rest_hours) > s.starts_at), '[]'::jsonb),
    sn.baseline_score + coalesce((
      select sum(a.normalized_points) from assignments a join slots x on x.id = a.slot_id
      where a.soldier_id = sn.soldier_id and x.cycle_id = c.id and a.role = 'performer'
        and a.status not in ('dropped', 'cancelled_approved', 'swapped_out')), 0),
    (select count(*)::int from assignments a join slots x on x.id = a.slot_id
     where a.soldier_id = sn.soldier_id and x.cycle_id = c.id
       and a.status not in ('dropped', 'cancelled_approved', 'swapped_out')),
    (select a.role::text from assignments a where a.slot_id = s.id and a.soldier_id = sn.soldier_id
       and a.status not in ('dropped', 'cancelled_approved', 'swapped_out') limit 1)
  from sn;
end $$;


create or replace function public.build_solver_input(p_cycle uuid, p_kind job_kind default 'full') returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  c        cycles;
  c_from   timestamptz;
  c_to     timestamptz;
  doc      jsonb;
  last_day date;
begin
  perform app.require_staff();
  select * into c from cycles where id = p_cycle;
  if not found then raise exception 'cycle % not found', p_cycle; end if;
  if not exists (select 1 from cycle_soldier_snapshot where cycle_id = p_cycle) then
    raise exception 'cycle % has no snapshot – run snapshot_cycle first', p_cycle;
  end if;
  c_from := c.start_date::timestamp at time zone app.tz();
  c_to   := (c.end_date + 1)::timestamp at time zone app.tz();
  -- an assumed-valid range covers every slot of the cycle, also one that ends after the cycle
  select greatest(c.end_date, max((sl.ends_at at time zone app.tz())::date)) into last_day
  from slots sl where sl.cycle_id = p_cycle and sl.cancelled_at is null;
  last_day := coalesce(last_day, c.end_date);

  doc := jsonb_build_object(
    'cycle_id',    p_cycle::text,
    'cycle_start', c.start_date,
    'cycle_end',   c.end_date,

    'task_types', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id::text, 'name', t.name, 'weight', t.weight, 'min_rest_hours', t.min_rest_hours,
        'service_restriction', t.service_restriction, 'requires_weapon', t.requires_weapon,
        'is_weekend_type', t.is_weekend_type, 'shachar_compatible', t.shachar_compatible, 'shachar_only', t.shachar_only,
        'qualifying_duty', t.qualifying_duty, 'eligible_populations', to_jsonb(t.eligible_populations),
        'rank_min', rmin.sort_order, 'rank_max', rmax.sort_order, 'gender', t.gender,
        'allowed_ranks', (select jsonb_agg(distinct r.sort_order) from ranks r where r.id = any(t.allowed_rank_ids)),
        'category_id', t.category_id::text) order by t.code)
      from task_types t
      left join ranks rmin on rmin.id = t.rank_min_id
      left join ranks rmax on rmax.id = t.rank_max_id
      where t.id in (select task_type_id from slots where cycle_id = p_cycle)), '[]'),

    'soldiers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id::text, 'gaf_id', s.gaf_id::text, 'service_type', sn.service_type,
        'rank_order', coalesce(sn.rank_order, 0), 'populations', to_jsonb(sn.populations),
        'gender', s.gender, 'enlistment_date', s.enlistment_date, 'release_date', s.release_date,
        'unit_join_date', s.unit_join_date,
        -- no range date on file = assumed valid for the whole cycle, while the setting is on
        'range_valid_until', coalesce(s.range_valid_until,
          case when coalesce((app.setting('assume_range_valid') #>> '{}')::boolean, false) then last_day end),
        'is_shachar', sn.is_shachar, 'qualifies_day_only', sn.qualifies_day_only,
        'home_nightly', app.home_nightly_on(s, c.start_date),
        'balance_population', sn.balance_population, 'baseline_score', sn.baseline_score,
        'fairness_group', sn.fairness_group,
        'credit_periods', app.credit_periods(s, c.start_date, last_day),
        'baseline_weekends', sn.baseline_weekends, 'baseline_reserves', sn.baseline_reserves,
        'load_roles', coalesce((
          select jsonb_agg(jsonb_build_object('factor', lr.factor, 'valid_from', slr.valid_from, 'valid_to', slr.valid_to))
          from soldier_load_roles slr join load_roles lr on lr.id = slr.load_role_id
          where slr.soldier_id = s.id
            and slr.valid_from <= c.end_date and (slr.valid_to is null or slr.valid_to >= c.start_date)), '[]')
        ) order by s.id)
      from cycle_soldier_snapshot sn join soldiers s on s.id = sn.soldier_id
      where sn.cycle_id = p_cycle), '[]'),

    'slots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', sl.id::text, 'task_type_id', sl.task_type_id::text,
        'starts_at', app.local_ts(sl.starts_at), 'ends_at', app.local_ts(sl.ends_at),
        'performers_needed', sl.performers_needed, 'reserves_needed', sl.reserves_needed,
        'rank_min', rmin.sort_order, 'rank_max', rmax.sort_order, 'gender', sl.gender,
        'allowed_ranks', (select jsonb_agg(distinct r.sort_order) from ranks r where r.id = any(sl.allowed_rank_ids)),
        'prefer_home_nightly', sl.prefer_home_nightly,
        'daily_hours', sl.daily_hours,
        'briefing_at', case when sl.briefing_at is not null then app.local_ts(sl.briefing_at) end,
        'is_penalty', sl.is_penalty_slot, 'penalty_soldier_id', pen.soldier_id::text,
        'is_surprise', sl.is_surprise
        ) order by sl.starts_at, sl.id)
      from slots sl
      left join ranks rmin on rmin.id = sl.rank_min_id
      left join ranks rmax on rmax.id = sl.rank_max_id
      left join penalties pen on pen.id = sl.penalty_id and pen.target_type = 'soldier'
      where sl.cycle_id = p_cycle and sl.cancelled_at is null), '[]'),

    'settings', jsonb_build_object(
      'night_window',       app.setting('night_window'),
      -- the engine uses Python weekdays (Monday = 0); settings use ISO (Monday = 1)
      'weekend_weekdays',   (select jsonb_agg(x::int - 1) from jsonb_array_elements_text(app.setting('weekend_weekdays')) x),
      'grace_days',         app.setting('grace_days'),
      'duty_cap_per_month', app.setting('duty_cap_per_month'),
      'weights',            app.setting('solver_weights'),
      'time_limit_seconds', app.setting('solver_time_limit_seconds'),
      'workers',            4,
      'surprise_multiplier', coalesce(app.setting('surprise_multiplier'), '1'),
      -- user-defined multipliers (the highest that applies wins) and the day types they look at
      'multipliers', coalesce((
        select jsonb_agg(jsonb_build_object(
          'name', m.name, 'value', m.value, 'day_types', to_jsonb(m.day_types),
          -- Python weekdays (Monday = 0)
          'weekdays', (select coalesce(jsonb_agg(w - 1), '[]') from unnest(m.weekdays) w),
          'time_window', m.time_window, 'date_from', m.date_from, 'date_to', m.date_to,
          'skip_shabbat_types', m.skip_shabbat_types) order by m.sort_order, m.name)
        from score_multipliers m where m.is_active), '[]'),
      'day_types', coalesce((
        select jsonb_object_agg(day::text, day_type) from calendar_days
        where day between c.start_date - 1 and c.end_date + 7), '{}')),

    'holidays', coalesce((
      select jsonb_agg(day order by day) from calendar_days
      where day_type in (select code from day_types where counts_as_holiday) and day between c.start_date - 1 and c.end_date + 1), '[]'),

    -- An exemption excludes the duties its type maps to, or the narrower list entered for it;
    -- a type with no mapping excludes everything. A qualifying exemption (ממלכ"ת יום only)
    -- is not an exclusion: its effect is in the snapshot (qualifies_day_only).
    'exemptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'soldier_id', e.soldier_id::text, 'start_date', e.start_date, 'end_date', e.end_date,
        'excluded_task_type_ids', (select to_jsonb(array_agg(x::text)) from unnest(app.exemption_scope(e.exemption_type_id, e.excluded_task_type_ids)) x),
        'restricted_hours', e.restricted_hours,
        'qualifies_task_type_ids', coalesce((
          select jsonb_agg(d.task_type_id::text order by d.task_type_id) from exemption_type_duties d
          where d.exemption_type_id = e.exemption_type_id and d.effect = 'qualifies'), '[]')))
      from exemptions e join exemption_types et on et.id = e.exemption_type_id
      where e.status = 'approved' and not et.qualifies_day_only
        and e.start_date <= c.end_date and e.end_date >= c.start_date
        and e.soldier_id in (select soldier_id from cycle_soldier_snapshot where cycle_id = p_cycle)), '[]'),

    'absences', coalesce((
      select jsonb_agg(jsonb_build_object(
        'soldier_id', a.soldier_id::text, 'starts_at', app.local_ts(a.starts_at), 'ends_at', app.local_ts(a.ends_at)))
      from absences a
      where a.status = 'active' and a.starts_at < c_to and a.ends_at > c_from), '[]'),

    'date_blocks', coalesce((
      select jsonb_agg(jsonb_build_object('soldier_id', b.soldier_id::text, 'date', b.day))
      from date_blocks b where b.status = 'active' and b.day between c.start_date and c.end_date), '[]'),

    'personal_constraints', coalesce((
      select jsonb_agg(jsonb_build_object(
        'soldier_id', pc.soldier_id::text, 'task_type_id', pc.task_type_id::text,
        'time_window', pc.time_window, 'valid_until', pc.valid_until))
      from personal_constraints pc where pc.valid_until is null or pc.valid_until >= c.start_date), '[]'),

    -- Kept as they are: manual locks always; in stability mode every published assignment too.
    'fixed', coalesce((
      -- an activated reserve holds the slot as its performer; the performer it replaced is not
      -- kept on the slot (it already counts its days), so the engine can propose a new reserve
      select jsonb_agg(jsonb_build_object('slot_id', a.slot_id::text, 'soldier_id', a.soldier_id::text,
                                          'role', case when a.status = 'reserve_activated' then 'performer' else a.role::text end))
      from assignments a join slots sl on sl.id = a.slot_id
      where sl.cycle_id = p_cycle and sl.cancelled_at is null
        and a.status not in ('dropped', 'cancelled_approved', 'swapped_out')
        and not (a.role = 'performer' and exists (select 1 from assignments x where x.slot_id = a.slot_id
                                                   and x.status = 'reserve_activated' and x.replaced_assignment_id = a.id))
        and (a.source = 'manual' or (p_kind = 'stability' and a.status <> 'draft'))), '[]'),

    -- Duties from other cycles that reach into this one (rest included).
    'busy', coalesce((
      select jsonb_agg(jsonb_build_object(
        'soldier_id', a.soldier_id::text,
        'starts_at', app.local_ts(sl.starts_at),
        'ends_at',   app.local_ts(sl.ends_at + make_interval(hours => t.min_rest_hours))))
      from assignments a join slots sl on sl.id = a.slot_id join task_types t on t.id = sl.task_type_id
      where sl.cycle_id <> p_cycle and sl.cancelled_at is null
        and a.status not in ('draft', 'dropped', 'cancelled_approved', 'swapped_out')
        and sl.starts_at < c_to
        and sl.ends_at + make_interval(hours => t.min_rest_hours) > c_from), '[]')
  );
  return doc;
end $$;

