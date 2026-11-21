-- Wording: "מסגרת" instead of "גף", "עובד" instead of "חייל" – everywhere the user reads.
-- 1. Frameworks are stored by their own name, without the "גף" prefix ("גף ענן" → "ענן").
--    The personnel load strips it too, so the file's names still match. A framework that
--    exists under both names is merged into the one without the prefix.
-- 2. The frameworks chosen for the personnel load (settings.roster_frameworks) follow.
-- 3. The server's messages use the new words (the functions are the same otherwise).

do $$
declare
  u      org_units;
  newn   text;
  target uuid;
  fk     record;
begin
  for u in select * from org_units where kind = 'gaf' and name ~ '^גף\s+' loop
    newn := btrim(regexp_replace(u.name, '^גף\s+', ''));
    continue when newn = '';
    select id into target from org_units where kind = 'gaf' and name = newn and id <> u.id;
    if target is null then
      update org_units set name = newn where id = u.id;
    else
      for fk in
        select c.conrelid::regclass as tbl, a.attname as col
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
        where c.contype = 'f' and c.confrelid = 'org_units'::regclass and cardinality(c.conkey) = 1
          and c.conrelid not in ('org_units'::regclass, 'gaf_aliases'::regclass)
      loop
        execute format('update %s set %I = $1 where %I = $2', fk.tbl, fk.col, fk.col) using target, u.id;
      end loop;
      update gaf_aliases set gaf_id = target where gaf_id = u.id;
      update org_units set parent_id = target where parent_id = u.id;
      -- the old row keeps its place in history under a name that no longer clashes
      update org_units set name = u.name || ' (מוזג)', active_to = coalesce(active_to, current_date), merged_into_id = target
       where id = u.id;
    end if;
  end loop;
end $$;

update settings
   set value = replace(value::text, '\u0001גף ', '\u0001')::jsonb
 where key = 'roster_frameworks' and value::text like '%\u0001גף %';

create or replace function app.manual_no_overlap() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s slots;
  hit record;
begin
  if new.source <> 'manual' or new.status in ('dropped', 'cancelled_approved', 'swapped_out') then return new; end if;
  select * into s from slots where id = new.slot_id;
  select x.starts_at, tt.name into hit
  from assignments a join slots x on x.id = a.slot_id join task_types tt on tt.id = x.task_type_id
  where a.soldier_id = new.soldier_id and a.id <> new.id and a.slot_id <> new.slot_id
    and a.status not in ('dropped', 'cancelled_approved', 'swapped_out') and x.cancelled_at is null
    and x.starts_at < s.ends_at and x.ends_at > s.starts_at
  order by x.starts_at limit 1;
  if found then
    raise exception 'העובד כבר משובץ באותו זמן: % (%). אי אפשר לשבץ לשתי תורנויות חופפות',
      hit.name, to_char(hit.starts_at at time zone app.tz(), 'DD/MM HH24:MI')
      using errcode = '23P01';
  end if;
  return new;
end $$;

create or replace function app.require_my_soldier() returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare sid uuid := app.my_soldier();
begin
  if sid is null or not app.has_role('soldier') then raise exception 'רק עובד עם חשבון אישי' using errcode = '42501'; end if;
  return sid;
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
  if key !~ '^[0-9a-f]{64}$' then raise exception 'מפתח העובד לא תקין – בדוק את מפתח היחידה'; end if;
  if coalesce(trim(p ->> 'full_name'), '') = '' then raise exception 'חסר שם'; end if;
  select * into ex from soldiers where soldier_key = key;
  if found then
    select name into gname from org_units where id = ex.gaf_id;
    return jsonb_build_object('status', case when ex.is_active then 'exists' else 'inactive' end,
                              'id', ex.id, 'name', ex.full_name, 'gaf', gname);
  end if;
  insert into soldiers (soldier_key, full_name, service_type, gender, gaf_id, computed_rank_id, enlistment_date,
                        release_date, career_start_date, range_valid_until, parent_status, home_nightly, phone, unit_join_date,
                        is_shachar, second_role_signed_at, tash_level)
  values (key, trim(p ->> 'full_name'), (p ->> 'service_type')::service_type, nullif(p ->> 'gender', '')::gender_type,
          (p ->> 'gaf_id')::uuid, nullif(p ->> 'rank_id', '')::uuid, nullif(p ->> 'enlistment_date', '')::date,
          nullif(p ->> 'release_date', '')::date, nullif(p ->> 'career_start_date', '')::date,
          nullif(p ->> 'range_valid_until', '')::date, coalesce((p ->> 'parent_status')::boolean, false),
          coalesce((p ->> 'home_nightly')::boolean, false), nullif(p ->> 'phone', ''), joined,
          coalesce((p ->> 'is_shachar')::boolean, false) and (p ->> 'service_type') = 'mandatory',
          nullif(p ->> 'second_role_signed_at', '')::date, nullif(p ->> 'tash_level', '')::smallint)
  returning id into sid;
  insert into audit_log (actor_user_id, action, entity_type, entity_id, after)
  values (auth.uid(), 'add_soldier', 'soldiers', sid::text, jsonb_build_object('full_name', trim(p ->> 'full_name'), 'unit_join_date', joined));
  perform app.resnapshot_open_cycles(joined);
  return jsonb_build_object('status', 'added', 'id', sid);
end $$;

create or replace function public.assign_published(p_slot uuid, p_role assignment_role, p_soldier uuid, p_reason text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s      slots;
  c      cycles;
  pts    record;
  have   int;
  need   int;
  new_id uuid;
begin
  perform app.require_staff();
  select * into s from slots where id = p_slot for update;
  if not found then raise exception 'התורנות לא נמצאה'; end if;
  select * into c from cycles where id = s.cycle_id;
  if c.status <> 'published' then
    raise exception 'המחזור לא מפורסם – לפני פרסום משבצים בטיוטה';
  end if;
  if s.ends_at <= now() then raise exception 'התורנות כבר הסתיימה'; end if;
  if exists (select 1 from assignments a where a.slot_id = p_slot and a.soldier_id = p_soldier
             and a.status not in ('draft', 'dropped', 'cancelled_approved', 'swapped_out')) then
    raise exception 'העובד כבר משובץ בתורנות הזו';
  end if;

  if p_role = 'performer' then
    select count(*) into have from assignments a where a.slot_id = p_slot
       and ((a.role = 'performer' and a.status not in ('draft', 'dropped', 'cancelled_approved', 'swapped_out'))
            or a.status = 'reserve_activated');
    need := s.performers_needed;
  else
    select count(*) into have from assignments a where a.slot_id = p_slot and a.role = 'reserve' and a.status = 'reserve_idle';
    need := s.reserves_needed;
  end if;
  if have >= need then raise exception 'התפקיד הזה בתורנות כבר מאויש'; end if;

  -- the engine's proposals for this role (and anything of this soldier) in the duty give way
  delete from assignments where slot_id = p_slot and status = 'draft' and (role = p_role or soldier_id = p_soldier);

  select * into pts from app.slot_points(p_slot, p_soldier);
  insert into assignments (slot_id, soldier_id, gaf_id, role, status, is_penalty, points, factor_at_time,
                           normalized_points, weekend_units, explanation, manual_reason, source, received_via, received_at)
  select p_slot, so.id, so.gaf_id, p_role,
         case when p_role = 'performer' then 'assigned'::assignment_status else 'reserve_idle'::assignment_status end,
         s.is_penalty_slot, pts.raw,
         case when pts.normalized > 0 then round(pts.raw / pts.normalized, 2) else 1 end,
         pts.normalized,
         case when not s.is_penalty_slot then app.weekend_units(s.starts_at, s.ends_at) else 0 end,
         'שיבוץ ידני אחרי פרסום' || coalesce(': ' || nullif(trim(p_reason), ''), ''),
         coalesce(nullif(trim(p_reason), ''), 'שיבוץ ידני אחרי פרסום'), 'manual', 'system', now()
  from soldiers so where so.id = p_soldier
  returning id into new_id;
  if new_id is null then raise exception 'החייל לא נמצא'; end if;

  if p_role = 'performer' then
    update assignments set paired_assignment_id = new_id
     where slot_id = p_slot and role = 'reserve' and paired_assignment_id is null
       and status not in ('draft', 'dropped', 'cancelled_approved', 'swapped_out');
  else
    update assignments set paired_assignment_id = (
      select p.id from assignments p where p.slot_id = p_slot
        and (p.role = 'performer' or p.status = 'reserve_activated')
        and p.status not in ('draft', 'dropped', 'cancelled_approved', 'swapped_out') order by p.created_at limit 1)
     where id = new_id;
  end if;
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
  update absences set status = 'cancelled', cancelled_by = auth.uid(), cancel_reason = 'בוטל על ידי העובד' where id = p_id;
end $$;

CREATE OR REPLACE FUNCTION public.create_user(p_username text, p_password text, p_role app_role, p_soldier uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare uid uuid; uname text := lower(trim(p_username));
begin
  perform app.require_coordinator();
  if uname !~ '^[a-z0-9._-]{3,32}$' then raise exception 'שם משתמש: 3–32 אותיות לטיניות קטנות, ספרות, נקודה, מקף או קו תחתון'; end if;
  if length(coalesce(p_password, '')) < 10 then raise exception 'סיסמה זמנית: לפחות 10 תווים'; end if;
  if p_role not in ('gaf_commander', 'unit_commander', 'coordinator') then raise exception 'כאן נוצרים חשבונות של נע"ת תורנויות, מפקדי מסגרות ומפקד היחידה'; end if;
  if exists (select 1 from app_users where username = uname) then raise exception 'שם המשתמש כבר קיים'; end if;
  if p_soldier is not null and exists (select 1 from app_users where soldier_id = p_soldier and deleted_at is null) then
    raise exception 'לעובד הזה כבר יש חשבון – הוסף לו תפקיד במקום חשבון שני';
  end if;
  uid := app.create_auth_user(uname || '@users.invalid', p_password);
  insert into app_users (id, username, soldier_id, must_change_password) values (uid, uname, p_soldier, true);
  insert into user_roles (user_id, role, gaf_id)
  values (uid, p_role, case when p_role = 'gaf_commander' and p_soldier is not null then (select gaf_id from soldiers where id = p_soldier) end);
  if p_soldier is not null then
    insert into user_roles (user_id, role, gaf_id) select uid, 'soldier', gaf_id from soldiers where id = p_soldier;
  end if;
  insert into audit_log (actor_user_id, action, entity_type, entity_id, after)
  values (auth.uid(), 'create_user', 'app_users', uid::text, jsonb_build_object('username', uname, 'role', p_role, 'soldier_id', p_soldier));
  return uid;
end $function$;

create or replace function public.delete_load_role(p_role uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  perform app.require_coordinator();
  select count(distinct soldier_id) into n from soldier_load_roles where load_role_id = p_role;
  if n > 0 then
    raise exception 'ל-% עובדים יש את ההקלה הזו, ולכן אי אפשר למחוק אותה. הסר אותה מהם קודם.', n;
  end if;
  delete from load_role_factor_history where load_role_id = p_role;
  delete from load_roles where id = p_role;
end $$;

create or replace function public.delete_user(p_user uuid) returns text
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u app_users;
begin
  perform app.require_coordinator();
  if p_user = auth.uid() then raise exception 'אי אפשר למחוק את המשתמש שלך'; end if;
  select * into u from app_users where id = p_user and deleted_at is null;
  if not found then raise exception 'המשתמש לא נמצא'; end if;
  if exists (select 1 from user_roles where user_id = p_user and role <> 'gaf_commander') then
    raise exception 'אפשר למחוק כאן רק חשבונות של מפקדי מסגרות';
  end if;
  insert into audit_log (actor_user_id, action, entity_type, entity_id, before)
  values (auth.uid(), 'delete_user', 'app_users', p_user::text,
          jsonb_build_object('username', u.username, 'soldier_id', u.soldier_id));
  begin
    delete from auth.users where id = p_user;  -- app_users, roles and sign-in factors go with it
    return 'deleted';
  exception when foreign_key_violation then
    -- on records: close the account instead
    delete from user_roles where user_id = p_user;
    update auth.users set encrypted_password = crypt(gen_random_uuid()::text, gen_salt('bf')),
                          email = 'deleted.' || left(p_user::text, 8) || '@users.invalid', updated_at = now()
     where id = p_user;
    update auth.identities set identity_data = identity_data || jsonb_build_object('email', 'deleted.' || left(p_user::text, 8) || '@users.invalid')
     where user_id = p_user;
    update app_users set is_locked = true, deleted_at = now(), soldier_id = null,
                         username = 'deleted.' || left(p_user::text, 8)
     where id = p_user;
    return 'closed';
  end;
end $$;

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
  perform app.require_staff();
  if p_assignment is not null then
    select a.soldier_id into sid from assignments a where a.id = p_assignment;
    if sid is null then raise exception 'השיבוץ לא נמצא'; end if;
  end if;
  if sid is null or (p_assignment is null and p_cycle is null) then raise exception 'חסר עובד או מחזור'; end if;
  select * into so from soldiers where id = sid;
  if so.id is null or not app.sees_soldier(sid) then raise exception 'העובד לא נמצא'; end if;

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

create or replace function public.grant_user_role(p_user uuid, p_role app_role) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare sid uuid;
begin
  perform app.require_coordinator();
  if p_role not in ('gaf_commander', 'unit_commander', 'coordinator') then
    raise exception 'אפשר להוסיף תפקיד נע"ת תורנויות, מפקד מסגרת או מפקד יחידה';
  end if;
  select soldier_id into sid from app_users where id = p_user and deleted_at is null;
  if not found then raise exception 'המשתמש לא נמצא'; end if;
  if exists (select 1 from user_roles where user_id = p_user and role = p_role
             and (valid_to is null or valid_to > now())) then
    raise exception 'כבר יש לו את התפקיד הזה';
  end if;
  insert into user_roles (user_id, role, gaf_id)
  values (p_user, p_role, case when p_role = 'gaf_commander' and sid is not null then (select gaf_id from soldiers where id = sid) end);
  insert into audit_log (actor_user_id, action, entity_type, entity_id, after)
  values (auth.uid(), 'grant_role', 'app_users', p_user::text, jsonb_build_object('role', p_role));
end $$;

create or replace function public.my_contacts()
returns table (display_name text, role_label text, phone text, kind text)
language sql stable security definer set search_path = public, pg_temp as $$
  with mine as (
    select s.gaf_id from app_users u join soldiers s on s.id = u.soldier_id where u.id = auth.uid()
  ), c as (
    select sc.display_name, sc.sort, coalesce(sc.phone, own.phone) as phone, r.role, r.gaf_id
    from soldier_contacts sc
    join app_users u on u.id = sc.user_id
    left join soldiers own on own.id = u.soldier_id
    cross join lateral app.contact_role(sc.user_id) r
  )
  (select display_name, case role when 'coordinator' then 'נע"ת התורנויות' else 'ממלא מקום נע"ת' end, phone, 'staff'
     from c where auth.uid() is not null and role in ('coordinator', 'deputy')
     order by role, sort, display_name limit 2)
  union all
  (select display_name, 'מפקד המסגרת', phone, 'gaf'
     from c where role = 'gaf_commander' and gaf_id = (select gaf_id from mine)
     order by sort, display_name limit 1)
$$;

create or replace function public.reactivate_soldier(p_soldier uuid, p_join date default current_date) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.require_staff();
  update soldiers set is_active = true, unit_join_date = coalesce(p_join, current_date), updated_at = now()
   where id = p_soldier and not is_active;
  if not found then raise exception 'העובד לא נמצא או שהוא כבר פעיל'; end if;
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
  if not found then raise exception 'העובד לא נמצא או שהוא כבר לא פעיל'; end if;
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

create or replace function public.request_swap(p_assignment uuid, p_target uuid, p_counter uuid default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := app.my_soldier();
  a assignments;
  b assignments;
  why text;
  new_id uuid;
  my_name text;
begin
  select * into a from assignments where id = p_assignment for update;
  if me is null or a.soldier_id is distinct from me then raise exception 'זו לא תורנות שלך'; end if;
  if p_target is null or p_target = me then raise exception 'צריך לבחור עובד אחר'; end if;
  why := app.swappable(a);
  if why is not null then raise exception '%', why; end if;
  if not app.has_account(p_target) then raise exception 'לעובד הזה אין חשבון במערכת – הוא לא יוכל לאשר'; end if;
  if exists (select 1 from swap_requests r where r.status = 'pending_peer'
             and (r.assignment_id = a.id or r.counter_assignment_id = a.id)) then
    raise exception 'כבר יש בקשת החלפה פתוחה על התורנות הזו';
  end if;
  if p_counter is null then
    if cardinality(app.swap_blockers(a.slot_id, p_target, null)) > 0 then
      raise exception 'העובד הזה לא יכול לקחת את התורנות';
    end if;
  else
    select * into b from assignments where id = p_counter for update;
    if b.soldier_id is distinct from p_target then raise exception 'התורנות שבחרת לא שלו'; end if;
    why := app.swappable(b);
    if why is not null then raise exception '%', why; end if;
    if b.role <> a.role then raise exception 'מתחלפים רק באותו תפקיד (מבצע או עתודה)'; end if;
    if (select cycle_id from slots where id = b.slot_id) <> (select cycle_id from slots where id = a.slot_id) then
      raise exception 'מתחלפים רק בתוך אותו מחזור';
    end if;
    if exists (select 1 from swap_requests r where r.status = 'pending_peer'
               and (r.assignment_id = b.id or r.counter_assignment_id = b.id)) then
      raise exception 'על התורנות שלו כבר יש בקשת החלפה פתוחה';
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
end $$;

create or replace function public.revoke_user_role(p_user uuid, p_role app_role) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.require_coordinator();
  if p_role = 'soldier' then raise exception 'תפקיד העובד נקבע לפי השיוך לעובד – מנתקים את השיוך במקום'; end if;
  if p_user = auth.uid() and p_role = 'coordinator' then raise exception 'אי אפשר להסיר מעצמך את תפקיד נע"ת'; end if;
  if not exists (select 1 from user_roles where user_id = p_user and role <> p_role) then
    raise exception 'זה התפקיד היחיד שלו – מחק את המשתמש במקום';
  end if;
  delete from user_roles where user_id = p_user and role = p_role;
  if not found then raise exception 'אין לו את התפקיד הזה'; end if;
  insert into audit_log (actor_user_id, action, entity_type, entity_id, before)
  values (auth.uid(), 'revoke_role', 'app_users', p_user::text, jsonb_build_object('role', p_role));
end $$;

create or replace function public.set_soldier_contacts(p jsonb) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e jsonb;
  i int := 0;
  ph text;
begin
  perform app.require_coordinator();
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 20 then raise exception 'רשימה לא תקינה'; end if;
  -- with a where: the API refuses a delete without one (safeupdate)
  delete from soldier_contacts where user_id is not null;
  for e in select * from jsonb_array_elements(p) loop
    if not exists (select 1 from app.contact_role((e->>'user_id')::uuid)) then
      raise exception 'איש קשר חייב להיות נע"ת, מ"מ או מפקד מסגרת פעיל';
    end if;
    ph := nullif(regexp_replace(coalesce(e->>'phone', ''), '\D', '', 'g'), '');
    if ph like '05%' then ph := '972' || substr(ph, 2); end if;
    if ph is not null and ph !~ '^9725[0-9]{8}$' then raise exception 'מספר טלפון לא תקין: %', e->>'phone'; end if;
    insert into soldier_contacts (user_id, display_name, phone, sort)
    values ((e->>'user_id')::uuid, btrim(e->>'display_name'), ph, i);
    i := i + 1;
  end loop;
  insert into audit_log (actor_user_id, action, entity_type, after)
  values (auth.uid(), 'set_soldier_contacts', 'soldier_contacts', jsonb_build_object('count', i));
  return i;
end $$;

create or replace function public.withdraw_my_exemption(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare sid uuid := app.require_my_soldier();
begin
  update exemptions set status = 'cancelled', decided_at = now(), decision_reason = 'בוטל על ידי העובד'
   where id = p_id and soldier_id = sid and status = 'pending';
  if not found then raise exception 'אפשר לבטל רק בקשה שעוד ממתינה'; end if;
end $$;
