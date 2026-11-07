-- =============================================================================
-- Potential matrix (מטריצת הפוטנציאל) and the exemption scope it shares with the engine.
--
-- Exemption scope: the duties an approved exemption excludes are the ones its type maps
-- to (exemption_type_duties), or the narrower list נע"ת entered; a type without a
-- mapping (פטור מלא) excludes all duties. A qualifying exemption excludes nothing – it
-- makes the holder ממלכ"ת-יום-only through the snapshot. build_solver_input is redefined
-- to use the same rule (before, an exemption entered "by type" excluded everything).
--
-- Potential: for each soldier of the cycle snapshot and each duty category, 1 / empty /
-- the share of cycle days the soldier is available for the best duty of the category.
-- Unavailable days: before enlistment, after release, the grace period after joining,
-- absences, and exemptions (without an hour window) that exclude the duty.
-- Rank and populations come from the snapshot, frozen when the potential is computed.
-- =============================================================================

create or replace function app.exemption_scope(p_type uuid, p_explicit uuid[]) returns uuid[]
language sql stable as $$
  select case
    when coalesce(cardinality(p_explicit), 0) > 0 then p_explicit
    else (select array_agg(d.task_type_id order by d.task_type_id) from exemption_type_duties d
          where d.exemption_type_id = p_type and d.effect = 'excludes')
  end
$$;
comment on function app.exemption_scope(uuid, uuid[]) is 'Duties an exemption excludes; null = all duties.';

alter table cycles add column if not exists potential_computed_at timestamptz;

create table potential_overrides (
  cycle_id    uuid not null references cycles(id) on delete cascade,
  soldier_id  uuid not null references soldiers(id),
  category_id uuid not null references duty_categories(id),
  value       numeric(3,2) not null check (value between 0 and 1),
  reason      text not null check (length(trim(reason)) > 0),
  created_by  uuid references app_users(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  primary key (cycle_id, soldier_id, category_id)
);
alter table potential_overrides enable row level security;
create policy staff_all on potential_overrides for all to authenticated using (app.is_staff()) with check (app.is_staff());
revoke all on potential_overrides from anon;
create trigger potential_overrides_audit after insert or update or delete on potential_overrides
  for each row execute function app.audit();

-- Freeze the cycle's facts (rank, populations, parent…) and stamp the time.
create or replace function public.compute_potential(p_cycle uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  perform app.require_staff();
  n := public.snapshot_cycle(p_cycle);
  update cycles set potential_computed_at = now() where id = p_cycle;
  return n;
end $$;

-- Why a duty is closed to a soldier regardless of the day (empty = open), per active duty.
create or replace function app.potential_static(p_cycle uuid)
returns table (soldier_id uuid, task_type_id uuid, category_id uuid, reasons text[])
language sql stable security definer set search_path = public, pg_temp as $$
  with sn as (
    select sn.*, s.gender from cycle_soldier_snapshot sn join soldiers s on s.id = sn.soldier_id
    where sn.cycle_id = p_cycle
  ),
  tasks as (
    select t.*, rmin.sort_order as rank_min, rmax.sort_order as rank_max
    from task_types t
    left join ranks rmin on rmin.id = t.rank_min_id
    left join ranks rmax on rmax.id = t.rank_max_id
    where t.is_active and t.category_id is not null
  )
  select sn.soldier_id, t.id, t.category_id,
    array_remove(array[
      case when t.service_restriction <> 'any' and sn.service_type::text <> t.service_restriction then 'service' end,
      case when t.qualifying_duty and not (sn.qualifies_day_only
             or (cardinality(t.eligible_populations) > 0 and t.eligible_populations && sn.populations)) then 'not_qualifying' end,
      case when not t.qualifying_duty and sn.qualifies_day_only then 'qualifying_only' end,
      case when not t.qualifying_duty and cardinality(t.eligible_populations) > 0
             and not (t.eligible_populations && sn.populations) then 'population' end,
      case when (t.rank_min is not null and coalesce(sn.rank_order, 0) < t.rank_min)
             or (t.rank_max is not null and coalesce(sn.rank_order, 0) > t.rank_max) then 'rank' end,
      case when t.gender is not null and sn.gender is distinct from t.gender then 'gender' end,
      case when sn.is_shachar and sn.service_type = 'mandatory' and not t.shachar_compatible then 'shachar' end
    ], null)
  from sn cross join tasks t
$$;

-- Cycle days a soldier cannot do a duty: before enlistment, after release, grace period,
-- absences (every day they touch), and exemptions without an hour window that exclude it.
create or replace function app.potential_unavailable(p_cycle uuid)
returns table (soldier_id uuid, task_type_id uuid, day date)
language sql stable security definer set search_path = public, pg_temp as $$
  with c as (select * from cycles where id = p_cycle),
  sn as (
    select s.id as soldier_id, s.enlistment_date, s.release_date, s.unit_join_date
    from cycle_soldier_snapshot x join soldiers s on s.id = x.soldier_id where x.cycle_id = p_cycle
  ),
  tasks as (select id from task_types where is_active and category_id is not null),
  off_days as (                      -- every duty
    select sn.soldier_id, d::date as day
    from sn cross join c cross join generate_series(c.start_date, c.end_date, interval '1 day') d
    where (sn.enlistment_date is not null and d::date < sn.enlistment_date)
       or (sn.release_date is not null and d::date > sn.release_date)
       or (sn.unit_join_date is not null
           and d::date < sn.unit_join_date + coalesce((app.setting('grace_days') #>> '{}')::int, 0))
    union
    select a.soldier_id, d::date
    from absences a cross join c
    cross join generate_series(
      greatest((a.starts_at at time zone app.tz())::date, c.start_date),
      least(((a.ends_at - interval '1 microsecond') at time zone app.tz())::date, c.end_date),
      interval '1 day') d
    where a.status = 'active' and a.soldier_id in (select soldier_id from sn)
  ),
  ex as (
    select e.soldier_id, greatest(e.start_date, c.start_date) as d0, least(e.end_date, c.end_date) as d1,
           app.exemption_scope(e.exemption_type_id, e.excluded_task_type_ids) as scope
    from exemptions e join exemption_types et on et.id = e.exemption_type_id cross join c
    where e.status = 'approved' and not et.qualifies_day_only and e.restricted_hours is null
      and e.start_date <= c.end_date and e.end_date >= c.start_date
      and e.soldier_id in (select soldier_id from sn)
  )
  select o.soldier_id, t.id, o.day from off_days o cross join tasks t
  union
  select ex.soldier_id, t.id, d::date
  from ex join tasks t on ex.scope is null or t.id = any(ex.scope)
  cross join generate_series(ex.d0, ex.d1, interval '1 day') d
$$;

create or replace function public.potential_matrix(p_cycle uuid)
returns table (soldier_id uuid, category_id uuid, value numeric, best_task_type_id uuid, reasons text[],
               available_days int, cycle_days int, override_value numeric, override_reason text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare total int;
begin
  perform app.require_staff();
  select end_date - start_date + 1 into total from cycles where id = p_cycle;
  if not exists (select 1 from cycle_soldier_snapshot where cycle_id = p_cycle) then
    raise exception 'potential not computed for cycle %', p_cycle;
  end if;
  return query
  with st as (select * from app.potential_static(p_cycle)),
  un as (
    select u.soldier_id, u.task_type_id, count(*)::int as n
    from app.potential_unavailable(p_cycle) u group by u.soldier_id, u.task_type_id
  ),
  scored as (
    select st.soldier_id, st.category_id, st.task_type_id,
      total - coalesce(un.n, 0) as avail,
      case when cardinality(st.reasons) = 0 then round((total - coalesce(un.n, 0))::numeric / total, 2) else 0 end as v,
      case when cardinality(st.reasons) = 0 and coalesce(un.n, 0) >= total then array['unavailable'] else st.reasons end as why
    from st left join un on un.soldier_id = st.soldier_id and un.task_type_id = st.task_type_id
  ),
  best as (
    select distinct on (s.soldier_id, s.category_id) s.*
    from scored s
    order by s.soldier_id, s.category_id, s.v desc, cardinality(s.why), s.task_type_id
  )
  select b.soldier_id, b.category_id, b.v, b.task_type_id,
         case when b.v > 0 then '{}'::text[] else b.why end,
         b.avail, total, o.value, o.reason
  from best b
  left join potential_overrides o on o.cycle_id = p_cycle and o.soldier_id = b.soldier_id and o.category_id = b.category_id;
end $$;

-- Soldiers available per category and day (for the availability heat map): open to at least
-- one duty of the category and not unavailable that day for all of them.
create or replace function public.potential_daily(p_cycle uuid)
returns table (day date, category_id uuid, available int)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  perform app.require_staff();
  return query
  with c as (select * from cycles where id = p_cycle),
  open_pairs as (select * from app.potential_static(p_cycle) where cardinality(reasons) = 0),
  open_count as (   -- soldiers per category, and how many open duties each has in it
    select soldier_id, category_id, count(*) as k from open_pairs group by soldier_id, category_id
  ),
  blocked as (      -- (soldier, category, day) where every open duty of the category is unavailable
    select op.soldier_id, op.category_id, u.day
    from open_pairs op join app.potential_unavailable(p_cycle) u
      on u.soldier_id = op.soldier_id and u.task_type_id = op.task_type_id
    group by op.soldier_id, op.category_id, u.day
    having count(*) = (select k from open_count oc where oc.soldier_id = op.soldier_id and oc.category_id = op.category_id)
  ),
  totals as (select category_id, count(*)::int as n from open_count group by category_id),
  gone as (select category_id, day, count(*)::int as n from blocked group by category_id, day)
  select d::date, t.category_id, t.n - coalesce(g.n, 0)
  from totals t cross join c cross join generate_series(c.start_date, c.end_date, interval '1 day') d
  left join gone g on g.category_id = t.category_id and g.day = d::date;
end $$;

revoke execute on function public.compute_potential(uuid), public.potential_matrix(uuid), public.potential_daily(uuid) from anon, public;
grant execute on function public.compute_potential(uuid), public.potential_matrix(uuid), public.potential_daily(uuid) to authenticated, service_role;
revoke execute on function app.potential_static(uuid), app.potential_unavailable(uuid) from anon, public, authenticated;

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
        'restricted_hours', e.restricted_hours))
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
