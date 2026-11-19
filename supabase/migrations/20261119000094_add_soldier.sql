-- Adding a soldier by hand, and taking one out of the unit (פריט 5).
--
-- add_soldier: one soldier from a short form instead of a personnel file. The ת.ז arrives already
-- hashed (HMAC with the unit key, in the browser) as soldier_key – the number never reaches the
-- server. An existing active soldier with the same key is not duplicated; an inactive one is
-- offered back (reactivate_soldier), keeping his history.
-- A newcomer (decided 19.11): joins with the average score of his group (grant_opening_scores, as
-- for a newcomer from a file), the engine does not assign him for 3 months from his join date
-- (grace_days = 90), and a manual assignment in that time counts as a call-up – compensation.
-- He enters the snapshot of the cycles under way at once, so he can be assigned by hand.
-- remove_from_unit: inactive from a date; his duties from that date are dropped, so they show as
-- slots to fill (and he is told), never deleted quietly.

update settings set value = '90' where key = 'grace_days';

-- the cycles under way that already have a snapshot: refresh them so a new soldier is in them
create or replace function app.resnapshot_open_cycles(p_from date) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare c record; n int := 0;
begin
  for c in select distinct cy.id from cycles cy
           where cy.end_date >= p_from and exists (select 1 from cycle_soldier_snapshot sn where sn.cycle_id = cy.id)
  loop
    perform public.snapshot_cycle(c.id);
    perform app.grant_opening_scores(c.id);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.add_soldier(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  key text := p ->> 'soldier_key';
  ex soldiers;
  gname text;
  sid uuid;
  joined date := coalesce((p ->> 'unit_join_date')::date, current_date);
begin
  perform app.require_staff();
  if key !~ '^[0-9a-f]{64}$' then raise exception 'מפתח החייל לא תקין – בדוק את מפתח היחידה'; end if;
  if coalesce(trim(p ->> 'full_name'), '') = '' then raise exception 'חסר שם'; end if;
  select * into ex from soldiers where soldier_key = key;
  if found then
    select name into gname from org_units where id = ex.gaf_id;
    return jsonb_build_object('status', case when ex.is_active then 'exists' else 'inactive' end,
                              'id', ex.id, 'name', ex.full_name, 'gaf', gname);
  end if;
  insert into soldiers (soldier_key, full_name, service_type, gender, gaf_id, computed_rank_id, enlistment_date,
                        release_date, career_start_date, range_valid_until, parent_status, home_nightly, phone, unit_join_date)
  values (key, trim(p ->> 'full_name'), (p ->> 'service_type')::service_type, nullif(p ->> 'gender', '')::gender_type,
          (p ->> 'gaf_id')::uuid, nullif(p ->> 'rank_id', '')::uuid, nullif(p ->> 'enlistment_date', '')::date,
          nullif(p ->> 'release_date', '')::date, nullif(p ->> 'career_start_date', '')::date,
          nullif(p ->> 'range_valid_until', '')::date, coalesce((p ->> 'parent_status')::boolean, false),
          coalesce((p ->> 'home_nightly')::boolean, false), nullif(p ->> 'phone', ''), joined)
  returning id into sid;
  insert into audit_log (actor_user_id, action, entity_type, entity_id, after)
  values (auth.uid(), 'add_soldier', 'soldiers', sid::text, jsonb_build_object('full_name', trim(p ->> 'full_name'), 'unit_join_date', joined));
  perform app.resnapshot_open_cycles(joined);
  return jsonb_build_object('status', 'added', 'id', sid);
end $$;

create or replace function public.reactivate_soldier(p_soldier uuid, p_join date default current_date) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.require_staff();
  update soldiers set is_active = true, unit_join_date = coalesce(p_join, current_date), updated_at = now()
   where id = p_soldier and not is_active;
  if not found then raise exception 'החייל לא נמצא או שהוא כבר פעיל'; end if;
  insert into audit_log (actor_user_id, action, entity_type, entity_id, after)
  values (auth.uid(), 'reactivate_soldier', 'soldiers', p_soldier::text, jsonb_build_object('unit_join_date', p_join));
  perform app.resnapshot_open_cycles(coalesce(p_join, current_date));
end $$;

create or replace function public.remove_from_unit(p_soldier uuid, p_from date default current_date) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  perform app.require_staff();
  update soldiers set is_active = false, updated_at = now() where id = p_soldier and is_active;
  if not found then raise exception 'החייל לא נמצא או שהוא כבר לא פעיל'; end if;
  -- his duties from that day: dropped (the slot shows as missing; he gets "removed")
  update assignments a set status = 'dropped', manual_reason = coalesce(a.manual_reason, 'יצא מהיחידה')
    from slots s
   where s.id = a.slot_id and a.soldier_id = p_soldier and s.starts_at >= p_from::timestamptz
     and a.status in ('assigned', 'reserve_idle');
  get diagnostics n = row_count;
  delete from assignments a using slots s
   where s.id = a.slot_id and a.soldier_id = p_soldier and a.status = 'draft' and s.starts_at >= p_from::timestamptz;
  insert into audit_log (actor_user_id, action, entity_type, entity_id, after)
  values (auth.uid(), 'remove_from_unit', 'soldiers', p_soldier::text, jsonb_build_object('from', p_from, 'duties_dropped', n));
  return n;
end $$;

-- how many live duties a soldier has from a day (the confirmation before taking him out)
create or replace function public.future_duties(p_soldier uuid, p_from date default current_date) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::int from assignments a join slots s on s.id = a.slot_id
  where app.is_staff() and a.soldier_id = p_soldier and s.starts_at >= p_from::timestamptz
    and a.status in ('assigned', 'reserve_idle', 'draft')
$$;

revoke execute on function app.resnapshot_open_cycles(date) from anon, public, authenticated;
revoke execute on function public.add_soldier(jsonb), public.reactivate_soldier(uuid, date), public.remove_from_unit(uuid, date),
  public.future_duties(uuid, date) from anon, public;
grant execute on function public.add_soldier(jsonb), public.reactivate_soldier(uuid, date), public.remove_from_unit(uuid, date),
  public.future_duties(uuid, date) to authenticated, service_role;

-- a manual assignment of a soldier still in his grace period counts as a call-up, however early
create or replace function app.call_up_by_notice() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  sl slots;
  c cycles;
  binding constant assignment_status[] := array['assigned', 'reserve_activated', 'done']::assignment_status[];
  was boolean := case when tg_op = 'UPDATE' then old.is_surprise else false end;
  now_flag boolean;
  m numeric;
begin
  if tg_op = 'UPDATE' and new.status = old.status then
    new.is_surprise := old.is_surprise;
    return new;
  end if;
  if new.status <> all (binding) then
    now_flag := false;                                   -- not (or no longer) doing the duty
  elsif tg_op = 'UPDATE' and old.status = any (binding) then
    now_flag := old.is_surprise;                         -- assigned → done and the like: as it was
  elsif tg_op = 'UPDATE' and old.status = 'dropped' then
    now_flag := false;                                   -- given back his own duty: he was planned
  else
    select * into sl from slots where id = new.slot_id;
    select * into c from cycles where id = sl.cycle_id;
    now_flag := c.status = 'published' and c.published_at < now()   -- not the first publication
                and new.source <> 'swap'                                      -- a swap is by choice
                and sl.fixed_points is null and not sl.is_penalty_slot
                and sl.starts_at - now() < make_interval(hours => coalesce((app.setting('surprise_notice_hours') #>> '{}')::int, 72));
    -- a newcomer in his grace period, assigned by hand: a call-up whenever it is done (compensation)
    if not now_flag and new.source = 'manual' and sl.fixed_points is null and not sl.is_penalty_slot then
      now_flag := exists (select 1 from soldiers so where so.id = new.soldier_id and so.unit_join_date is not null
                          and sl.starts_at < (so.unit_join_date + coalesce((app.setting('grace_days') #>> '{}')::int, 0))::timestamptz);
    end if;
  end if;
  if now_flag is distinct from was then
    m := coalesce((app.setting('surprise_multiplier') #>> '{}')::numeric, 1);
    if m > 0 then
      if now_flag then
        new.points := round(new.points * m, 2);
        new.normalized_points := round(new.normalized_points * m, 2);
      else
        new.points := round(new.points / m, 2);
        new.normalized_points := round(new.normalized_points / m, 2);
      end if;
    end if;
  end if;
  new.is_surprise := now_flag;
  return new;
end $$;

