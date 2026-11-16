-- =============================================================================
-- More than one נע"ת תורנויות.
--
-- create_user (נע"ת only, after two-step sign-in) can now create a coordinator too, besides
-- gaf and unit commanders. The new account has a temporary password, changes it on its first
-- sign-in and sets up two-step sign-in before it can act (as every staff account).
-- A coordinator can lock another coordinator but never himself, so one always remains.
-- Deleting stays limited to gaf commanders' accounts (a coordinator is locked, not deleted,
-- so its records keep their author).
-- =============================================================================

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
  uid := app.create_auth_user(uname || '@users.invalid', p_password);
  insert into app_users (id, username, soldier_id, must_change_password) values (uid, uname, p_soldier, true);
  insert into user_roles (user_id, role, gaf_id)
  values (uid, p_role, case when p_role = 'gaf_commander' and p_soldier is not null then (select gaf_id from soldiers where id = p_soldier) end);
  insert into audit_log (actor_user_id, action, entity_type, entity_id, after)
  values (auth.uid(), 'create_user', 'app_users', uid::text, jsonb_build_object('username', uname, 'role', p_role, 'soldier_id', p_soldier));
  return uid;
end $function$;
