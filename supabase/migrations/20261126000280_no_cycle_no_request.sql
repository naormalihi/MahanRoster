-- No requests for days no cycle covers (decided 26.11): they showed nowhere but the home screen's
-- warning. An employee's absence or date block needs a cycle for every day; an exemption (which may
-- run past the cycle) needs to touch one. Staff enter constraints inside a cycle anyway.

create or replace function app.cycle_covers(p_from date, p_to date) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select not exists (
    select 1 from generate_series(p_from, p_to, interval '1 day') g(d)
    where not exists (select 1 from cycles c where g.d::date between c.start_date and c.end_date))
$$;

create or replace function app.cycle_overlaps(p_from date, p_to date) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from cycles c where c.start_date <= p_to and c.end_date >= p_from)
$$;
revoke all on function app.cycle_covers(date, date), app.cycle_overlaps(date, date) from public, anon;

create or replace function public.add_my_date_block(p_day date) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  sid uuid := app.require_my_soldier();
  new_id uuid;
  quota int := coalesce((app.setting('block_quota_per_month') #>> '{}')::int, 1);
begin
  if p_day is null or p_day <= current_date then raise exception 'חסימה רק לתאריך עתידי'; end if;
  if not app.cycle_covers(p_day, p_day) then raise exception 'אין עדיין מחזור לתאריכים האלה – אפשר להגיש כשאחראי השיבוצים יפתח מחזור'; end if;
  if not app.self_entry_open(p_day) then raise exception 'איסוף האילוצים למחזור הזה נסגר. לשינוי פנה לאחראי השיבוצים'; end if;
  if (select count(*) from date_blocks where soldier_id = sid and status = 'active'
        and date_trunc('month', day::timestamp) = date_trunc('month', p_day::timestamp)) >= quota then
    raise exception 'כבר יש לך חסימה בחודש הזה (מכסה: % בחודש). בטל אותה כדי לבחור יום אחר', quota;
  end if;
  insert into date_blocks (soldier_id, cycle_id, day, received_via, received_at)
  values (sid, (select c.id from cycles c where p_day between c.start_date and c.end_date order by c.start_date limit 1), p_day, 'system', now())
  returning date_blocks.id into new_id;
  return new_id;
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
  if p_to - p_from > 120 then raise exception 'היעדרות עד 120 יום – לארוכה יותר פנה לאחראי השיבוצים'; end if;
  if not exists (select 1 from absence_types where id = p_type and not requires_approval) then
    raise exception 'את סוג ההיעדרות הזה מזין אחראי השיבוצים';
  end if;
  if not app.cycle_covers(p_from, p_to) then raise exception 'אין עדיין מחזור לתאריכים האלה – אפשר להגיש כשאחראי השיבוצים יפתח מחזור'; end if;
  for d in select generate_series(p_from, p_to, interval '1 day')::date loop
    if not app.self_entry_open(d) then raise exception 'איסוף האילוצים למחזור של % נסגר. לשינוי פנה לאחראי השיבוצים', to_char(d, 'DD/MM'); end if;
  end loop;
  insert into absences (soldier_id, absence_type_id, starts_at, ends_at, received_via, received_at)
  values (sid, p_type, p_from::timestamp at time zone app.tz(), (p_to + 1)::timestamp at time zone app.tz(), 'system', now())
  returning absences.id into new_id;
  return new_id;
end $$;

create or replace function public.submit_exemption(p_type uuid, p_start date, p_end date, p_tasks uuid[] default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  sid uuid := app.require_my_soldier();
  new_id uuid;
  urgent boolean;
  needs boolean;
begin
  if p_start is null or p_end is null or p_end < p_start then raise exception 'תאריכים לא תקינים'; end if;
  if p_end < current_date then raise exception 'הפטור כבר הסתיים'; end if;
  if p_end - p_start > 400 then raise exception 'פטור עד שנה ומשהו – לפטור ארוך יותר פנה לאחראי השיבוצים'; end if;
  if not app.cycle_overlaps(p_start, p_end) then raise exception 'אין עדיין מחזור לתאריכים האלה – אפשר להגיש כשאחראי השיבוצים יפתח מחזור'; end if;
  select requires_duty_list into needs from exemption_types where id = p_type and auto_rule is null;
  if not found then raise exception 'סוג פטור לא מוכר'; end if;
  if needs and coalesce(cardinality(p_tasks), 0) = 0 then
    raise exception 'בפטור חלקי צריך לבחור לפחות משימה אחת שאינך יכול לבצע';
  end if;
  if needs and not (p_tasks <@ app.eligible_task_types(sid)) then
    raise exception 'אפשר לבחור רק משימות שאתה משובץ אליהן';
  end if;
  if exists (select 1 from exemptions where soldier_id = sid and exemption_type_id = p_type and status = 'pending'
              and start_date <= p_end and end_date >= p_start) then
    raise exception 'כבר הגשת בקשה כזו לתאריכים האלה, והיא ממתינה';
  end if;
  urgent := exists (select 1 from cycles c where c.start_date <= p_end and c.end_date >= p_start
                     and (c.status in ('published', 'closed') or (c.exemption_deadline is not null and c.exemption_deadline <= now())));
  insert into exemptions (soldier_id, exemption_type_id, kind, start_date, end_date, excluded_task_type_ids,
                          is_urgent, status, source, received_via, received_at)
  values (sid, p_type, case when needs then 'partial' else 'full' end, greatest(p_start, current_date), p_end,
          case when needs then p_tasks end, urgent, 'pending', 'soldier', 'system', now())
  returning exemptions.id into new_id;
  return new_id;
end $$;
