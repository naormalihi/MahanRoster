-- =============================================================================
-- Unpublish: the action is taken from inside the cycle, so a clear warning is the whole
-- confirmation – no sign-in again, no typing or choosing the cycle, no reason field.
-- Still coordinator only and only before the cycle starts; the audit log keeps who,
-- when and how many assignments went back to draft.
-- =============================================================================

drop function if exists public.unpublish_cycle(uuid, text, text);

create function public.unpublish_cycle(p_cycle uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c   cycles;
  n   int;
begin
  perform app.require_staff();
  if not app.has_role('coordinator') then
    raise exception 'רק נע"ת התורנויות יכול לבטל פרסום';
  end if;
  select * into c from cycles where id = p_cycle for update;
  if not found then raise exception 'cycle % not found', p_cycle; end if;
  if c.status <> 'published' then
    raise exception 'המחזור לא במצב "פורסם"';
  end if;
  if c.start_date <= (now() at time zone app.tz())::date
     or exists (select 1 from slots s where s.cycle_id = p_cycle and s.cancelled_at is null and s.starts_at <= now()) then
    raise exception 'המחזור כבר התחיל. שינויים במחזור שרץ נעשים בתפעול השוטף.';
  end if;

  update assignments a set status = 'draft'
  from slots s
  where s.id = a.slot_id and s.cycle_id = p_cycle and a.status in ('assigned', 'reserve_idle');
  get diagnostics n = row_count;

  insert into audit_log (actor_user_id, action, entity_type, entity_id, before, after)
  values (auth.uid(), 'unpublish', 'cycles', p_cycle::text,
          jsonb_build_object('status', c.status, 'published_at', c.published_at, 'published_by', c.published_by),
          jsonb_build_object('status', 'review', 'assignments_returned', n));

  update cycles set status = 'review', published_at = null, published_by = null where id = p_cycle;
  return n;
end $$;

revoke execute on function public.unpublish_cycle(uuid) from anon, public;
grant execute on function public.unpublish_cycle(uuid) to authenticated;
