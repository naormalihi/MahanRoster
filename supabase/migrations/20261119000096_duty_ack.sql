-- Duty acknowledgement – "ראיתי" (פריט 3).
-- Every published duty (performer or reserve) waits for its soldier's "ראיתי". Changing its time,
-- or the soldier's role in it, asks again. נע"ת sees who has not acknowledged yet among the
-- duties of the coming days, and can mark "spoke on the phone". Before the duty a reminder goes to
-- the soldier, and later a notice to his gaf commander (settings, 0 = off). A duty taken in a swap
-- counts as seen: he accepted it himself.

alter table assignments
  add column if not exists acked_at timestamptz,
  add column if not exists acked_via text check (acked_via in ('app', 'phone', 'swap')),
  add column if not exists acked_by uuid references app_users(id),
  add column if not exists ack_reminded_at timestamptz,
  add column if not exists ack_escalated_at timestamptz;

-- duties already over were seen
update assignments a set acked_at = a.created_at, acked_via = 'app'
  from slots s where s.id = a.slot_id and s.ends_at < now() and a.acked_at is null;

insert into settings (key, value) values ('ack_reminder_hours', '48'), ('ack_escalation_hours', '24')
on conflict (key) do nothing;

-- a new time, or a new role, asks again
create or replace function app.reset_ack_on_slot() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at then
    update assignments set acked_at = null, acked_via = null, acked_by = null, ack_reminded_at = null, ack_escalated_at = null
     where slot_id = new.id and status in ('assigned', 'reserve_idle') and acked_at is not null;
  end if;
  return null;
end $$;
drop trigger if exists slots_reset_ack on slots;
create trigger slots_reset_ack after update of starts_at, ends_at on slots for each row execute function app.reset_ack_on_slot();

create or replace function app.reset_ack_on_role() returns trigger
language plpgsql as $$
begin
  if new.role is distinct from old.role then
    new.acked_at := null; new.acked_via := null; new.acked_by := null; new.ack_reminded_at := null; new.ack_escalated_at := null;
  end if;
  return new;
end $$;
drop trigger if exists assignments_reset_ack on assignments;
create trigger assignments_reset_ack before update of role on assignments for each row execute function app.reset_ack_on_role();

-- the soldier: "ראיתי" on one duty or on all new ones
create or replace function public.ack_duties(p_ids uuid[]) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  if app.my_soldier() is null then raise exception 'not allowed' using errcode = '42501'; end if;
  update assignments set acked_at = now(), acked_via = 'app', acked_by = auth.uid()
   where id = any (p_ids) and soldier_id = app.my_soldier() and acked_at is null
     and status in ('assigned', 'reserve_idle', 'reserve_activated');
  get diagnostics n = row_count;
  return n;
end $$;

-- נע"ת: "spoke on the phone" (or "he wrote back in WhatsApp")
create or replace function public.staff_ack(p_assignment uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.require_staff();
  update assignments set acked_at = now(), acked_via = 'phone', acked_by = auth.uid()
   where id = p_assignment and acked_at is null and status in ('assigned', 'reserve_idle', 'reserve_activated');
  if not found then raise exception 'כבר אושר, או שהשיבוץ השתנה'; end if;
  insert into audit_log (actor_user_id, action, entity_type, entity_id) values (auth.uid(), 'staff_ack', 'assignments', p_assignment::text);
end $$;

-- who has not acknowledged yet, among the duties of the coming hours (a gaf commander: his gaf)
create or replace function public.unacked_duties(p_hours int default 72)
returns table (assignment_id uuid, soldier_id uuid, full_name text, gaf_name text, has_account boolean, phone text,
               task_name text, role assignment_role, starts_at timestamptz, ends_at timestamptz, reminded boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.id, so.id, so.full_name, g.name,
         exists (select 1 from app_users u where u.soldier_id = so.id and u.deleted_at is null and not u.is_locked),
         so.phone, coalesce(sl.special_name, t.name), a.role, sl.starts_at, sl.ends_at, a.ack_reminded_at is not null
  from assignments a
  join slots sl on sl.id = a.slot_id and sl.cancelled_at is null
  join cycles c on c.id = sl.cycle_id and c.status = 'published'
  join task_types t on t.id = sl.task_type_id
  join soldiers so on so.id = a.soldier_id
  left join org_units g on g.id = so.gaf_id
  where app.can_read() and app.sees_soldier(so.id)
    and a.acked_at is null and a.status in ('assigned', 'reserve_idle')
    and sl.starts_at > now() and sl.starts_at < now() + make_interval(hours => greatest(1, least(p_hours, 24 * 14)))
  order by sl.starts_at, so.full_name
$$;

revoke execute on function public.ack_duties(uuid[]), public.staff_ack(uuid), public.unacked_duties(int) from public, anon;
grant execute on function public.ack_duties(uuid[]), public.staff_ack(uuid), public.unacked_duties(int) to authenticated, service_role;

-- every tick: "עוד לא אישרת" to the soldier, then a notice to his gaf commander – each once
create or replace function app.queue_ack_reminders() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  rh int := coalesce((app.setting('ack_reminder_hours') #>> '{}')::int, 48);
  eh int := coalesce((app.setting('ack_escalation_hours') #>> '{}')::int, 24);
  r record;
  n int := 0;
begin
  if rh > 0 then
    for r in
      select a.id, a.soldier_id, coalesce(sl.special_name, t.name) as task, sl.starts_at
      from assignments a join slots sl on sl.id = a.slot_id and sl.cancelled_at is null
      join cycles c on c.id = sl.cycle_id and c.status = 'published'
      join task_types t on t.id = sl.task_type_id
      where a.acked_at is null and a.ack_reminded_at is null and a.status in ('assigned', 'reserve_idle')
        and sl.starts_at > now() and sl.starts_at < now() + make_interval(hours => rh)
    loop
      perform app.notify_soldier(r.soldier_id, 'ack_reminder', 'עוד לא אישרת: ' || r.task,
        app.when_text(r.starts_at) || ' – לחץ "ראיתי" ב"התורנויות שלי"', '/', jsonb_build_object('assignment_id', r.id), true);
      update assignments set ack_reminded_at = now() where id = r.id;
      n := n + 1;
    end loop;
  end if;
  if eh > 0 then
    for r in
      select a.id, so.full_name, so.gaf_id, coalesce(sl.special_name, t.name) as task, sl.starts_at
      from assignments a join slots sl on sl.id = a.slot_id and sl.cancelled_at is null
      join cycles c on c.id = sl.cycle_id and c.status = 'published'
      join task_types t on t.id = sl.task_type_id
      join soldiers so on so.id = a.soldier_id
      where a.acked_at is null and a.ack_escalated_at is null and a.status in ('assigned', 'reserve_idle')
        and sl.starts_at > now() and sl.starts_at < now() + make_interval(hours => eh)
    loop
      insert into notifications (recipient_user_id, type, payload)
      select distinct ur.user_id, 'ack_escalation',
             jsonb_build_object('title', r.full_name || ' עוד לא אישר תורנות',
                                'body', r.task || ', ' || app.when_text(r.starts_at), 'url', '/', 'assignment_id', r.id)
      from user_roles ur join app_users u on u.id = ur.user_id
      left join soldiers own on own.id = u.soldier_id
      where ur.role = 'gaf_commander' and not u.is_locked and u.deleted_at is null
        and coalesce(ur.gaf_id, own.gaf_id) = r.gaf_id
        and (ur.valid_from is null or ur.valid_from <= now()) and (ur.valid_to is null or ur.valid_to > now());
      update assignments set ack_escalated_at = now() where id = r.id;
      n := n + 1;
    end loop;
  end if;
  return n;
end $$;
revoke execute on function app.queue_ack_reminders() from public, anon, authenticated;

-- the soldier's duties carry their acknowledgement
drop function if exists public.my_duties();
create function public.my_duties()
returns table (assignment_id uuid, cycle_id uuid, cycle_name text, task_name text, starts_at timestamptz, ends_at timestamptz,
               role assignment_role, status assignment_status, points numeric, explanation text,
               report_at timestamptz, report_place text, briefing_at timestamptz, briefing_place text, equipment text,
               briefing_by_call boolean, contact_name text, contact_phone text, briefing_note text, acked_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.id, c.id, c.name, coalesce(sl.special_name, t.name), sl.starts_at, sl.ends_at, a.role, a.status, a.normalized_points, a.explanation,
         coalesce(sl.report_at, case when b.kind = 'report' then b.at end),
         coalesce(sl.report_place, case when b.kind = 'report' then b.place end),
         coalesce(sl.briefing_at, case when b.kind = 'briefing' then b.at end),
         coalesce(sl.briefing_place, case when b.kind in ('briefing', 'by_call') then b.place end),
         sl.equipment,
         coalesce(b.kind = 'by_call' and sl.briefing_at is null, false),
         b.contact_name, b.contact_phone, b.note, a.acked_at
  from assignments a
  join slots sl on sl.id = a.slot_id
  join cycles c on c.id = sl.cycle_id and c.status in ('published', 'closed')
  join task_types t on t.id = sl.task_type_id
  left join lateral app.slot_brief(sl.id) b on true
  where a.soldier_id = app.my_soldier()
    and a.status not in ('draft', 'dropped', 'swapped_out', 'cancelled_approved')
    and sl.cancelled_at is null
  order by sl.starts_at
$$;
revoke execute on function public.my_duties() from public, anon;
grant execute on function public.my_duties() to authenticated;

-- a duty taken in a swap is seen
create or replace function app.swap_move(p_old uuid, p_to uuid, p_note text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o assignments;
  s slots;
  pts record;
  new_id uuid;
begin
  select * into o from assignments where id = p_old for update;
  select * into s from slots where id = o.slot_id;
  update assignments set status = 'swapped_out' where id = o.id;
  select * into pts from app.slot_points(o.slot_id, p_to);
  insert into assignments (slot_id, soldier_id, gaf_id, role, status, is_penalty, points, factor_at_time, normalized_points,
                           weekend_units, explanation, source, replaced_assignment_id, paired_assignment_id, received_via, received_at,
                           acked_at, acked_via)
  select o.slot_id, so.id, so.gaf_id, o.role, o.status, o.is_penalty, pts.raw,
         case when pts.normalized > 0 then round(pts.raw / pts.normalized, 2) else 1 end,
         pts.normalized, o.weekend_units, p_note, 'swap', o.id, o.paired_assignment_id, 'system', now(),
         now(), 'swap'   -- he took it himself: seen
  from soldiers so where so.id = p_to
  returning id into new_id;
  update assignments set paired_assignment_id = new_id where paired_assignment_id = o.id and id <> new_id;
  return new_id;
end $$;


-- the tick queues the acknowledgement reminders too
create or replace function app.notify_tick() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare queued int; acks int; waiting int; woke boolean := false;
begin
  queued := app.queue_reminders();   -- its inserts wake the workflow through the trigger
  acks := app.queue_ack_reminders(); -- "עוד לא אישרת" and the gaf commander's notice
  select count(*) into waiting
    from notifications n
   where n.pushed_at is null and n.created_at > now() - interval '2 days' and n.created_at < now() - interval '1 minute'
     and exists (select 1 from push_subscriptions p where p.user_id = n.recipient_user_id);
  if waiting > 0 then woke := app.wake_notify(); end if;
  return jsonb_build_object('reminders', queued, 'acks', acks, 'waiting', waiting, 'woke', woke);
end $$;
revoke execute on function app.notify_tick() from public, anon, authenticated;
