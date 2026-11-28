-- =============================================================================
-- "תורנויות מסגרת" (2.76): a monthly duty that passes between the frames (gafim) – e.g. איסוף
-- משיכת חלב ולוגיסטיקה every Sunday. It is NOT a task: no slots, no scoring, no solver, no reports.
--   * frame_rotas: the duty (name, weekday, time, place, details) and the order of the frames;
--     start_month is the month the first frame in the order takes; the order repeats every N months.
--   * frame_rota_overrides: a month given to another frame by hand.
--   * A day that is a holiday or a holiday eve (calendar_days) moves to the next working day.
--   * Every employee sees who is on duty this month and next; the frame's gaf commander and
--     נציג המסגרת get a card in "משימות" during their month, a notice in the month before, and push
--     notifications: a week before the month and at 20:00 the evening before each day.
-- =============================================================================

create table if not exists frame_rotas (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  weekday     smallint not null default 0 check (weekday between 0 and 6),   -- 0 = ראשון
  at_time     time not null default '08:00',
  place       text check (place is null or char_length(place) <= 80),
  details     text check (details is null or char_length(details) <= 300),
  is_active   boolean not null default true,
  gaf_order   uuid[] not null default '{}',
  start_month date not null default date_trunc('month', current_date)::date check (extract(day from start_month) = 1),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table frame_rotas enable row level security;

create table if not exists frame_rota_overrides (
  rota_id uuid not null references frame_rotas(id) on delete cascade,
  month   date not null check (extract(day from month) = 1),
  gaf_id  uuid not null references org_units(id),
  primary key (rota_id, month)
);
alter table frame_rota_overrides enable row level security;

-- which notification went out (once each)
create table if not exists frame_rota_sent (
  rota_id uuid not null references frame_rotas(id) on delete cascade,
  kind    text not null,
  day     date not null,
  sent_at timestamptz not null default now(),
  primary key (rota_id, kind, day)
);
alter table frame_rota_sent enable row level security;
-- no policies: only the functions below touch them

do $$
declare t text;
begin
  foreach t in array array['frame_rotas', 'frame_rota_overrides'] loop
    execute format('drop trigger if exists live_bump_iud on public.%I', t);
    execute format('drop trigger if exists live_bump_upd on public.%I', t);
    execute format('create trigger live_bump_iud after insert or delete on public.%I
                      for each row execute function app.bump_data_version()', t);
    execute format('create trigger live_bump_upd after update on public.%I
                      for each row when (old.* is distinct from new.*) execute function app.bump_data_version()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------
create or replace function app.he_weekday(p_day date) returns text
language sql immutable as $$
  select (array['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'])[extract(dow from p_day)::int + 1]
$$;

-- the frame on duty in a month: a hand override, else the order (repeating, also before start_month)
create or replace function app.frame_rota_gaf(p_rota uuid, p_month date) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select o.gaf_id from frame_rota_overrides o where o.rota_id = r.id and o.month = date_trunc('month', p_month)::date),
    case when cardinality(r.gaf_order) = 0 then null else
      r.gaf_order[((( (extract(year from p_month)::int * 12 + extract(month from p_month)::int)
                    - (extract(year from r.start_month)::int * 12 + extract(month from r.start_month)::int))
                    % cardinality(r.gaf_order) + cardinality(r.gaf_order)) % cardinality(r.gaf_order)) + 1]
    end)
  from frame_rotas r where r.id = p_rota
$$;

-- not a working day: Friday, Saturday, or a holiday / holiday eve in לוח חגים
create or replace function app.is_work_day(p_day date) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select extract(dow from p_day) not in (5, 6) and not app.is_holiday(p_day)
$$;

-- the duty's days in a month: planned (the weekday) and actual (the next working day when needed)
create or replace function app.frame_rota_days(p_rota uuid, p_month date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  r frame_rotas;
  m date := date_trunc('month', p_month)::date;
  d date;
  a date;
  why text;
  out jsonb := '[]';
begin
  select * into r from frame_rotas where id = p_rota;
  if not found then return out; end if;
  d := m + ((r.weekday - extract(dow from m)::int + 7) % 7);
  while d < (m + interval '1 month')::date loop
    a := d;
    for i in 1..21 loop
      exit when app.is_work_day(a);
      a := a + 1;
    end loop;
    why := null;
    if a <> d then
      select string_agg(coalesce(nullif(c.note, ''), t.name), ', ' order by c.day) into why
      from calendar_days c join day_types t on t.code = c.day_type
      where c.day >= d and c.day < a and t.counts_as_holiday;
    end if;
    out := out || jsonb_build_object('planned', d, 'actual', a, 'why', why);
    d := d + 7;
  end loop;
  return out;
end $$;

-- who gets the frame's card and notifications: its gaf commander(s) and נציג המסגרת
create or replace function app.frame_people(p_gaf uuid) returns table (user_id uuid, soldier_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select distinct u.id, u.soldier_id
  from user_roles ur
  join app_users u on u.id = ur.user_id
  left join soldiers s on s.id = u.soldier_id
  where ur.role in ('gaf_commander', 'gaf_rep') and coalesce(ur.gaf_id, s.gaf_id) = p_gaf
    and not u.is_locked and u.deleted_at is null
    and (ur.valid_from is null or ur.valid_from <= now()) and (ur.valid_to is null or ur.valid_to > now())
$$;

create or replace function app.gaf_commander_name(p_gaf uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select string_agg(distinct s.full_name, ', ')
  from user_roles ur
  join app_users u on u.id = ur.user_id
  join soldiers s on s.id = u.soldier_id
  where ur.role = 'gaf_commander' and coalesce(ur.gaf_id, s.gaf_id) = p_gaf
    and not u.is_locked and u.deleted_at is null
    and (ur.valid_from is null or ur.valid_from <= now()) and (ur.valid_to is null or ur.valid_to > now())
$$;

create or replace function app.frame_rota_month(p_rota uuid, p_month date) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'month', date_trunc('month', p_month)::date,
    'gaf_id', g.gaf,
    'gaf_name', (select name from org_units where id = g.gaf),
    'commander', app.gaf_commander_name(g.gaf),
    'overridden', exists (select 1 from frame_rota_overrides o where o.rota_id = p_rota and o.month = date_trunc('month', p_month)::date))
  from (select app.frame_rota_gaf(p_rota, p_month) as gaf) g
$$;

revoke execute on function app.frame_rota_gaf(uuid, date), app.is_work_day(date), app.frame_rota_days(uuid, date),
  app.frame_people(uuid), app.gaf_commander_name(uuid), app.frame_rota_month(uuid, date) from public, anon;
grant execute on function app.frame_rota_gaf(uuid, date), app.is_work_day(date), app.frame_rota_days(uuid, date),
  app.frame_people(uuid), app.gaf_commander_name(uuid), app.frame_rota_month(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- settings (אחראי השיבוצים)
-- ---------------------------------------------------------------------------
create or replace function public.frame_rotas_admin() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  this_month date := date_trunc('month', (now() at time zone app.tz())::date)::date;
begin
  if not app.is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'gafs', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name) order by g.name)
                      from org_units g where g.kind = 'gaf' and g.merged_into_id is null
                        and (g.active_to is null or g.active_to >= current_date)), '[]'),
    'rotas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'name', r.name, 'weekday', r.weekday, 'at_time', to_char(r.at_time, 'HH24:MI'),
        'place', r.place, 'details', r.details, 'is_active', r.is_active,
        'gaf_order', to_jsonb(r.gaf_order), 'start_month', r.start_month,
        'months', (select jsonb_agg(app.frame_rota_month(r.id, (this_month + make_interval(months => k))::date) order by k)
                   from generate_series(0, 11) k))
      order by r.created_at) from frame_rotas r), '[]'));
end $$;

create or replace function public.frame_rota_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_order uuid[] := coalesce((select array_agg(x::uuid order by i) from jsonb_array_elements_text(coalesce(p->'gaf_order', '[]')) with ordinality t(x, i)), '{}');
begin
  if not app.is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  if exists (select 1 from unnest(v_order) g where not exists (select 1 from org_units o where o.id = g and o.kind = 'gaf')) then
    raise exception 'מסגרת לא קיימת';
  end if;
  if (select count(distinct g) from unnest(v_order) g) <> cardinality(v_order) then
    raise exception 'מסגרת מופיעה פעמיים בסבב';
  end if;
  if v_id is null then
    insert into frame_rotas (name, weekday, at_time, place, details, is_active, gaf_order, start_month)
    values (btrim(p->>'name'), coalesce((p->>'weekday')::smallint, 0), coalesce((p->>'at_time')::time, '08:00'),
            nullif(btrim(p->>'place'), ''), nullif(btrim(p->>'details'), ''), coalesce((p->>'is_active')::boolean, true),
            v_order, date_trunc('month', coalesce((p->>'start_month')::date, current_date))::date)
    returning id into v_id;
  else
    update frame_rotas set
      name = btrim(p->>'name'), weekday = coalesce((p->>'weekday')::smallint, weekday),
      at_time = coalesce((p->>'at_time')::time, at_time),
      place = nullif(btrim(p->>'place'), ''), details = nullif(btrim(p->>'details'), ''),
      is_active = coalesce((p->>'is_active')::boolean, is_active), gaf_order = v_order,
      start_month = date_trunc('month', coalesce((p->>'start_month')::date, start_month))::date,
      updated_at = now()
    where id = v_id;
    if not found then raise exception 'לא נמצא – אולי נמחק בינתיים'; end if;
  end if;
  insert into audit_log (actor_user_id, action, entity_type, entity_id) values (auth.uid(), 'frame_rota_save', 'frame_rota', v_id);
  return v_id;
end $$;

create or replace function public.frame_rota_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from frame_rotas where id = p_id;
  insert into audit_log (actor_user_id, action, entity_type, entity_id) values (auth.uid(), 'frame_rota_delete', 'frame_rota', p_id);
end $$;

-- p_gaf null: back to the order
create or replace function public.frame_rota_override(p_rota uuid, p_month date, p_gaf uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare m date := date_trunc('month', p_month)::date;
begin
  if not app.is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_gaf is null then
    delete from frame_rota_overrides where rota_id = p_rota and month = m;
  else
    if not exists (select 1 from org_units where id = p_gaf and kind = 'gaf') then raise exception 'מסגרת לא קיימת'; end if;
    insert into frame_rota_overrides (rota_id, month, gaf_id) values (p_rota, m, p_gaf)
    on conflict (rota_id, month) do update set gaf_id = excluded.gaf_id;
  end if;
  insert into audit_log (actor_user_id, action, entity_type, entity_id) values (auth.uid(), 'frame_rota_override', 'frame_rota', p_rota);
end $$;

-- ---------------------------------------------------------------------------
-- what an employee sees ("משימות"): every active rota, this month and next; mine = his frame
-- ---------------------------------------------------------------------------
create or replace function public.my_frame_rotas() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  me uuid := app.my_soldier();
  this_month date := date_trunc('month', (now() at time zone app.tz())::date)::date;
  next_month date := (date_trunc('month', (now() at time zone app.tz())::date) + interval '1 month')::date;
  mine uuid[];
begin
  if me is null and not app.is_staff() and not app.is_commander() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct coalesce(ur.gaf_id, s.gaf_id)), '{}') into mine
  from app_users u
  join user_roles ur on ur.user_id = u.id and ur.role in ('gaf_commander', 'gaf_rep')
  left join soldiers s on s.id = u.soldier_id
  where me is not null and u.soldier_id = me and not u.is_locked and u.deleted_at is null
    and (ur.valid_from is null or ur.valid_from <= now()) and (ur.valid_to is null or ur.valid_to > now());
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'name', r.name, 'weekday', r.weekday, 'at_time', to_char(r.at_time, 'HH24:MI'), 'place', r.place,
      'current', app.frame_rota_month(r.id, this_month) || jsonb_build_object(
                   'mine', app.frame_rota_gaf(r.id, this_month) = any (mine),
                   'days', app.frame_rota_days(r.id, this_month)),
      'next', app.frame_rota_month(r.id, next_month) || jsonb_build_object(
                'mine', app.frame_rota_gaf(r.id, next_month) = any (mine),
                'days', app.frame_rota_days(r.id, next_month)),
      -- the details only to the frame on duty (this month or next)
      'details', case when app.frame_rota_gaf(r.id, this_month) = any (mine) or app.frame_rota_gaf(r.id, next_month) = any (mine)
                      then r.details end)
    order by r.created_at)
    from frame_rotas r where r.is_active and cardinality(r.gaf_order) > 0), '[]');
end $$;

revoke execute on function public.frame_rotas_admin(), public.frame_rota_save(jsonb), public.frame_rota_delete(uuid),
  public.frame_rota_override(uuid, date, uuid), public.my_frame_rotas() from public, anon;
grant execute on function public.frame_rotas_admin(), public.frame_rota_save(jsonb), public.frame_rota_delete(uuid),
  public.frame_rota_override(uuid, date, uuid), public.my_frame_rotas() to authenticated;

-- ---------------------------------------------------------------------------
-- notifications (from notify_tick)
--   * 'month': a week before the frame's month, in the day (09:00–21:00)
--   * 'eve': from 20:00 the evening before the actual day
--   * 'moved': from 20:00 the evening before a planned day that moved (a holiday)
-- ---------------------------------------------------------------------------
create or replace function app.queue_frame_rota_reminders() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n int := 0;
  k int;
  r frame_rotas;
  local_now timestamp := now() at time zone app.tz();
  today date := (now() at time zone app.tz())::date;
  tomorrow date := (now() at time zone app.tz())::date + 1;
  next_month date := (date_trunc('month', (now() at time zone app.tz())::date) + interval '1 month')::date;
  g uuid;
  d jsonb;
  ad date;
  pd date;
  title text;
  body text;
begin
  for r in select * from frame_rotas where is_active and cardinality(gaf_order) > 0 loop
    -- a week before the month
    if next_month - today <= 7 and local_now::time between time '09:00' and time '21:00' then
      g := app.frame_rota_gaf(r.id, next_month);
      if g is not null then
        insert into frame_rota_sent (rota_id, kind, day) values (r.id, 'month', next_month) on conflict do nothing;
        get diagnostics k = row_count;
        if k > 0 then
          insert into notifications (recipient_user_id, type, payload)
          select p.user_id, 'frame_rota', jsonb_build_object(
            'rota_id', r.id, 'kind', 'month', 'day', next_month,
            'title', 'בחודש הבא התור של המסגרת שלך',
            'body', r.name || ' · כל יום ' || app.he_weekday(r.start_month + r.weekday - extract(dow from r.start_month)::int)
                    || ' ב־' || to_char(r.at_time, 'HH24:MI') || coalesce(' · ' || r.place, ''),
            'url', '/my')
          from app.frame_people(g) p;
          get diagnostics k = row_count; n := n + k;
        end if;
      end if;
    end if;

    -- the evening before
    if local_now::time >= time '20:00' then
      for d in
        select x from (
          select jsonb_array_elements(app.frame_rota_days(r.id, (tomorrow - 21))) x
          union all
          select jsonb_array_elements(app.frame_rota_days(r.id, tomorrow)) x
          where date_trunc('month', tomorrow - 21) <> date_trunc('month', tomorrow)) y
      loop
        pd := (d->>'planned')::date;
        ad := (d->>'actual')::date;
        g := app.frame_rota_gaf(r.id, pd);
        continue when g is null;
        if ad = tomorrow then
          insert into frame_rota_sent (rota_id, kind, day) values (r.id, 'eve', ad) on conflict do nothing;
          get diagnostics k = row_count;
          if k > 0 then
            title := 'מחר: ' || r.name;
            body := app.he_weekday(ad) || ' ' || to_char(ad, 'FMDD.FMMM') || ' · ' || to_char(r.at_time, 'HH24:MI')
                    || coalesce(' · ' || r.place, '')
                    || case when ad <> pd then ' (במקום ' || app.he_weekday(pd) || coalesce(' – ' || (d->>'why'), '') || ')' else '' end;
            insert into notifications (recipient_user_id, type, payload)
            select p.user_id, 'frame_rota', jsonb_build_object('rota_id', r.id, 'kind', 'eve', 'day', ad, 'title', title, 'body', body, 'url', '/my')
            from app.frame_people(g) p;
            get diagnostics k = row_count; n := n + k;
          end if;
        end if;
        if pd = tomorrow and ad <> pd then
          insert into frame_rota_sent (rota_id, kind, day) values (r.id, 'moved', pd) on conflict do nothing;
          get diagnostics k = row_count;
          if k > 0 then
            title := 'מחר ' || coalesce(d->>'why', 'חג') || ' – ' || r.name || ' עוברת ל' || app.he_weekday(ad) || ' ' || to_char(ad, 'FMDD.FMMM');
            body := r.name || ' · ' || to_char(r.at_time, 'HH24:MI') || coalesce(' · ' || r.place, '');
            insert into notifications (recipient_user_id, type, payload)
            select p.user_id, 'frame_rota', jsonb_build_object('rota_id', r.id, 'kind', 'moved', 'day', pd, 'title', title, 'body', body, 'url', '/my')
            from app.frame_people(g) p;
            get diagnostics k = row_count; n := n + k;
          end if;
        end if;
      end loop;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function app.queue_frame_rota_reminders() from public, anon, authenticated;

create or replace function app.notify_tick()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare queued int; acks int; ranges int; deadlines int; rotas int; waiting int; woke boolean := false;
begin
  queued := app.queue_reminders();   -- its inserts wake the workflow through the trigger
  acks := app.queue_ack_reminders(); -- "עוד לא אישרת" and the gaf commander's notice
  ranges := app.queue_range_reminders();
  deadlines := app.queue_deadline_reminders();
  rotas := app.queue_frame_rota_reminders();
  select count(*) into waiting
    from notifications n
   where n.pushed_at is null and n.created_at > now() - interval '2 days' and n.created_at < now() - interval '1 minute'
     and exists (select 1 from push_subscriptions p where p.user_id = n.recipient_user_id);
  if waiting > 0 then woke := app.wake_notify(); end if;
  return jsonb_build_object('reminders', queued, 'acks', acks, 'ranges', ranges, 'deadlines', deadlines, 'rotas', rotas, 'waiting', waiting, 'woke', woke);
end $function$;

-- the unit's line ("נתוני היחידה")
create or replace function public.frame_rotas_status() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  this_month date := date_trunc('month', (now() at time zone app.tz())::date)::date;
begin
  perform app.require_unit_numbers();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'name', r.name,
      'current', app.frame_rota_month(r.id, this_month),
      'next', app.frame_rota_month(r.id, (this_month + interval '1 month')::date)) order by r.created_at)
    from frame_rotas r where r.is_active and cardinality(r.gaf_order) > 0), '[]');
end $$;
revoke execute on function public.frame_rotas_status() from public, anon;
grant execute on function public.frame_rotas_status() to authenticated;
