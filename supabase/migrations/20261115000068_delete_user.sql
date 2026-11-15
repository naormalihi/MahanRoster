-- Deleting a user (a gaf commander's account). Not your own, and not a coordinator's or a
-- deputy's – those are set up in the deployment.
--
-- A user with no trace in the data is removed altogether (sign-in, roles, codes). A user whose
-- name is on records (decisions, approvals, uploads…) cannot be removed without losing who did
-- what, so the account is closed instead: no roles, no password, locked, its username freed
-- (renamed deleted.<id>), and hidden from the users list. Either way the audit log keeps it.

alter table app_users add column if not exists deleted_at timestamptz;

create or replace function public.delete_user(p_user uuid) returns text
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u app_users;
begin
  perform app.require_coordinator();
  if p_user = auth.uid() then raise exception 'אי אפשר למחוק את המשתמש שלך'; end if;
  select * into u from app_users where id = p_user and deleted_at is null;
  if not found then raise exception 'המשתמש לא נמצא'; end if;
  if exists (select 1 from user_roles where user_id = p_user and role <> 'gaf_commander') then
    raise exception 'אפשר למחוק כאן רק חשבונות של מפקדי גפים';
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
revoke execute on function public.delete_user(uuid) from anon, public;
grant execute on function public.delete_user(uuid) to authenticated;

create or replace function public.list_users()
returns table (user_id uuid, username text, soldier_id uuid, soldier_name text, is_locked boolean,
               must_change_password boolean, last_login_at timestamptz, roles jsonb)
language sql stable security definer set search_path = public, pg_temp as $$
  select u.id, u.username, u.soldier_id, s.full_name, u.is_locked, u.must_change_password, u.last_login_at,
         coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'role', r.role, 'gaf_id', r.gaf_id,
                                                       'valid_from', r.valid_from, 'valid_to', r.valid_to) order by r.created_at)
                   from user_roles r where r.user_id = u.id), '[]')
  from app_users u left join soldiers s on s.id = u.soldier_id
  where app.is_staff() and u.deleted_at is null
  order by u.username
$$;
