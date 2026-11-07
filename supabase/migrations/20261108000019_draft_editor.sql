-- =============================================================================
-- Draft editor: manual changes to the engine's draft.
--
-- * app.slot_points – a slot's raw and normalized points for a soldier, the same
--   formula as the engine (scoring.py): 24-hour units from the start, each scored by
--   the day it starts on (holiday / weekend multiplier, the higher wins; no weekend
--   multiplier for Shabbat types), the night multiplier for duties shorter than 24
--   hours that are mostly in the night window, divided by the load factor that day.
-- * public.slot_candidates – every soldier of the cycle for one slot, with the rules
--   that would be broken (same codes as the engine) and clashes with the soldier's
--   other duties (overlap or rest).
-- * public.manual_assign / public.remove_assignment – change the draft by hand, with
--   a reason. Manual rows are kept by later engine runs (they go in as "fixed").
-- =============================================================================

-- Minutes of a daily window ("22:00-06:00") inside [a, b) – local timestamps.
create or replace function app.window_minutes(p_window text, a timestamp, b timestamp) returns numeric
language sql immutable as $$
  select coalesce(sum(greatest(0, extract(epoch from (least(b, w1) - greatest(a, w0))) / 60)), 0)
  from (
    select d::date + split_part(p_window, '-', 1)::time as w0,
           d::date + split_part(p_window, '-', 2)::time
             + case when split_part(p_window, '-', 2)::time <= split_part(p_window, '-', 1)::time
                    then interval '1 day' else interval '0' end as w1
    from generate_series(a::date - 1, b::date, interval '1 day') d
  ) x
$$;

-- Minutes of a window inside the hours a slot is worked (its daily hours, or the whole span).
create or replace function app.slot_window_minutes(p_window text, s slots) returns numeric
language sql stable as $$
  with t as (select (s.starts_at at time zone app.tz()) as a, (s.ends_at at time zone app.tz()) as b)
  select case
    when s.daily_hours is null then (select app.window_minutes(p_window, a, b) from t)
    else (
      select coalesce(sum(app.window_minutes(p_window, greatest(t.a, w0), least(t.b, w1))), 0)
      from t cross join lateral (
        select d::date + split_part(s.daily_hours, '-', 1)::time as w0,
               d::date + split_part(s.daily_hours, '-', 2)::time
                 + case when split_part(s.daily_hours, '-', 2)::time <= split_part(s.daily_hours, '-', 1)::time
                        then interval '1 day' else interval '0' end as w1
        from generate_series(t.a::date, (t.b - interval '1 microsecond')::date, interval '1 day') d
      ) w
      where greatest(t.a, w0) < least(t.b, w1))
  end
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
  night as (
    select case
      when span.minutes < 24 * 60
       and app.window_minutes(app.setting('night_window') #>> '{}', span.a, span.b) > span.minutes / 2
      then (app.setting('night_multiplier') #>> '{}')::numeric else 1 end as m
    from span
  ),
  units as (
    select (span.a + i * interval '24 hours')::date as day
    from span cross join generate_series(0, ceil(span.minutes / (24 * 60))::int - 1) i
  ),
  scored as (
    select u.day,
      t.weight * greatest(
        1,
        case when exists (select 1 from calendar_days c where c.day = u.day and c.day_type in ('holiday', 'holiday_eve'))
             then (app.setting('holiday_multiplier') #>> '{}')::numeric else 1 end,
        case when not t.is_weekend_type
              and extract(isodow from u.day)::int in (select jsonb_array_elements_text(app.setting('weekend_weekdays'))::int)
             then (app.setting('weekend_multiplier') #>> '{}')::numeric else 1 end
      ) * (select m from night) as p,
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
-- Candidates for a slot
-- ---------------------------------------------------------------------------
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
           when ((select lo from rk) is not null and coalesce(sn.rank_order, 0) < (select lo from rk))
             or ((select hi from rk) is not null and coalesce(sn.rank_order, 0) > (select hi from rk)) then 'rank' end,
      case when coalesce(s.gender, t.gender) is not null and sn.gender is distinct from coalesce(s.gender, t.gender) then 'gender' end,
      case when sn.is_shachar and sn.service_type = 'mandatory' and not t.shachar_compatible then 'shachar' end,
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

-- ---------------------------------------------------------------------------
-- Manual changes
-- ---------------------------------------------------------------------------
create or replace function public.manual_assign(p_slot uuid, p_role assignment_role, p_soldier uuid,
                                                p_replace uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s     slots;
  c     cycles;
  old   assignments;
  pts   record;
  new_id uuid;
  pair  uuid;
begin
  perform app.require_staff();
  if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  select * into s from slots where id = p_slot for update;
  if not found then raise exception 'slot % not found', p_slot; end if;
  select * into c from cycles where id = s.cycle_id;
  if c.status in ('published', 'closed') then
    raise exception 'the cycle is published – changes after publishing go through swaps and drops';
  end if;
  if exists (select 1 from assignments a where a.slot_id = p_slot and a.soldier_id = p_soldier
             and a.status not in ('dropped', 'cancelled_approved', 'swapped_out') and a.id is distinct from p_replace) then
    raise exception 'the soldier already has a role in this slot';
  end if;

  if p_replace is not null then
    select * into old from assignments where id = p_replace and slot_id = p_slot for update;
    if not found then raise exception 'assignment % is not in this slot', p_replace; end if;
    if old.status <> 'draft' then raise exception 'only draft assignments can be replaced here'; end if;
    p_role := old.role;
    pair := old.paired_assignment_id;
    -- reserves paired to a replaced performer move to the new one below
    update assignments set paired_assignment_id = null where paired_assignment_id = old.id;
    delete from assignments where id = old.id;
  end if;

  select * into pts from app.slot_points(p_slot, p_soldier);
  insert into assignments (slot_id, soldier_id, gaf_id, role, status, is_penalty, points, factor_at_time,
                           normalized_points, weekend_units, explanation, manual_reason, source, received_via, received_at)
  select p_slot, so.id, so.gaf_id, p_role, 'draft', s.is_penalty_slot,
         case when p_role = 'performer' then pts.raw else 0 end,
         case when pts.normalized > 0 then round(pts.raw / pts.normalized, 2) else 1 end,
         case when p_role = 'performer' then pts.normalized else 0 end,
         case when p_role = 'performer' and not s.is_penalty_slot then app.weekend_units(s.starts_at, s.ends_at) else 0 end,
         'שיבוץ ידני: ' || trim(p_reason), trim(p_reason), 'manual', 'system', now()
  from soldiers so where so.id = p_soldier
  returning id into new_id;
  if new_id is null then raise exception 'soldier % not found', p_soldier; end if;

  if p_role = 'performer' then
    update assignments set paired_assignment_id = new_id
     where slot_id = p_slot and role = 'reserve' and paired_assignment_id is null
       and status not in ('dropped', 'cancelled_approved', 'swapped_out');
  else
    update assignments set paired_assignment_id = coalesce(pair, (
      select p.id from assignments p where p.slot_id = p_slot and p.role = 'performer'
        and p.status not in ('dropped', 'cancelled_approved', 'swapped_out') order by p.created_at limit 1))
     where id = new_id;
  end if;
  return new_id;
end $$;

create or replace function public.remove_assignment(p_assignment uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a assignments;
begin
  perform app.require_staff();
  if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  select * into a from assignments where id = p_assignment for update;
  if not found then raise exception 'assignment % not found', p_assignment; end if;
  if a.status <> 'draft' then raise exception 'only draft assignments can be removed here'; end if;
  update assignments set paired_assignment_id = null where paired_assignment_id = a.id;
  delete from assignments where id = a.id;
  -- the delete itself is audited by the table trigger; this row keeps the reason
  insert into audit_log (actor_user_id, action, entity_type, entity_id, before, after)
  values (auth.uid(), 'remove_assignment', 'assignments', a.id::text, to_jsonb(a), jsonb_build_object('reason', trim(p_reason)));
end $$;

revoke execute on function public.slot_candidates(uuid), public.manual_assign(uuid, assignment_role, uuid, uuid, text),
  public.remove_assignment(uuid, text) from anon, public;
grant execute on function public.slot_candidates(uuid), public.manual_assign(uuid, assignment_role, uuid, uuid, text),
  public.remove_assignment(uuid, text) to authenticated, service_role;
revoke execute on function app.slot_points(uuid, uuid) from anon, public;
grant execute on function app.slot_points(uuid, uuid) to authenticated, service_role;
