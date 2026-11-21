-- A נע"ת's account may be deleted too (by another נע"ת), as long as another active נע"ת stays.
create or replace function public.delete_user(p_user uuid) returns text
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare u app_users;
begin
  perform app.require_coordinator();
  if p_user = auth.uid() then raise exception 'אי אפשר למחוק את המשתמש שלך'; end if;
  select * into u from app_users where id = p_user and deleted_at is null;
  if not found then raise exception 'המשתמש לא נמצא'; end if;
  -- a framework commander's or a נע"ת's account; either may also carry the employee role
  if exists (select 1 from user_roles where user_id = p_user and role not in ('gaf_commander', 'coordinator', 'soldier'))
     or not exists (select 1 from user_roles where user_id = p_user and role in ('gaf_commander', 'coordinator')) then
    raise exception 'אפשר למחוק כאן רק חשבונות של נע"ת ושל מפקדי מסגרות';
  end if;
  -- a נע"ת goes only while another active נע"ת stays
  if exists (select 1 from user_roles where user_id = p_user and role = 'coordinator')
     and not exists (select 1 from user_roles r join app_users a on a.id = r.user_id
                      where r.role = 'coordinator' and r.user_id <> p_user
                        and a.deleted_at is null and not a.is_locked
                        and (r.valid_from is null or r.valid_from <= now())
                        and (r.valid_to is null or r.valid_to > now())) then
    raise exception 'חייב להישאר לפחות נע"ת פעיל אחד';
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

