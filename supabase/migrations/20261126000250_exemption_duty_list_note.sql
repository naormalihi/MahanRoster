-- Exemptions (decided 26.11):
-- 1. A type marked "requires a duty list" (פטור חלקי) is saved only with the duties the employee
--    can't do, chosen from those the employee is eligible for. Before, a פטור חלקי "by type" had
--    no duties mapped – so it excluded every duty, like a full exemption.
-- 2. An internal note for staff (on approval or later) – never shown to the employee.
-- 3. Staff delete a row outright (exemptions, absences, date blocks) – staff_all already allows it
--    and the audit trigger already logs the delete; nothing to add in the database.

alter table exemption_types add column if not exists requires_duty_list boolean not null default false;
comment on column exemption_types.requires_duty_list is 'An exemption of this type names the duties the employee can''t do (פטור חלקי).';
update exemption_types set requires_duty_list = true where name = 'פטור חלקי';

alter table exemptions add column if not exists internal_note text
  check (internal_note is null or length(internal_note) <= 200);
comment on column exemptions.internal_note is 'Staff only, no medical details. Employees read their requests through my_requests, which leaves it out.';

-- The duties an employee is eligible for on a day, by the static rules of the potential
-- (service, populations, rank, gender, שח"ר) – from the employee's record, not a cycle snapshot.
create or replace function app.eligible_task_types(p_soldier uuid, p_on date default current_date) returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  with s as (
    select so.*, r.sort_order as rank_order,
      app.service_on(so.career_start_date, so.service_type, p_on) as svc,
      coalesce(r.population_tags, '{}') as rank_tags
    from soldiers so
    left join ranks r on r.id = case when so.appointment_rank_id is not null
                                       and (so.appointment_rank_until is null or so.appointment_rank_until >= p_on)
                                      then so.appointment_rank_id else so.computed_rank_id end
    where so.id = p_soldier
  )
  select coalesce(array_agg(t.id order by t.name), '{}')
  from s cross join task_types t
  left join ranks rmin on rmin.id = t.rank_min_id
  left join ranks rmax on rmax.id = t.rank_max_id
  where t.is_active
    and (t.service_restriction = 'any' or s.svc::text = t.service_restriction)
    and (t.qualifying_duty or cardinality(t.eligible_populations) = 0
         or t.eligible_populations && (array[s.svc::text] || s.rank_tags))
    and (rmin.sort_order is null or coalesce(s.rank_order, 0) >= rmin.sort_order)
    and (rmax.sort_order is null or coalesce(s.rank_order, 0) <= rmax.sort_order)
    and (t.allowed_rank_ids is null or exists (select 1 from ranks r where r.id = any(t.allowed_rank_ids)
                                               and r.sort_order = coalesce(s.rank_order, 0)))
    and (t.gender is null or s.gender is not distinct from t.gender)
    and not (s.is_shachar and s.svc = 'mandatory' and not t.shachar_compatible)
    and not (t.shachar_only and not (s.is_shachar and s.svc = 'mandatory'))
$$;
revoke all on function app.eligible_task_types(uuid, date) from public, anon;

-- for the forms: staff for anyone, an employee for themself
create or replace function public.eligible_task_types(p_soldier uuid) returns uuid[]
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not app.is_staff() and app.my_soldier() is distinct from p_soldier then
    raise exception 'אין הרשאה' using errcode = '42501';
  end if;
  return app.eligible_task_types(p_soldier);
end $$;
revoke all on function public.eligible_task_types(uuid) from public, anon;
grant execute on function public.eligible_task_types(uuid) to authenticated;

-- A פטור חלקי needs its duties: when entered, approved, or its type or duties change.
-- Rows from before stay as they are until someone touches them (the table marks them).
create or replace function app.exemption_duty_list_check() returns trigger
language plpgsql as $$
begin
  if new.status in ('pending', 'approved')
     and exists (select 1 from exemption_types t where t.id = new.exemption_type_id and t.requires_duty_list)
     and (tg_op = 'INSERT'
          or new.status is distinct from old.status
          or new.exemption_type_id is distinct from old.exemption_type_id
          or new.excluded_task_type_ids is distinct from old.excluded_task_type_ids) then
    if coalesce(cardinality(new.excluded_task_type_ids), 0) = 0 then
      raise exception 'בפטור חלקי צריך לבחור לפחות משימה אחת שהעובד לא יכול לבצע';
    end if;
    new.kind := 'partial';
  end if;
  return new;
end $$;
drop trigger if exists exemptions_duty_list on exemptions;
create trigger exemptions_duty_list before insert or update on exemptions
  for each row execute function app.exemption_duty_list_check();

-- The employee's own request: the duties, for a type that needs them (only ones they're eligible for).
drop function if exists public.submit_exemption(uuid, date, date);
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
revoke execute on function public.submit_exemption(uuid, date, date, uuid[]) from anon, public;
grant execute on function public.submit_exemption(uuid, date, date, uuid[]) to authenticated;

-- the employee's options: which types need a duty list, and the duties they're eligible for
create or replace function public.my_input_options() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select case when app.my_soldier() is null then null else jsonb_build_object(
    'exemption_types', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name,
                                                                     'requires_duty_list', t.requires_duty_list) order by t.name)
                                 from exemption_types t where t.auto_rule is null), '[]'),
    'eligible_tasks', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name)
                                from task_types t where t.id = any(app.eligible_task_types(app.my_soldier()))), '[]'),
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
