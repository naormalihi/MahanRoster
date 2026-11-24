-- =============================================================================
-- A note on a duty ("הערה"): the third column of the duties file, kept in slots.instructions
-- (already shown on the board). Up to 300 characters, shown as written.
--
-- * public.set_slot_note(slot, note): staff edit it by hand. On a published board the
--   performer and the reserve of the duty are told in the bell.
-- * my_duties returns it ("המשימות שלי"); duty_message carries it to the WhatsApp message;
--   the day-before reminder ends with it, cut to 60 characters.
-- =============================================================================

alter table slots drop constraint if exists slots_instructions_len;
update slots set instructions = left(instructions, 300) where length(instructions) > 300;
alter table slots add constraint slots_instructions_len check (length(instructions) <= 300);

create or replace function app.short_note(p text) returns text
language sql immutable as $$
  select case when nullif(btrim(p), '') is null then null
              when length(btrim(regexp_replace(p, '\s+', ' ', 'g'))) <= 60 then btrim(regexp_replace(p, '\s+', ' ', 'g'))
              else left(btrim(regexp_replace(p, '\s+', ' ', 'g')), 59) || '…' end
$$;

create or replace function public.set_slot_note(p_slot uuid, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s record;
  v text := nullif(btrim(regexp_replace(coalesce(p_note, ''), '\r\n?', E'\n', 'g')), '');
  r record;
begin
  perform app.require_staff();
  if length(v) > 300 then raise exception 'הערה – עד 300 תווים'; end if;
  select sl.id, sl.instructions, sl.starts_at, sl.ends_at, sl.cancelled_at, c.status as cycle_status,
         coalesce(sl.special_name, t.name) as task
    into s
    from slots sl join cycles c on c.id = sl.cycle_id join task_types t on t.id = sl.task_type_id
   where sl.id = p_slot;
  if s.id is null then raise exception 'המשבצת לא נמצאה'; end if;
  if s.instructions is not distinct from v then return; end if;
  update slots set instructions = v, updated_at = now() where id = p_slot;
  -- on a published board, whoever holds the duty hears about it
  if s.cycle_status = 'published' and s.cancelled_at is null and s.ends_at > now() then
    for r in
      select distinct a.soldier_id from assignments a
       where a.slot_id = p_slot and a.status in ('assigned', 'reserve_idle', 'reserve_activated')
    loop
      perform app.notify_soldier(r.soldier_id, 'duty_note',
        case when v is null then 'הוסרה ההערה למשימה' else 'עודכנה הערה למשימה' end,
        s.task || ', ' || app.when_text(s.starts_at) || coalesce('. ' || v, ''), '/');
    end loop;
  end if;
end $$;
revoke execute on function public.set_slot_note(uuid, text) from public, anon;
grant execute on function public.set_slot_note(uuid, text) to authenticated;

drop function if exists public.my_duties();
CREATE OR REPLACE FUNCTION public.my_duties()
 RETURNS TABLE(assignment_id uuid, cycle_id uuid, cycle_name text, task_name text, starts_at timestamp with time zone, ends_at timestamp with time zone, role assignment_role, status assignment_status, points numeric, explanation text, report_at timestamp with time zone, report_place text, briefing_at timestamp with time zone, briefing_place text, equipment text, briefing_by_call boolean, contact_name text, contact_phone text, briefing_note text, acked_at timestamp with time zone, note text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select a.id, c.id, c.name, coalesce(sl.special_name, t.name), sl.starts_at, sl.ends_at, a.role, a.status, a.normalized_points, a.explanation,
         coalesce(sl.report_at, case when b.kind = 'report' then b.at end),
         coalesce(sl.report_place, case when b.kind = 'report' then b.place end),
         coalesce(sl.briefing_at, case when b.kind = 'briefing' then b.at end),
         coalesce(sl.briefing_place, case when b.kind in ('briefing', 'by_call') then b.place end),
         sl.equipment,
         coalesce(b.kind = 'by_call' and sl.briefing_at is null, false),
         b.contact_name, b.contact_phone, b.note, a.acked_at, sl.instructions
  from assignments a
  join slots sl on sl.id = a.slot_id
  join cycles c on c.id = sl.cycle_id and c.status in ('published', 'closed')
  join task_types t on t.id = sl.task_type_id
  left join lateral app.slot_brief(sl.id) b on true
  where a.soldier_id = app.my_soldier()
    and a.status not in ('draft', 'dropped', 'swapped_out', 'cancelled_approved')
    and sl.cancelled_at is null
  order by sl.starts_at
$function$;

revoke execute on function public.my_duties() from public, anon;
grant execute on function public.my_duties() to authenticated;

CREATE OR REPLACE FUNCTION app.queue_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  n int := 0; r record; brief text;
  lead interval := make_interval(hours => least(72, greatest(2, coalesce((app.setting('briefing_reminder_hours') #>> '{}')::int, 24))));
begin
  -- the day before a duty (performer, on a published board), once per duty
  for r in
    select a.id, a.soldier_id, sl.id as slot_id, sl.starts_at, coalesce(sl.special_name, t.name) as task, sl.instructions as note
    from assignments a join slots sl on sl.id = a.slot_id join cycles c on c.id = sl.cycle_id and c.status = 'published'
    join task_types t on t.id = sl.task_type_id
    where a.role = 'performer' and a.status in ('assigned', 'reserve_activated') and sl.cancelled_at is null
      and sl.starts_at between now() + interval '12 hours' and now() + interval '36 hours'
      and not exists (select 1 from notifications x where x.type = 'duty_reminder' and x.payload->>'assignment_id' = a.id::text)
  loop
    -- an early briefing has its own reminder; here only the reporting / a briefing near the start
    brief := case when app.early_brief_at(r.slot_id) is null then app.brief_text(r.slot_id) end;
    n := n + app.notify_soldier(r.soldier_id, 'duty_reminder', 'תזכורת: משימת מחר',
      r.task || ', ' || app.when_text(r.starts_at) || coalesce('. ' || brief, '') || coalesce('. ' || app.short_note(r.note), ''),
      '/', jsonb_build_object('assignment_id', r.id));
  end loop;

  -- a briefing well before the start: its own reminder, lead hours before it, once per duty
  for r in
    select a.id, a.soldier_id, sl.id as slot_id, coalesce(sl.special_name, t.name) as task, x.at_
    from assignments a join slots sl on sl.id = a.slot_id join cycles c on c.id = sl.cycle_id and c.status = 'published'
    join task_types t on t.id = sl.task_type_id
    cross join lateral (select app.early_brief_at(sl.id) as at_) x
    where a.role = 'performer' and a.status in ('assigned', 'reserve_activated') and sl.cancelled_at is null
      and sl.starts_at > now() and sl.starts_at < now() + interval '10 days'
      and x.at_ is not null
      and now() >= x.at_ - lead and now() < x.at_ - interval '1 hour'
      -- got the duty (or saw the board) after the reminder's time: the assignment message said it
      and a.created_at <= x.at_ - lead and c.published_at <= x.at_ - lead
      and not exists (select 1 from notifications y where y.type = 'briefing_reminder' and y.payload->>'assignment_id' = a.id::text)
  loop
    n := n + app.notify_soldier(r.soldier_id, 'briefing_reminder',
      'תזכורת: ' || case when (select kind from app.slot_brief(r.slot_id)) = 'report'
                              and (select briefing_at from slots where id = r.slot_id) is null
                         then 'התייצבות' else 'תדריך' end || ' למשימה',
      r.task || ' – ' || app.brief_text(r.slot_id),
      '/', jsonb_build_object('assignment_id', r.id));
  end loop;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.duty_message(p_soldier uuid DEFAULT NULL::uuid, p_assignment uuid DEFAULT NULL::uuid, p_cycle uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  sid uuid := p_soldier;
  so soldiers;
  acct boolean;
  c text;
  duties jsonb;
begin
  if p_assignment is not null then
    select a.soldier_id into sid from assignments a where a.id = p_assignment;
    if sid is null then raise exception 'השיבוץ לא נמצא'; end if;
  end if;
  if sid is null or (p_assignment is null and p_cycle is null) then raise exception 'חסר עובד או מחזור'; end if;
  select * into so from soldiers where id = sid;
  if so.id is null or not app.sees_soldier(sid) then raise exception 'העובד לא נמצא'; end if;
  if not (app.is_staff() or app.commands_soldier(sid)) then
    raise exception 'רק לעובדי המסגרת שלך' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'assignment_id', a.id, 'task_name', coalesce(sl.special_name, t.name), 'role', a.role,
           'starts_at', sl.starts_at, 'ends_at', sl.ends_at, 'brief', app.brief_text(sl.id), 'note', sl.instructions)
         order by sl.starts_at), '[]'::jsonb)
    into duties
  from assignments a
  join slots sl on sl.id = a.slot_id and sl.cancelled_at is null
  join task_types t on t.id = sl.task_type_id
  where a.soldier_id = sid and a.status in ('assigned', 'reserve_idle', 'reserve_activated')
    and case when p_assignment is not null then a.id = p_assignment
             else sl.cycle_id = p_cycle and sl.ends_at > now() end;

  acct := exists (select 1 from app_users u where u.soldier_id = sid and u.deleted_at is null);
  if not acct and so.is_active then
    update soldier_invites set revoked_at = now() where soldier_id = sid and used_at is null and revoked_at is null;
    c := app.invite_code();
    insert into soldier_invites (soldier_id, code_hash, created_by, expires_at, sent_at)
    values (sid, app.invite_hash(c), auth.uid(), now() + interval '30 days', now());
    c := substr(c, 1, 5) || '-' || substr(c, 6, 5);
    insert into audit_log (actor_user_id, action, entity_type, entity_id, after)
    values (auth.uid(), 'duty_message', 'soldiers', sid::text, jsonb_build_object('duties', jsonb_array_length(duties), 'invite', true));
  end if;

  return jsonb_build_object('soldier_id', sid, 'full_name', so.full_name, 'phone', so.phone,
                            'has_account', acct, 'code', c, 'duties', duties);
end $function$;
