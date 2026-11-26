-- The range card lives in the employee's personal card now: the reminders point there.
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
      || 'אחרי שירית – עדכן את תאריך המטווח בכרטיס האישי.',
      '/my/profile', jsonb_build_object('valid_until', r.range_valid_until));
  end loop;

  -- a range was saved: those who need it, and each gaf commander gets the list of their gaf
  for pr in select * from planned_ranges where notified_at is null and day >= today loop
    rng := app.range_text(pr);
    for r in select id from app.range_needers(pr.id) loop
      n := n + app.notify_soldier(r.id, 'range_planned', 'נקבע מטווח', rng || coalesce('. ' || pr.note, ''),
        '/my/profile', jsonb_build_object('range_id', pr.id));
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
        '/my/profile', jsonb_build_object('range_id', pr.id));
    end loop;
    update planned_ranges set eve_notified_at = now() where id = pr.id;
  end loop;
  return n;
end $$;
