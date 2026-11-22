-- =============================================================================
-- A gaf commander updates administrative details of his own framework's employees – what he
-- knows first-hand, with no document to check:
--   * mobile phone and range date (one employee or several);
--   * relief roles (ראש צוות / כונן מבצעי …) – who holds one and from when to when; the
--     factors stay in נע"ת's settings. A change here moves the score, so נע"ת is told;
--   * join codes: create, revoke, mark as sent, and the WhatsApp message with his duties
--     to someone with no account.
-- Exemptions, ת"ש, reliefs, appointment rank, parent, שח"ר, moving or removing employees and
-- everything about scores and scheduling stay with נע"ת. The tables stay closed to him – all
-- of it goes through the functions below, which take these fields only and check that each
-- employee is in his framework (and that he passed two-step sign-in). Every change is logged.
-- =============================================================================

-- does the signed-in gaf commander command this employee? (staff are not "commanders" here)
create or replace function app.commands_soldier(p_soldier uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.has_role('gaf_commander') and app.mfa_passed()
     and exists (select 1 from soldiers s where s.id = p_soldier and s.gaf_id = any (app.my_gafs()))
$$;
grant execute on function app.commands_soldier(uuid) to authenticated;

create or replace function app.require_commands(p_soldiers uuid[]) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if coalesce(cardinality(p_soldiers), 0) = 0
     or exists (select 1 from unnest(p_soldiers) x(id) where not app.commands_soldier(x.id)) then
    raise exception 'רק לעובדי המסגרת שלך' using errcode = '42501';
  end if;
end $$;

-- join codes: נע"ת, or a gaf commander for his own people
create or replace function app.require_coordinator_or_commands(p_soldiers uuid[]) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if (app.has_role('coordinator') and app.mfa_passed()) or current_setting('role') in ('service_role', 'none') then return; end if;
  perform app.require_commands(p_soldiers);
end $$;
grant execute on function app.require_commands(uuid[]), app.require_coordinator_or_commands(uuid[]) to authenticated;

-- the frameworks whose employees the signed-in user updates (the screen asks; the server checks anyway)
create or replace function public.my_commanded_gafs() returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select case when app.has_role('gaf_commander') and app.mfa_passed() then app.my_gafs() else '{}'::uuid[] end
$$;
revoke execute on function public.my_commanded_gafs() from public, anon;
grant execute on function public.my_commanded_gafs() to authenticated;

-- phone and range date; a field is changed only when its "set" flag is on
create or replace function public.update_soldiers_admin(p_soldiers uuid[], p_set_phone boolean, p_phone text,
                                                        p_set_range boolean, p_range date)
returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  if not app.is_staff() then perform app.require_commands(p_soldiers); end if;
  if p_set_phone and p_phone is not null and p_phone !~ '^9725[0-9]{8}$' then
    raise exception 'מספר הטלפון לא תקין – נייד ישראלי, למשל 050-1234567';
  end if;
  update soldiers
     set phone = case when p_set_phone then p_phone else phone end,
         range_valid_until = case when p_set_range then p_range else range_valid_until end
   where id = any (p_soldiers);
  get diagnostics n = row_count;
  return n;
end $$;

-- relief roles: the employee's whole list is replaced (as in the employee window)
create or replace function public.set_soldier_load_roles_admin(p_soldier uuid, p_roles jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  staff boolean := app.is_staff();
  before_txt text;
  after_txt text;
  who text;
  nm text;
begin
  if not staff then perform app.require_commands(array[p_soldier]); end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_roles, '[]')) r
              where (r->>'load_role_id') is null or (r->>'valid_from') is null
                 or not exists (select 1 from load_roles l where l.id = (r->>'load_role_id')::uuid)) then
    raise exception 'לכל תפקיד הקלה צריך סוג קיים ותאריך התחלה';
  end if;
  select string_agg(l.name || ' ' || to_char(x.valid_from, 'DD/MM/YY') || coalesce('–' || to_char(x.valid_to, 'DD/MM/YY'), ''), ', ' order by x.valid_from)
    into before_txt from soldier_load_roles x join load_roles l on l.id = x.load_role_id where x.soldier_id = p_soldier;
  delete from soldier_load_roles where soldier_id = p_soldier;
  insert into soldier_load_roles (soldier_id, load_role_id, valid_from, valid_to)
  select p_soldier, (r->>'load_role_id')::uuid, (r->>'valid_from')::date, nullif(r->>'valid_to', '')::date
    from jsonb_array_elements(coalesce(p_roles, '[]')) r;
  select string_agg(l.name || ' ' || to_char(x.valid_from, 'DD/MM/YY') || coalesce('–' || to_char(x.valid_to, 'DD/MM/YY'), ''), ', ' order by x.valid_from)
    into after_txt from soldier_load_roles x join load_roles l on l.id = x.load_role_id where x.soldier_id = p_soldier;
  -- a commander's change moves the score: נע"ת is told
  if not staff and before_txt is distinct from after_txt then
    select full_name into nm from soldiers where id = p_soldier;
    select coalesce(s.full_name, u.username) into who from app_users u left join soldiers s on s.id = u.soldier_id where u.id = auth.uid();
    insert into notifications (recipient_user_id, type, payload)
    select distinct ur.user_id, 'commander_change',
           jsonb_build_object('title', 'תפקיד הקלה – ' || nm,
                              'body', coalesce(after_txt, 'בלי תפקיד הקלה') || ' (עודכן על ידי ' || who || ')',
                              'url', '/soldiers?edit=' || p_soldier)
      from user_roles ur join app_users u on u.id = ur.user_id
     where ur.role = 'coordinator' and not u.is_locked and u.deleted_at is null
       and (ur.valid_from is null or ur.valid_from <= now()) and (ur.valid_to is null or ur.valid_to > now());
  end if;
end $$;

revoke execute on function public.update_soldiers_admin(uuid[], boolean, text, boolean, date),
  public.set_soldier_load_roles_admin(uuid, jsonb) from public, anon;
grant execute on function public.update_soldiers_admin(uuid[], boolean, text, boolean, date),
  public.set_soldier_load_roles_admin(uuid, jsonb) to authenticated;

-- join codes and the WhatsApp to someone with no account: also for his own people
create or replace function public.create_soldier_invites(p_soldiers uuid[], p_days int default 30)
returns table (soldier_id uuid, code text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s record;
  c text;
begin
  perform app.require_coordinator_or_commands(p_soldiers);
  if p_days is null or p_days < 1 or p_days > 365 then raise exception 'תוקף הקוד: 1–365 ימים'; end if;
  for s in
    select so.id from soldiers so
    where so.id = any (p_soldiers) and so.is_active
      and not exists (select 1 from app_users u where u.soldier_id = so.id)
  loop
    update soldier_invites i set revoked_at = now()
     where i.soldier_id = s.id and i.used_at is null and i.revoked_at is null;
    c := app.invite_code();
    insert into soldier_invites (soldier_id, code_hash, created_by, expires_at)
    values (s.id, app.invite_hash(c), auth.uid(), now() + make_interval(days => p_days));
    soldier_id := s.id;
    code := substr(c, 1, 5) || '-' || substr(c, 6, 5);
    return next;
  end loop;
  insert into audit_log (actor_user_id, action, entity_type, after)
  values (auth.uid(), 'create_invites', 'soldier_invites', jsonb_build_object('soldiers', cardinality(p_soldiers), 'days', p_days));
end $$;

create or replace function public.revoke_soldier_invites(p_soldiers uuid[]) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  perform app.require_coordinator_or_commands(p_soldiers);
  update soldier_invites set revoked_at = now()
   where soldier_id = any (p_soldiers) and used_at is null and revoked_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.mark_invites_sent(p_soldiers uuid[]) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  if not app.is_staff() then perform app.require_commands(p_soldiers); end if;
  update soldier_invites i set sent_at = now()
   where i.soldier_id = any (p_soldiers) and i.sent_at is null and i.used_at is null and i.revoked_at is null
     and i.id = (select x.id from soldier_invites x where x.soldier_id = i.soldier_id order by x.created_at desc limit 1);
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.soldier_account_status()
returns table (soldier_id uuid, username text, is_locked boolean, invited_at timestamptz, invite_expires_at timestamptz,
               invite_state text, invite_sent_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select so.id,
         u.username,
         u.is_locked,
         i.created_at,
         i.expires_at,
         case when i.id is null then null
              when i.used_at is not null then 'used'
              when i.revoked_at is not null then 'revoked'
              when i.expires_at <= now() then 'expired'
              else 'open' end,
         i.sent_at
  from soldiers so
  left join app_users u on u.soldier_id = so.id
  left join lateral (select * from soldier_invites x where x.soldier_id = so.id order by x.created_at desc limit 1) i on true
  where app.is_staff() or app.commands_soldier(so.id)
$$;

create or replace function public.no_account_duties(p_cycle uuid)
returns table (soldier_id uuid, full_name text, gaf_name text, phone text, duties int, first_at timestamptz, sent boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select so.id, so.full_name, g.name, so.phone, count(*)::int, min(sl.starts_at),
         exists (select 1 from soldier_invites i
                 where i.soldier_id = so.id and i.sent_at >= coalesce(c.published_at, c.created_at))
  from assignments a
  join slots sl on sl.id = a.slot_id and sl.cancelled_at is null
  join cycles c on c.id = sl.cycle_id
  join soldiers so on so.id = a.soldier_id and so.is_active
  left join org_units g on g.id = so.gaf_id
  where (app.is_staff() or app.commands_soldier(so.id)) and sl.cycle_id = p_cycle and sl.ends_at > now()
    and a.status in ('assigned', 'reserve_idle', 'reserve_activated')
    and app.sees_soldier(so.id)
    and not exists (select 1 from app_users u where u.soldier_id = so.id and u.deleted_at is null)
  group by so.id, so.full_name, g.name, so.phone, c.published_at, c.created_at
  order by g.name nulls last, so.full_name
$$;

create or replace function public.duty_message(p_soldier uuid default null, p_assignment uuid default null, p_cycle uuid default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  sid uuid := p_soldier;
  so soldiers;
  acct boolean;
  c text;
  duties jsonb;
begin
  if p_assignment is not null then
    select a.soldier_id into sid from assignments a where a.id = p_assignment;
    if sid is null then raise exception 'השיבוץ לא נמצא'; end if;
  end if;
  if sid is null or (p_assignment is null and p_cycle is null) then raise exception 'חסר עובד או מחזור'; end if;
  select * into so from soldiers where id = sid;
  if so.id is null or not app.sees_soldier(sid) then raise exception 'העובד לא נמצא'; end if;
  if not (app.is_staff() or app.commands_soldier(sid)) then
    raise exception 'רק לעובדי המסגרת שלך' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'assignment_id', a.id, 'task_name', coalesce(sl.special_name, t.name), 'role', a.role,
           'starts_at', sl.starts_at, 'ends_at', sl.ends_at, 'brief', app.brief_text(sl.id))
         order by sl.starts_at), '[]'::jsonb)
    into duties
  from assignments a
  join slots sl on sl.id = a.slot_id and sl.cancelled_at is null
  join task_types t on t.id = sl.task_type_id
  where a.soldier_id = sid and a.status in ('assigned', 'reserve_idle', 'reserve_activated')
    and case when p_assignment is not null then a.id = p_assignment
             else sl.cycle_id = p_cycle and sl.ends_at > now() end;

  acct := exists (select 1 from app_users u where u.soldier_id = sid and u.deleted_at is null);
  if not acct and so.is_active then
    update soldier_invites set revoked_at = now() where soldier_id = sid and used_at is null and revoked_at is null;
    c := app.invite_code();
    insert into soldier_invites (soldier_id, code_hash, created_by, expires_at, sent_at)
    values (sid, app.invite_hash(c), auth.uid(), now() + interval '30 days', now());
    c := substr(c, 1, 5) || '-' || substr(c, 6, 5);
    insert into audit_log (actor_user_id, action, entity_type, entity_id, after)
    values (auth.uid(), 'duty_message', 'soldiers', sid::text, jsonb_build_object('duties', jsonb_array_length(duties), 'invite', true));
  end if;

  return jsonb_build_object('soldier_id', sid, 'full_name', so.full_name, 'phone', so.phone,
                            'has_account', acct, 'code', c, 'duties', duties);
end $$;
