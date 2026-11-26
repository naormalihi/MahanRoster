-- =============================================================================
-- "צפייה כעובד" (2.63): staff, or a gaf commander for his own people, see the app as one employee
-- sees it – read only.
--   * view_as: one row per viewer (the employee he looks at, until when – 2 hours).
--   * app.my_soldier() – the one place the employee's screens learn "who am I" – answers the viewed
--     employee while it is on; app.my_own_soldier() keeps the viewer's own.
--   * Every action of an employee is blocked while viewing (app.no_view_as): require_my_soldier,
--     and the actions that read app.my_soldier() directly. A new action must do the same.
--   * Each start goes to the audit log.
-- =============================================================================

create table if not exists view_as (
  user_id uuid primary key references app_users(id) on delete cascade,
  soldier_id uuid not null references soldiers(id) on delete cascade,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table view_as enable row level security;
-- no policies: only the functions below touch it

create or replace function app.my_own_soldier() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select u.soldier_id from app_users u
  where u.id = auth.uid() and not u.is_locked and app.soldier_in_service(u.soldier_id)
$$;

-- the employee viewed now, if the viewer may still see him
create or replace function app.viewing_as() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select v.soldier_id from view_as v
  where v.user_id = auth.uid() and v.expires_at > now()
    and (app.is_staff() or app.commands_soldier(v.soldier_id))
$$;

create or replace function app.my_soldier() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(app.viewing_as(), app.my_own_soldier())
$$;

create or replace function app.no_view_as() returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if app.viewing_as() is not null then
    raise exception 'בצפייה כעובד אין פעולות – חזור לחשבון שלך' using errcode = '42501';
  end if;
end $$;

revoke execute on function app.my_own_soldier(), app.viewing_as(), app.no_view_as() from public, anon;
grant execute on function app.my_own_soldier(), app.viewing_as(), app.no_view_as() to authenticated;

create or replace function public.view_as_start(p_soldier uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not (app.is_staff() or app.commands_soldier(p_soldier)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from soldiers where id = p_soldier) then raise exception 'העובד לא נמצא'; end if;
  insert into view_as (user_id, soldier_id, started_at, expires_at)
  values (auth.uid(), p_soldier, now(), now() + interval '2 hours')
  on conflict (user_id) do update set soldier_id = excluded.soldier_id, started_at = now(), expires_at = excluded.expires_at;
  insert into audit_log (actor_user_id, action, entity_type, entity_id)
  values (auth.uid(), 'view_as', 'soldiers', p_soldier::text);
end $$;

create or replace function public.view_as_stop() returns void
language sql security definer set search_path = public, pg_temp as $$
  delete from view_as where user_id = auth.uid()
$$;

-- what the app needs to show the banner: the employee and until when
create or replace function public.view_as_current() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('soldier_id', s.id, 'name', s.full_name, 'until', v.expires_at)
  from view_as v join soldiers s on s.id = v.soldier_id
  where v.user_id = auth.uid() and v.soldier_id = app.viewing_as()
$$;

revoke execute on function public.view_as_start(uuid), public.view_as_stop(), public.view_as_current() from public, anon;
grant execute on function public.view_as_start(uuid), public.view_as_stop(), public.view_as_current() to authenticated;

CREATE OR REPLACE FUNCTION app.require_my_soldier()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare sid uuid;
begin
  perform app.no_view_as();
  sid := app.my_soldier();
  if sid is null or not app.has_role('soldier') then raise exception 'רק עובד עם חשבון אישי' using errcode = '42501'; end if;
  return sid;
end $function$;

CREATE OR REPLACE FUNCTION public.ack_duties(p_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare n int;
begin
  perform app.no_view_as(); -- viewing as an employee: no actions
  if app.my_soldier() is null then raise exception 'not allowed' using errcode = '42501'; end if;
  update assignments set acked_at = now(), acked_via = 'app', acked_by = auth.uid()
   where id = any (p_ids) and soldier_id = app.my_soldier() and acked_at is null
     and status in ('assigned', 'reserve_idle', 'reserve_activated');
  get diagnostics n = row_count;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.answer_swap(p_request uuid, p_accept boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  me uuid := app.my_soldier();
  r swap_requests;
  a assignments;
  b assignments;
  why text;
  req_name text;
  tgt_name text;
  what text;
begin
  perform app.no_view_as(); -- viewing as an employee: no actions
  select * into r from swap_requests where id = p_request for update;
  if not found or me is null or r.target_soldier_id is distinct from me then raise exception 'הבקשה לא נמצאה'; end if;
  if r.status <> 'pending_peer' then raise exception 'הבקשה כבר טופלה'; end if;
  select full_name into req_name from soldiers where id = r.requested_by;
  select full_name into tgt_name from soldiers where id = r.target_soldier_id;
  select * into a from assignments where id = r.assignment_id for update;
  what := app.duty_text(a.slot_id);
  if not p_accept then
    update swap_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now() where id = r.id;
    perform app.notify_soldier(r.requested_by, 'swap_declined', tgt_name || ' לא יכול להחליף', what, '/', jsonb_build_object('swap_id', r.id));
    return jsonb_build_object('status', 'rejected');
  end if;

  -- still valid? (the board may have changed since the request)
  why := case when a.soldier_id <> r.requested_by then 'המשימה כבר לא שלו' else app.swappable(a) end;
  if why is null and r.counter_assignment_id is not null then
    select * into b from assignments where id = r.counter_assignment_id for update;
    why := case when b.soldier_id <> me then 'המשימה שלך השתנתה' else app.swappable(b) end;
  end if;
  if why is null and (
       cardinality(app.swap_blockers(a.slot_id, me, b.slot_id)) > 0
       or (b.id is not null and cardinality(app.swap_blockers(b.slot_id, r.requested_by, a.slot_id)) > 0)) then
    why := 'ההחלפה כבר לא אפשרית (זכאות, מנוחה או חפיפה)';
  end if;
  if why is not null then
    update swap_requests set status = 'cancelled', decision_reason = why, decided_by = auth.uid(), decided_at = now() where id = r.id;
    perform app.notify_soldier(r.requested_by, 'swap_declined', 'ההחלפה עם ' || tgt_name || ' בוטלה', why, '/', jsonb_build_object('swap_id', r.id));
    return jsonb_build_object('status', 'cancelled', 'reason', why);
  end if;

  perform app.swap_move(a.id, me, 'החלפה: לקח את המשימה מ' || req_name);
  if b.id is not null then
    perform app.swap_move(b.id, r.requested_by, 'החלפה: לקח את המשימה מ' || tgt_name);
  end if;
  update swap_requests set status = 'approved', decided_by = auth.uid(), decided_at = now() where id = r.id;

  perform app.notify_soldier(r.requested_by, 'swap_done', tgt_name || ' אישר את ההחלפה',
    case when b.id is null then 'המשימה עברה אליו: ' || what
         else 'אתה ב' || app.duty_text(b.slot_id) || ' במקום ' || what end,
    '/', jsonb_build_object('swap_id', r.id), true);
  -- אחראי השיבוצים hears about it (no approval needed)
  insert into notifications (recipient_user_id, type, payload)
  select distinct u.id, 'swap_done',
         jsonb_build_object('title', 'החלפה בוצעה: ' || req_name || ' ⇄ ' || tgt_name,
                            'body', case when b.id is null then tgt_name || ' לוקח את ' || what
                                         else what || ' ⇄ ' || app.duty_text(b.slot_id) end,
                            'url', '/cycle/operate', 'swap_id', r.id)
  from app_users u join user_roles ur on ur.user_id = u.id
  where ur.role in ('coordinator', 'deputy') and not u.is_locked
    and (ur.valid_from is null or ur.valid_from <= now()) and (ur.valid_to is null or ur.valid_to > now());
  return jsonb_build_object('status', 'approved');
end $function$;

CREATE OR REPLACE FUNCTION public.cancel_swap(p_request uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  me uuid := app.my_soldier();
  r swap_requests;
begin
  perform app.no_view_as(); -- viewing as an employee: no actions
  select * into r from swap_requests where id = p_request for update;
  if not found or me is null or r.requested_by is distinct from me then raise exception 'הבקשה לא נמצאה'; end if;
  if r.status <> 'pending_peer' then raise exception 'הבקשה כבר טופלה'; end if;
  update swap_requests set status = 'cancelled', decided_by = auth.uid(), decided_at = now(), decision_reason = 'בוטלה על ידי המבקש' where id = r.id;
  update notifications set read_at = coalesce(read_at, now()), acked_at = coalesce(acked_at, now())
   where type = 'swap_request' and payload ->> 'swap_id' = r.id::text;
end $function$;

CREATE OR REPLACE FUNCTION public.request_swap(p_assignment uuid, p_target uuid, p_counter uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  me uuid := app.my_soldier();
  a assignments;
  b assignments;
  why text;
  new_id uuid;
  my_name text;
begin
  perform app.no_view_as(); -- viewing as an employee: no actions
  select * into a from assignments where id = p_assignment for update;
  if me is null or a.soldier_id is distinct from me then raise exception 'זו לא משימה שלך'; end if;
  if p_target is null or p_target = me then raise exception 'צריך לבחור עובד אחר'; end if;
  why := app.swappable(a);
  if why is not null then raise exception '%', why; end if;
  if not app.has_account(p_target) then raise exception 'לעובד הזה אין חשבון במערכת – הוא לא יוכל לאשר'; end if;
  if exists (select 1 from swap_requests r where r.status = 'pending_peer'
             and (r.assignment_id = a.id or r.counter_assignment_id = a.id)) then
    raise exception 'כבר יש בקשת החלפה פתוחה על המשימה הזו';
  end if;
  if p_counter is null then
    if cardinality(app.swap_blockers(a.slot_id, p_target, null)) > 0 then
      raise exception 'העובד הזה לא יכול לקחת את המשימה';
    end if;
  else
    select * into b from assignments where id = p_counter for update;
    if b.soldier_id is distinct from p_target then raise exception 'המשימה שבחרת לא שלו'; end if;
    why := app.swappable(b);
    if why is not null then raise exception '%', why; end if;
    if b.role <> a.role then raise exception 'מתחלפים רק באותו תפקיד (מבצע או עתודה)'; end if;
    if (select cycle_id from slots where id = b.slot_id) <> (select cycle_id from slots where id = a.slot_id) then
      raise exception 'מתחלפים רק בתוך אותו מחזור';
    end if;
    if exists (select 1 from swap_requests r where r.status = 'pending_peer'
               and (r.assignment_id = b.id or r.counter_assignment_id = b.id)) then
      raise exception 'על המשימה שלו כבר יש בקשת החלפה פתוחה';
    end if;
    if cardinality(app.swap_blockers(a.slot_id, p_target, b.slot_id)) > 0
       or cardinality(app.swap_blockers(b.slot_id, me, a.slot_id)) > 0 then
      raise exception 'ההחלפה הזו לא אפשרית (זכאות, מנוחה או חפיפה)';
    end if;
  end if;
  insert into swap_requests (kind, assignment_id, requested_by, target_soldier_id, counter_assignment_id, status, received_via, received_at)
  values (case when p_counter is null then 'handover' else 'mutual' end, a.id, me, p_target, p_counter, 'pending_peer', 'system', now())
  returning swap_requests.id into new_id;
  select full_name into my_name from soldiers where soldiers.id = me;
  perform app.notify_soldier(p_target, 'swap_request', 'בקשת החלפה מ' || my_name,
    case when p_counter is null then 'מבקש שתיקח ממנו: ' || app.duty_text(a.slot_id)
         else 'מציע להתחלף: אתה לוקח ' || app.duty_text(a.slot_id) || ', הוא לוקח ' || app.duty_text(b.slot_id) end,
    '/', jsonb_build_object('swap_id', new_id), true);
  return new_id;
end $function$;

CREATE OR REPLACE FUNCTION app.no_self_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if old.status = 'pending' and new.status in ('approved', 'rejected') and auth.uid() is not null
     and new.soldier_id = app.my_own_soldier() then
    raise exception 'זו בקשה שלך – אחראי השיבוצים או מ"מ אחר מאשר אותה';
  end if;
  return new;
end $function$;
