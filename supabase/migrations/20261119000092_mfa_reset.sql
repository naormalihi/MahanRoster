-- Resetting a staff member's two-step login (אימות דו-שלבי), e.g. after a new phone.
-- Another נע"ת or מ"מ, signed in with two-step login, removes the user's factors and signs him out
-- everywhere; on his next sign-in he sets the authenticator up again (scan the QR). Nobody resets
-- his own. Recorded in the audit log, and the rest of the staff are told.
-- Last resort when no one else can (a single נע"ת): README, "איפוס אימות דו-שלבי".

create or replace function public.reset_user_mfa(p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uname text;
  actor text;
begin
  if not (app.is_staff() or current_setting('role') in ('service_role', 'none')) then
    raise exception 'רק נע"ת או מ"מ מאפסים אימות דו-שלבי' using errcode = '42501';
  end if;
  if p_user = auth.uid() then raise exception 'אי אפשר לאפס את האימות של עצמך – בקש מנע"ת אחר'; end if;
  select username into uname from app_users where id = p_user and deleted_at is null;
  if uname is null then raise exception 'המשתמש לא נמצא'; end if;
  if not exists (select 1 from auth.mfa_factors where user_id = p_user) then
    raise exception 'למשתמש הזה אין אימות דו-שלבי';
  end if;
  delete from auth.mfa_factors where user_id = p_user;
  delete from auth.sessions where user_id = p_user;          -- the lost phone is signed out too
  delete from auth.refresh_tokens where user_id = p_user::text;
  insert into audit_log (actor_user_id, action, entity_type, entity_id, after)
  values (auth.uid(), 'reset_mfa', 'app_users', p_user::text, jsonb_build_object('username', uname));
  select username into actor from app_users where id = auth.uid();
  insert into notifications (recipient_user_id, type, payload)
  select distinct u.id, 'mfa_reset',
         jsonb_build_object('title', 'אימות דו-שלבי אופס: ' || uname,
                            'body', 'על ידי ' || coalesce(actor, 'מערכת') || '. אם זה לא תואם איתך – בדוק ביומן השינויים.',
                            'url', '/admin')
  from app_users u join user_roles ur on ur.user_id = u.id
  where ur.role in ('coordinator', 'deputy') and not u.is_locked and u.deleted_at is null
    and u.id is distinct from auth.uid() and u.id <> p_user
    and (ur.valid_from is null or ur.valid_from <= now()) and (ur.valid_to is null or ur.valid_to > now());
end $$;

revoke execute on function public.reset_user_mfa(uuid) from anon, public;
grant execute on function public.reset_user_mfa(uuid) to authenticated, service_role;

-- the users list says who has two-step login set up
drop function if exists public.list_users();
create or replace function public.list_users()
returns table (user_id uuid, username text, soldier_id uuid, soldier_name text, is_locked boolean,
               must_change_password boolean, last_login_at timestamptz, roles jsonb, has_mfa boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select u.id, u.username, u.soldier_id, s.full_name, u.is_locked, u.must_change_password, u.last_login_at,
         coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'role', r.role, 'gaf_id', r.gaf_id,
                                                       'valid_from', r.valid_from, 'valid_to', r.valid_to) order by r.created_at)
                   from user_roles r where r.user_id = u.id), '[]'),
         exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified')
  from app_users u left join soldiers s on s.id = u.soldier_id
  where app.is_staff() and u.deleted_at is null
  order by u.username
$$;
revoke execute on function public.list_users() from anon, public;
grant execute on function public.list_users() to authenticated, service_role;
