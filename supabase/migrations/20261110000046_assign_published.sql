-- Manual staffing of a published duty that waits (added after publishing, left unfilled by the
-- engine, or missing a reserve after an activation). The coordinator picks a soldier from the
-- candidates; breaking a rule is allowed with a reason (the screen asks for it). The person goes
-- straight onto the published board – performer as 'assigned', reserve as 'reserve_idle' – and the
-- engine's proposals for that role in that duty are dropped.

create or replace function public.assign_published(p_slot uuid, p_role assignment_role, p_soldier uuid, p_reason text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s      slots;
  c      cycles;
  pts    record;
  have   int;
  need   int;
  new_id uuid;
begin
  perform app.require_staff();
  select * into s from slots where id = p_slot for update;
  if not found then raise exception 'התורנות לא נמצאה'; end if;
  select * into c from cycles where id = s.cycle_id;
  if c.status <> 'published' then
    raise exception 'המחזור לא מפורסם – לפני פרסום משבצים בטיוטה';
  end if;
  if s.ends_at <= now() then raise exception 'התורנות כבר הסתיימה'; end if;
  if exists (select 1 from assignments a where a.slot_id = p_slot and a.soldier_id = p_soldier
             and a.status not in ('draft', 'dropped', 'cancelled_approved', 'swapped_out')) then
    raise exception 'החייל כבר משובץ בתורנות הזו';
  end if;

  if p_role = 'performer' then
    select count(*) into have from assignments a where a.slot_id = p_slot
       and ((a.role = 'performer' and a.status not in ('draft', 'dropped', 'cancelled_approved', 'swapped_out'))
            or a.status = 'reserve_activated');
    need := s.performers_needed;
  else
    select count(*) into have from assignments a where a.slot_id = p_slot and a.role = 'reserve' and a.status = 'reserve_idle';
    need := s.reserves_needed;
  end if;
  if have >= need then raise exception 'התפקיד הזה בתורנות כבר מאויש'; end if;

  -- the engine's proposals for this role (and anything of this soldier) in the duty give way
  delete from assignments where slot_id = p_slot and status = 'draft' and (role = p_role or soldier_id = p_soldier);

  select * into pts from app.slot_points(p_slot, p_soldier);
  insert into assignments (slot_id, soldier_id, gaf_id, role, status, is_penalty, points, factor_at_time,
                           normalized_points, weekend_units, explanation, manual_reason, source, received_via, received_at)
  select p_slot, so.id, so.gaf_id, p_role,
         case when p_role = 'performer' then 'assigned'::assignment_status else 'reserve_idle'::assignment_status end,
         s.is_penalty_slot, pts.raw,
         case when pts.normalized > 0 then round(pts.raw / pts.normalized, 2) else 1 end,
         pts.normalized,
         case when not s.is_penalty_slot then app.weekend_units(s.starts_at, s.ends_at) else 0 end,
         'שיבוץ ידני אחרי פרסום' || coalesce(': ' || nullif(trim(p_reason), ''), ''),
         coalesce(nullif(trim(p_reason), ''), 'שיבוץ ידני אחרי פרסום'), 'manual', 'system', now()
  from soldiers so where so.id = p_soldier
  returning id into new_id;
  if new_id is null then raise exception 'החייל לא נמצא'; end if;

  if p_role = 'performer' then
    update assignments set paired_assignment_id = new_id
     where slot_id = p_slot and role = 'reserve' and paired_assignment_id is null
       and status not in ('draft', 'dropped', 'cancelled_approved', 'swapped_out');
  else
    update assignments set paired_assignment_id = (
      select p.id from assignments p where p.slot_id = p_slot
        and (p.role = 'performer' or p.status = 'reserve_activated')
        and p.status not in ('draft', 'dropped', 'cancelled_approved', 'swapped_out') order by p.created_at limit 1)
     where id = new_id;
  end if;
  return new_id;
end $$;
revoke execute on function public.assign_published(uuid, assignment_role, uuid, text) from anon, public;
grant execute on function public.assign_published(uuid, assignment_role, uuid, text) to authenticated;
