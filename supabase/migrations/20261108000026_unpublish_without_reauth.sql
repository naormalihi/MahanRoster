-- =============================================================================
-- Unpublish: no sign-in again. The confirmation is the warning, choosing the cycle from a
-- list (its name must match) and a reason; coordinator only, before the cycle starts.
-- =============================================================================

create or replace function public.unpublish_cycle(p_cycle uuid, p_reason text, p_confirm_name text) returns int
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
  if trim(coalesce(p_confirm_name, '')) <> trim(c.name) then
    raise exception 'שם המחזור שהוקלד לא תואם';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'חובה לכתוב נימוק';
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
          jsonb_build_object('status', 'review', 'reason', trim(p_reason), 'assignments_returned', n));

  update cycles set status = 'review', published_at = null, published_by = null where id = p_cycle;
  return n;
end $$;

