-- חובה ↔ קבע (decided 26.11): an employee whose service in a cycle (by the majority of its days)
-- differs from their service in the cycle before carries no points across – the two populations
-- have different scales. Their earlier score is replaced by the average of their new fairness
-- group (without other switchers and newcomers), dated to the cycle's start like a newcomer's
-- opening score; history before it no longer counts. A manual correction for that cycle still adds.

alter table soldiers add column if not exists service_switch_at date;
alter table soldiers add column if not exists service_switch_score numeric(8,2);
alter table soldiers add column if not exists service_switch_to text;
comment on column soldiers.service_switch_at is 'Start of the cycle where the service (חובה/קבע) changed; history before it does not count.';

create or replace function app.grant_switch_scores(p_cycle uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c_start date;
  n int;
begin
  select start_date into c_start from cycles where id = p_cycle;

  -- service in the latest earlier cycle that has a snapshot of them
  create temp table _sw on commit drop as
    select sn.soldier_id, sn.fairness_group, sn.balance_population, prev.balance_population as prev_population
    from cycle_soldier_snapshot sn
    cross join lateral (
      select p.balance_population from cycle_soldier_snapshot p join cycles pc on pc.id = p.cycle_id
      where p.soldier_id = sn.soldier_id and pc.start_date < c_start
      order by pc.start_date desc limit 1
    ) prev
    join soldiers s on s.id = sn.soldier_id
    where sn.cycle_id = p_cycle and prev.balance_population is distinct from sn.balance_population
      and (s.opening_score_at is null or (s.opening_score_at at time zone app.tz())::date <> c_start);

  -- a switch recorded for this cycle that no longer holds (the dates were fixed): forget it
  update soldiers s set service_switch_at = null, service_switch_score = null, service_switch_to = null
   where s.service_switch_at = c_start and s.id not in (select soldier_id from _sw)
     and s.id in (select soldier_id from cycle_soldier_snapshot where cycle_id = p_cycle);

  create temp table _avg on commit drop as
    select w.soldier_id,
           round(coalesce(
             (select avg(o.baseline_score) from cycle_soldier_snapshot o join soldiers os on os.id = o.soldier_id
               where o.cycle_id = p_cycle and o.fairness_group = w.fairness_group
                 and o.soldier_id not in (select soldier_id from _sw)
                 and (os.opening_score_at is null or (os.opening_score_at at time zone app.tz())::date <> c_start)),
             (select avg(o.baseline_score) from cycle_soldier_snapshot o join soldiers os on os.id = o.soldier_id
               where o.cycle_id = p_cycle and o.balance_population = w.balance_population
                 and o.soldier_id not in (select soldier_id from _sw)
                 and (os.opening_score_at is null or (os.opening_score_at at time zone app.tz())::date <> c_start)),
             0), 2) as score
    from _sw w;

  update soldiers s set service_switch_at = c_start, service_switch_score = a.score, service_switch_to = w.balance_population
  from _avg a join _sw w on w.soldier_id = a.soldier_id
  where s.id = a.soldier_id;
  get diagnostics n = row_count;

  -- the snapshot: the average, plus a correction given for this cycle
  update cycle_soldier_snapshot sn
     set baseline_score = a.score + coalesce((select sum(points) from score_adjustments sa
                                               where sa.soldier_id = sn.soldier_id and sa.effective_date >= c_start - 1
                                                 and sa.effective_date < c_start), 0)
    from _avg a where sn.cycle_id = p_cycle and sn.soldier_id = a.soldier_id;
  drop table _sw; drop table _avg;
  return n;
end $$;
revoke execute on function app.grant_switch_scores(uuid) from anon, public, authenticated;

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
  -- a switch found at this cycle is found again below (or not, if the dates changed)
  update soldiers set service_switch_at = null, service_switch_score = null, service_switch_to = null
   where service_switch_at = c.start_date;

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
      -- corrections: from the window – or, after a service switch, those given for the switch cycle on
      + coalesce((select sum(points) from score_adjustments sa
                  where sa.soldier_id = s.id and sa.effective_date >= coalesce(sw.at - 1, win_from) and sa.effective_date < c.start_date), 0)
      + case when s.opening_score_at >= sw.from_day then coalesce(s.opening_score, 0) else 0 end
      -- availability credits of earlier published cycles inside the window
      + coalesce((select sum(cc.points) from cycle_credits cc join cycles pc on pc.id = cc.cycle_id
                  where cc.soldier_id = s.id and pc.status in ('published', 'closed')
                    and pc.start_date >= sw.from_day and pc.start_date < c.start_date), 0)
      -- חובה ↔ קבע: the earlier service's points don't count – the average of the new group does
      + case when sw.at is not null and sw.at >= win_from then coalesce(s.service_switch_score, 0) else 0 end,
    coalesce(hist.weekends, 0),
    coalesce(hist.reserves, 0)
  from soldiers s
  left join lateral (
    select case when s.appointment_rank_id is not null
                 and (s.appointment_rank_until is null or s.appointment_rank_until >= c.start_date)
                then s.appointment_rank_id else s.computed_rank_id end as rank_id
  ) rk on true
  left join ranks r on r.id = rk.rank_id
  -- a service switch recorded at this cycle or before: history counts from it
  cross join lateral (
    select case when s.service_switch_at is not null and s.service_switch_at <= c.start_date then s.service_switch_at end as at,
           greatest(win_from, case when s.service_switch_at is not null and s.service_switch_at <= c.start_date
                                   then s.service_switch_at else win_from end) as from_day
  ) sw
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
      and sl.starts_at >= sw.from_day::timestamp at time zone app.tz()
      and sl.starts_at <  c.start_date::timestamp at time zone app.tz()
  ) hist on true
  where s.is_active
    and (s.release_date is null or s.release_date >= c.start_date)
    and (s.enlistment_date is null or s.enlistment_date <= c.end_date);

  get diagnostics n = row_count;
  perform app.assign_fairness_groups(p_cycle);
  perform app.grant_opening_scores(p_cycle);
  perform app.grant_switch_scores(p_cycle);
  return n;
end $function$;
