-- =============================================================================
-- A user changes his own username – no need to go through נע"ת.
--
-- * app.set_username(user, name): the one place a username changes (rules, free name, auth email
--   and identity). rename_user (נע"ת) and rename_me use it.
-- * public.rename_me(name, password):
--     - on the first sign-in (must_change_password – he just got a temporary password) the name
--       may be fixed with no password and no limit: the name נע"ת typed is only a start;
--     - later: the current password is required, and once in 7 days.
--   The shared viewer account cannot rename itself. Each change goes to the audit log.
-- =============================================================================

alter table app_users add column if not exists username_changed_at timestamptz;

create or replace function app.set_username(p_user uuid, p_username text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  old text;
  uname text := lower(trim(p_username));
begin
  select username into old from app_users where id = p_user and deleted_at is null;
  if not found then raise exception 'המשתמש לא נמצא'; end if;
  if uname !~ '^[a-z0-9._-]{3,32}$' then raise exception 'שם משתמש: 3–32 אותיות לטיניות קטנות, ספרות, נקודה, מקף או קו תחתון'; end if;
  if uname like 'deleted.%' then raise exception 'שם המשתמש שמור למערכת'; end if;
  if uname = old then return null; end if;
  if exists (select 1 from app_users where username = uname) then raise exception 'שם המשתמש כבר קיים'; end if;
  update app_users set username = uname where id = p_user;
  update auth.users set email = uname || '@users.invalid', updated_at = now() where id = p_user;
  update auth.identities set identity_data = identity_data || jsonb_build_object('email', uname || '@users.invalid')
   where user_id = p_user;
  return old;
end $$;
revoke execute on function app.set_username(uuid, text) from public, anon, authenticated;

create or replace function public.rename_user(p_user uuid, p_username text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare old text;
begin
  perform app.require_coordinator();
  old := app.set_username(p_user, p_username);
  if old is null then return; end if;
  insert into audit_log (actor_user_id, action, entity_type, entity_id, before, after)
  values (auth.uid(), 'rename_user', 'app_users', p_user::text, jsonb_build_object('username', old),
          jsonb_build_object('username', lower(trim(p_username))));
end $$;

create or replace function public.rename_me(p_username text, p_password text default null) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  uid uuid := auth.uid();
  u app_users;
  old text;
begin
  select * into u from app_users where id = uid and deleted_at is null and not is_locked;
  if not found then raise exception 'not signed in' using errcode = '42501'; end if;
  if exists (select 1 from user_roles where user_id = uid and role = 'viewer') then
    raise exception 'לחשבון הצפייה המשותף אין שינוי שם';
  end if;
  if not u.must_change_password then
    if not exists (select 1 from auth.users where id = uid
                     and encrypted_password = crypt(coalesce(p_password, ''), encrypted_password)) then
      raise exception 'הסיסמה הנוכחית שגויה';
    end if;
    if u.username_changed_at > now() - interval '7 days' then
      raise exception 'אפשר לשנות שם משתמש פעם בשבוע – אפשר שוב מ-%',
        to_char((u.username_changed_at + interval '7 days') at time zone app.tz(), 'DD/MM HH24:MI');
    end if;
  end if;
  old := app.set_username(uid, p_username);
  if old is null then return; end if;
  update app_users set username_changed_at = case when u.must_change_password then null else now() end where id = uid;
  insert into audit_log (actor_user_id, action, entity_type, entity_id, before, after)
  values (uid, 'rename_me', 'app_users', uid::text, jsonb_build_object('username', old),
          jsonb_build_object('username', lower(trim(p_username))));
end $$;

revoke execute on function public.rename_me(text, text) from public, anon;
grant execute on function public.rename_me(text, text) to authenticated;
