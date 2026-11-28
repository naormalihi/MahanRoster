-- 2.76.0: the employee's reason – on every date block, and on an absence whose type says nothing ("אחר").
-- Required whoever enters it (the employee or אחראי השיבוצים); rows from before stay as they are.

alter table absence_types add column if not exists requires_reason boolean not null default false;
update absence_types set requires_reason = true where name = 'אחר' and not requires_reason;
alter table absences add column if not exists reason text;
alter table date_blocks add column if not exists reason text;

create or replace function app.require_reason() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare needs boolean;
begin
  new.reason := nullif(btrim(new.reason), '');
  if tg_table_name = 'date_blocks' then
    needs := true;
  else
    select requires_reason into needs from absence_types where id = new.absence_type_id;
  end if;
  if needs and new.reason is null then
    raise exception '%', case when tg_table_name = 'date_blocks' then 'בחסימת תאריך צריך לכתוב נימוק'
                              else 'בהיעדרות מסוג "אחר" צריך לכתוב נימוק' end;
  end if;
  if length(new.reason) > 200 then raise exception 'הנימוק ארוך מדי (עד 200 תווים)'; end if;
  return new;
end $$;

drop trigger if exists date_blocks_reason on date_blocks;
create trigger date_blocks_reason before insert or update of reason on date_blocks
  for each row execute function app.require_reason();
drop trigger if exists absences_reason on absences;
create trigger absences_reason before insert or update of reason, absence_type_id on absences
  for each row execute function app.require_reason();

drop function if exists public.add_my_date_block(date);
drop function if exists public.add_my_absence(uuid, date, date);

create or replace function public.add_my_date_block(p_day date, p_reason text) returns uuid
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
  insert into date_blocks (soldier_id, cycle_id, day, reason, received_via, received_at)
  values (sid, (select c.id from cycles c where p_day between c.start_date and c.end_date order by c.start_date limit 1), p_day, btrim(p_reason), 'system', now())
  returning date_blocks.id into new_id;
  return new_id;
end $$;

create or replace function public.add_my_absence(p_type uuid, p_from date, p_to date, p_reason text default null) returns uuid
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
  insert into absences (soldier_id, absence_type_id, starts_at, ends_at, reason, received_via, received_at)
  values (sid, p_type, p_from::timestamp at time zone app.tz(), (p_to + 1)::timestamp at time zone app.tz(), nullif(btrim(p_reason), ''), 'system', now())
  returning absences.id into new_id;
  return new_id;
end $$;

revoke all on function public.add_my_date_block(date, text), public.add_my_absence(uuid, date, date, text) from anon, public;
grant execute on function public.add_my_date_block(date, text), public.add_my_absence(uuid, date, date, text) to authenticated;

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
    'blocks', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'day', b.day, 'reason', b.reason, 'mine', b.received_via = 'system' and b.on_behalf_of is null,
                                                            'open', app.self_entry_open(b.day)) order by b.day)
      from date_blocks b where b.soldier_id = (select id from me) and b.status = 'active' and b.day >= current_date - 30), '[]'),
    'absences', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'type', t.name, 'reason', a.reason, 'starts_at', a.starts_at, 'ends_at', a.ends_at,
                                                              'mine', a.received_via = 'system' and a.on_behalf_of is null,
                                                              'open', app.self_entry_open((a.starts_at at time zone app.tz())::date)) order by a.starts_at)
      from absences a join absence_types t on t.id = a.absence_type_id
      where a.soldier_id = (select id from me) and a.status = 'active' and a.ends_at >= now() - interval '30 days'), '[]')
  ) end
$$;

CREATE OR REPLACE FUNCTION public.my_input_options()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case when app.my_soldier() is null then null else jsonb_build_object(
    'exemption_types', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name,
                                                                     'requires_duty_list', t.requires_duty_list) order by t.name)
                                 from exemption_types t where t.auto_rule is null and t.is_active), '[]'),
    'eligible_tasks', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name)
                                from task_types t where t.id = any(app.eligible_task_types(app.my_soldier()))), '[]'),
    'absence_types', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name,
                                                                   'requires_reason', t.requires_reason) order by t.name)
                               from absence_types t where not t.requires_approval), '[]'),
    'block_quota_per_month', coalesce((app.setting('block_quota_per_month') #>> '{}')::int, 1),
    'cycles', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'start_date', c.start_date, 'end_date', c.end_date,
                                                            'deadline', c.exemption_deadline,
                                                            'published', c.status in ('published', 'closed'), 'published_at', c.published_at,
                                                            'open', c.status not in ('published', 'closed')
                                                                    and (c.exemption_deadline is null or c.exemption_deadline > now()))
                                         order by c.start_date)
                        from cycles c where c.end_date >= current_date), '[]')
  ) end
$function$;
