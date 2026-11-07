-- =============================================================================
-- Catalog against the base's real file.
--
-- * "משימות חיליות" are Air-Force-wide missions (not "משימות חיילות"): officers, a
--   weapon, a week away with bedding. The type is renamed and corrected.
-- * מפקד תורן (רס"ן, סרן in a רס"ן appointment) – new type. Its hours depend on the
--   day: Sunday or the day after a holiday 06:00 → 08:00 next day, Monday–Wednesday
--   08:00 → 08:00, Thursday 08:00 → 18:00 (task_types.weekday_hours).
-- * Rank קא"ב, equal to סגן.
-- * פטור רפואי: while it is in force the holder (mandatory or career) does ממלכ"ת יום
--   only – it excludes every other duty and "qualifies" for ממלכ"ת יום.
-- * slots.briefing_at reaches the engine: absences and date blocks are checked from
--   the briefing (e.g. the day before a guard week).
-- * The base's duty names, mapped once in advance (editable in the settings screen).
-- =============================================================================

insert into ranks (name, sort_order, population_tags)
select 'קא"ב', 11, '{officer}'
where not exists (select 1 from ranks where name = 'קא"ב')
  and exists (select 1 from ranks where name = 'סגן' and sort_order = 11)
  and not exists (select 1 from ranks where sort_order = 11 and name <> 'סגן' and name <> 'קמ"א');

alter table task_types add column if not exists weekday_hours jsonb;
comment on column task_types.weekday_hours is
  'Hours by start weekday, {"0": "06:00-08:00+1", …, "after_holiday": "06:00-08:00+1"} (0 = Sunday); "+1" or an end not after the start = the next day.';

-- משימות חיליות
update duty_categories set name = 'משימות חיליות' where name = 'משימות חיילות';
update task_types t
   set code = 'mesimot_chayliyot', name = 'משימות חיליות', gender = null, requires_weapon = true,
       eligible_populations = '{officer}', min_rest_hours = 24,
       default_start_time = '10:00', default_end_time = '10:00',
       rank_max_id = (select id from ranks where name = 'רס"ן')
 where t.code = 'mesimot_chayalot';

-- מפקד תורן
insert into duty_categories (name) values ('מפקד תורן') on conflict (name) do nothing;
insert into task_types (code, name, category_id, weight, min_rest_hours, service_restriction, requires_weapon,
                        is_weekend_type, shachar_compatible, qualifying_duty, eligible_populations, rank_max_id,
                        default_start_time, default_end_time, weekday_hours, color)
select 'mefaked_toran', 'מפקד תורן', (select id from duty_categories where name = 'מפקד תורן'), 1.00, 24, 'any', false,
       false, false, false, '{major}', (select id from ranks where name = 'רס"ן'), '08:00', '08:00',
       '{"0": "06:00-08:00+1", "1": "08:00-08:00", "2": "08:00-08:00", "3": "08:00-08:00", "4": "08:00-18:00", "after_holiday": "06:00-08:00+1"}',
       '#8a3b2e'
where exists (select 1 from ranks where name = 'רס"ן')
  and not exists (select 1 from task_types where code = 'mefaked_toran');

-- פטור רפואי: everything but ממלכ"ת יום, which it qualifies for; קפ"ס also covers the new type
insert into exemption_type_duties (exemption_type_id, task_type_id, effect)
select et.id, t.id, 'excludes' from exemption_types et cross join task_types t
where et.name in ('רפואי', 'קפ"ס') and t.code in ('mefaked_toran', 'mesimot_chayliyot')
on conflict do nothing;
delete from exemption_type_duties d using exemption_types et, task_types t
where d.exemption_type_id = et.id and d.task_type_id = t.id and et.name = 'רפואי' and t.code = 'mamlachat_yom';
insert into exemption_type_duties (exemption_type_id, task_type_id, effect)
select et.id, t.id, 'qualifies' from exemption_types et cross join task_types t
where et.name = 'רפואי' and t.code = 'mamlachat_yom'
on conflict do nothing;

-- The base's names for our duty types (a name נע"ת already mapped is kept).
insert into task_type_aliases (alias, task_type_id)
select a.alias, t.id
from (values
  ('אמ"ת גבעת המורה', 'mesimot_chayliyot'),
  ('אמ"ת חרבית',      'mesimot_chayliyot'),
  ('שיפוט צד',         'mesimot_chayliyot'),
  ('רסר הקלת"ש',       'rasar'),
  ('רסר טקס רלצד',     'rasar'),
  ('ממלכת יום',        'mamlachat_yom'),
  ('ש.ג דרום 7-11',    'mefaked_shaar'),
  ('צפון 10-13,16-16', 'mefaked_shaar')
) a(alias, code)
join task_types t on t.code = a.code
on conflict (alias) do nothing;

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
      case when t.gender is not null and sn.gender is distinct from t.gender then 'gender' end,
      case when sn.is_shachar and sn.service_type = 'mandatory' and not t.shachar_compatible then 'shachar' end,
      case when sn.home_nightly and t.overnight then 'home_nightly' end
    ], null)
  from sn cross join tasks t
$$;

create or replace function public.build_solver_input(p_cycle uuid, p_kind job_kind default 'full') returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  c        cycles;
  c_from   timestamptz;
  c_to     timestamptz;
  doc      jsonb;
begin
  perform app.require_staff();
  select * into c from cycles where id = p_cycle;
  if not found then raise exception 'cycle % not found', p_cycle; end if;
  if not exists (select 1 from cycle_soldier_snapshot where cycle_id = p_cycle) then
    raise exception 'cycle % has no snapshot – run snapshot_cycle first', p_cycle;
  end if;
  c_from := c.start_date::timestamp at time zone app.tz();
  c_to   := (c.end_date + 1)::timestamp at time zone app.tz();

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
          case when coalesce((app.setting('assume_range_valid') #>> '{}')::boolean, false) then c.end_date end),
        'is_shachar', sn.is_shachar, 'qualifies_day_only', sn.qualifies_day_only,
        'home_nightly', app.home_nightly_on(s, c.start_date),
        'balance_population', sn.balance_population, 'baseline_score', sn.baseline_score,
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
      'weekend_multiplier', app.setting('weekend_multiplier'),
      'holiday_multiplier', app.setting('holiday_multiplier'),
      'night_multiplier',   app.setting('night_multiplier'),
      'night_window',       app.setting('night_window'),
      -- the engine uses Python weekdays (Monday = 0); settings use ISO (Monday = 1)
      'weekend_weekdays',   (select jsonb_agg(x::int - 1) from jsonb_array_elements_text(app.setting('weekend_weekdays')) x),
      'grace_days',         app.setting('grace_days'),
      'duty_cap_per_month', app.setting('duty_cap_per_month'),
      'weights',            app.setting('solver_weights'),
      'time_limit_seconds', app.setting('solver_time_limit_seconds'),
      'workers',            4),

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

revoke execute on function app.potential_static(uuid) from anon, public, authenticated;
