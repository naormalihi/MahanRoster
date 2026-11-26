-- Range (מטווח), decided 26.11:
-- 1. The employee updates it themself: they give the date of their last range, the validity is
--    that date + range_validity_months. Marked as self-updated (staff and the gaf commander can fix it).
-- 2. Planned ranges (staff): date, hours, place, note.
-- 3. Reminders: once, range_warning_days before the validity ends; when a range is saved, to those
--    whose validity ends before the range + range_notice_days (and their gaf commander gets the list);
--    the day before the range, to the same employees. Anyone who updated stops getting them.
--    No date entered = treated as valid = no reminders.

insert into settings (key, value) values
  ('range_validity_months', '6'),
  ('range_notice_days', '30')
on conflict (key) do nothing;

alter table soldiers add column if not exists range_self_updated_at timestamptz;
comment on column soldiers.range_self_updated_at is 'When the employee last updated their own range validity; cleared when anyone else changes it.';

create or replace function app.range_self_mark() returns trigger
language plpgsql as $$
begin
  if new.range_valid_until is distinct from old.range_valid_until then
    new.range_self_updated_at := case when current_setting('app.range_self', true) = 'on' then now() end;
  end if;
  return new;
end $$;
drop trigger if exists soldiers_range_self on soldiers;
create trigger soldiers_range_self before update of range_valid_until on soldiers
  for each row execute function app.range_self_mark();

create or replace function app.range_validity_months() returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select least(36, greatest(1, coalesce((app.setting('range_validity_months') #>> '{}')::int, 6)))
$$;

-- ---------------------------------------------------------------------------
-- planned ranges
-- ---------------------------------------------------------------------------
create table if not exists planned_ranges (
  id              uuid primary key default gen_random_uuid(),
  day             date not null,
  starts          time,
  ends            time,
  place           text check (place is null or length(place) <= 80),
  note            text check (note is null or length(note) <= 200),
  notified_at     timestamptz,   -- "נקבע מטווח" went out
  eve_notified_at timestamptz,   -- "מטווח מחר" went out
  created_at      timestamptz not null default now()
);
alter table planned_ranges enable row level security;
create policy staff_all on planned_ranges for all to authenticated using (app.is_staff()) with check (app.is_staff());
grant select, insert, update, delete on planned_ranges to authenticated;
drop trigger if exists planned_ranges_audit on planned_ranges;
create trigger planned_ranges_audit after insert or update or delete on planned_ranges
  for each row execute function app.audit();

-- a changed date or hours: tell them again
create or replace function app.planned_range_changed() returns trigger
language plpgsql as $$
begin
  if new.day is distinct from old.day or new.starts is distinct from old.starts or new.ends is distinct from old.ends
     or new.place is distinct from old.place then
    new.notified_at := null;
    new.eve_notified_at := null;
  end if;
  return new;
end $$;
drop trigger if exists planned_ranges_changed on planned_ranges;
create trigger planned_ranges_changed before update on planned_ranges
  for each row execute function app.planned_range_changed();

create or replace function app.range_text(r planned_ranges) returns text
language sql stable set search_path = public, pg_temp as $$
  select to_char(r.day, 'DD/MM/YYYY')
      || coalesce(' ' || to_char(r.starts, 'HH24:MI') || coalesce('–' || to_char(r.ends, 'HH24:MI'), ''), '')
      || coalesce(', ' || r.place, '')
$$;

-- the next planned range (from today)
create or replace function app.next_range() returns planned_ranges
language sql stable security definer set search_path = public, pg_temp as $$
  select * from planned_ranges where day >= (now() at time zone app.tz())::date order by day, starts nulls first limit 1
$$;

-- who needs this range: valid until before the range + notice days (no date = treated as valid)
create or replace function app.range_needers(p_range uuid) returns setof soldiers
language sql stable security definer set search_path = public, pg_temp as $$
  select so.* from soldiers so, planned_ranges r
  where r.id = p_range and so.is_active and (so.release_date is null or so.release_date > r.day)
    and so.range_valid_until is not null
    and so.range_valid_until <= r.day + coalesce((app.setting('range_notice_days') #>> '{}')::int, 30)
$$;

-- ---------------------------------------------------------------------------
-- the employee
-- ---------------------------------------------------------------------------
create or replace function public.my_range() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select case when app.my_soldier() is null then null else (
    select jsonb_build_object(
      'valid_until', so.range_valid_until,
      'self_updated_at', so.range_self_updated_at,
      'validity_months', app.range_validity_months(),
      'warning_days', coalesce((app.setting('range_warning_days') #>> '{}')::int, 14),
      'next', (select case when n.id is null then null
                      else jsonb_build_object('day', n.day, 'starts', to_char(n.starts, 'HH24:MI'), 'ends', to_char(n.ends, 'HH24:MI'),
                                              'place', n.place, 'note', n.note) end
               from app.next_range() n))
    from soldiers so where so.id = app.my_soldier()) end
$$;
revoke all on function public.my_range() from public, anon;
grant execute on function public.my_range() to authenticated;

-- the date of the last range; returns the new validity
create or replace function public.update_my_range(p_last date) returns date
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  sid uuid := app.require_my_soldier();
  today date := (now() at time zone app.tz())::date;
  until date;
begin
  if p_last is null or p_last > today then raise exception 'תאריך המטווח לא יכול להיות בעתיד'; end if;
  if p_last < today - interval '1 year' then raise exception 'תאריך המטווח – עד שנה אחורה'; end if;
  until := (p_last + make_interval(months => app.range_validity_months()))::date;
  perform set_config('app.range_self', 'on', true);
  update soldiers set range_valid_until = until, updated_at = now() where id = sid;
  perform set_config('app.range_self', '', true);
  return until;
end $$;
revoke all on function public.update_my_range(date) from public, anon;
grant execute on function public.update_my_range(date) to authenticated;

-- ---------------------------------------------------------------------------
-- reminders (from notify_tick, every 15 minutes)
-- ---------------------------------------------------------------------------
create or replace function app.queue_range_reminders() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n int := 0;
  r record;
  pr planned_ranges;
  nx planned_ranges := app.next_range();
  today date := (now() at time zone app.tz())::date;
  warn int := coalesce((app.setting('range_warning_days') #>> '{}')::int, 14);
  rng text;
begin
  -- the validity is about to end: once per validity date
  for r in
    select so.id, so.range_valid_until from soldiers so
    where so.is_active and (so.release_date is null or so.release_date > today)
      and so.range_valid_until is not null
      and so.range_valid_until between today and today + warn
      and not exists (select 1 from notifications x join app_users u on u.id = x.recipient_user_id
                      where u.soldier_id = so.id and x.type = 'range_expiring'
                        and x.payload->>'valid_until' = so.range_valid_until::text)
  loop
    n := n + app.notify_soldier(r.id, 'range_expiring', 'תוקף המטווח שלך עומד לפוג',
      'בתוקף עד ' || to_char(r.range_valid_until, 'DD/MM/YYYY') || '. '
      || coalesce('המטווח הקרוב: ' || app.range_text(nx) || '. ', '')
      || 'אחרי שירית – עדכן את תאריך המטווח בבקשות שלי.',
      '/requests', jsonb_build_object('valid_until', r.range_valid_until));
  end loop;

  -- a range was saved: those who need it, and each gaf commander gets the list of their gaf
  for pr in select * from planned_ranges where notified_at is null and day >= today loop
    rng := app.range_text(pr);
    for r in select id from app.range_needers(pr.id) loop
      n := n + app.notify_soldier(r.id, 'range_planned', 'נקבע מטווח', rng || coalesce('. ' || pr.note, ''),
        '/requests', jsonb_build_object('range_id', pr.id));
    end loop;
    insert into notifications (recipient_user_id, type, payload)
    select ur.user_id, 'range_planned_gaf',
           jsonb_build_object('title', 'מטווח ' || to_char(pr.day, 'DD/MM') || ' – מי מהמסגרת צריך',
                              'body', string_agg(x.full_name || ' (עד ' || to_char(x.range_valid_until, 'DD/MM') || ')', ', ' order by x.full_name),
                              'url', '/soldiers', 'range_id', pr.id)
    from app.range_needers(pr.id) x
    join user_roles ur on ur.role = 'gaf_commander'
    join app_users u on u.id = ur.user_id and not u.is_locked and u.deleted_at is null
    left join soldiers own on own.id = u.soldier_id
    where coalesce(ur.gaf_id, own.gaf_id) = x.gaf_id
      and (ur.valid_from is null or ur.valid_from <= now()) and (ur.valid_to is null or ur.valid_to > now())
    group by ur.user_id;
    update planned_ranges set notified_at = now() where id = pr.id;
  end loop;

  -- the day before the range
  for pr in select * from planned_ranges where eve_notified_at is null and day = today + 1
            and (now() at time zone app.tz())::time >= time '12:00' loop
    for r in select id from app.range_needers(pr.id) loop
      n := n + app.notify_soldier(r.id, 'range_eve', 'תזכורת: מטווח מחר', app.range_text(pr) || coalesce('. ' || pr.note, ''),
        '/requests', jsonb_build_object('range_id', pr.id));
    end loop;
    update planned_ranges set eve_notified_at = now() where id = pr.id;
  end loop;
  return n;
end $$;
revoke all on function app.queue_range_reminders() from public, anon, authenticated;

create or replace function app.notify_tick() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare queued int; acks int; ranges int; waiting int; woke boolean := false;
begin
  queued := app.queue_reminders();   -- its inserts wake the workflow through the trigger
  acks := app.queue_ack_reminders(); -- "עוד לא אישרת" and the gaf commander's notice
  ranges := app.queue_range_reminders();
  select count(*) into waiting
    from notifications n
   where n.pushed_at is null and n.created_at > now() - interval '2 days' and n.created_at < now() - interval '1 minute'
     and exists (select 1 from push_subscriptions p where p.user_id = n.recipient_user_id);
  if waiting > 0 then woke := app.wake_notify(); end if;
  return jsonb_build_object('reminders', queued, 'acks', acks, 'ranges', ranges, 'waiting', waiting, 'woke', woke);
end $$;
revoke execute on function app.notify_tick() from public, anon, authenticated;
