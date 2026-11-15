-- =============================================================================
-- Version 2.0, stage 2.2 – the soldier enters his own constraints.
--
--   * exemption request: pending until נע"ת checks the proof (shown outside the system –
--     no medical detail is kept) and decides; the soldier may withdraw it while pending.
--     After the constraints deadline of the cycle the dates fall in, a request is urgent.
--   * date block: one per calendar month (the existing unique index), until the deadline.
--   * absence: in force at once, of a type that needs no approval, until the deadline.
--
-- After the deadline (or once a cycle is published) blocks and absences go through נע"ת, as in
-- 1.0. Everything the soldier enters is marked received_via 'system', received_at now, and
-- on_behalf_of empty – so נע"ת sees it came from the soldier himself.
-- =============================================================================

-- The cycle a day falls in and whether self-entry is still open for it.
create or replace function app.self_entry_open(p_day date) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select not exists (
    select 1 from cycles c
    where p_day between c.start_date and c.end_date
      and (c.status in ('published', 'closed') or (c.exemption_deadline is not null and c.exemption_deadline <= now()))
  )
$$;

create or replace function app.require_my_soldier() returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare sid uuid := app.my_soldier();
begin
  if sid is null or not app.has_role('soldier') then raise exception 'רק חייל עם חשבון אישי' using errcode = '42501'; end if;
  return sid;
end $$;

-- What the forms offer: the types, the monthly block quota, and the cycles with their deadlines.
create or replace function public.my_input_options() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select case when app.my_soldier() is null then null else jsonb_build_object(
    'exemption_types', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name)
                                 from exemption_types t where t.auto_rule is null), '[]'),
    'absence_types', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name)
                               from absence_types t where not t.requires_approval), '[]'),
    'block_quota_per_month', coalesce((app.setting('block_quota_per_month') #>> '{}')::int, 1),
    'cycles', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'start_date', c.start_date, 'end_date', c.end_date,
                                                            'deadline', c.exemption_deadline,
                                                            'open', c.status not in ('published', 'closed')
                                                                    and (c.exemption_deadline is null or c.exemption_deadline > now()))
                                         order by c.start_date)
                        from cycles c where c.end_date >= current_date), '[]')
  ) end
$$;

-- His requests and entries from a month back on.
create or replace function public.my_requests() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with me as (select app.my_soldier() as id)
  select case when (select id from me) is null then null else jsonb_build_object(
    'exemptions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'type', t.name, 'start_date', e.start_date, 'end_date', e.end_date, 'status', e.status,
        'is_urgent', e.is_urgent, 'mine', e.source = 'soldier', 'decision_reason', e.decision_reason, 'created_at', e.created_at)
        order by e.start_date desc)
      from exemptions e join exemption_types t on t.id = e.exemption_type_id
      where e.soldier_id = (select id from me) and e.end_date >= current_date - 30 and e.source <> 'computed'), '[]'),
    'blocks', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'day', b.day, 'mine', b.received_via = 'system' and b.on_behalf_of is null,
                                                            'open', app.self_entry_open(b.day)) order by b.day)
      from date_blocks b where b.soldier_id = (select id from me) and b.status = 'active' and b.day >= current_date - 30), '[]'),
    'absences', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'type', t.name, 'starts_at', a.starts_at, 'ends_at', a.ends_at,
                                                              'mine', a.received_via = 'system' and a.on_behalf_of is null,
                                                              'open', app.self_entry_open((a.starts_at at time zone app.tz())::date)) order by a.starts_at)
      from absences a join absence_types t on t.id = a.absence_type_id
      where a.soldier_id = (select id from me) and a.status = 'active' and a.ends_at >= now() - interval '30 days'), '[]')
  ) end
$$;

create or replace function public.submit_exemption(p_type uuid, p_start date, p_end date) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  sid uuid := app.require_my_soldier();
  new_id uuid;
  urgent boolean;
begin
  if p_start is null or p_end is null or p_end < p_start then raise exception 'תאריכים לא תקינים'; end if;
  if p_end < current_date then raise exception 'הפטור כבר הסתיים'; end if;
  if p_end - p_start > 400 then raise exception 'פטור עד שנה ומשהו – לפטור ארוך יותר פנה לנע"ת'; end if;
  if not exists (select 1 from exemption_types where id = p_type and auto_rule is null) then raise exception 'סוג פטור לא מוכר'; end if;
  if exists (select 1 from exemptions where soldier_id = sid and exemption_type_id = p_type and status = 'pending'
              and start_date <= p_end and end_date >= p_start) then
    raise exception 'כבר הגשת בקשה כזו לתאריכים האלה, והיא ממתינה';
  end if;
  -- after the deadline of a cycle it touches, the request is urgent
  urgent := exists (select 1 from cycles c where c.start_date <= p_end and c.end_date >= p_start
                     and (c.status in ('published', 'closed') or (c.exemption_deadline is not null and c.exemption_deadline <= now())));
  insert into exemptions (soldier_id, exemption_type_id, kind, start_date, end_date, is_urgent, status, source, received_via, received_at)
  values (sid, p_type, 'full', greatest(p_start, current_date), p_end, urgent, 'pending', 'soldier', 'system', now())
  returning exemptions.id into new_id;
  return new_id;
end $$;

create or replace function public.withdraw_my_exemption(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare sid uuid := app.require_my_soldier();
begin
  update exemptions set status = 'cancelled', decided_at = now(), decision_reason = 'בוטל על ידי החייל'
   where id = p_id and soldier_id = sid and status = 'pending';
  if not found then raise exception 'אפשר לבטל רק בקשה שעוד ממתינה'; end if;
end $$;

create or replace function public.add_my_date_block(p_day date) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  sid uuid := app.require_my_soldier();
  new_id uuid;
  quota int := coalesce((app.setting('block_quota_per_month') #>> '{}')::int, 1);
begin
  if p_day is null or p_day <= current_date then raise exception 'חסימה רק לתאריך עתידי'; end if;
  if not app.self_entry_open(p_day) then raise exception 'איסוף האילוצים למחזור הזה נסגר. לשינוי פנה לנע"ת'; end if;
  if (select count(*) from date_blocks where soldier_id = sid and status = 'active'
        and date_trunc('month', day::timestamp) = date_trunc('month', p_day::timestamp)) >= quota then
    raise exception 'כבר יש לך חסימה בחודש הזה (מכסה: % בחודש). בטל אותה כדי לבחור יום אחר', quota;
  end if;
  insert into date_blocks (soldier_id, cycle_id, day, received_via, received_at)
  values (sid, (select c.id from cycles c where p_day between c.start_date and c.end_date order by c.start_date limit 1), p_day, 'system', now())
  returning date_blocks.id into new_id;
  return new_id;
end $$;

create or replace function public.cancel_my_date_block(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare sid uuid := app.require_my_soldier(); d date;
begin
  select day into d from date_blocks where id = p_id and soldier_id = sid and status = 'active';
  if not found then raise exception 'החסימה לא נמצאה'; end if;
  if not app.self_entry_open(d) then raise exception 'איסוף האילוצים למחזור הזה נסגר. לשינוי פנה לנע"ת'; end if;
  update date_blocks set status = 'cancelled' where id = p_id;
end $$;

create or replace function public.add_my_absence(p_type uuid, p_from date, p_to date) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  sid uuid := app.require_my_soldier();
  new_id uuid;
  d date;
begin
  if p_from is null or p_to is null or p_to < p_from then raise exception 'תאריכים לא תקינים'; end if;
  if p_from <= current_date then raise exception 'היעדרות רק מתאריך עתידי'; end if;
  if p_to - p_from > 120 then raise exception 'היעדרות עד 120 יום – לארוכה יותר פנה לנע"ת'; end if;
  if not exists (select 1 from absence_types where id = p_type and not requires_approval) then
    raise exception 'את סוג ההיעדרות הזה מזין נע"ת';
  end if;
  for d in select generate_series(p_from, p_to, interval '1 day')::date loop
    if not app.self_entry_open(d) then raise exception 'איסוף האילוצים למחזור של % נסגר. לשינוי פנה לנע"ת', to_char(d, 'DD/MM'); end if;
  end loop;
  insert into absences (soldier_id, absence_type_id, starts_at, ends_at, received_via, received_at)
  values (sid, p_type, p_from::timestamp at time zone app.tz(), (p_to + 1)::timestamp at time zone app.tz(), 'system', now())
  returning absences.id into new_id;
  return new_id;
end $$;

create or replace function public.cancel_my_absence(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare sid uuid := app.require_my_soldier(); a absences;
begin
  select * into a from absences where id = p_id and soldier_id = sid and status = 'active';
  if not found then raise exception 'ההיעדרות לא נמצאה'; end if;
  if a.received_via is distinct from 'system' or a.on_behalf_of is not null then raise exception 'את ההיעדרות הזו הזין נע"ת – לשינוי פנה אליו'; end if;
  if not app.self_entry_open((a.starts_at at time zone app.tz())::date) then raise exception 'איסוף האילוצים למחזור הזה נסגר. לשינוי פנה לנע"ת'; end if;
  update absences set status = 'cancelled', cancelled_by = auth.uid(), cancel_reason = 'בוטל על ידי החייל' where id = p_id;
end $$;

revoke execute on function public.my_input_options(), public.my_requests(), public.submit_exemption(uuid, date, date),
  public.withdraw_my_exemption(uuid), public.add_my_date_block(date), public.cancel_my_date_block(uuid),
  public.add_my_absence(uuid, date, date), public.cancel_my_absence(uuid) from anon, public;
grant execute on function public.my_input_options(), public.my_requests(), public.submit_exemption(uuid, date, date),
  public.withdraw_my_exemption(uuid), public.add_my_date_block(date), public.cancel_my_date_block(uuid),
  public.add_my_absence(uuid, date, date), public.cancel_my_absence(uuid) to authenticated;
revoke execute on function app.self_entry_open(date), app.require_my_soldier() from anon, public;
