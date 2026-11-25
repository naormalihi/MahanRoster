-- =============================================================================
-- הת"ש levels 1–7 (were 3–7): the personnel file has 1 and 2 as well. Level k = k nights a week
-- at home, so at most 7 − k nights on base; 7 = ת"ש 7. The engine already works it out from the
-- level; here the column allows 1–2 and a slot's candidates count the nights for them too.
-- =============================================================================

alter table soldiers drop constraint if exists soldiers_tash_level_check;
alter table soldiers add constraint soldiers_tash_level_check check (tash_level between 1 and 7);

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
    select sn.*, so.gender, so.enlistment_date, so.release_date, so.unit_join_date, so.range_valid_until,
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
