-- =============================================================================
-- Version 2.0, stage 2.5 – personal notifications: in the system and pushed to the phone.
--
-- What a soldier is told (only soldiers with an account; the text is built here, once, in
-- Hebrew, and kept in the payload – the screen and the phone show the same words):
--   * board_published   – the board of a cycle is out, with how many duties he has;
--   * duty_added        – a duty given to him after publishing (as performer or reserve);
--   * duty_removed      – a duty taken off him after publishing (exemption, swap, cancel);
--   * reserve_activated – his reserve role became the duty: needs his acknowledgement;
--   * exemption_decided – his exemption request was approved or rejected;
--   * duty_reminder     – the day before a duty (queued by the notify worker).
--
-- Push: the browser's Web Push. Each device that agreed is a row in push_subscriptions.
-- The VAPID key pair is made once by the push-setup workflow: the public key goes to
-- settings (the browser needs it), the private one to Supabase Vault ('vapid_private_key')
-- and is read only by the notify worker. The worker runs on GitHub Actions: dispatched from
-- here when notifications are queued (like the scheduling engine), and every 15 minutes for
-- the reminders.
-- =============================================================================

alter table notifications add column if not exists pushed_at timestamptz;

drop policy if exists own_read on notifications;
create policy own_read on notifications for select to authenticated using (recipient_user_id = auth.uid());

create table push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references app_users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz,
  failures    int not null default 0
);
create index on push_subscriptions (user_id);
alter table push_subscriptions enable row level security;
create policy own_read on push_subscriptions for select to authenticated using (user_id = auth.uid());

insert into settings (key, value) values ('notify_workflow', '"notify.yml"') on conflict (key) do nothing;

-- When the worker was last woken (kept out of settings, whose changes are audited).
create table notify_state (id int primary key default 1 check (id = 1), dispatched_at timestamptz);
insert into notify_state (id) values (1);
alter table notify_state enable row level security;

-- ---------------------------------------------------------------------------
-- Making notifications
-- ---------------------------------------------------------------------------

create or replace function app.when_text(t timestamptz) returns text
language sql stable set search_path = public, pg_temp as $$
  select (array['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳'])[extract(isodow from t at time zone app.tz())::int % 7 + 1]
         || ' ' || to_char(t at time zone app.tz(), 'DD/MM HH24:MI')
$$;

-- A notification to every account of a soldier (normally one).
create or replace function app.notify_soldier(p_soldier uuid, p_type text, p_title text, p_body text,
                                              p_url text default '/', p_extra jsonb default '{}', p_ack boolean default false)
returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  insert into notifications (recipient_user_id, type, payload, requires_ack)
  select u.id, p_type, p_extra || jsonb_build_object('title', p_title, 'body', p_body, 'url', p_url), p_ack
  from app_users u
  where u.soldier_id = p_soldier and not u.is_locked;
  get diagnostics n = row_count;
  return n;
end $$;

-- The board of a cycle is out.
create or replace function app.on_cycle_published() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  for r in
    select a.soldier_id,
           count(*) filter (where a.role = 'performer') as duties,
           count(*) filter (where a.role = 'reserve') as reserves,
           min(sl.starts_at) filter (where a.role = 'performer') as first_at
    from assignments a join slots sl on sl.id = a.slot_id
    where sl.cycle_id = new.id and sl.cancelled_at is null
      and a.status in ('assigned', 'reserve_idle', 'reserve_activated')
    group by a.soldier_id
  loop
    perform app.notify_soldier(r.soldier_id, 'board_published',
      'לוח התורנויות פורסם – ' || new.name,
      'יש לך ' || r.duties || ' תורנויות' || case when r.reserves > 0 then ' ו-' || r.reserves || ' עתודות' else '' end
        || case when r.first_at is not null then '. הראשונה: ' || app.when_text(r.first_at) else '' end || '.',
      '/', jsonb_build_object('cycle_id', new.id));
  end loop;
  return null;
end $$;

drop trigger if exists cycle_published_notify on cycles;
create trigger cycle_published_notify after update of status on cycles
  for each row when (new.status = 'published' and old.status is distinct from 'published')
  execute function app.on_cycle_published();

-- A change to a soldier's duty on a published board (not the publishing itself, not an unpublish).
create or replace function app.on_assignment_changed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
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
  elsif tg_op = 'UPDATE' and new.status in ('dropped', 'cancelled_approved', 'swapped_out')
        and old.status in ('assigned', 'reserve_idle', 'reserve_activated') then
    perform app.notify_soldier(new.soldier_id, 'duty_removed', 'תורנות ירדה ממך', what, '/',
      jsonb_build_object('assignment_id', new.id));
  end if;
  return null;
end $$;

drop trigger if exists assignment_changed_notify on assignments;
create trigger assignment_changed_notify after insert or update of status on assignments
  for each row execute function app.on_assignment_changed();

-- A decision on an exemption request.
create or replace function app.on_exemption_decided() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare tname text;
begin
  select name into tname from exemption_types where id = new.exemption_type_id;
  perform app.notify_soldier(new.soldier_id, 'exemption_decided',
    case when new.status = 'approved' then 'בקשת הפטור אושרה' else 'בקשת הפטור נדחתה' end,
    tname || ', ' || to_char(new.start_date, 'DD/MM') || '–' || to_char(new.end_date, 'DD/MM')
      || case when new.status = 'rejected' and new.decision_reason is not null then '. ' || new.decision_reason else '' end,
    '/requests', jsonb_build_object('exemption_id', new.id));
  return null;
end $$;

drop trigger if exists exemption_decided_notify on exemptions;
create trigger exemption_decided_notify after update of status on exemptions
  for each row when (old.status = 'pending' and new.status in ('approved', 'rejected'))
  execute function app.on_exemption_decided();

-- The day before a duty (performer, on a published board), once per duty. Run by the worker.
create or replace function app.queue_reminders() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int := 0; r record;
begin
  for r in
    select a.id, a.soldier_id, sl.starts_at, sl.report_at, sl.report_place, t.name as task
    from assignments a join slots sl on sl.id = a.slot_id join cycles c on c.id = sl.cycle_id and c.status = 'published'
    join task_types t on t.id = sl.task_type_id
    where a.role = 'performer' and a.status in ('assigned', 'reserve_activated') and sl.cancelled_at is null
      and sl.starts_at between now() + interval '12 hours' and now() + interval '36 hours'
      and not exists (select 1 from notifications x where x.type = 'duty_reminder' and x.payload->>'assignment_id' = a.id::text)
  loop
    n := n + app.notify_soldier(r.soldier_id, 'duty_reminder', 'תזכורת: תורנות מחר',
      r.task || ', ' || app.when_text(r.starts_at)
        || case when r.report_at is not null then '. התייצבות ' || app.when_text(r.report_at) else '' end
        || case when r.report_place is not null then ', ' || r.report_place else '' end,
      '/', jsonb_build_object('assignment_id', r.id));
  end loop;
  return n;
end $$;

-- Wake the notify worker when there is something to push (at most once a minute).
create or replace function app.dispatch_notify() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare tok text; last timestamptz;
begin
  if not exists (select 1 from push_subscriptions) then return null; end if;
  select dispatched_at into last from notify_state where id = 1;
  if last is not null and last > now() - interval '1 minute' then return null; end if;
  update notify_state set dispatched_at = now() where id = 1;
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null or to_regclass('vault.decrypted_secrets') is null then
    return null;
  end if;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'github_dispatch_token' limit 1$q$ into tok;
  if tok is null or tok = '' then return null; end if;
  execute $q$select net.http_post(
      url     := $1,
      body    := jsonb_build_object('ref', 'main'),
      params  := '{}'::jsonb,
      headers := jsonb_build_object('Authorization', 'Bearer ' || $2, 'Accept', 'application/vnd.github+json',
                                    'X-GitHub-Api-Version', '2022-11-28', 'User-Agent', 'mahanroster', 'Content-Type', 'application/json'),
      timeout_milliseconds := 10000)$q$
    using format('https://api.github.com/repos/%s/actions/workflows/%s/dispatches',
                 app.setting('github_repo') #>> '{}', app.setting('notify_workflow') #>> '{}'), tok;
  return null;
exception when others then
  return null;  -- a notification must never fail the change that made it
end $$;

drop trigger if exists notifications_dispatch on notifications;
create trigger notifications_dispatch after insert on notifications
  for each statement execute function app.dispatch_notify();

-- ---------------------------------------------------------------------------
-- The user's side
-- ---------------------------------------------------------------------------

create or replace function public.my_notifications() returns table (
  id uuid, type text, title text, body text, url text, requires_ack boolean, read_at timestamptz, acked_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select n.id, n.type, n.payload->>'title', n.payload->>'body', coalesce(n.payload->>'url', '/'),
         n.requires_ack, n.read_at, n.acked_at, n.created_at
  from notifications n
  where n.recipient_user_id = auth.uid()
  order by n.created_at desc
  limit 60
$$;

-- Mark read (all, or the given ones); an acknowledgement is the soldier's "קיבלתי".
create or replace function public.mark_notifications_read(p_ids uuid[] default null) returns void
language sql security definer set search_path = public, pg_temp as $$
  update notifications set read_at = coalesce(read_at, now())
  where recipient_user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids))
$$;

create or replace function public.ack_notification(p_id uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  update notifications set acked_at = coalesce(acked_at, now()), read_at = coalesce(read_at, now())
  where id = p_id and recipient_user_id = auth.uid()
$$;

create or replace function public.vapid_public_key() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select app.setting('vapid_public_key') #>> '{}'
$$;

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_endpoint !~ '^https://' then raise exception 'כתובת לא תקינה'; end if;
  insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 200))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, failures = 0;
end $$;

create or replace function public.delete_push_subscription(p_endpoint text) returns void
language sql security definer set search_path = public, pg_temp as $$
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid()
$$;

revoke execute on function public.my_notifications(), public.mark_notifications_read(uuid[]), public.ack_notification(uuid),
  public.vapid_public_key(), public.save_push_subscription(text, text, text, text), public.delete_push_subscription(text) from anon, public;
grant execute on function public.my_notifications(), public.mark_notifications_read(uuid[]), public.ack_notification(uuid),
  public.vapid_public_key(), public.save_push_subscription(text, text, text, text), public.delete_push_subscription(text) to authenticated;
revoke execute on function app.notify_soldier(uuid, text, text, text, text, jsonb, boolean), app.queue_reminders(),
  app.on_cycle_published(), app.on_assignment_changed(), app.on_exemption_decided(), app.dispatch_notify() from anon, public, authenticated;
