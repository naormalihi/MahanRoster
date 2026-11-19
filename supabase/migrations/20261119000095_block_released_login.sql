-- =============================================================================
-- A soldier whose service ended (release date passed, or taken out of the unit) cannot
-- sign in. The account stays (history, audit); it works again if his date is extended.
--
-- * app.soldier_in_service(soldier): active, and the release date is today or later (Israel).
-- * The soldier role counts only while he is in service: has_role, can_view_board and
--   my_soldier stop answering for him, so a session already open sees nothing.
-- * A staff role (נע"ת, מ"מ, מפקד, צפייה) on the same account is not affected – those have
--   their own validity dates.
-- * public.my_access(): why this account may not use the system now (null = it may):
--   'locked' or 'released'. The web app signs out with a message.
-- =============================================================================

create or replace function app.soldier_in_service(p_soldier uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from soldiers s
                 where s.id = p_soldier and s.is_active
                   and (s.release_date is null or s.release_date >= (now() at time zone app.tz())::date))
$$;

create or replace function app.has_role(r app_role) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from user_roles ur
    join app_users u on u.id = ur.user_id
    where ur.user_id = auth.uid()
      and ur.role = r
      and not u.is_locked
      and (ur.valid_from is null or ur.valid_from <= now())
      and (ur.valid_to   is null or ur.valid_to   >  now())
      and (ur.role <> 'soldier' or app.soldier_in_service(u.soldier_id))
  )
$$;

create or replace function app.can_view_board() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from user_roles ur
    join app_users u on u.id = ur.user_id
    where ur.user_id = auth.uid()
      and not u.is_locked
      and (ur.valid_from is null or ur.valid_from <= now())
      and (ur.valid_to   is null or ur.valid_to   >  now())
      and (ur.role <> 'soldier' or app.soldier_in_service(u.soldier_id))
  )
$$;

create or replace function app.my_soldier() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select u.soldier_id from app_users u
  where u.id = auth.uid() and not u.is_locked and app.soldier_in_service(u.soldier_id)
$$;

create or replace function public.my_access() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when u.is_locked then 'locked'
    -- no role that still works: the soldier role ended with his service and there is no staff role
    when not exists (
      select 1 from user_roles ur
      where ur.user_id = u.id
        and (ur.valid_from is null or ur.valid_from <= now())
        and (ur.valid_to   is null or ur.valid_to   >  now())
        and (ur.role <> 'soldier' or app.soldier_in_service(u.soldier_id)))
      and u.soldier_id is not null and not app.soldier_in_service(u.soldier_id)
      then 'released'
  end
  from app_users u where u.id = auth.uid()
$$;
revoke execute on function public.my_access() from public, anon;
grant execute on function public.my_access() to authenticated;
