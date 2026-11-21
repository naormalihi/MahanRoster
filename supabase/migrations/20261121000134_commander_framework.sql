-- =============================================================================
-- A framework commander's framework.
--
-- Until now it was copied from his linked employee record when the account was created or
-- linked, and stayed: an employee who moved framework in the roster kept the old one, and a
-- commander who is not on the roster had no way to get one.
-- Now user_roles.gaf_id of a gaf_commander means a framework chosen by נע"ת; empty = follow the
-- linked employee's framework, as it is now (app.my_gafs already reads coalesce(role, employee)).
-- * The copies made so far were never chosen: they are emptied, so they follow the employee.
-- * create_user, grant_user_role, set_user_soldier stop copying.
-- * public.set_commander_gaf(user, framework | null): choose one, or go back to following.
-- * list_users: each role also carries the framework in effect and whether it was chosen.
-- =============================================================================

update user_roles r set gaf_id = null
 where r.role = 'gaf_commander' and r.gaf_id is not null
   and exists (select 1 from app_users u where u.id = r.user_id and u.soldier_id is not null);

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
  values (uid, p_role, null);   -- a framework commander follows his employee's framework unless one is chosen
  if p_soldier is not null then
    insert into user_roles (user_id, role, gaf_id) select uid, 'soldier', gaf_id from soldiers where id = p_soldier;
  end if;
  insert into audit_log (actor_user_id, action, entity_type, entity_id, after)
  values (auth.uid(), 'create_user', 'app_users', uid::text, jsonb_build_object('username', uname, 'role', p_role, 'soldier_id', p_soldier));
  return uid;
end $function$;

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
  values (p_user, p_role, null);
  insert into audit_log (actor_user_id, action, entity_type, entity_id, after)
  values (auth.uid(), 'grant_role', 'app_users', p_user::text, jsonb_build_object('role', p_role));
end $$;

create or replace function public.set_user_soldier(p_user uuid, p_soldier uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.require_coordinator();
  update app_users set soldier_id = p_soldier where id = p_user;
end $$;

create or replace function public.set_commander_gaf(p_user uuid, p_gaf uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare before uuid;
begin
  perform app.require_coordinator();
  if not exists (select 1 from user_roles where user_id = p_user and role = 'gaf_commander') then
    raise exception 'למשתמש הזה אין תפקיד מפקד מסגרת';
  end if;
  if p_gaf is not null and not exists (select 1 from org_units where id = p_gaf and kind = 'gaf') then
    raise exception 'המסגרת לא נמצאה';
  end if;
  select gaf_id into before from user_roles where user_id = p_user and role = 'gaf_commander' limit 1;
  update user_roles set gaf_id = p_gaf where user_id = p_user and role = 'gaf_commander';
  insert into audit_log (actor_user_id, action, entity_type, entity_id, before, after)
  values (auth.uid(), 'set_commander_gaf', 'app_users', p_user::text, jsonb_build_object('gaf_id', before), jsonb_build_object('gaf_id', p_gaf));
end $$;
revoke execute on function public.set_commander_gaf(uuid, uuid) from public, anon;
grant execute on function public.set_commander_gaf(uuid, uuid) to authenticated;

create or replace function public.list_users()
returns table (user_id uuid, username text, soldier_id uuid, soldier_name text, is_locked boolean,
               must_change_password boolean, last_login_at timestamptz, roles jsonb, has_mfa boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select u.id, u.username, u.soldier_id, s.full_name, u.is_locked, u.must_change_password, u.last_login_at,
         coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'role', r.role, 'gaf_id', r.gaf_id,
                                                       'valid_from', r.valid_from, 'valid_to', r.valid_to,
                                                       'gaf_in_effect', coalesce(r.gaf_id, s.gaf_id),
                                                       'gaf_name', (select g.name from org_units g where g.id = coalesce(r.gaf_id, s.gaf_id)),
                                                       'gaf_chosen', r.gaf_id is not null) order by r.created_at)
                   from user_roles r where r.user_id = u.id), '[]'),
         exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified')
  from app_users u left join soldiers s on s.id = u.soldier_id
  where app.is_staff() and u.deleted_at is null
  order by u.username
$$;
