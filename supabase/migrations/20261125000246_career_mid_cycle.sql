-- =============================================================================
-- Entering career service in the middle of a cycle (2.59).
--
-- When the career start date falls inside a cycle, the soldier's service type for that cycle is the
-- one he spends most of the cycle in (a tie – mandatory). He serves only in that part:
--   * mostly mandatory: mandatory duties up to the day before the date, not available from it on;
--   * mostly career: not available before the date, career duties from it on.
-- The days outside his part count like days after release / before enlistment: they leave his
-- potential relative and are credited.
-- =============================================================================

create or replace function app.career_switch(p_career date, p_from date, p_to date)
returns table (service service_type, off_from date, off_to date)
language sql immutable as $$
  select case when p_to - p_career + 1 > p_career - p_from then 'career' else 'mandatory' end::service_type,
         case when p_to - p_career + 1 > p_career - p_from then p_from else p_career end,
         case when p_to - p_career + 1 > p_career - p_from then p_career - 1 else 'infinity'::date end
  where p_career is not null and p_career > p_from and p_career <= p_to
$$;
grant execute on function app.career_switch(date, date, date) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.snapshot_cycle(p_cycle uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c        cycles;
  win_from date;
  n        int;
begin
  perform app.require_staff();
  select * into c from cycles where id = p_cycle;
  if not found then raise exception 'cycle % not found', p_cycle; end if;
  win_from := c.start_date - make_interval(months => (app.setting('score_window_months') #>> '{}')::int);

  delete from cycle_soldier_snapshot where cycle_id = p_cycle;

  insert into cycle_soldier_snapshot (
    cycle_id, soldier_id, service_type, rank_id, rank_order, populations, balance_population,
    is_parent, qualifies_day_only, is_shachar, baseline_score, baseline_weekends, baseline_reserves)
  select
    p_cycle,
    s.id,
    svc.v,
    r.id,
    r.sort_order,
    array(select distinct x from unnest(array[svc.v::text] || coalesce(r.population_tags, '{}')) x order by x),
    svc.v::text,
    parent.v,
    parent.v or exists (
      select 1 from exemptions e join exemption_types et on et.id = e.exemption_type_id
      where e.soldier_id = s.id and e.status = 'approved' and et.qualifies_day_only
        and e.start_date <= c.end_date and e.end_date >= c.start_date),
    s.is_shachar,
    coalesce(hist.points, 0)
      + coalesce((select sum(points) from score_adjustments sa
                  where sa.soldier_id = s.id and sa.effective_date >= win_from and sa.effective_date < c.start_date), 0)
      + case when s.opening_score_at >= win_from then coalesce(s.opening_score, 0) else 0 end
      -- availability credits of earlier published cycles inside the window
      + coalesce((select sum(cc.points) from cycle_credits cc join cycles pc on pc.id = cc.cycle_id
                  where cc.soldier_id = s.id and pc.status in ('published', 'closed')
                    and pc.start_date >= win_from and pc.start_date < c.start_date), 0),
    coalesce(hist.weekends, 0),
    coalesce(hist.reserves, 0)
  from soldiers s
  left join lateral (
    select case when s.appointment_rank_id is not null
                 and (s.appointment_rank_until is null or s.appointment_rank_until >= c.start_date)
                then s.appointment_rank_id else s.computed_rank_id end as rank_id
  ) rk on true
  left join ranks r on r.id = rk.rank_id
  cross join lateral (select coalesce((select cs.service from app.career_switch(s.career_start_date, c.start_date, c.end_date) cs),
                                     app.service_on(s.career_start_date, s.service_type, c.start_date)) as v) svc
  cross join lateral (
    select case when s.parent_override is not null
                 and (s.parent_override_until is null or s.parent_override_until >= c.start_date)
                then s.parent_override else s.parent_status end as v
  ) parent
  left join lateral (
    select
      sum(a.normalized_points) filter (where a.role = 'performer' and a.status in ('assigned', 'done') or a.status = 'reserve_activated') as points,
      sum(a.weekend_units)     filter (where a.role = 'performer' and a.status in ('assigned', 'done') or a.status = 'reserve_activated') as weekends,
      count(*) filter (where a.role = 'reserve' and a.status in ('reserve_idle', 'reserve_activated', 'assigned')) as reserves
    from assignments a join slots sl on sl.id = a.slot_id
    where a.soldier_id = s.id
      and sl.starts_at >= win_from::timestamp at time zone app.tz()
      and sl.starts_at <  c.start_date::timestamp at time zone app.tz()
  ) hist on true
  where s.is_active
    and (s.release_date is null or s.release_date >= c.start_date)
    and (s.enlistment_date is null or s.enlistment_date <= c.end_date);

  get diagnostics n = row_count;
  perform app.assign_fairness_groups(p_cycle);
  perform app.grant_opening_scores(p_cycle);
  return n;
end $function$;

CREATE OR REPLACE FUNCTION app.potential_unavailable(p_cycle uuid)
 RETURNS TABLE(soldier_id uuid, task_type_id uuid, day date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with c as (select * from cycles where id = p_cycle),
  sn as (
    select s.id as soldier_id, s.enlistment_date, s.release_date, s.unit_join_date, s.career_start_date
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
       or exists (select 1 from app.career_switch(sn.career_start_date, c.start_date, c.end_date) cs
                  where d::date between cs.off_from and cs.off_to)
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
$function$;

CREATE OR REPLACE FUNCTION app.credit_periods(s soldiers, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with p (a, b) as (
    select p_from, s.enlistment_date - 1 where s.enlistment_date > p_from
    union all
    select s.release_date + 1, p_to where s.release_date < p_to
    union all
    -- entering career mid-cycle: the part of the cycle he does not serve in
    select cs.off_from, least(cs.off_to, p_to)
    from app.career_switch(s.career_start_date, p_from,
                           coalesce((select max(cy.end_date) from cycles cy where cy.start_date = p_from), p_to)) cs
    union all
    select s.unit_join_date, s.unit_join_date + ((app.setting('grace_days') #>> '{}')::int - 1)
    where s.unit_join_date is not null
    union all
    select (a.starts_at at time zone app.tz())::date, ((a.ends_at - interval '1 microsecond') at time zone app.tz())::date
    from absences a join absence_types t on t.id = a.absence_type_id
    where a.soldier_id = s.id and a.status = 'active' and t.credits_load
      and a.ends_at - a.starts_at >= make_interval(days => (app.setting('credit_absence_min_days') #>> '{}')::int)
    union all
    select e.start_date, e.end_date
    from exemptions e join exemption_types et on et.id = e.exemption_type_id
    where e.soldier_id = s.id and e.status = 'approved' and not et.qualifies_day_only
      and e.restricted_hours is null and app.exemption_scope(e.exemption_type_id, e.excluded_task_type_ids) is null
  )
  select coalesce(jsonb_agg(jsonb_build_object('start', greatest(a, p_from), 'end', least(b, p_to)) order by a), '[]')
  from p where a <= p_to and b >= p_from and greatest(a, p_from) <= least(b, p_to)
$function$;

CREATE OR REPLACE FUNCTION app.slot_candidates_for(p_slot uuid, p_only uuid DEFAULT NULL::uuid)
 RETURNS TABLE(soldier_id uuid, reasons text[], conflicts jsonb, cycle_points numeric, cycle_duties integer, in_slot text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    select sn.*, so.gender, so.enlistment_date, so.release_date, so.career_start_date, so.unit_join_date, so.range_valid_until,
           so.tash_level, app.home_nightly_on(so, c.start_date) as home_nightly
    from cycle_soldier_snapshot sn join soldiers so on so.id = sn.soldier_id
    where sn.cycle_id = c.id and (p_only is null or sn.soldier_id = p_only)
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
      case when sn.home_nightly and night_hit and t.tash_rule <> 'home' then 'home_nightly' end,
      case when t.tash_rule = 'closed' and (sn.home_nightly or sn.tash_level is not null) then 'tash_closed' end,
      -- הת"ש 3–6: nights on base in any week (this duty + his other duties) at most 7 − level
      case when not sn.home_nightly and sn.tash_level between 1 and 6 and exists (
             select 1 from (
               select app.week_of(n) as wk, count(*) as nights from (
                 select unnest(app.slot_nights(s)) as n
                 union all
                 select unnest(app.slot_nights(x)) from assignments a join slots x on x.id = a.slot_id
                 where a.soldier_id = sn.soldier_id and app.performs(a.role, a.status) and x.id <> s.id and x.cancelled_at is null
                   and a.status not in ('dropped', 'cancelled_approved', 'swapped_out')
                   and x.starts_at < s.ends_at + interval '8 days' and x.ends_at > s.starts_at - interval '8 days'
               ) all_n group by 1
             ) w
             where w.wk in (select app.week_of(n) from unnest(app.slot_nights(s)) n)
               and w.nights > 7 - sn.tash_level) then 'tash_nights' end,
      case when t.requires_weapon and coalesce(sn.range_valid_until,
             case when coalesce((app.setting('assume_range_valid') #>> '{}')::boolean, false) then last_slot_day end) is distinct from null
             and coalesce(sn.range_valid_until, last_slot_day) < last_d then 'weapon_range'
           when t.requires_weapon and sn.range_valid_until is null
             and not coalesce((app.setting('assume_range_valid') #>> '{}')::boolean, false) then 'weapon_range' end,
      case when sn.enlistment_date is not null and first_d < sn.enlistment_date then 'not_enlisted' end,
      case when sn.release_date is not null and last_d > sn.release_date then 'released' end,
      (select case cs.service when 'career' then 'before_career' else 'after_career' end
       from app.career_switch(sn.career_start_date, c.start_date, c.end_date) cs
       where first_d <= cs.off_to and last_d >= cs.off_from),
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
      where a.soldier_id = sn.soldier_id and x.cycle_id = c.id and app.performs(a.role, a.status)
        and a.status not in ('dropped', 'cancelled_approved', 'swapped_out')), 0),
    (select count(*)::int from assignments a join slots x on x.id = a.slot_id
     where a.soldier_id = sn.soldier_id and x.cycle_id = c.id
       and a.status not in ('dropped', 'cancelled_approved', 'swapped_out')),
    (select a.role::text from assignments a where a.slot_id = s.id and a.soldier_id = sn.soldier_id
       and a.status not in ('dropped', 'cancelled_approved', 'swapped_out') limit 1)
  from sn;
end $function$;

CREATE OR REPLACE FUNCTION app.build_solver_input_base(p_cycle uuid, p_kind job_kind DEFAULT 'full'::job_kind)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
        'is_weekend_type', t.is_weekend_type, 'includes_holidays', t.includes_holidays, 'shachar_compatible', t.shachar_compatible, 'shachar_only', t.shachar_only, 'tash_rule', t.tash_rule,
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
        'gender', s.gender,
        -- entering career mid-cycle narrows his service to his part of the cycle
        'enlistment_date', case when cs.service = 'career' then greatest(s.enlistment_date, cs.off_to + 1) else s.enlistment_date end,
        'release_date', case when cs.service = 'mandatory' then least(s.release_date, cs.off_from - 1) else s.release_date end,
        'unit_join_date', s.unit_join_date,
        -- no range date on file = assumed valid for the whole cycle, while the setting is on
        'range_valid_until', coalesce(s.range_valid_until,
          case when coalesce((app.setting('assume_range_valid') #>> '{}')::boolean, false) then last_day end),
        'is_shachar', sn.is_shachar, 'qualifies_day_only', sn.qualifies_day_only,
        'home_nightly', app.home_nightly_on(s, c.start_date), 'tash_level', s.tash_level,
        'recent_holiday', exists (select 1 from app.holiday_duties(c.start_date - 365, c.start_date - 1) h where h.soldier_id = s.id),
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
      left join lateral app.career_switch(s.career_start_date, c.start_date, c.end_date) cs on true
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
        'is_surprise', sl.is_surprise,
        'fixed_points', sl.fixed_points
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

    -- An update run starts from the current draft: the engine's own draft assignments, which it
    -- keeps where they still hold and repairs where they no longer do.
    'start', case when p_kind = 'update' then coalesce((
      select jsonb_agg(jsonb_build_object('slot_id', a.slot_id::text, 'soldier_id', a.soldier_id::text, 'role', a.role::text))
      from assignments a join slots sl on sl.id = a.slot_id
      where sl.cycle_id = p_cycle and sl.cancelled_at is null
        and a.status = 'draft' and a.source = 'solver' and a.role in ('performer', 'reserve')), '[]'::jsonb)
      else '[]'::jsonb end,

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
end $function$;

CREATE OR REPLACE FUNCTION public.potential_cell_why(p_cycle uuid, p_soldier uuid, p_task_type uuid)
 RETURNS TABLE(cause text, detail text, from_day date, to_day date, days integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c cycles;
  s soldiers;
  grace int := coalesce((app.setting('grace_days') #>> '{}')::int, 0);
begin
  perform app.require_staff();
  if not app.sees_soldier(p_soldier) then raise exception 'אין הרשאה' using errcode = '42501'; end if;
  select * into c from cycles where id = p_cycle;
  select * into s from soldiers where id = p_soldier;
  if c.id is null or s.id is null then return; end if;

  return query
  with r as (
    select 'not_enlisted'::text as cause, 'גיוס ' || to_char(s.enlistment_date, 'DD.MM.YYYY') as detail,
           c.start_date as d0, least(s.enlistment_date - 1, c.end_date) as d1
    where s.enlistment_date is not null and s.enlistment_date > c.start_date
    union all
    select 'released', 'שחרור ' || to_char(s.release_date, 'DD.MM.YYYY'),
           greatest(s.release_date + 1, c.start_date), c.end_date
    where s.release_date is not null and s.release_date < c.end_date
    union all
    select case cs.service when 'career' then 'before_career' else 'after_career' end,
           'כניסה לקבע ' || to_char(s.career_start_date, 'DD.MM.YYYY'),
           greatest(cs.off_from, c.start_date), least(cs.off_to, c.end_date)
    from app.career_switch(s.career_start_date, c.start_date, c.end_date) cs
    union all
    select 'grace', 'נקלט '  || to_char(s.unit_join_date, 'DD.MM.YYYY') || ' · ' || grace || ' יום חסד',
           c.start_date, least(s.unit_join_date + grace - 1, c.end_date)
    where s.unit_join_date is not null and s.unit_join_date + grace > c.start_date
    union all
    select 'absence', coalesce(at.name, 'היעדרות'),
           greatest((a.starts_at at time zone app.tz())::date, c.start_date),
           least(((a.ends_at - interval '1 microsecond') at time zone app.tz())::date, c.end_date)
    from absences a left join absence_types at on at.id = a.absence_type_id
    where a.soldier_id = p_soldier and a.status = 'active'
      and (a.starts_at at time zone app.tz())::date <= c.end_date
      and ((a.ends_at - interval '1 microsecond') at time zone app.tz())::date >= c.start_date
    union all
    select 'exemption', coalesce(et.name, 'פטור'),
           greatest(e.start_date, c.start_date), least(e.end_date, c.end_date)
    from exemptions e join exemption_types et on et.id = e.exemption_type_id
    where e.soldier_id = p_soldier and e.status = 'approved' and not et.qualifies_day_only and e.restricted_hours is null
      and e.start_date <= c.end_date and e.end_date >= c.start_date
      and (app.exemption_scope(e.exemption_type_id, e.excluded_task_type_ids) is null
           or p_task_type = any(app.exemption_scope(e.exemption_type_id, e.excluded_task_type_ids)))
  )
  select r.cause, r.detail, r.d0, r.d1, (r.d1 - r.d0 + 1)::int
  from r where r.d1 >= r.d0
  order by r.d0, r.cause;
end $function$;
