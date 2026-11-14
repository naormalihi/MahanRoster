-- =============================================================================
-- Holidays by name: multipliers per holiday and per day of it.
--
-- * calendar_days.holiday + holiday_kind: which holiday a day belongs to and which day of it –
--     eve (ערב חג), day (the holiday itself), chol_hamoed (חול המועד).
--   Holidays: rosh_hashana, yom_kippur, sukkot (with שמיני עצרת), pesach (with שביעי של פסח),
--   shavuot, independence. הושענא רבה is the eve of שמיני עצרת, so an eve of סוכות.
-- * חול המועד is now on the calendar (a day type of its own, not a holiday for weekend balancing).
-- * score_multipliers.holidays / holiday_kinds: a multiplier may require them (any of each). With
--   only a kind, it is every holiday's day of that kind; with only holidays, every day of them.
--   The highest multiplier that applies still wins, so "ערב ר"ה, יו"כ, סוכות ופסח ×6",
--   "חול המועד ×1.5" and "חג ×2" live side by side.
-- * Existing multipliers keep their day-type conditions and give the same points as before.
-- =============================================================================

-- Fix (053): with no הת"ש level, "or s.tash_level = 7" made the answer null instead of false –
-- the weekly-nights check in a slot's candidates was skipped and the engine got null.
create or replace function app.home_nightly_on(s soldiers, on_day date) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case when s.home_nightly_override is not null
               and (s.home_nightly_override_until is null or s.home_nightly_override_until >= on_day)
              then s.home_nightly_override else s.home_nightly end
      or coalesce(s.tash_level = 7, false)
      or exists (select 1 from exemptions e join exemption_types t on t.id = e.exemption_type_id
                 where e.soldier_id = s.id and t.home_nightly and e.status = 'approved'
                   and e.start_date <= on_day and e.end_date >= on_day)
$$;



alter table calendar_days add column if not exists holiday text
  check (holiday in ('rosh_hashana', 'yom_kippur', 'sukkot', 'pesach', 'shavuot', 'independence'));
alter table calendar_days add column if not exists holiday_kind text check (holiday_kind in ('eve', 'day', 'chol_hamoed'));
alter table calendar_days drop constraint if exists calendar_days_holiday_pair;
alter table calendar_days add constraint calendar_days_holiday_pair check ((holiday is null) = (holiday_kind is null));

insert into day_types (code, name, counts_as_holiday) values ('chol_hamoed', 'חול המועד', false)
on conflict (code) do nothing;

-- Label the generated days by their name, and add חול המועד: the days between סוכות and
-- הושענא רבה, and between פסח and ערב שביעי של פסח. Manual days are left as they are.
create or replace function app.label_holidays() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  update calendar_days c set holiday = m.h, holiday_kind = m.k
  from (values
    ('ערב ראש השנה', 'rosh_hashana', 'eve'), ('ראש השנה א׳', 'rosh_hashana', 'day'), ('ראש השנה ב׳', 'rosh_hashana', 'day'),
    ('ערב יום כיפור', 'yom_kippur', 'eve'), ('יום כיפור', 'yom_kippur', 'day'),
    ('ערב סוכות', 'sukkot', 'eve'), ('סוכות', 'sukkot', 'day'),
    ('הושענא רבה (ערב שמיני עצרת)', 'sukkot', 'eve'), ('שמיני עצרת / שמחת תורה', 'sukkot', 'day'),
    ('ערב פסח', 'pesach', 'eve'), ('פסח', 'pesach', 'day'),
    ('ערב שביעי של פסח', 'pesach', 'eve'), ('שביעי של פסח', 'pesach', 'day'),
    ('ערב שבועות', 'shavuot', 'eve'), ('שבועות', 'shavuot', 'day'),
    ('יום העצמאות', 'independence', 'day')
  ) as m(note, h, k)
  where c.note = m.note and c.holiday is null;

  insert into calendar_days (day, day_type, source, note, holiday, holiday_kind)
  select d::date, 'chol_hamoed', 'hebcal', 'חול המועד ' || p.name, p.h, 'chol_hamoed'
  from (
    select 'סוכות' as name, 'sukkot' as h, a.day as first, b.day as last
    from calendar_days a join calendar_days b on b.note = 'הושענא רבה (ערב שמיני עצרת)' and b.day between a.day and a.day + 8
    where a.note = 'סוכות'
    union all
    select 'פסח', 'pesach', a.day, b.day
    from calendar_days a join calendar_days b on b.note = 'ערב שביעי של פסח' and b.day between a.day and a.day + 8
    where a.note = 'פסח'
  ) p
  cross join generate_series(p.first + 1, p.last - 1, interval '1 day') d
  on conflict (day) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
select app.label_holidays();

alter table score_multipliers add column if not exists holidays text[] not null default '{}';
alter table score_multipliers add column if not exists holiday_kinds text[] not null default '{}';
alter table score_multipliers drop constraint if exists score_multipliers_holiday_kinds;
alter table score_multipliers add constraint score_multipliers_holiday_kinds
  check (holiday_kinds <@ array['eve', 'day', 'chol_hamoed']);
-- "at least one condition" now also counts the holiday conditions
do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'score_multipliers'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%cardinality(day_types) > 0%'
  loop
    execute format('alter table score_multipliers drop constraint %I', c);
  end loop;
end $$;
alter table score_multipliers add constraint score_multipliers_some_condition
  check (cardinality(day_types) > 0 or cardinality(weekdays) > 0 or time_window is not null
         or date_from is not null or date_to is not null or cardinality(holidays) > 0 or cardinality(holiday_kinds) > 0);

create or replace function app.unit_multiplier(p_day date, p_shabbat_type boolean, p_a timestamp, p_b timestamp)
returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select greatest(1, coalesce(max(m.value), 1))
  from score_multipliers m
  where m.is_active
    and not (m.skip_shabbat_types and p_shabbat_type)
    and (cardinality(m.day_types) = 0
         or exists (select 1 from calendar_days c where c.day = p_day and c.day_type = any (m.day_types)))
    and (cardinality(m.holidays) = 0 and cardinality(m.holiday_kinds) = 0
         or exists (select 1 from calendar_days c where c.day = p_day and c.holiday is not null
                    and (cardinality(m.holidays) = 0 or c.holiday = any (m.holidays))
                    and (cardinality(m.holiday_kinds) = 0 or c.holiday_kind = any (m.holiday_kinds))))
    and (cardinality(m.weekdays) = 0 or extract(isodow from p_day)::int = any (m.weekdays))
    and (m.date_from is null or p_day >= m.date_from)
    and (m.date_to is null or p_day <= m.date_to)
    and (m.time_window is null
         or (extract(epoch from p_b - p_a) / 60 < 24 * 60
             and app.window_minutes(m.time_window, p_a, p_b) > extract(epoch from p_b - p_a) / 60 / 2))
$$;


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
        'is_weekend_type', t.is_weekend_type, 'shachar_compatible', t.shachar_compatible, 'shachar_only', t.shachar_only, 'tash_rule', t.tash_rule,
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
        'home_nightly', app.home_nightly_on(s, c.start_date), 'tash_level', s.tash_level,
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
          'skip_shabbat_types', m.skip_shabbat_types,
          'holidays', to_jsonb(m.holidays), 'holiday_kinds', to_jsonb(m.holiday_kinds)) order by m.sort_order, m.name)
        from score_multipliers m where m.is_active), '[]'),
      'day_types', coalesce((
        select jsonb_object_agg(day::text, day_type) from calendar_days
        where day between c.start_date - 1 and c.end_date + 7), '{}'),
      -- which holiday a day belongs to, and which day of it (eve / the holiday / חול המועד)
      'day_holidays', coalesce((
        select jsonb_object_agg(day::text, jsonb_build_array(holiday, holiday_kind)) from calendar_days
        where holiday is not null and day between c.start_date - 1 and c.end_date + 7), '{}')),

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



