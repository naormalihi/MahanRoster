-- =============================================================================
-- Why a cell of the potential matrix is a fraction: which days of the cycle the soldier is
-- out for this duty, and for what – "שחרור 07.02.2027 · 143 ימים", "היעדרות (חופשה) 10–15.03".
-- The same rules as app.potential_unavailable, one row a cause; causes may overlap, so the
-- days of the rows can add up to more than the days missing.
-- For whoever may see that soldier (as the reasons in public.potential_matrix).
-- =============================================================================

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
    select 'grace', 'נכנס ליחידה ' || to_char(s.unit_join_date, 'DD.MM.YYYY') || ' · ' || grace || ' יום חסד',
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

revoke execute on function public.potential_cell_why(uuid, uuid, uuid) from public, anon;
grant execute on function public.potential_cell_why(uuid, uuid, uuid) to authenticated;
