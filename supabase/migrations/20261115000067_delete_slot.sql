-- Deleting a duty from the board, also after publishing and with people on it: a duty added by
-- mistake, or one that was called off. Only before it starts – a duty that started is history.
-- Its people come off with it (and their points); the deletion, who was on it and why are kept
-- in the audit log. A duty that serves as a penalty stays.

create or replace function public.delete_slot(p_slot uuid, p_reason text default null) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  k slots;
  people jsonb;
  n int;
begin
  perform app.require_staff();
  select * into k from slots where id = p_slot;
  if not found then raise exception 'התורנות לא נמצאה'; end if;
  if k.starts_at <= now() then raise exception 'התורנות כבר התחילה – אי אפשר למחוק אותה'; end if;
  if exists (select 1 from penalties where penalty_slot_id = p_slot) then
    raise exception 'התורנות משמשת כתורנות עונש – אי אפשר למחוק אותה';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('soldier_id', a.soldier_id, 'role', a.role, 'status', a.status, 'points', a.points)), '[]'),
         count(*) filter (where a.status <> 'draft')
    into people, n
    from assignments a where a.slot_id = p_slot;
  if n > 0 and coalesce(btrim(p_reason), '') = '' then
    raise exception 'בתורנות יש שיבוץ מפורסם – צריך לכתוב סיבה למחיקה';
  end if;
  insert into audit_log (actor_user_id, action, entity_type, entity_id, before, after)
  values (auth.uid(), 'slot.delete', 'slot', p_slot::text,
          to_jsonb(k) || jsonb_build_object('people', people),
          jsonb_build_object('reason', nullif(btrim(p_reason), '')));
  delete from slots where id = p_slot;  -- its assignments go with it (on delete cascade)
  return n;
end $$;
revoke execute on function public.delete_slot(uuid, text) from anon, public;
grant execute on function public.delete_slot(uuid, text) to authenticated;
