-- Staff and commanders who do duties themselves see their own (פריט 1).
-- An account linked to a soldier also holds the 'soldier' role, next to its staff role: it gets
-- "התורנויות שלי", "הבקשות שלי", swaps and duty notices, like any soldier. Permissions do not
-- change: on his own data he acts as a soldier, on the unit as staff.
-- A soldier who already has an account can be given a staff role (instead of a second account),
-- and lose it again. נע"ת does not approve his own exemption request.

-- 1. existing linked accounts without the soldier role
insert into user_roles (user_id, role, gaf_id)
select u.id, 'soldier', s.gaf_id
from app_users u join soldiers s on s.id = u.soldier_id
where u.deleted_at is null
  and not exists (select 1 from user_roles r where r.user_id = u.id and r.role = 'soldier');

-- 2. linking or unlinking an account keeps the soldier role in step
create or replace function app.sync_soldier_role() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.soldier_id is not distinct from old.soldier_id then return null; end if;
  if new.soldier_id is null then
    -- unlinked: no soldier role, unless it is all the account has
    delete from user_roles r where r.user_id = new.id and r.role = 'soldier'
      and exists (select 1 from user_roles o where o.user_id = new.id and o.role <> 'soldier');
  elsif exists (select 1 from user_roles r where r.user_id = new.id and r.role = 'soldier') then
    update user_roles set gaf_id = (select gaf_id from soldiers where id = new.soldier_id)
     where user_id = new.id and role = 'soldier';
  else
    insert into user_roles (user_id, role, gaf_id) select new.id, 'soldier', gaf_id from soldiers where id = new.soldier_id;
  end if;
  return null;
end $$;
drop trigger if exists app_users_soldier_role on app_users;
create trigger app_users_soldier_role after update of soldier_id on app_users
  for each row execute function app.sync_soldier_role();

-- 3. a new staff account linked to a soldier gets the soldier role too
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
  if p_role not in ('gaf_commander', 'unit_commander', 'coordinator') then raise exception 'כאן נוצרים חשבונות של נע"ת תורנויות, מפקדי גפים ומפקד היחידה'; end if;
  if exists (select 1 from app_users where username = uname) then raise exception 'שם המשתמש כבר קיים'; end if;
  if p_soldier is not null and exists (select 1 from app_users where soldier_id = p_soldier and deleted_at is null) then
    raise exception 'לחייל הזה כבר יש חשבון – הוסף לו תפקיד במקום חשבון שני';
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

-- 4. give an existing account a staff role, or take it away
create or replace function public.grant_user_role(p_user uuid, p_role app_role) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare sid uuid;
begin
  perform app.require_coordinator();
  if p_role not in ('gaf_commander', 'unit_commander', 'coordinator') then
    raise exception 'אפשר להוסיף תפקיד נע"ת תורנויות, מפקד גף או מפקד יחידה';
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

create or replace function public.revoke_user_role(p_user uuid, p_role app_role) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.require_coordinator();
  if p_role = 'soldier' then raise exception 'תפקיד החייל נקבע לפי השיוך לחייל – מנתקים את השיוך במקום'; end if;
  if p_user = auth.uid() and p_role = 'coordinator' then raise exception 'אי אפשר להסיר מעצמך את תפקיד נע"ת'; end if;
  if not exists (select 1 from user_roles where user_id = p_user and role <> p_role) then
    raise exception 'זה התפקיד היחיד שלו – מחק את המשתמש במקום';
  end if;
  delete from user_roles where user_id = p_user and role = p_role;
  if not found then raise exception 'אין לו את התפקיד הזה'; end if;
  insert into audit_log (actor_user_id, action, entity_type, entity_id, before)
  values (auth.uid(), 'revoke_role', 'app_users', p_user::text, jsonb_build_object('role', p_role));
end $$;

revoke execute on function public.grant_user_role(uuid, app_role), public.revoke_user_role(uuid, app_role) from anon, public;
grant execute on function public.grant_user_role(uuid, app_role), public.revoke_user_role(uuid, app_role) to authenticated, service_role;

-- 5. נע"ת does not decide his own exemption request: another נע"ת / מ"מ does
create or replace function app.no_self_decision() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.status = 'pending' and new.status in ('approved', 'rejected') and auth.uid() is not null
     and new.soldier_id = app.my_soldier() then
    raise exception 'זו בקשה שלך – נע"ת או מ"מ אחר מאשר אותה';
  end if;
  return new;
end $$;
drop trigger if exists exemptions_no_self_decision on exemptions;
create trigger exemptions_no_self_decision before update of status on exemptions
  for each row execute function app.no_self_decision();
