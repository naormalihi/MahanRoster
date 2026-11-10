-- Deleting a duty that waits for staffing after publishing (added by mistake, or no longer
-- needed). Only while nothing on it is published: its engine proposals (drafts) go with it.
-- A duty with a published performer or reserve stays – changes to it go through the board.

create or replace function public.delete_pending_slot(p_slot uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.require_staff();
  if not exists (select 1 from slots where id = p_slot) then
    raise exception 'התורנות לא נמצאה';
  end if;
  if exists (select 1 from assignments where slot_id = p_slot and status <> 'draft') then
    raise exception 'בתורנות יש שיבוץ מפורסם – אי אפשר למחוק אותה';
  end if;
  if exists (select 1 from penalties where penalty_slot_id = p_slot) then
    raise exception 'התורנות משמשת כתורנות עונש – אי אפשר למחוק אותה';
  end if;
  delete from slots where id = p_slot;  -- draft assignments go with it (on delete cascade)
end $$;
revoke execute on function public.delete_pending_slot(uuid) from anon, public;
grant execute on function public.delete_pending_slot(uuid) to authenticated;
