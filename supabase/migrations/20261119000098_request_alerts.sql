-- =============================================================================
-- A notice to נע"ת on a new exemption request, so it does not wait until someone opens the
-- overview.
--
-- * Who: נע"ת and מ"מ (coordinator / deputy); a gaf commander for his gaf's soldiers, to know
--   (he does not decide). Not the one who wrote the request, and not who turned the notices off.
-- * Grouped: a request within an hour of the last notice, still unread, joins it – "4 בקשות פטור
--   חדשות" – and is not pushed again, so the start of a cycle does not flood the phone.
-- * Before the stage closes: 48 hours before a cycle's exemption deadline, "עוד X בקשות ממתינות"
--   to נע"ת and מ"מ (once a cycle, only when some wait).
-- * app_users.request_alerts (default on): turned off from the bell, per user.
-- Date blocks and absences take effect at once, without a decision, so they send nothing.
-- =============================================================================

alter table app_users add column if not exists request_alerts boolean not null default true;
alter table cycles add column if not exists pending_reminded_at timestamptz;

create or replace function public.set_my_request_alerts(p_on boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  update app_users set request_alerts = coalesce(p_on, true) where id = auth.uid();
end $$;
revoke execute on function public.set_my_request_alerts(boolean) from public, anon;
grant execute on function public.set_my_request_alerts(boolean) to authenticated;

-- the active holders of a role (a gaf commander: of this gaf), who want these notices
create or replace function app.request_alert_users(p_gaf uuid) returns table (user_id uuid, info_only boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select distinct on (u.id) u.id, ur.role = 'gaf_commander'
  from user_roles ur
  join app_users u on u.id = ur.user_id
  left join soldiers own on own.id = u.soldier_id
  where not u.is_locked and u.deleted_at is null and u.request_alerts
    and (ur.valid_from is null or ur.valid_from <= now()) and (ur.valid_to is null or ur.valid_to > now())
    and (ur.role in ('coordinator', 'deputy')
         or (ur.role = 'gaf_commander' and p_gaf is not null and coalesce(ur.gaf_id, own.gaf_id) = p_gaf))
  order by u.id, (ur.role = 'gaf_commander')   -- a coordinator who is also a gaf commander decides
$$;
revoke execute on function app.request_alert_users(uuid) from public, anon, authenticated;

create or replace function app.on_exemption_request() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  so soldiers;
  tname text;
  line text;
  r record;
  last notifications;
  n int;
begin
  if new.status <> 'pending' or new.source = 'computed' then return new; end if;
  select * into so from soldiers where id = new.soldier_id;
  select name into tname from exemption_types where id = new.exemption_type_id;
  line := so.full_name || ': ' || coalesce(tname, 'פטור') || ', '
       || to_char(new.start_date, 'DD.MM') || '–' || to_char(new.end_date, 'DD.MM');
  for r in select * from app.request_alert_users(so.gaf_id) loop
    continue when r.user_id = auth.uid();   -- he wrote it himself
    select * into last from notifications
     where recipient_user_id = r.user_id and type = 'exemption_request' and read_at is null
       and created_at > now() - interval '1 hour'
     order by created_at desc limit 1;
    if last.id is not null then
      n := coalesce((last.payload->>'count')::int, 1) + 1;
      update notifications
         set payload = payload || jsonb_build_object('count', n, 'title', n || ' בקשות פטור חדשות',
                                                     'body', 'האחרונה – ' || line)
       where id = last.id;
    else
      insert into notifications (recipient_user_id, type, payload)
      values (r.user_id, 'exemption_request',
              jsonb_build_object('title', 'בקשת פטור – ' || so.full_name,
                                 'body', line || case when r.info_only then ' (לידיעה)' else '' end,
                                 'url', case when r.info_only then '/' else '/cycle/constraints' end,
                                 'count', 1, 'exemption_id', new.id));
    end if;
  end loop;
  return new;
end $$;
revoke execute on function app.on_exemption_request() from public, anon, authenticated;

drop trigger if exists exemption_request_alert on exemptions;
create trigger exemption_request_alert after insert on exemptions
  for each row execute function app.on_exemption_request();

-- 48 hours before the exemption deadline: what still waits, to נע"ת and מ"מ – once a cycle
create or replace function app.queue_pending_reminders() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c record;
  waiting int;
  n int := 0;
begin
  for c in
    select * from cycles
    where exemption_deadline is not null and pending_reminded_at is null
      and exemption_deadline > now() and exemption_deadline <= now() + interval '48 hours'
  loop
    select count(*) into waiting from exemptions e
     where e.status = 'pending' and e.start_date <= c.end_date and e.end_date >= c.start_date;
    if waiting > 0 then
      insert into notifications (recipient_user_id, type, payload)
      select u.user_id, 'exemption_pending',
             jsonb_build_object('title', case when waiting = 1 then 'עוד בקשת פטור אחת ממתינה' else 'עוד ' || waiting || ' בקשות פטור ממתינות' end,
                                'body', 'שלב האילוצים נסגר ב-' || to_char(c.exemption_deadline at time zone app.tz(), 'DD.MM HH24:MI'),
                                'url', '/cycle/constraints', 'cycle_id', c.id)
      from app.request_alert_users(null) u where not u.info_only;
      n := n + 1;
    end if;
    update cycles set pending_reminded_at = now() where id = c.id;
  end loop;
  return n;
end $$;
revoke execute on function app.queue_pending_reminders() from public, anon, authenticated;

-- every 15 minutes: the duty reminders, the "ראיתי" reminders, the closing-stage reminder;
-- then wake the workflow for anything still waiting to be pushed
create or replace function app.notify_tick() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare queued int; acks int; pend int; waiting int; woke boolean := false;
begin
  queued := app.queue_reminders();
  acks := app.queue_ack_reminders();
  pend := app.queue_pending_reminders();
  select count(*) into waiting
    from notifications n
   where n.pushed_at is null and n.created_at > now() - interval '2 days' and n.created_at < now() - interval '1 minute'
     and exists (select 1 from push_subscriptions p where p.user_id = n.recipient_user_id);
  if waiting > 0 then woke := app.wake_notify(); end if;
  return jsonb_build_object('reminders', queued, 'acks', acks, 'pending', pend, 'waiting', waiting, 'woke', woke);
end $$;
revoke execute on function app.notify_tick() from public, anon, authenticated;
