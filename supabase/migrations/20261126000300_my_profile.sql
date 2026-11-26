-- "הפרטים שלי" (decided 26.11): the employee sees what the system knows about them and uses to
-- schedule them – personnel details, what affects their scheduling, the duties they can and can't
-- do (and why), and their score with where it comes from (a manual correction with its reason).
-- "לא נכון?" sends a fix request: staff get a notice, decide, and answer; nothing changes by itself.
-- Not shown: the employee number (never stored in the clear), staff's internal notes, others' data.

create table if not exists profile_fix_requests (
  id          uuid primary key default gen_random_uuid(),
  soldier_id  uuid not null references soldiers(id) on delete cascade,
  field       text not null check (length(field) between 1 and 60),
  current     text check (current is null or length(current) <= 200),
  requested   text not null check (length(requested) between 1 and 200),
  status      text not null default 'open' check (status in ('open', 'fixed', 'dismissed')),
  reply       text check (reply is null or length(reply) <= 200),
  created_by  uuid references app_users(id) on delete set null,
  created_at  timestamptz not null default now(),
  handled_by  uuid references app_users(id) on delete set null,
  handled_at  timestamptz
);
create index if not exists profile_fix_requests_open on profile_fix_requests (soldier_id) where status = 'open';
alter table profile_fix_requests enable row level security;
create policy staff_all on profile_fix_requests for all to authenticated using (app.is_staff()) with check (app.is_staff());
grant select, insert, update, delete on profile_fix_requests to authenticated;
drop trigger if exists profile_fix_requests_audit on profile_fix_requests;
create trigger profile_fix_requests_audit after insert or update or delete on profile_fix_requests
  for each row execute function app.audit();

-- ---------------------------------------------------------------------------
-- duties: can / can't, with the reason (static rules + approved partial exemptions)
-- ---------------------------------------------------------------------------
create or replace function app.task_eligibility(p_soldier uuid, p_from date, p_to date)
returns table (task_type_id uuid, name text, ok boolean, reason text)
language sql stable security definer set search_path = public, pg_temp as $$
  with s as (
    select so.*, r.sort_order as rank_order,
      app.service_on(so.career_start_date, so.service_type, p_from) as svc,
      coalesce(r.population_tags, '{}') as rank_tags
    from soldiers so
    left join ranks r on r.id = case when so.appointment_rank_id is not null
                                       and (so.appointment_rank_until is null or so.appointment_rank_until >= p_from)
                                      then so.appointment_rank_id else so.computed_rank_id end
    where so.id = p_soldier
  ),
  x as (
    select t.id, t.name,
      case
        when not (t.service_restriction = 'any' or s.svc::text = t.service_restriction)
          then case t.service_restriction when 'mandatory' then 'רק לחובה' when 'career' then 'רק לקבע' else 'סוג שירות' end
        when t.gender is not null and s.gender is distinct from t.gender
          then case t.gender when 'male' then 'רק לגברים' else 'רק לנשים' end
        when (rmin.sort_order is not null and coalesce(s.rank_order, 0) < rmin.sort_order)
          or (rmax.sort_order is not null and coalesce(s.rank_order, 0) > rmax.sort_order)
          or (t.allowed_rank_ids is not null and not exists (select 1 from ranks r where r.id = any(t.allowed_rank_ids)
                                                             and r.sort_order = coalesce(s.rank_order, 0)))
          then 'דרגה'
        when not t.qualifying_duty and cardinality(t.eligible_populations) > 0
             and not (t.eligible_populations && (array[s.svc::text] || s.rank_tags))
          then 'לא באוכלוסייה של המשימה'
        when s.is_shachar and s.svc = 'mandatory' and not t.shachar_compatible then 'שח״ר'
        when t.shachar_only and not (s.is_shachar and s.svc = 'mandatory') then 'רק לשח״ר'
        else (select coalesce(et.name, 'פטור') || ' עד ' || to_char(e.end_date, 'DD/MM')
              from exemptions e join exemption_types et on et.id = e.exemption_type_id
              where e.soldier_id = s.id and e.status = 'approved' and e.kind = 'partial'
                and e.start_date <= p_to and e.end_date >= p_from
                and t.id = any(coalesce(app.exemption_scope(e.exemption_type_id, e.excluded_task_type_ids), '{}'))
              order by e.end_date desc limit 1)
      end as reason
    from s cross join task_types t
    left join ranks rmin on rmin.id = t.rank_min_id
    left join ranks rmax on rmax.id = t.rank_max_id
    where t.is_active and t.category_id is not null
  )
  select x.id, x.name, x.reason is null, x.reason from x order by x.reason is not null, x.name
$$;
revoke all on function app.task_eligibility(uuid, date, date) from public, anon;

-- ---------------------------------------------------------------------------
-- the employee's page
-- ---------------------------------------------------------------------------
create or replace function public.my_profile() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  sid uuid := app.my_soldier();
  so soldiers;
  c cycles;
  sn cycle_soldier_snapshot;
  win_from date;
  today date := (now() at time zone app.tz())::date;
  rk ranks;
  out jsonb;
begin
  if sid is null then return null; end if;
  select * into so from soldiers where id = sid;
  -- the cycle that matters now: the one we're in, else the next one
  select * into c from cycles where end_date >= today order by start_date limit 1;
  select * into rk from ranks where id = case when so.appointment_rank_id is not null
                                                and (so.appointment_rank_until is null or so.appointment_rank_until >= today)
                                               then so.appointment_rank_id else so.computed_rank_id end;
  out := jsonb_build_object(
    'full_name', so.full_name,
    'gaf', (select name from org_units where id = so.gaf_id),
    'rank', rk.name,
    'appointed', so.appointment_rank_id is not null and (so.appointment_rank_until is null or so.appointment_rank_until >= today),
    'phone', so.phone,
    'service', app.service_on(so.career_start_date, so.service_type, today),
    'career_start_date', so.career_start_date,
    'enlistment_date', so.enlistment_date,
    'release_date', so.release_date,
    'unit_join_date', so.unit_join_date,
    'grace_until', case when so.unit_join_date is not null
                         and so.unit_join_date + coalesce((app.setting('grace_days') #>> '{}')::int, 0) > today
                        then so.unit_join_date + coalesce((app.setting('grace_days') #>> '{}')::int, 0) - 1 end,
    'tash_level', coalesce(so.tash_level, 0),
    'home_nightly', so.home_nightly,
    'parent', case when so.parent_override is not null and (so.parent_override_until is null or so.parent_override_until >= today)
                   then so.parent_override else so.parent_status end,
    'shachar', so.is_shachar and app.service_on(so.career_start_date, so.service_type, today) = 'mandatory',
    'second_role_signed_at', so.second_role_signed_at,
    'relief', (select jsonb_build_object('name', lr.name, 'factor', lr.factor, 'until', sl.valid_to)
               from soldier_load_roles sl join load_roles lr on lr.id = sl.load_role_id
               where sl.soldier_id = sid and sl.valid_from <= today and (sl.valid_to is null or sl.valid_to >= today)
               order by lr.factor limit 1),
    'range_valid_until', so.range_valid_until,
    'away', coalesce((select jsonb_agg(jsonb_build_object('kind', 'exemption', 'name', et.name, 'from', e.start_date, 'to', e.end_date,
                                                          'status', e.status, 'partial', e.kind = 'partial') order by e.start_date)
                      from exemptions e join exemption_types et on et.id = e.exemption_type_id
                      where e.soldier_id = sid and e.status in ('pending', 'approved') and e.end_date >= today), '[]')
          || coalesce((select jsonb_agg(jsonb_build_object('kind', 'absence', 'name', at.name,
                                                           'from', (a.starts_at at time zone app.tz())::date,
                                                           'to', ((a.ends_at - interval '1 microsecond') at time zone app.tz())::date,
                                                           'status', 'approved', 'partial', false) order by a.starts_at)
                       from absences a left join absence_types at on at.id = a.absence_type_id
                       where a.soldier_id = sid and a.status = 'active'
                         and ((a.ends_at - interval '1 microsecond') at time zone app.tz())::date >= today), '[]'),
    'fixes', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'field', f.field, 'requested', f.requested, 'status', f.status,
                                                           'reply', f.reply, 'created_at', f.created_at, 'handled_at', f.handled_at)
                                        order by f.created_at desc)
                       from profile_fix_requests f
                       where f.soldier_id = sid and (f.status = 'open' or f.handled_at > now() - interval '30 days')), '[]'));

  if c.id is null then return out; end if;
  out := out || jsonb_build_object(
    'cycle', jsonb_build_object('id', c.id, 'name', c.name, 'start_date', c.start_date, 'end_date', c.end_date,
                                'published', c.status in ('published', 'closed')),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('name', e.name, 'ok', e.ok, 'reason', e.reason))
                       from app.task_eligibility(sid, greatest(c.start_date, today), c.end_date) e), '[]'));

  select * into sn from cycle_soldier_snapshot where cycle_id = c.id and soldier_id = sid;
  if sn.soldier_id is null then return out; end if;
  win_from := c.start_date - make_interval(months => (app.setting('score_window_months') #>> '{}')::int);
  out := out || jsonb_build_object('score', jsonb_build_object(
    'earlier', sn.baseline_score,
    'group', coalesce(sn.fairness_label, case sn.balance_population when 'career' then 'קבע' else 'חובה' end),
    'group_size', (select count(*) from cycle_soldier_snapshot o where o.cycle_id = c.id
                     and o.fairness_group is not distinct from sn.fairness_group and o.balance_population = sn.balance_population),
    'group_avg', (select round(avg(o.baseline_score), 1) from cycle_soldier_snapshot o where o.cycle_id = c.id
                    and o.fairness_group is not distinct from sn.fairness_group and o.balance_population = sn.balance_population),
    'switch', case when so.service_switch_at is not null and so.service_switch_at <= c.start_date and so.service_switch_at >= win_from
                   then jsonb_build_object('at', so.service_switch_at, 'to', so.service_switch_to, 'score', so.service_switch_score) end,
    'opening', case when so.opening_score_at >= win_from and (so.service_switch_at is null or so.opening_score_at >= so.service_switch_at)
                    then so.opening_score end,
    'corrections', coalesce((select jsonb_agg(jsonb_build_object('points', sa.points, 'note', sa.note, 'at', sa.created_at,
                                                                 'by', (select username from app_users u where u.id = sa.created_by))
                                              order by sa.created_at)
                             from score_adjustments sa
                             where sa.soldier_id = sid and sa.reason = 'manual'
                               and sa.effective_date >= coalesce(case when so.service_switch_at <= c.start_date then so.service_switch_at - 1 end, win_from)
                               and sa.effective_date < c.start_date), '[]'),
    -- only what's on a published board counts for the employee to see
    'cycle_points', case when c.status in ('published', 'closed') then
        (select coalesce(sum(a.normalized_points), 0) from assignments a join slots sl on sl.id = a.slot_id
          where sl.cycle_id = c.id and a.soldier_id = sid
            and (a.role = 'performer' and a.status in ('assigned', 'done') or a.status = 'reserve_activated')) end,
    'cycle_duties', case when c.status in ('published', 'closed') then
        (select count(*) from assignments a join slots sl on sl.id = a.slot_id
          where sl.cycle_id = c.id and a.soldier_id = sid
            and (a.role = 'performer' and a.status in ('assigned', 'done') or a.status = 'reserve_activated')) end));
  return out;
end $$;
revoke all on function public.my_profile() from public, anon;
grant execute on function public.my_profile() to authenticated;

-- "לא נכון?"
create or replace function public.request_profile_fix(p_field text, p_current text, p_text text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  sid uuid := app.require_my_soldier();
  so soldiers;
  rid uuid;
  f text := nullif(btrim(p_field), '');
  t text := nullif(btrim(p_text), '');
  r record;
begin
  if f is null or length(f) > 60 then raise exception 'בחר מה לא נכון'; end if;
  if t is null then raise exception 'כתוב מה הנכון'; end if;
  if length(t) > 200 then raise exception 'עד 200 תווים'; end if;
  if (select count(*) from profile_fix_requests where soldier_id = sid and status = 'open') >= 10 then
    raise exception 'יש לך כבר 10 בקשות פתוחות – חכה שאחראי השיבוצים יטפל בהן';
  end if;
  select * into so from soldiers where id = sid;
  insert into profile_fix_requests (soldier_id, field, current, requested, created_by)
  values (sid, f, left(nullif(btrim(p_current), ''), 200), t, auth.uid())
  returning id into rid;
  for r in select * from app.request_alert_users(so.gaf_id) where not info_only loop
    continue when r.user_id = auth.uid();
    insert into notifications (recipient_user_id, type, payload)
    values (r.user_id, 'profile_fix',
            jsonb_build_object('title', 'בקשת תיקון – ' || so.full_name, 'body', f || ': ' || t,
                               'url', '/soldiers?fix=' || sid, 'request_id', rid));
  end loop;
  return rid;
end $$;
revoke all on function public.request_profile_fix(text, text, text) from public, anon;
grant execute on function public.request_profile_fix(text, text, text) to authenticated;

-- staff: "תוקן" / "לא רלוונטי", with an optional line back to the employee
create or replace function public.handle_profile_fix(p_id uuid, p_status text, p_reply text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  fx profile_fix_requests;
  rep text := nullif(btrim(p_reply), '');
begin
  perform app.require_staff();
  if p_status not in ('fixed', 'dismissed') then raise exception 'סטטוס לא מוכר'; end if;
  if length(rep) > 200 then raise exception 'תשובה – עד 200 תווים'; end if;
  update profile_fix_requests set status = p_status, reply = rep, handled_by = auth.uid(), handled_at = now()
   where id = p_id and status = 'open' returning * into fx;
  if fx.id is null then raise exception 'הבקשה לא נמצאה או שכבר טופלה'; end if;
  perform app.notify_soldier(fx.soldier_id, 'profile_fix_done',
    case p_status when 'fixed' then 'תוקן: ' || fx.field else 'בקשת התיקון נבדקה: ' || fx.field end,
    coalesce(rep, case p_status when 'fixed' then 'הפרט עודכן.' else 'לא נדרש שינוי.' end),
    '/my/profile', jsonb_build_object('request_id', fx.id));
end $$;
revoke all on function public.handle_profile_fix(uuid, text, text) from public, anon;
grant execute on function public.handle_profile_fix(uuid, text, text) to authenticated;
