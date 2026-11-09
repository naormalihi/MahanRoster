-- An exemption approved after publishing frees the soldier's published duties it covers
-- (the spec's "ביטול מראש" with "הקפצת עתודה תמיד"):
--   * as performer: the reserve of the slot becomes the performer (reserve_activated, with the
--     points); in a multi-day duty already under way, from the exemption's first day – the
--     performer keeps the days before it. With no reserve the performer is dropped and the slot
--     waits for the engine on the "תפעול" step.
--   * as reserve: dropped; the slot waits for a new reserve the same way.
-- Only duties that have not ended, in published cycles, that the exemption covers (its duties
-- and hours). Applied when an exemption becomes approved, and once now for exemptions entered
-- after their cycle was published.

-- The core of activate_reserve, without the permission check (the callers check).
create or replace function app.activate_reserve_core(p_reserve uuid, p_performer uuid, p_from_unit int, p_note text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r   assignments;
  p   assignments;
  sl  slots;
  pts record;
begin
  select * into r from assignments where id = p_reserve for update;
  select * into p from assignments where id = p_performer for update;
  select * into sl from slots where id = r.slot_id;
  if p_from_unit <= 0 then
    update assignments set status = 'dropped', points = 0, normalized_points = 0, weekend_units = 0,
           manual_reason = coalesce(p_note, 'העתודה הופעלה'), received_via = 'system', received_at = now()
     where id = p.id;
  else
    select * into pts from app.slot_points_units(sl.id, p.soldier_id, 0, p_from_unit);
    update assignments set status = 'done', points = pts.raw, normalized_points = pts.normalized,
           weekend_units = app.weekend_units(sl.starts_at, least(sl.ends_at, sl.starts_at + p_from_unit * interval '24 hours')),
           manual_reason = coalesce(p_note, 'העתודה הופעלה מהיממה ה-' || (p_from_unit + 1)),
           received_via = 'system', received_at = now()
     where id = p.id;
  end if;
  select * into pts from app.slot_points_units(sl.id, r.soldier_id, greatest(p_from_unit, 0), null);
  update assignments set status = 'reserve_activated', points = pts.raw, normalized_points = pts.normalized,
         factor_at_time = case when pts.normalized > 0 then round(pts.raw / pts.normalized, 2) else 1 end,
         weekend_units = app.weekend_units(sl.starts_at + greatest(p_from_unit, 0) * interval '24 hours', sl.ends_at),
         replaced_assignment_id = p.id,
         manual_reason = coalesce(p_note, 'עתודה שהופעלה'), received_via = 'system', received_at = now()
   where id = r.id;
end $$;
revoke execute on function app.activate_reserve_core(uuid, uuid, int, text) from anon, public, authenticated;

-- Duties an approved exemption frees; returns how many assignments changed.
create or replace function app.release_for_exemption(p_exemption uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e     exemptions;
  et    exemption_types;
  a     record;
  res   uuid;
  n     int := 0;
  from_unit int;
  note  text;
begin
  select * into e from exemptions where id = p_exemption;
  select * into et from exemption_types where id = e.exemption_type_id;
  if e.status <> 'approved' or et.qualifies_day_only then
    return 0;
  end if;
  note := 'פטור ' || et.name || ' שאושר אחרי הפרסום';
  for a in
    select x.id, x.role, x.slot_id, sl.starts_at, sl.ends_at
    from assignments x
    join slots sl on sl.id = x.slot_id and sl.cancelled_at is null
    join cycles c on c.id = sl.cycle_id and c.status = 'published'
    cross join lateral (select app.exemption_scope(e.exemption_type_id, e.excluded_task_type_ids) as scope) sc
    where x.soldier_id = e.soldier_id
      and x.status in ('assigned', 'reserve_idle')
      and sl.ends_at > now()
      and (sl.starts_at at time zone app.tz())::date <= e.end_date
      and ((sl.ends_at - interval '1 second') at time zone app.tz())::date >= e.start_date
      and (sc.scope is null or sl.task_type_id = any (sc.scope))
      and (e.restricted_hours is null or app.slot_window_minutes(e.restricted_hours, sl) > 0)
  loop
    if a.role = 'reserve' then
      update assignments set status = 'dropped', manual_reason = note, received_via = 'system', received_at = now()
       where id = a.id;
    else
      -- the days of the duty before the exemption starts stay with the performer
      from_unit := greatest(0, e.start_date - (a.starts_at at time zone app.tz())::date);
      select id into res from assignments
       where slot_id = a.slot_id and role = 'reserve' and status = 'reserve_idle' and soldier_id <> e.soldier_id
       order by (paired_assignment_id = a.id) desc nulls last, created_at
       limit 1;
      if res is not null then
        perform app.activate_reserve_core(res, a.id, from_unit, note);
      else
        update assignments set status = 'dropped', points = 0, normalized_points = 0, weekend_units = 0,
               manual_reason = note || ' – אין עתודה', received_via = 'system', received_at = now()
         where id = a.id;
      end if;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function app.release_for_exemption(uuid) from anon, public, authenticated;

create or replace function app.on_exemption_approved() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved'
                                  or old.start_date <> new.start_date or old.end_date <> new.end_date) then
    perform app.release_for_exemption(new.id);
  end if;
  return null;
end $$;
drop trigger if exists exemptions_release_duties on exemptions;
create trigger exemptions_release_duties after insert or update on exemptions
  for each row execute function app.on_exemption_approved();

-- activate_reserve keeps its checks and uses the core
create or replace function public.activate_reserve(p_reserve uuid, p_from_unit int default 0,
                                                    p_performer uuid default null, p_note text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r   assignments;
  p   assignments;
  sl  slots;
  n   int;
begin
  perform app.require_staff();
  select * into r from assignments where id = p_reserve;
  if not found or r.role <> 'reserve' or r.status <> 'reserve_idle' then
    raise exception 'זו לא עתודה פעילה בלוח המפורסם';
  end if;
  select * into sl from slots where id = r.slot_id;
  if not exists (select 1 from cycles where id = sl.cycle_id and status = 'published') then
    raise exception 'הפעלת עתודה נעשית במחזור שפורסם';
  end if;
  select * into p from assignments
  where slot_id = sl.id and role = 'performer' and status = 'assigned'
    and (id = p_performer or (p_performer is null and (id = r.paired_assignment_id or
         (select count(*) from assignments x where x.slot_id = sl.id and x.role = 'performer' and x.status = 'assigned') = 1)))
  order by (id = r.paired_assignment_id) desc
  limit 1;
  if not found then
    raise exception 'לא נמצא מבצע להחלפה – בחר את המבצע';
  end if;
  n := ceil(extract(epoch from sl.ends_at - sl.starts_at) / 86400)::int;
  if p_from_unit is null or p_from_unit < 0 or p_from_unit >= greatest(n, 1) then
    raise exception 'יום ההחלפה מחוץ לתורנות';
  end if;
  perform app.activate_reserve_core(r.id, p.id, p_from_unit, p_note);
end $$;

-- Once now: exemptions entered after their cycle was published.
do $$
declare x record;
begin
  for x in
    select distinct e.id from exemptions e
    join cycles c on c.status = 'published' and c.published_at is not null
                 and e.created_at > c.published_at
                 and e.start_date <= c.end_date and e.end_date >= c.start_date
    where e.status = 'approved'
  loop
    perform app.release_for_exemption(x.id);
  end loop;
end $$;
