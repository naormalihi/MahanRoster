-- =============================================================================
-- An activated reserve does the duty: it counts wherever "who did the duty" is counted.
--
-- The engine, the history snapshots and the board already counted it. Three places counted
-- only role = 'performer', so a soldier activated as a reserve lost those points:
--   * my_scores        – the points and duties the soldier sees on his page
--   * unit_dashboard   – the unit's snapshot (load per soldier, per population)
--   * slot_candidates  – the candidates list of a manual assignment (cycle load, ת"ש nights)
-- One definition, app.performs(role, status), is used by all three.
-- =============================================================================

create or replace function app.performs(p_role assignment_role, p_status assignment_status) returns boolean
language sql immutable as $$
  select p_role = 'performer' or p_status = 'reserve_activated'
$$;
grant execute on function app.performs(assignment_role, assignment_status) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.my_scores()
 RETURNS TABLE(cycle_id uuid, cycle_name text, start_date date, end_date date, duties integer, points numeric, group_label text, group_size integer, group_mean numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with me as (select app.my_soldier() as id),
  pts as (
    select sn.cycle_id, sn.soldier_id, sn.fairness_group,
           coalesce(sum(a.normalized_points) filter (where app.performs(a.role, a.status)), 0) as points,
           count(a.id) filter (where app.performs(a.role, a.status))::int as duties
    from cycle_soldier_snapshot sn
    join cycles c on c.id = sn.cycle_id and c.status in ('published', 'closed')
    left join slots sl on sl.cycle_id = sn.cycle_id and sl.cancelled_at is null
    left join assignments a on a.slot_id = sl.id and a.soldier_id = sn.soldier_id
                           and a.status not in ('draft', 'dropped', 'swapped_out', 'cancelled_approved')
    group by sn.cycle_id, sn.soldier_id, sn.fairness_group
  )
  select c.id, c.name, c.start_date, c.end_date, mine.duties, mine.points,
         (select sn.fairness_label from cycle_soldier_snapshot sn where sn.cycle_id = c.id and sn.soldier_id = mine.soldier_id),
         (select count(*)::int from pts p where p.cycle_id = c.id and p.fairness_group is not distinct from mine.fairness_group),
         (select round(avg(p.points), 2) from pts p where p.cycle_id = c.id and p.fairness_group is not distinct from mine.fairness_group)
  from pts mine join cycles c on c.id = mine.cycle_id
  where mine.soldier_id = (select id from me)
  order by c.start_date desc
$function$;

CREATE OR REPLACE FUNCTION public.unit_dashboard()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c cycles;
begin
  perform app.require_reader();
  -- the published cycle of today, else the latest published one
  select * into c from cycles
   where status in ('published', 'closed')
   order by (current_date between start_date and end_date) desc, start_date desc
   limit 1;
  return jsonb_build_object(
    'cycle', case when c.id is null then null else jsonb_build_object('id', c.id, 'name', c.name, 'start_date', c.start_date, 'end_date', c.end_date) end,
    'planning', (select jsonb_build_object('name', p.name, 'status', p.status, 'deadline', p.exemption_deadline)
                 from cycles p where p.status not in ('published', 'closed') order by p.start_date limit 1),
    'by_gaf', coalesce((
      select jsonb_agg(jsonb_build_object('gaf', g.name, 'soldiers', x.soldiers, 'duties', x.duties, 'points', x.points) order by g.name)
      from org_units g
      join lateral (
        select count(distinct s.id) as soldiers,
               count(a.id) filter (where app.performs(a.role, a.status)) as duties,
               coalesce(sum(a.normalized_points) filter (where app.performs(a.role, a.status)), 0) as points
        from soldiers s
        left join assignments a on a.soldier_id = s.id and a.status not in ('draft', 'dropped', 'swapped_out', 'cancelled_approved')
                               and a.slot_id in (select id from slots where cycle_id = c.id and cancelled_at is null)
        where s.gaf_id = g.id and s.is_active
      ) x on true
      where g.kind = 'gaf'), '[]'),
    'by_population', coalesce((
      select jsonb_agg(jsonb_build_object('population', p.service_type, 'soldiers', p.n, 'mean', p.mean, 'min', p.min, 'max', p.max,
                                          'without', p.without) order by p.service_type)
      from (
        select sn.service_type, count(*) as n, round(avg(t.points), 2) as mean, min(t.points) as min, max(t.points) as max,
               count(*) filter (where t.points = 0) as without
        from cycle_soldier_snapshot sn
        join lateral (
          select coalesce(sum(a.normalized_points) filter (where app.performs(a.role, a.status)), 0) as points
          from assignments a join slots sl on sl.id = a.slot_id
          where a.soldier_id = sn.soldier_id and sl.cycle_id = c.id and sl.cancelled_at is null
            and a.status not in ('draft', 'dropped', 'swapped_out', 'cancelled_approved')
        ) t on true
        where sn.cycle_id = c.id
        group by sn.service_type
      ) p), '[]'),
    'requests', jsonb_build_object(
      'pending', (select count(*) from exemptions where status = 'pending'),
      'urgent', (select count(*) from exemptions where status = 'pending' and is_urgent),
      'by_soldiers', (select count(*) from exemptions where status = 'pending' and source = 'soldier')),
    'accounts', jsonb_build_object(
      'soldiers', (select count(*) from soldiers where is_active),
      'with_account', (select count(distinct u.soldier_id) from app_users u join user_roles r on r.user_id = u.id and r.role = 'soldier'
                       join soldiers s on s.id = u.soldier_id and s.is_active)),
    'settings_changes', coalesce((
      select jsonb_agg(x order by x->>'at' desc) from (
        select jsonb_build_object(
                 'at', l.at, 'action', l.action, 'entity', l.entity_type,
                 'name', coalesce(l.after->>'name', l.before->>'name', l.after->>'key', l.before->>'key', l.entity_id),
                 'by', (select username from app_users where id = l.actor_user_id)) as x
        from audit_log l
        where l.at > now() - interval '30 days'
          and l.entity_type in ('settings', 'task_types', 'score_multipliers', 'exemption_types', 'absence_types', 'load_roles',
                                'ranks', 'duty_categories', 'populations', 'day_types', 'calendar_days', 'exemption_type_duties')
          and l.actor_user_id is not null
        order by l.at desc
        limit 60) q), '[]')
  );
end $function$;

CREATE OR REPLACE FUNCTION public.slot_candidates(p_slot uuid)
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
           so.tash_level, app.home_nightly_on(so, c.start_date) as home_nightly
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
      case when sn.home_nightly and night_hit and t.tash_rule <> 'home' then 'home_nightly' end,
      case when t.tash_rule = 'closed' and (sn.home_nightly or sn.tash_level is not null) then 'tash_closed' end,
      -- הת"ש 3–6: nights on base in any week (this duty + his other duties) at most 7 − level
      case when not sn.home_nightly and sn.tash_level between 3 and 6 and exists (
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
