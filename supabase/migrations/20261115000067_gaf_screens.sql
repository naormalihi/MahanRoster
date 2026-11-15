-- =============================================================================
-- Version 2.0, stage 2.3 – the gaf's own screen: gaf representative and gaf commander.
--
--   * the gaf representative (נציג גף, new account type) gathers the gaf's constraints:
--     sees the gaf's soldiers and what each entered, enters blocks and absences for those
--     who are away and an exemption request on their behalf, and submits the gaf's
--     constraints to the commander;
--   * the gaf commander may do all of that, and approves the gaf's constraints;
--   * both comment on the draft (a duty of their soldiers, or the gaf in general) – the
--     comments reach נע"ת on the scheduling screen, who marks them handled.
--
-- Both are role holders: two-step verification, as for every role. A gaf is the gaf of the
-- soldier the account is tied to. Everything entered is marked on_behalf_of = the user.
-- =============================================================================

-- נציג גף accounts, made by נע"ת like the commanders' (tied to a soldier: that is his gaf).
create or replace function public.create_user(p_username text, p_password text, p_role app_role, p_soldier uuid default null)
returns uuid
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid; uname text := lower(trim(p_username));
begin
  perform app.require_coordinator();
  if uname !~ '^[a-z0-9._-]{3,32}$' then raise exception 'שם משתמש: 3–32 אותיות לטיניות קטנות, ספרות, נקודה, מקף או קו תחתון'; end if;
  if length(coalesce(p_password, '')) < 10 then raise exception 'סיסמה זמנית: לפחות 10 תווים'; end if;
  if p_role not in ('gaf_commander', 'gaf_rep') then raise exception 'כאן נוצרים חשבונות של מפקדי גפים ונציגי גפים'; end if;
  if p_role = 'gaf_rep' and p_soldier is null then raise exception 'נציג גף משויך לחייל – הגף שלו הוא הגף של החייל'; end if;
  if exists (select 1 from app_users where username = uname) then raise exception 'שם המשתמש כבר קיים'; end if;
  uid := app.create_auth_user(uname || '@users.invalid', p_password);
  insert into app_users (id, username, soldier_id, must_change_password) values (uid, uname, p_soldier, true);
  insert into user_roles (user_id, role, gaf_id)
  values (uid, p_role, case when p_soldier is not null then (select gaf_id from soldiers where id = p_soldier) end);
  insert into audit_log (actor_user_id, action, entity_type, entity_id, after)
  values (auth.uid(), 'create_user', 'app_users', uid::text, jsonb_build_object('username', uname, 'role', p_role, 'soldier_id', p_soldier));
  return uid;
end $$;

create or replace function public.set_user_soldier(p_user uuid, p_soldier uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.require_coordinator();
  update app_users set soldier_id = p_soldier where id = p_user;
  update user_roles set gaf_id = (select gaf_id from soldiers where id = p_soldier)
   where user_id = p_user and role in ('gaf_commander', 'gaf_rep');
end $$;

-- The caller's gaf, as commander or representative (with the second factor).
create or replace function app.my_gaf() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select ur.gaf_id from user_roles ur join app_users u on u.id = ur.user_id
  where ur.user_id = auth.uid() and not u.is_locked and ur.gaf_id is not null
    and ur.role in ('gaf_commander', 'gaf_rep')
    and (ur.valid_from is null or ur.valid_from <= now()) and (ur.valid_to is null or ur.valid_to > now())
    and app.mfa_passed()
  order by (ur.role = 'gaf_commander') desc
  limit 1
$$;

create or replace function app.require_my_gaf() returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare g uuid := app.my_gaf();
begin
  if g is null then raise exception 'רק מפקד גף או נציג גף, משויך לגף' using errcode = '42501'; end if;
  return g;
end $$;

create or replace function app.require_gaf_soldier(p_soldier uuid) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare g uuid := app.require_my_gaf();
begin
  if not exists (select 1 from soldiers where id = p_soldier and gaf_id = g and is_active) then
    raise exception 'החייל לא בגף שלך' using errcode = '42501';
  end if;
  return g;
end $$;

-- The forms' options serve the gaf screens too (types, quota, cycles).
create or replace function public.my_input_options() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select case when app.my_soldier() is null and app.my_gaf() is null then null else jsonb_build_object(
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

-- The gaf's picture for a cycle: soldiers and their constraints, the submission, the comments,
-- and (once there is a draft or a board) their duties.
create or replace function public.gaf_overview(p_cycle uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  g uuid := app.require_my_gaf();
  c cycles;
begin
  select * into c from cycles where id = p_cycle;
  if not found then return null; end if;
  return jsonb_build_object(
    'gaf', jsonb_build_object('id', g, 'name', (select name from org_units where id = g)),
    'is_commander', app.has_role('gaf_commander') and exists (select 1 from user_roles where user_id = auth.uid() and role = 'gaf_commander' and gaf_id = g),
    'cycle', jsonb_build_object('id', c.id, 'name', c.name, 'start_date', c.start_date, 'end_date', c.end_date, 'status', c.status,
                                'deadline', c.exemption_deadline,
                                'open', c.status not in ('published', 'closed') and (c.exemption_deadline is null or c.exemption_deadline > now())),
    'soldiers', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.full_name, 'rank', r.name,
                                                              'has_account', exists (select 1 from app_users u where u.soldier_id = s.id))
                                           order by s.full_name)
                          from soldiers s left join ranks r on r.id = s.computed_rank_id
                          where s.gaf_id = g and s.is_active), '[]'),
    'exemptions', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'soldier_id', e.soldier_id, 'type', t.name, 'start_date', e.start_date,
                                                                'end_date', e.end_date, 'status', e.status, 'is_urgent', e.is_urgent,
                                                                'by_soldier', e.source = 'soldier' and e.on_behalf_of is null) order by e.start_date)
                            from exemptions e join exemption_types t on t.id = e.exemption_type_id join soldiers s on s.id = e.soldier_id
                            where s.gaf_id = g and e.status in ('pending', 'approved') and e.source <> 'computed'
                              and e.start_date <= c.end_date and e.end_date >= c.start_date), '[]'),
    'blocks', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'soldier_id', b.soldier_id, 'day', b.day,
                                                            'by_soldier', b.received_via = 'system' and b.on_behalf_of is null) order by b.day)
                        from date_blocks b join soldiers s on s.id = b.soldier_id
                        where s.gaf_id = g and b.status = 'active' and b.day between c.start_date and c.end_date), '[]'),
    'absences', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'soldier_id', a.soldier_id, 'type', t.name,
                                                              'starts_at', a.starts_at, 'ends_at', a.ends_at,
                                                              'by_soldier', a.received_via = 'system' and a.on_behalf_of is null) order by a.starts_at)
                          from absences a join absence_types t on t.id = a.absence_type_id join soldiers s on s.id = a.soldier_id
                          where s.gaf_id = g and a.status = 'active'
                            and a.starts_at < (c.end_date + 1)::timestamp at time zone app.tz()
                            and a.ends_at > c.start_date::timestamp at time zone app.tz()), '[]'),
    'submission', (select jsonb_build_object('status', x.status, 'submitted_at', x.submitted_at,
                                             'submitted_by', (select username from app_users where id = x.representative_user_id),
                                             'approved_at', x.approved_at, 'approved_by', (select username from app_users where id = x.approved_by))
                   from gaf_constraint_submissions x where x.cycle_id = c.id and x.gaf_id = g),
    'comments', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'slot_id', d.slot_id, 'text', d.text, 'status', d.status,
                                                              'author', (select username from app_users where id = d.author_user_id),
                                                              'created_at', d.created_at) order by d.created_at desc)
                          from draft_comments d where d.cycle_id = c.id and d.gaf_id = g), '[]'),
    'duties', coalesce((select jsonb_agg(jsonb_build_object('assignment_id', a.id, 'slot_id', sl.id, 'soldier_id', a.soldier_id, 'task', t.name,
                                                            'starts_at', sl.starts_at, 'ends_at', sl.ends_at, 'role', a.role, 'status', a.status)
                                         order by sl.starts_at)
                        from assignments a join slots sl on sl.id = a.slot_id join task_types t on t.id = sl.task_type_id
                        join soldiers s on s.id = a.soldier_id
                        where sl.cycle_id = c.id and s.gaf_id = g and sl.cancelled_at is null
                          and a.status not in ('dropped', 'swapped_out', 'cancelled_approved')), '[]')
  );
end $$;

-- Self-entry for another soldier of the gaf: same rules and deadline as the soldier's own.
create or replace function public.gaf_add_block(p_soldier uuid, p_day date) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare quota int := coalesce((app.setting('block_quota_per_month') #>> '{}')::int, 1);
begin
  perform app.require_gaf_soldier(p_soldier);
  if p_day is null or p_day <= current_date then raise exception 'חסימה רק לתאריך עתידי'; end if;
  if not app.self_entry_open(p_day) then raise exception 'איסוף האילוצים למחזור הזה נסגר. לשינוי פנה לנע"ת'; end if;
  if (select count(*) from date_blocks where soldier_id = p_soldier and status = 'active'
        and date_trunc('month', day::timestamp) = date_trunc('month', p_day::timestamp)) >= quota then
    raise exception 'לחייל כבר יש חסימה בחודש הזה (מכסה: % בחודש)', quota;
  end if;
  insert into date_blocks (soldier_id, cycle_id, day, on_behalf_of, received_via, received_at)
  values (p_soldier, (select c.id from cycles c where p_day between c.start_date and c.end_date order by c.start_date limit 1),
          p_day, auth.uid(), 'system', now());
end $$;

create or replace function public.gaf_add_absence(p_soldier uuid, p_type uuid, p_from date, p_to date) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare d date;
begin
  perform app.require_gaf_soldier(p_soldier);
  if p_from is null or p_to is null or p_to < p_from then raise exception 'תאריכים לא תקינים'; end if;
  if p_from <= current_date then raise exception 'היעדרות רק מתאריך עתידי'; end if;
  if p_to - p_from > 120 then raise exception 'היעדרות עד 120 יום – לארוכה יותר פנה לנע"ת'; end if;
  if not exists (select 1 from absence_types where id = p_type and not requires_approval) then raise exception 'את סוג ההיעדרות הזה מזין נע"ת'; end if;
  for d in select generate_series(p_from, p_to, interval '1 day')::date loop
    if not app.self_entry_open(d) then raise exception 'איסוף האילוצים למחזור של % נסגר. לשינוי פנה לנע"ת', to_char(d, 'DD/MM'); end if;
  end loop;
  insert into absences (soldier_id, absence_type_id, starts_at, ends_at, on_behalf_of, received_via, received_at)
  values (p_soldier, p_type, p_from::timestamp at time zone app.tz(), (p_to + 1)::timestamp at time zone app.tz(), auth.uid(), 'system', now());
end $$;

create or replace function public.gaf_request_exemption(p_soldier uuid, p_type uuid, p_start date, p_end date) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare urgent boolean;
begin
  perform app.require_gaf_soldier(p_soldier);
  if p_start is null or p_end is null or p_end < p_start then raise exception 'תאריכים לא תקינים'; end if;
  if p_end < current_date then raise exception 'הפטור כבר הסתיים'; end if;
  if not exists (select 1 from exemption_types where id = p_type and auto_rule is null) then raise exception 'סוג פטור לא מוכר'; end if;
  urgent := exists (select 1 from cycles c where c.start_date <= p_end and c.end_date >= p_start
                     and (c.status in ('published', 'closed') or (c.exemption_deadline is not null and c.exemption_deadline <= now())));
  insert into exemptions (soldier_id, exemption_type_id, kind, start_date, end_date, is_urgent, status, source, on_behalf_of, received_via, received_at)
  values (p_soldier, p_type, 'full', greatest(p_start, current_date), p_end, urgent, 'pending', 'soldier', auth.uid(), 'system', now());
end $$;

-- Cancel a block or an absence of a gaf soldier, while the collection is open.
create or replace function public.gaf_cancel_entry(p_kind text, p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare sid uuid; d date;
begin
  if p_kind = 'block' then
    select soldier_id, day into sid, d from date_blocks where id = p_id and status = 'active';
  elsif p_kind = 'absence' then
    select soldier_id, (starts_at at time zone app.tz())::date into sid, d from absences where id = p_id and status = 'active';
  else
    raise exception 'סוג לא מוכר';
  end if;
  if sid is null then raise exception 'הרשומה לא נמצאה'; end if;
  perform app.require_gaf_soldier(sid);
  if not app.self_entry_open(d) then raise exception 'איסוף האילוצים למחזור הזה נסגר. לשינוי פנה לנע"ת'; end if;
  if p_kind = 'block' then
    update date_blocks set status = 'cancelled' where id = p_id;
  else
    update absences set status = 'cancelled', cancelled_by = auth.uid(), cancel_reason = 'בוטל על ידי הגף' where id = p_id;
  end if;
end $$;

-- The representative submits the gaf's constraints; the commander approves them.
create or replace function public.gaf_submit_constraints(p_cycle uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare g uuid := app.require_my_gaf();
begin
  insert into gaf_constraint_submissions (cycle_id, gaf_id, representative_user_id, status, submitted_at, received_via, received_at)
  values (p_cycle, g, auth.uid(), 'submitted', now(), 'system', now())
  on conflict (cycle_id, gaf_id) do update
    set representative_user_id = excluded.representative_user_id, status = 'submitted', submitted_at = now(),
        approved_by = null, approved_at = null;
end $$;

create or replace function public.gaf_approve_constraints(p_cycle uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare g uuid := app.require_my_gaf(); late boolean;
begin
  if not exists (select 1 from user_roles where user_id = auth.uid() and role = 'gaf_commander' and gaf_id = g) then
    raise exception 'רק מפקד הגף מאשר את אילוצי הגף' using errcode = '42501';
  end if;
  late := exists (select 1 from cycles where id = p_cycle and exemption_deadline is not null and exemption_deadline < now());
  insert into gaf_constraint_submissions (cycle_id, gaf_id, status, submitted_at, approved_by, approved_at, received_via, received_at)
  values (p_cycle, g, case when late then 'late' else 'approved' end, now(), auth.uid(), now(), 'system', now())
  on conflict (cycle_id, gaf_id) do update
    set status = case when late then 'late' else 'approved' end, approved_by = auth.uid(), approved_at = now(),
        submitted_at = coalesce(gaf_constraint_submissions.submitted_at, now());
end $$;

-- A comment on the draft: on a duty of a gaf soldier, or on the gaf in general (no slot).
create or replace function public.gaf_comment(p_cycle uuid, p_slot uuid, p_text text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare g uuid := app.require_my_gaf();
begin
  if length(trim(coalesce(p_text, ''))) < 2 then raise exception 'כתוב את ההערה'; end if;
  if not exists (select 1 from cycles where id = p_cycle and status not in ('published', 'closed')) then
    raise exception 'הלוח כבר פורסם – פנה לנע"ת';
  end if;
  if p_slot is not null and not exists (
       select 1 from assignments a join soldiers s on s.id = a.soldier_id join slots sl on sl.id = a.slot_id
       where a.slot_id = p_slot and sl.cycle_id = p_cycle and s.gaf_id = g) then
    raise exception 'אפשר להעיר על תורנויות של חיילי הגף';
  end if;
  insert into draft_comments (cycle_id, slot_id, gaf_id, author_user_id, text, received_via, received_at)
  values (p_cycle, p_slot, g, auth.uid(), trim(p_text), 'system', now());
end $$;

-- נע"ת: the gafs' submissions and comments of a cycle, and marking a comment handled.
create or replace function public.gaf_reports(p_cycle uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform app.require_reader();
  return jsonb_build_object(
    'submissions', coalesce((select jsonb_agg(jsonb_build_object('gaf', o.name, 'status', x.status, 'submitted_at', x.submitted_at,
                                                                 'approved_at', x.approved_at,
                                                                 'approved_by', (select username from app_users where id = x.approved_by))
                                              order by o.name)
                             from org_units o left join gaf_constraint_submissions x on x.gaf_id = o.id and x.cycle_id = p_cycle
                             where o.kind = 'gaf'), '[]'),
    'comments', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'gaf', o.name, 'slot_id', d.slot_id, 'text', d.text, 'status', d.status,
                                                              'author', (select username from app_users where id = d.author_user_id),
                                                              'created_at', d.created_at) order by d.status, d.created_at desc)
                          from draft_comments d left join org_units o on o.id = d.gaf_id where d.cycle_id = p_cycle), '[]')
  );
end $$;

create or replace function public.handle_draft_comment(p_id uuid, p_handled boolean default true) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.require_staff();
  update draft_comments set status = case when p_handled then 'handled' else 'open' end where id = p_id;
end $$;

revoke execute on function public.gaf_overview(uuid), public.gaf_add_block(uuid, date), public.gaf_add_absence(uuid, uuid, date, date),
  public.gaf_request_exemption(uuid, uuid, date, date), public.gaf_cancel_entry(text, uuid), public.gaf_submit_constraints(uuid),
  public.gaf_approve_constraints(uuid), public.gaf_comment(uuid, uuid, text), public.gaf_reports(uuid), public.handle_draft_comment(uuid, boolean)
  from anon, public;
grant execute on function public.gaf_overview(uuid), public.gaf_add_block(uuid, date), public.gaf_add_absence(uuid, uuid, date, date),
  public.gaf_request_exemption(uuid, uuid, date, date), public.gaf_cancel_entry(text, uuid), public.gaf_submit_constraints(uuid),
  public.gaf_approve_constraints(uuid), public.gaf_comment(uuid, uuid, text), public.gaf_reports(uuid), public.handle_draft_comment(uuid, boolean)
  to authenticated;
revoke execute on function app.my_gaf(), app.require_my_gaf(), app.require_gaf_soldier(uuid) from anon, public;
