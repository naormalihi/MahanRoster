-- A new soldier starts with the average score of his group, not zero (spec: "חייל חדש ביחידה").
--
-- New = added by a personnel file after the first one (the first load is the starting roster,
-- whose history comes from the past boards). A soldier already in the system keeps his record,
-- his history and everything entered by hand; the file only refreshes the fields it carries.
--
-- When a cycle is snapshot, every new soldier in it who has no opening score yet gets the mean
-- baseline of his fairness group, without the other newcomers of the same computation (no
-- group peers: the mean of his balance population; none at all: 0). The score is stored on the
-- soldier with its date, so it counts inside the rolling window and leaves it like any history.
-- The grace period itself is covered by the availability credit, as before.

create or replace function app.grant_opening_scores(p_cycle uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  first_load timestamptz;
  n int;
begin
  select min(created_at) into first_load from roster_imports where kind = 'roster' and status = 'applied';
  if first_load is null then return 0; end if;

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

  update soldiers s set opening_score = o.score, opening_score_at = now()
  from _open o where o.soldier_id = s.id;
  get diagnostics n = row_count;
  update cycle_soldier_snapshot sn set baseline_score = sn.baseline_score + o.score
  from _open o where sn.cycle_id = p_cycle and sn.soldier_id = o.soldier_id;
  drop table _new; drop table _open;
  return n;
end $$;
revoke execute on function app.grant_opening_scores(uuid) from anon, public;

create or replace function public.snapshot_cycle(p_cycle uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
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
  cross join lateral (select app.service_on(s.career_start_date, s.service_type, c.start_date) as v) svc
  cross join lateral (
    select case when s.parent_override is not null
                 and (s.parent_override_until is null or s.parent_override_until >= c.start_date)
                then s.parent_override else s.parent_status end as v
  ) parent
  left join lateral (
    select
      sum(a.normalized_points) filter (where a.status in ('done', 'reserve_activated'))  as points,
      sum(a.weekend_units)     filter (where a.status in ('done', 'reserve_activated'))  as weekends,
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
end $$;
