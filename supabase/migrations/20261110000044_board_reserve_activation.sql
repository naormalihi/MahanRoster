-- Reserve activation from the published board (staff): the board marks who came in as an
-- activated reserve and whom he replaced, and an activation can be undone while the duty has
-- not started – the performer is back on duty and the reserve is a reserve again.

create or replace view published_board with (security_barrier = true) as
select
  s.id                                              as slot_id,
  c.id                                              as cycle_id,
  s.starts_at,
  s.ends_at,
  tt.name                                           as task_name,
  dc.name                                           as category_name,
  tt.color,
  coalesce(array_agg(so.full_name order by so.full_name) filter (where a.role = 'performer' or a.status = 'reserve_activated'), '{}') as performers,
  coalesce(array_agg(so.full_name order by so.full_name) filter (where a.role = 'reserve' and a.status <> 'reserve_activated'),   '{}') as reserves,
  coalesce(array_agg(distinct g.name) filter (where a.role = 'performer' or a.status = 'reserve_activated'), '{}')                   as gafim,
  s.report_at,
  s.report_place,
  s.briefing_at,
  s.briefing_place,
  greatest(s.updated_at, max(a.updated_at))         as updated_at,
  greatest(s.updated_at, max(a.updated_at)) > c.published_at as changed_after_publish,
  s.instructions,
  coalesce(array_agg(coalesce(g.name, '') order by so.full_name) filter (where a.role = 'performer' or a.status = 'reserve_activated'), '{}') as performer_gafim,
  coalesce(array_agg(coalesce(g.name, '') order by so.full_name) filter (where a.role = 'reserve' and a.status <> 'reserve_activated'),   '{}') as reserve_gafim,
  coalesce(array_agg(so.full_name order by so.full_name) filter (where a.status = 'reserve_activated'), '{}') as activated,
  coalesce((select array_agg(so2.full_name order by so2.full_name)
            from assignments ra join assignments rp on rp.id = ra.replaced_assignment_id join soldiers so2 on so2.id = rp.soldier_id
            where ra.slot_id = s.id and ra.status = 'reserve_activated'), '{}')                                as replaced
from slots s
join cycles c          on c.id = s.cycle_id and c.status in ('published', 'closed')
join task_types tt     on tt.id = s.task_type_id
left join duty_categories dc on dc.id = tt.category_id
left join assignments a on a.slot_id = s.id
                       and a.status not in ('draft', 'dropped', 'cancelled_approved', 'swapped_out')
left join soldiers so  on so.id = a.soldier_id
left join org_units g  on g.id = a.gaf_id
where s.cancelled_at is null
  and app.can_view_board()
group by s.id, c.id, tt.name, dc.name, tt.color;

create or replace function public.undo_reserve_activation(p_reserve uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r   assignments;
  p   assignments;
  sl  slots;
  pts record;
begin
  perform app.require_staff();
  select * into r from assignments where id = p_reserve for update;
  if not found or r.status <> 'reserve_activated' then
    raise exception 'זו לא עתודה שהופעלה';
  end if;
  select * into sl from slots where id = r.slot_id;
  if sl.starts_at <= now() then
    raise exception 'התורנות כבר התחילה – אי אפשר לבטל את ההפעלה';
  end if;
  select * into p from assignments where id = r.replaced_assignment_id for update;
  if not found or p.status not in ('dropped', 'done') then
    raise exception 'לא נמצא המבצע שהוחלף';
  end if;
  if exists (select 1 from exemptions e
             where e.soldier_id = p.soldier_id and e.status = 'approved'
               and e.start_date <= (sl.ends_at at time zone app.tz())::date
               and e.end_date >= (sl.starts_at at time zone app.tz())::date) then
    raise exception 'למבצע יש פטור מאושר בתאריכי התורנות – אי אפשר להחזיר אותו';
  end if;

  select * into pts from app.slot_points_units(sl.id, p.soldier_id, 0, null);
  update assignments set status = 'assigned', points = pts.raw, normalized_points = pts.normalized,
         weekend_units = app.weekend_units(sl.starts_at, sl.ends_at),
         manual_reason = null, received_via = 'system', received_at = now()
   where id = p.id;

  select * into pts from app.slot_points_units(sl.id, r.soldier_id, 0, null);
  update assignments set status = 'reserve_idle', points = pts.raw, normalized_points = pts.normalized,
         weekend_units = app.weekend_units(sl.starts_at, sl.ends_at),
         replaced_assignment_id = null, manual_reason = null, received_via = 'system', received_at = now()
   where id = r.id;
end $$;
revoke execute on function public.undo_reserve_activation(uuid) from anon, public;
grant execute on function public.undo_reserve_activation(uuid) to authenticated;
