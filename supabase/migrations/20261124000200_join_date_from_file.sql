-- A newcomer is decided by his join date (תאריך קליטה) – from the personnel file, or entered by hand –
-- never guessed. Until now a soldier added after the first personnel load got the later of that day
-- and the cycle's start as his join date; so deleting the soldiers and loading the file again (or
-- loading it in parts) made everyone "new": 90 days of grace and an opening score.
--
-- grant_opening_scores: no join date is set here any more. The opening score (his group's average)
-- goes to one whose grace period still runs at the cycle's start, or who joins during it.
-- Clean-up: the guessed join dates are cleared (a date entered by hand – add_soldier, reactivate –
-- stays), and so are the opening scores of those who are no longer newcomers. The next
-- "חישוב מחדש" in the potential screen rebuilds the cycle's snapshot.

create or replace function app.grant_opening_scores(p_cycle uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c_start date;
  grace   int := coalesce((app.setting('grace_days') #>> '{}')::int, 0);
  n int;
begin
  select start_date into c_start from cycles where id = p_cycle;

  create temp table _new on commit drop as
    select sn.soldier_id, sn.fairness_group, sn.balance_population
    from cycle_soldier_snapshot sn join soldiers s on s.id = sn.soldier_id
    where sn.cycle_id = p_cycle and s.opening_score_at is null
      and s.unit_join_date is not null and s.unit_join_date + grace > c_start;

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

-- the guessed join dates go; one entered by hand stays
update soldiers s set unit_join_date = null
 where s.unit_join_date is not null
   and not exists (select 1 from audit_log l
                    where l.entity_type = 'soldiers' and l.entity_id = s.id::text
                      and l.action in ('add_soldier', 'reactivate_soldier'));
-- an opening score belongs to a newcomer only
update soldiers set opening_score = null, opening_score_at = null
 where opening_score_at is not null and unit_join_date is null;

-- "למה לא 1" in the potential matrix: the same word as everywhere – תאריך קליטה
create or replace function public.potential_cell_why(p_cycle uuid, p_soldier uuid, p_task_type uuid)
returns table (cause text, detail text, from_day date, to_day date, days int)
language plpgsql stable security definer set search_path = public, pg_temp as $$
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
end $$;
