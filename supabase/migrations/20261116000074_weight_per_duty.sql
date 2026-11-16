-- =============================================================================
-- The weight of a duty is its points for the whole duty, however many days it lasts
-- (it was the points per 24 hours). An אמ"ת of a week with weight 13 is worth 13, not 13 × 7.
--
--   points = weight × M × (surprise multiplier, when it is a call-up)
--   M = the highest multiplier that applies on any of the duty's days, once (not per day).
--       A multiplier the duty's own flags say it already includes (weekend for a Shabbat type,
--       holidays for "includes holidays") is not applied – as before.
--   A special call-up keeps its fixed points.
--   The load factor (relief roles) is the one in force on the day the duty starts.
--   For weekend balancing a duty that touches a weekend or holiday counts once.
--
-- The 24-hour units stay, each with an equal share of the duty's points: a duty split between
-- a performer and an activated reserve still splits its points by the days each held it.
--
-- Every existing assignment is rescored the same way (a share of a duty keeps its share), and
-- the history in the snapshots of existing cycles follows.
-- =============================================================================

-- the old scores, to rescale existing rows by
create temp table old_full as
select a.id, a.slot_id, a.soldier_id, p.raw as old_raw, p.normalized as old_norm
from assignments a cross join lateral app.slot_points_units(a.slot_id, a.soldier_id, 0, null) p
where a.points <> 0 or a.normalized_points <> 0;

create temp table old_hist as
select sn.cycle_id, sn.soldier_id, coalesce(h.points, 0) as points, coalesce(h.weekends, 0) as weekends
from cycle_soldier_snapshot sn join cycles c on c.id = sn.cycle_id
left join lateral (
  select sum(a.normalized_points) filter (where a.role = 'performer' and a.status in ('assigned', 'done') or a.status = 'reserve_activated') as points,
         sum(a.weekend_units) filter (where a.role = 'performer' and a.status in ('assigned', 'done') or a.status = 'reserve_activated') as weekends
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
  -- the highest multiplier on any day of the duty, applied once
  m as (
    select coalesce(max(app.unit_multiplier(u.day, t.is_weekend_type, (select a from span), (select b from span), t.includes_holidays)), 1) as mult
    from all_units u cross join t
  ),
  -- the relief factor in force on the day the duty starts
  f as (
    select coalesce((select min(lr.factor) from soldier_load_roles slr join load_roles lr on lr.id = slr.load_role_id
                     where slr.soldier_id = p_soldier and slr.valid_from <= (select a from span)::date
                       and (slr.valid_to is null or slr.valid_to >= (select a from span)::date)), 1) as f
  ),
  total as (
    select case when span.fixed_points is not null then span.fixed_points
                else t.weight * (select mult from m) * span.surprise end as p
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

-- a duty that touches a weekend day or a holiday is one weekend for the balancing
create or replace function app.weekend_units(starts timestamptz, ends timestamptz) returns int
language sql stable as $$
  select case when exists (
    select 1
    from generate_series(0, greatest(ceil(extract(epoch from ends - starts) / 86400)::int, 1) - 1) i
    cross join lateral (select ((starts + i * interval '24 hours') at time zone app.tz())::date as d) u
    where extract(isodow from u.d)::int in (select jsonb_array_elements_text(app.setting('weekend_weekdays'))::int)
       or app.is_holiday(u.d)) then 1 else 0 end
$$;

-- rescore: each row keeps its share of its duty
update assignments a set
  points = round(a.points * n.raw / o.old_raw, 2),
  normalized_points = round(a.normalized_points * n.normalized / o.old_norm, 2)
from old_full o cross join lateral app.slot_points_units(o.slot_id, o.soldier_id, 0, null) n
where o.id = a.id and o.old_raw > 0 and o.old_norm > 0;

update assignments set weekend_units = 1 where weekend_units > 1;

-- the history in the snapshots of existing cycles, by the same change
update cycle_soldier_snapshot sn set
  baseline_score = sn.baseline_score + (coalesce(nh.points, 0) - oh.points),
  baseline_weekends = sn.baseline_weekends + (coalesce(nh.weekends, 0) - oh.weekends)
from old_hist oh join cycles c on c.id = oh.cycle_id
left join lateral (
  select sum(a.normalized_points) filter (where a.role = 'performer' and a.status in ('assigned', 'done') or a.status = 'reserve_activated') as points,
         sum(a.weekend_units) filter (where a.role = 'performer' and a.status in ('assigned', 'done') or a.status = 'reserve_activated') as weekends
  from assignments a join slots sl on sl.id = a.slot_id
  where a.soldier_id = oh.soldier_id
    and sl.starts_at >= (c.start_date - make_interval(months => (app.setting('score_window_months') #>> '{}')::int))::timestamp at time zone app.tz()
    and sl.starts_at < c.start_date::timestamp at time zone app.tz()
) nh on true
where sn.cycle_id = oh.cycle_id and sn.soldier_id = oh.soldier_id;

insert into audit_log (actor_user_id, action, entity_type, entity_id, after)
values (null, 'rescore_weight_per_duty', 'assignments', null,
        jsonb_build_object('rows', (select count(*) from old_full), 'note', 'weight = points per duty, not per 24 hours'));

drop table old_full;
drop table old_hist;
