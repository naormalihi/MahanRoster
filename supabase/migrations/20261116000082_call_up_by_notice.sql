-- =============================================================================
-- A call-up (הקפצה) by notice, not by hand.
--
-- A soldier put on a duty less than 72 hours (setting surprise_notice_hours) before it starts
-- gets the call-up multiplier on it (×1.3): an activated reserve, a replacement assigned by
-- hand, a duty added after publishing and approved onto the board. The mark belongs to the
-- soldier's assignment, not to the duty: whoever was planned for it from the start was not
-- called up.
--   * only in a published cycle; the first publication of a cycle is never a call-up
--   * measured when the assignment becomes binding (assigned, or the reserve activated)
--   * kept through "done"; gone when the assignment is dropped or the activation undone
--   * a special call-up keeps its fixed points; a penalty duty is never a call-up
-- The manual "הקפצה" mark on duties goes: the four duties marked so far lose it, and their
-- rows lose the multiplier (all of them start in 2027, far more than 72 hours ahead).
-- =============================================================================

alter table assignments add column if not exists is_surprise boolean not null default false;
insert into settings (key, value) values ('surprise_notice_hours', '72') on conflict (key) do nothing;

-- the manual marks so far: out of the points, then off the duties
update assignments a
   set points = round(a.points / x.m, 2), normalized_points = round(a.normalized_points / x.m, 2)
  from slots s, (select coalesce((app.setting('surprise_multiplier') #>> '{}')::numeric, 1) as m) x
 where s.id = a.slot_id and s.is_surprise and s.fixed_points is null and x.m > 0;
update slots set is_surprise = false where is_surprise;

CREATE OR REPLACE FUNCTION app.slot_points_units(p_slot uuid, p_soldier uuid, p_from integer, p_to integer)
 RETURNS TABLE(raw numeric, normalized numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with s as (select * from slots where id = p_slot),
  t as (select tt.* from task_types tt join s on s.task_type_id = tt.id),
  span as (
    select (s.starts_at at time zone app.tz()) as a, (s.ends_at at time zone app.tz()) as b,
           extract(epoch from s.ends_at - s.starts_at) / 60 as minutes, s.is_penalty_slot,
           case when s.is_surprise or exists (
             select 1 from assignments x where x.slot_id = s.id and x.soldier_id = p_soldier and x.is_surprise)
           then coalesce((app.setting('surprise_multiplier') #>> '{}')::numeric, 1) else 1 end as surprise,
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
$function$;

create or replace function app.call_up_by_notice() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  sl slots;
  c cycles;
  binding constant assignment_status[] := array['assigned', 'reserve_activated', 'done']::assignment_status[];
  was boolean := case when tg_op = 'UPDATE' then old.is_surprise else false end;
  now_flag boolean;
  m numeric;
begin
  if tg_op = 'UPDATE' and new.status = old.status then
    new.is_surprise := old.is_surprise;
    return new;
  end if;
  if new.status <> all (binding) then
    now_flag := false;                                   -- not (or no longer) doing the duty
  elsif tg_op = 'UPDATE' and old.status = any (binding) then
    now_flag := old.is_surprise;                         -- assigned → done and the like: as it was
  elsif tg_op = 'UPDATE' and old.status = 'dropped' then
    now_flag := false;                                   -- given back his own duty: he was planned
  else
    select * into sl from slots where id = new.slot_id;
    select * into c from cycles where id = sl.cycle_id;
    now_flag := c.status = 'published' and c.published_at < now()   -- not the first publication
                and sl.fixed_points is null and not sl.is_penalty_slot
                and sl.starts_at - now() < make_interval(hours => coalesce((app.setting('surprise_notice_hours') #>> '{}')::int, 72));
  end if;
  if now_flag is distinct from was then
    m := coalesce((app.setting('surprise_multiplier') #>> '{}')::numeric, 1);
    if m > 0 then
      if now_flag then
        new.points := round(new.points * m, 2);
        new.normalized_points := round(new.normalized_points * m, 2);
      else
        new.points := round(new.points / m, 2);
        new.normalized_points := round(new.normalized_points / m, 2);
      end if;
    end if;
  end if;
  new.is_surprise := now_flag;
  return new;
end $$;

drop trigger if exists assignments_call_up on assignments;
create trigger assignments_call_up before insert or update of status on assignments
  for each row execute function app.call_up_by_notice();
