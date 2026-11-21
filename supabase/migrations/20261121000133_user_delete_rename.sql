-- =============================================================================
-- Users screen:
-- * Deleting a framework commander's account failed when he also does duties: since 2.25 such an
--   account carries the employee role too. A commander's account may now be deleted whether or
--   not it has the employee role; his employee record stays as it is.
-- * public.rename_user(user, username): נע"ת changes a username (same rules as a new one). The
--   sign-in address follows; the password, roles and sessions stay. Written to the audit log.
-- =============================================================================

create or replace function public.delete_user(p_user uuid) returns text
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u app_users;
begin
  perform app.require_coordinator();
  if p_user = auth.uid() then raise exception 'אי אפשר למחוק את המשתמש שלך'; end if;
  select * into u from app_users where id = p_user and deleted_at is null;
  if not found then raise exception 'המשתמש לא נמצא'; end if;
  -- a commander who also does duties has the employee role too: still a commander's account
  if exists (select 1 from user_roles where user_id = p_user and role not in ('gaf_commander', 'soldier'))
     or not exists (select 1 from user_roles where user_id = p_user and role = 'gaf_commander') then
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

create or replace function public.rename_user(p_user uuid, p_username text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u app_users;
  uname text := lower(trim(p_username));
begin
  perform app.require_coordinator();
  select * into u from app_users where id = p_user and deleted_at is null;
  if not found then raise exception 'המשתמש לא נמצא'; end if;
  if uname !~ '^[a-z0-9._-]{3,32}$' then raise exception 'שם משתמש: 3–32 אותיות לטיניות קטנות, ספרות, נקודה, מקף או קו תחתון'; end if;
  if uname like 'deleted.%' then raise exception 'שם המשתמש שמור למערכת'; end if;
  if uname = u.username then return; end if;
  if exists (select 1 from app_users where username = uname) then raise exception 'שם המשתמש כבר קיים'; end if;
  update app_users set username = uname where id = p_user;
  update auth.users set email = uname || '@users.invalid', updated_at = now() where id = p_user;
  update auth.identities set identity_data = identity_data || jsonb_build_object('email', uname || '@users.invalid')
   where user_id = p_user;
  insert into audit_log (actor_user_id, action, entity_type, entity_id, before, after)
  values (auth.uid(), 'rename_user', 'app_users', p_user::text, jsonb_build_object('username', u.username), jsonb_build_object('username', uname));
end $$;
revoke execute on function public.rename_user(uuid, text) from public, anon;
grant execute on function public.rename_user(uuid, text) to authenticated;
