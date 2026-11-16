-- =============================================================================
-- Multipliers add to the weight instead of multiplying it.
--
--   points = (weight + V) × (surprise multiplier, when it is a call-up)
--   V = the highest value of the multipliers that apply on any of the duty's days (weekend,
--       holiday, eve, חול המועד…), added once; 0 when none applies. Values never add up.
--
-- A kitchen duty (4): on a Friday 4 + 3 = 7 (was 12); on ערב ראש השנה 4 + 6 = 10 (was 24); on
-- חול המועד that falls on a Friday 4 + the higher of 3 and 3 = 7; a week through פסח 4 + 6 = 10.
-- The task flags keep their meaning: a Shabbat type leaves the weekend out, "includes holidays"
-- leaves the holidays out. A special call-up keeps its fixed points. Every existing assignment
-- is rescored, and the history in the snapshots of existing cycles follows (as in 074).
-- =============================================================================

-- a multiplier set by holiday: by name / kind, or by a calendar day type that is not plain
create or replace function app.is_holiday_multiplier(m score_multipliers) returns boolean
language sql immutable as $$
  select cardinality(m.holidays) > 0 or cardinality(m.holiday_kinds) > 0
      or exists (select 1 from unnest(m.day_types) dt where dt not in ('weekday', 'weekend'))
$$;

-- the highest value of the multipliers of one kind (holiday or not) that apply to a day; null if none
create or replace function app.unit_value(p_day date, p_shabbat_type boolean, p_a timestamp, p_b timestamp,
                                          p_no_holiday boolean, p_holiday boolean)
returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select max(m.value)
  from score_multipliers m
  where m.is_active
    and app.is_holiday_multiplier(m) = p_holiday
    and not (m.skip_shabbat_types and p_shabbat_type)
    and not (p_no_holiday and app.is_holiday_multiplier(m))
    and (cardinality(m.day_types) = 0
         or exists (select 1 from calendar_days c where c.day = p_day and c.day_type = any (m.day_types)))
    and (cardinality(m.holidays) = 0 and cardinality(m.holiday_kinds) = 0
         or exists (select 1 from calendar_days c where c.day = p_day and c.holiday is not null
                    and c.holiday = any (case when cardinality(m.holidays) = 0 then app.rest_holidays() else m.holidays end)
                    and (cardinality(m.holiday_kinds) = 0 or c.holiday_kind = any (m.holiday_kinds))))
    and (cardinality(m.weekdays) = 0 or extract(isodow from p_day)::int = any (m.weekdays))
    and (m.date_from is null or p_day >= m.date_from)
    and (m.date_to is null or p_day <= m.date_to)
    and (m.time_window is null
         or (extract(epoch from p_b - p_a) / 60 < 24 * 60
             and app.window_minutes(m.time_window, p_a, p_b) > extract(epoch from p_b - p_a) / 60 / 2))
$$;

-- the old scores, to rescale existing rows by
create temp table old_full as
select a.id, a.slot_id, a.soldier_id, p.raw as old_raw, p.normalized as old_norm
from assignments a cross join lateral app.slot_points_units(a.slot_id, a.soldier_id, 0, null) p
where a.points <> 0 or a.normalized_points <> 0;

create temp table old_hist as
select sn.cycle_id, sn.soldier_id, coalesce(h.points, 0) as points
from cycle_soldier_snapshot sn join cycles c on c.id = sn.cycle_id
left join lateral (
  select sum(a.normalized_points) filter (where a.role = 'performer' and a.status in ('assigned', 'done') or a.status = 'reserve_activated') as points
  from assignments a join slots sl on sl.id = a.slot_id
  where a.soldier_id = sn.soldier_id
    and sl.starts_at >= (c.start_date - make_interval(months => (app.setting('score_window_months') #>> '{}')::int))::timestamp at time zone app.tz()
    and sl.starts_at < c.start_date::timestamp at time zone app.tz()
) h on true;

create or replace function app.slot_points_units(p_slot uuid, p_soldier uuid, p_from int, p_to int)
returns table (raw numeric, normalized numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  with s as (select * from slots where id = p_slot),
  t as (select tt.* from task_types tt join s on s.task_type_id = tt.id),
  span as (
    select (s.starts_at at time zone app.tz()) as a, (s.ends_at at time zone app.tz()) as b,
           extract(epoch from s.ends_at - s.starts_at) / 60 as minutes, s.is_penalty_slot,
           case when s.is_surprise then coalesce((app.setting('surprise_multiplier') #>> '{}')::numeric, 1) else 1 end as surprise,
           s.fixed_points,
           greatest(ceil(extract(epoch from s.ends_at - s.starts_at) / 60 / (24 * 60))::int, 1) as nunits
    from s
  ),
  all_units as (
    select i, (span.a + i * interval '24 hours')::date as day
    from span cross join generate_series(0, greatest(ceil(span.minutes / (24 * 60))::int, 1) - 1) i
  ),
  -- the highest value that applies on any day (weekend or holiday alike), once
  m as (
    select coalesce(max(greatest(
             app.unit_value(u.day, t.is_weekend_type, (select a from span), (select b from span), t.includes_holidays, false),
             app.unit_value(u.day, t.is_weekend_type, (select a from span), (select b from span), t.includes_holidays, true))), 0) as added
    from all_units u cross join t
  ),
  f as (
    select coalesce((select min(lr.factor) from soldier_load_roles slr join load_roles lr on lr.id = slr.load_role_id
                     where slr.soldier_id = p_soldier and slr.valid_from <= (select a from span)::date
                       and (slr.valid_to is null or slr.valid_to >= (select a from span)::date)), 1) as f
  ),
  total as (
    select case when span.fixed_points is not null then span.fixed_points
                else (t.weight + (select added from m)) * span.surprise end as p
    from span cross join t
  ),
  units as (
    select i from all_units where i >= coalesce(p_from, 0) and (p_to is null or i < p_to)
  )
  select case when (select is_penalty_slot from span) then 0
              else round(coalesce((select p from total) * (select count(*) from units) / (select nunits from span), 0), 2) end,
         case when (select is_penalty_slot from span) then 0
              else round(coalesce((select p from total) * (select count(*) from units) / (select nunits from span) / (select f from f), 0), 2) end
$$;

-- rescore: each row keeps its share of its duty
update assignments a set
  points = round(a.points * n.raw / o.old_raw, 2),
  normalized_points = round(a.normalized_points * n.normalized / o.old_norm, 2)
from old_full o cross join lateral app.slot_points_units(o.slot_id, o.soldier_id, 0, null) n
where o.id = a.id and o.old_raw > 0 and o.old_norm > 0;

update cycle_soldier_snapshot sn set
  baseline_score = sn.baseline_score + (coalesce(nh.points, 0) - oh.points)
from old_hist oh join cycles c on c.id = oh.cycle_id
left join lateral (
  select sum(a.normalized_points) filter (where a.role = 'performer' and a.status in ('assigned', 'done') or a.status = 'reserve_activated') as points
  from assignments a join slots sl on sl.id = a.slot_id
  where a.soldier_id = oh.soldier_id
    and sl.starts_at >= (c.start_date - make_interval(months => (app.setting('score_window_months') #>> '{}')::int))::timestamp at time zone app.tz()
    and sl.starts_at < c.start_date::timestamp at time zone app.tz()
) nh on true
where sn.cycle_id = oh.cycle_id and sn.soldier_id = oh.soldier_id;

insert into audit_log (actor_user_id, action, entity_type, entity_id, after)
values (null, 'rescore_values_added', 'assignments', null,
        jsonb_build_object('rows', (select count(*) from old_full), 'note', 'a multiplier adds its value to the weight instead of multiplying it'));

drop table old_full;
drop table old_hist;
