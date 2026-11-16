-- =============================================================================
-- Taking someone off a published duty, to put someone else on it: נע"ת removes the performer
-- (or an idle reserve) with a reason, before the duty starts. The row stays as 'dropped' (it no
-- longer counts), the soldier is notified by the board-change trigger, and the duty waits in
-- "duties waiting to be staffed" for the replacement. Once a duty started, a reserve is
-- activated instead.
-- =============================================================================

create or replace function public.unassign_published(p_assignment uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a assignments;
  s slots;
  c cycles;
begin
  perform app.require_staff();
  if coalesce(trim(p_reason), '') = '' then raise exception 'חובה לכתוב סיבה'; end if;
  select * into a from assignments where id = p_assignment for update;
  if not found then raise exception 'השיבוץ לא נמצא'; end if;
  select * into s from slots where id = a.slot_id;
  select * into c from cycles where id = s.cycle_id;
  if c.status not in ('published', 'closed') then raise exception 'המחזור לא מפורסם – לפני פרסום משנים בטיוטה'; end if;
  if s.starts_at <= now() then raise exception 'התורנות כבר התחילה – במקום הסרה מפעילים עתודה'; end if;
  if not ((a.role = 'performer' and a.status = 'assigned') or (a.role = 'reserve' and a.status = 'reserve_idle')) then
    raise exception 'אפשר להסיר רק מבצע משובץ או עתודה שלא הופעלה';
  end if;
  update assignments set paired_assignment_id = null where paired_assignment_id = a.id;
  update assignments set status = 'dropped', manual_reason = trim(p_reason) where id = a.id;
  insert into audit_log (actor_user_id, action, entity_type, entity_id, before, after)
  values (auth.uid(), 'unassign_published', 'assignments', a.id::text, to_jsonb(a), jsonb_build_object('reason', trim(p_reason)));
end $$;

revoke execute on function public.unassign_published(uuid, text) from anon, public;
grant execute on function public.unassign_published(uuid, text) to authenticated, service_role;
