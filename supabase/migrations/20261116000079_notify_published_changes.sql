-- =============================================================================
-- Soldiers hear about every change to a published board.
--
-- Until now a notification went out only on a status change of an assignment, so three
-- changes reached nobody:
--   * delete_slot      – the duty and its rows are deleted; no status change fires
--                        → "התורנות בוטלה" to the performer and the reserve
--   * undoing an activation – the performer gets his duty back (dropped → assigned) and the
--                        reserve goes back to standing by (reserve_activated → reserve_idle)
--                        → "חזרת לתורנות" / "הפעלת העתודה בוטלה"
--   * unpublish_cycle  – rows go back to draft, which the trigger ignores on purpose
--                        → one "לוח התורנויות חזר לעדכון" per soldier on the board
--
-- Also fixed: undoing an activation on a duty that was assigned by hand failed the check
-- "a manual row has a reason" (the undo cleared the reason). It now keeps one.
-- =============================================================================

CREATE OR REPLACE FUNCTION app.on_assignment_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  sl slots;
  c cycles;
  task text;
  what text;
begin
  if tg_op = 'UPDATE' and (old.status = 'draft' or new.status = 'draft' or old.status = new.status) then return null; end if;
  if tg_op = 'INSERT' and new.status = 'draft' then return null; end if;
  select * into sl from slots where id = new.slot_id;
  if sl.starts_at <= now() or sl.cancelled_at is not null then return null; end if;
  select * into c from cycles where id = sl.cycle_id;
  if c.status <> 'published' then return null; end if;
  select name into task from task_types where id = sl.task_type_id;
  what := task || ', ' || app.when_text(sl.starts_at);

  if tg_op = 'INSERT' and new.status in ('assigned', 'reserve_idle') then
    perform app.notify_soldier(new.soldier_id, 'duty_added',
      case when new.role = 'performer' then 'שובצת לתורנות' else 'שובצת כעתודה' end, what, '/',
      jsonb_build_object('assignment_id', new.id));
  elsif tg_op = 'UPDATE' and new.status = 'reserve_activated' then
    perform app.notify_soldier(new.soldier_id, 'reserve_activated', 'העתודה שלך הופעלה – אתה מבצע את התורנות', what, '/',
      jsonb_build_object('assignment_id', new.id), true);
  elsif tg_op = 'UPDATE' and old.status = 'reserve_activated' and new.status = 'reserve_idle' then
    -- the activation was undone: back to standing by
    perform app.notify_soldier(new.soldier_id, 'activation_undone', 'הפעלת העתודה בוטלה – אתה שוב עתודה', what, '/',
      jsonb_build_object('assignment_id', new.id), true);
  elsif tg_op = 'UPDATE' and old.status in ('dropped', 'done') and new.status in ('assigned', 'reserve_idle') then
    -- put back on the duty (an undone activation gives the performer his duty back)
    perform app.notify_soldier(new.soldier_id, 'duty_restored',
      case when new.role = 'performer' then 'חזרת לתורנות' else 'חזרת להיות עתודה' end, what, '/',
      jsonb_build_object('assignment_id', new.id), true);
  elsif tg_op = 'UPDATE' and new.status in ('dropped', 'cancelled_approved', 'swapped_out')
        and old.status in ('assigned', 'reserve_idle', 'reserve_activated') then
    perform app.notify_soldier(new.soldier_id, 'duty_removed', 'תורנות ירדה ממך', what, '/',
      jsonb_build_object('assignment_id', new.id));
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.delete_slot(p_slot uuid, p_reason text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  k slots;
  people jsonb;
  n int;
  what text;
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
  -- whoever holds it hears that it is cancelled (deleting the rows fires no status change)
  if exists (select 1 from cycles c where c.id = k.cycle_id and c.status = 'published') then
    what := coalesce(k.special_name, (select name from task_types where id = k.task_type_id)) || ', ' || app.when_text(k.starts_at);
    perform app.notify_soldier(a.soldier_id, 'duty_removed', 'התורנות בוטלה', what, '/',
                               jsonb_build_object('slot_id', p_slot), true)
      from assignments a
     where a.slot_id = p_slot and a.status in ('assigned', 'reserve_idle', 'reserve_activated');
  end if;
  delete from slots where id = p_slot;  -- its assignments go with it (on delete cascade)
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.unpublish_cycle(p_cycle uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- everyone on the published board hears once that it is being updated
  perform app.notify_soldier(x.soldier_id, 'board_withdrawn', 'לוח התורנויות חזר לעדכון',
                             'הלוח של ' || c.name || ' בעדכון. תקבל הודעה כשיפורסם מחדש.', '/')
    from (select distinct a.soldier_id from assignments a join slots s on s.id = a.slot_id
          where s.cycle_id = p_cycle and s.cancelled_at is null and a.status in ('assigned', 'reserve_idle', 'reserve_activated')) x;

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
end $function$;

CREATE OR REPLACE FUNCTION public.undo_reserve_activation(p_reserve uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
         manual_reason = case when source = 'manual' then 'הפעלת העתודה בוטלה' end, received_via = 'system', received_at = now()
   where id = p.id;

  select * into pts from app.slot_points_units(sl.id, r.soldier_id, 0, null);
  update assignments set status = 'reserve_idle', points = pts.raw, normalized_points = pts.normalized,
         weekend_units = app.weekend_units(sl.starts_at, sl.ends_at),
         replaced_assignment_id = null, manual_reason = case when source = 'manual' then 'הפעלת העתודה בוטלה' end, received_via = 'system', received_at = now()
   where id = r.id;
end $function$;
