-- User-defined scoring multipliers.
--
-- A multiplier has a value and conditions; it applies to a day unit of a duty when all of its
-- conditions hold (inside one condition, any of the listed values):
--   day_types   the unit's day is one of these calendar day types (holiday, memorial, …)
--   weekdays    the unit's day is one of these weekdays (ISO: 1 = Monday … 7 = Sunday)
--   time_window the duty is shorter than 24 hours and most of its hours fall in the window
--   date_from / date_to  the unit's day is in this range
-- skip_shabbat_types: not applied to Shabbat duty types (their weight already includes it).
-- Points per unit = weight × the highest multiplier that applies (1 when none) – also for night,
-- which used to multiply on top of the day multiplier.
--
-- The three fixed multipliers (weekend, holiday, night) become ordinary rows. The weekend days
-- (for weekend balancing) and the night window (for those who sleep at home) stay settings.
-- Points already stored on assignments do not change.

create table score_multipliers (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null unique check (length(btrim(name)) between 1 and 60),
  value              numeric(4,2) not null check (value >= 1 and value <= 5),
  day_types          text[] not null default '{}',
  weekdays           int[]  not null default '{}' check (weekdays <@ array[1,2,3,4,5,6,7]),
  time_window        text check (time_window ~ '^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$'),
  date_from          date,
  date_to            date,
  skip_shabbat_types boolean not null default false,
  is_active          boolean not null default true,
  sort_order         int not null default 0,
  created_at         timestamptz not null default now(),
  check (date_from is null or date_to is null or date_from <= date_to),
  check (cardinality(day_types) > 0 or cardinality(weekdays) > 0 or time_window is not null
         or date_from is not null or date_to is not null)
);

alter table score_multipliers enable row level security;
create policy staff_all on score_multipliers for all to authenticated using (app.is_staff()) with check (app.is_staff());
create policy commander_read on score_multipliers for select to authenticated using (app.is_commander());
revoke all on score_multipliers from anon;
create trigger score_multipliers_audit after insert or update or delete on score_multipliers
  for each row execute function app.audit();

-- the fixed three, with their current values
insert into score_multipliers (name, value, weekdays, skip_shabbat_types, sort_order)
select 'סוף שבוע', coalesce((app.setting('weekend_multiplier') #>> '{}')::numeric, 1.5),
       coalesce((select array_agg(x::int) from jsonb_array_elements_text(app.setting('weekend_weekdays')) x), '{5,6}'),
       true, 1;
insert into score_multipliers (name, value, day_types, sort_order)
select 'חג וערב חג', coalesce((app.setting('holiday_multiplier') #>> '{}')::numeric, 2), '{holiday,holiday_eve}', 2;
insert into score_multipliers (name, value, time_window, sort_order)
select 'לילה', coalesce((app.setting('night_multiplier') #>> '{}')::numeric, 1.25),
       coalesce(app.setting('night_window') #>> '{}', '22:00-06:00'), 3;

-- history: every value change, as before (multiplier_key = the row id)
create or replace function app.log_score_multiplier() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' or new.value is distinct from old.value then
    insert into weight_history (multiplier_key, value, effective_from, changed_by)
    values (new.id::text, new.value, current_date, auth.uid());
  end if;
  return null;
end $$;
create trigger score_multipliers_history after insert or update on score_multipliers
  for each row execute function app.log_score_multiplier();
insert into weight_history (multiplier_key, value, effective_from)
select id::text, value, current_date from score_multipliers;

delete from settings where key in ('weekend_multiplier', 'holiday_multiplier', 'night_multiplier');

-- ---------------------------------------------------------------------------
-- Points
-- ---------------------------------------------------------------------------
-- The multiplier of one day unit of a duty: the highest that applies, at least 1.
create or replace function app.unit_multiplier(p_day date, p_shabbat_type boolean, p_a timestamp, p_b timestamp)
returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select greatest(1, coalesce(max(m.value), 1))
  from score_multipliers m
  where m.is_active
    and not (m.skip_shabbat_types and p_shabbat_type)
    and (cardinality(m.day_types) = 0
         or exists (select 1 from calendar_days c where c.day = p_day and c.day_type = any (m.day_types)))
    and (cardinality(m.weekdays) = 0 or extract(isodow from p_day)::int = any (m.weekdays))
    and (m.date_from is null or p_day >= m.date_from)
    and (m.date_to is null or p_day <= m.date_to)
    and (m.time_window is null
         or (extract(epoch from p_b - p_a) / 60 < 24 * 60
             and app.window_minutes(m.time_window, p_a, p_b) > extract(epoch from p_b - p_a) / 60 / 2))
$$;

create or replace function app.slot_points(p_slot uuid, p_soldier uuid)
returns table (raw numeric, normalized numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  with s as (select * from slots where id = p_slot),
  t as (select tt.* from task_types tt join s on s.task_type_id = tt.id),
  span as (
    select (s.starts_at at time zone app.tz()) as a, (s.ends_at at time zone app.tz()) as b,
           extract(epoch from s.ends_at - s.starts_at) / 60 as minutes, s.is_penalty_slot
    from s
  ),
  units as (
    select (span.a + i * interval '24 hours')::date as day
    from span cross join generate_series(0, ceil(span.minutes / (24 * 60))::int - 1) i
  ),
  scored as (
    select u.day,
      t.weight * app.unit_multiplier(u.day, t.is_weekend_type, (select a from span), (select b from span)) as p,
      coalesce((select min(lr.factor) from soldier_load_roles slr join load_roles lr on lr.id = slr.load_role_id
                where slr.soldier_id = p_soldier and slr.valid_from <= u.day
                  and (slr.valid_to is null or slr.valid_to >= u.day)), 1) as f
    from units u cross join t
  )
  select case when (select is_penalty_slot from span) then 0 else round(coalesce(sum(p), 0), 2) end,
         case when (select is_penalty_slot from span) then 0 else round(coalesce(sum(p / f), 0), 2) end
  from scored
$$;

-- ---------------------------------------------------------------------------
-- Engine input: the multipliers and the calendar day types instead of three fixed values
-- ---------------------------------------------------------------------------
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
        'is_weekend_type', t.is_weekend_type, 'shachar_compatible', t.shachar_compatible,
        'qualifying_duty', t.qualifying_duty, 'eligible_populations', to_jsonb(t.eligible_populations),
        'rank_min', rmin.sort_order, 'rank_max', rmax.sort_order, 'gender', t.gender,
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
        'is_penalty', sl.is_penalty_slot, 'penalty_soldier_id', pen.soldier_id::text
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
      where day_type in ('holiday', 'holiday_eve') and day between c.start_date - 1 and c.end_date + 1), '[]'),

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
      select jsonb_agg(jsonb_build_object('slot_id', a.slot_id::text, 'soldier_id', a.soldier_id::text, 'role', a.role))
      from assignments a join slots sl on sl.id = a.slot_id
      where sl.cycle_id = p_cycle and sl.cancelled_at is null
        and a.status not in ('dropped', 'cancelled_approved', 'swapped_out')
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
