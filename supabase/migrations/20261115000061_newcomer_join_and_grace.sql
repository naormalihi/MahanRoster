-- A new soldier: no duties in his first months, and he opens at his group's average.
--
-- Two gaps:
-- 1. The grace period runs from soldiers.unit_join_date, and nothing ever set it (the personnel
--    file has no such column), so no one had a grace period. A newcomer's join date is now set
--    when he first enters a cycle's snapshot: the later of the day he was added and the cycle's
--    start – a file loaded ahead of the cycle means he joins with the cycle.
-- 2. The opening score was dated when it was granted. Granted while preparing a cycle months
--    ahead, that date fell before the cycle's score window and the score never counted. It is
--    now dated at the cycle's start, so it counts in that cycle's window and leaves it like any
--    history.
--
-- The grace period is 3 months (90 days). Opening scores granted so far came from baselines
-- that left out the published boards (fixed in 060) and from the old dating: they are cleared
-- and granted again at the next potential computation.

update settings set value = '90' where key = 'grace_days';

create or replace function app.grant_opening_scores(p_cycle uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  first_load timestamptz;
  c_start    date;
  n int;
begin
  select min(created_at) into first_load from roster_imports where kind = 'roster' and status = 'applied';
  if first_load is null then return 0; end if;
  select start_date into c_start from cycles where id = p_cycle;

  -- joined the unit: the later of the day he was added and this cycle's start
  update soldiers s set unit_join_date = greatest((s.created_at at time zone app.tz())::date, c_start)
  from cycle_soldier_snapshot sn
  where sn.cycle_id = p_cycle and sn.soldier_id = s.id and s.unit_join_date is null and s.created_at > first_load;

  create temp table _new on commit drop as
    select sn.soldier_id, sn.fairness_group, sn.balance_population
    from cycle_soldier_snapshot sn join soldiers s on s.id = sn.soldier_id
    where sn.cycle_id = p_cycle and s.opening_score_at is null and s.created_at > first_load;

  create temp table _open on commit drop as
    select nw.soldier_id,
           round(coalesce(
             (select avg(o.baseline_score) from cycle_soldier_snapshot o
               where o.cycle_id = p_cycle and o.fairness_group = nw.fairness_group
                 and o.soldier_id not in (select soldier_id from _new)),
             (select avg(o.baseline_score) from cycle_soldier_snapshot o
               where o.cycle_id = p_cycle and o.balance_population = nw.balance_population
                 and o.soldier_id not in (select soldier_id from _new)),
             0), 2) as score
    from _new nw;

  update soldiers s set opening_score = o.score, opening_score_at = c_start::timestamp at time zone app.tz()
  from _open o where o.soldier_id = s.id;
  get diagnostics n = row_count;
  update cycle_soldier_snapshot sn set baseline_score = sn.baseline_score + o.score
  from _open o where sn.cycle_id = p_cycle and sn.soldier_id = o.soldier_id;
  drop table _new; drop table _open;
  return n;
end $$;
revoke execute on function app.grant_opening_scores(uuid) from anon, public;

update soldiers set opening_score = null, opening_score_at = null where opening_score_at is not null;
