-- =============================================================================
-- Gaf commanders: personal accounts, read-only access to the whole unit.
--
-- * Role gaf_commander (with a second factor, like staff) reads every operational table
--   and the potential, but writes nothing – RLS lets only staff write.
-- * Users screen (coordinator only): create an account with a temporary password, link
--   it to the soldier record (the personal number is never stored), give or take a role,
--   reset the password, lock and unlock. Accounts are created here in SQL, in the
--   Supabase Auth tables, so no server function is needed.
-- =============================================================================

create or replace function app.is_commander() returns boolean
language sql stable as $$ select app.has_role('gaf_commander') and app.mfa_passed() $$;

create or replace function app.can_read() returns boolean
language sql stable as $$ select app.is_staff() or app.is_commander() $$;

create or replace function app.require_reader() returns void
language plpgsql stable as $$
begin
  if not (app.can_read() or current_setting('role') in ('service_role', 'none')) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
end $$;

create or replace function app.require_coordinator() returns void
language plpgsql stable as $$
begin
  if not ((app.has_role('coordinator') and app.mfa_passed()) or current_setting('role') in ('service_role', 'none')) then
    raise exception 'רק נע"ת התורנויות מנהל משתמשים' using errcode = '42501';
  end if;
end $$;

-- Read policy next to every staff_all policy (the operational tables).
do $$
declare t text;
begin
  for t in select tablename from pg_policies where schemaname = 'public' and policyname = 'staff_all' loop
    execute format('drop policy if exists commander_read on public.%I', t);
    execute format('create policy commander_read on public.%I for select to authenticated using (app.is_commander())', t);
  end loop;
end $$;

-- Read RPCs open to commanders
create or replace function public.potential_matrix(p_cycle uuid)
returns table (soldier_id uuid, category_id uuid, value numeric, best_task_type_id uuid, reasons text[],
               available_days int, cycle_days int, override_value numeric, override_reason text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare total int;
begin
  perform app.require_reader();
  select end_date - start_date + 1 into total from cycles where id = p_cycle;
  if not exists (select 1 from cycle_soldier_snapshot where cycle_id = p_cycle) then
    raise exception 'potential not computed for cycle %', p_cycle;
  end if;
  return query
  with st as (select * from app.potential_static(p_cycle)),
  un as (
    select u.soldier_id, u.task_type_id, count(*)::int as n
    from app.potential_unavailable(p_cycle) u group by u.soldier_id, u.task_type_id
  ),
  scored as (
    select st.soldier_id, st.category_id, st.task_type_id,
      total - coalesce(un.n, 0) as avail,
      case when cardinality(st.reasons) = 0 then round((total - coalesce(un.n, 0))::numeric / total, 2) else 0 end as v,
      case when cardinality(st.reasons) = 0 and coalesce(un.n, 0) >= total then array['unavailable'] else st.reasons end as why
    from st left join un on un.soldier_id = st.soldier_id and un.task_type_id = st.task_type_id
  ),
  best as (
    select distinct on (s.soldier_id, s.category_id) s.*
    from scored s
    order by s.soldier_id, s.category_id, s.v desc, cardinality(s.why), s.task_type_id
  )
  select b.soldier_id, b.category_id, b.v, b.task_type_id,
         case when b.v > 0 then '{}'::text[] else b.why end,
         b.avail, total, o.value, o.reason
  from best b
  left join potential_overrides o on o.cycle_id = p_cycle and o.soldier_id = b.soldier_id and o.category_id = b.category_id;
end $$;

-- Soldiers available per category and day (for the availability heat map): open to at least
-- one duty of the category and not unavailable that day for all of them.
create or replace function public.potential_daily(p_cycle uuid)
returns table (day date, category_id uuid, available int)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  perform app.require_reader();
  return query
  with c as (select * from cycles where id = p_cycle),
  open_pairs as (select * from app.potential_static(p_cycle) where cardinality(reasons) = 0),
  open_count as (   -- soldiers per category, and how many open duties each has in it
    select soldier_id, category_id, count(*) as k from open_pairs group by soldier_id, category_id
  ),
  blocked as (      -- (soldier, category, day) where every open duty of the category is unavailable
    select op.soldier_id, op.category_id, u.day
    from open_pairs op join app.potential_unavailable(p_cycle) u
      on u.soldier_id = op.soldier_id and u.task_type_id = op.task_type_id
    group by op.soldier_id, op.category_id, u.day
    having count(*) = (select k from open_count oc where oc.soldier_id = op.soldier_id and oc.category_id = op.category_id)
  ),
  totals as (select category_id, count(*)::int as n from open_count group by category_id),
  gone as (select category_id, day, count(*)::int as n from blocked group by category_id, day)
  select d::date, t.category_id, t.n - coalesce(g.n, 0)
  from totals t cross join c cross join generate_series(c.start_date, c.end_date, interval '1 day') d
  left join gone g on g.category_id = t.category_id and g.day = d::date;
end $$;


-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
create or replace function public.list_users()
returns table (user_id uuid, username text, soldier_id uuid, soldier_name text, is_locked boolean,
               must_change_password boolean, last_login_at timestamptz, roles jsonb)
language sql stable security definer set search_path = public, pg_temp as $$
  select u.id, u.username, u.soldier_id, s.full_name, u.is_locked, u.must_change_password, u.last_login_at,
         coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'role', r.role, 'gaf_id', r.gaf_id,
                                                       'valid_from', r.valid_from, 'valid_to', r.valid_to) order by r.created_at)
                   from user_roles r where r.user_id = u.id), '[]')
  from app_users u left join soldiers s on s.id = u.soldier_id
  where app.is_staff()
  order by u.username
$$;

-- An Auth user with a password, confirmed, as Supabase's own sign-up would leave it.
create or replace function app.create_auth_user(p_email text, p_password text) returns uuid
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change,
                          phone_change, phone_change_token, email_change_token_current, reauthentication_token)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', p_email,
          crypt(p_password, gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}', '{}', now(), now(),
          '', '', '', '', '', '', '', '');
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (uid::text, uid, jsonb_build_object('sub', uid::text, 'email', p_email, 'email_verified', true), 'email', now(), now(), now());
  return uid;
end $$;
revoke execute on function app.create_auth_user(text, text) from anon, public, authenticated;

create or replace function public.create_user(p_username text, p_password text, p_role app_role, p_soldier uuid default null)
returns uuid
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid; uname text := lower(trim(p_username));
begin
  perform app.require_coordinator();
  if uname !~ '^[a-z0-9._-]{3,32}$' then raise exception 'שם משתמש: 3–32 אותיות לטיניות קטנות, ספרות, נקודה, מקף או קו תחתון'; end if;
  if length(coalesce(p_password, '')) < 10 then raise exception 'סיסמה זמנית: לפחות 10 תווים'; end if;
  if p_role <> 'gaf_commander' then raise exception 'בגרסה הזו נוצרים כאן רק חשבונות של מפקדי גפים'; end if;
  if exists (select 1 from app_users where username = uname) then raise exception 'שם המשתמש כבר קיים'; end if;
  uid := app.create_auth_user(uname || '@users.invalid', p_password);
  insert into app_users (id, username, soldier_id, must_change_password) values (uid, uname, p_soldier, true);
  insert into user_roles (user_id, role, gaf_id)
  values (uid, p_role, case when p_soldier is not null then (select gaf_id from soldiers where id = p_soldier) end);
  insert into audit_log (actor_user_id, action, entity_type, entity_id, after)
  values (auth.uid(), 'create_user', 'app_users', uid::text, jsonb_build_object('username', uname, 'role', p_role, 'soldier_id', p_soldier));
  return uid;
end $$;

create or replace function public.reset_user_password(p_user uuid, p_password text) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  perform app.require_coordinator();
  if length(coalesce(p_password, '')) < 10 then raise exception 'סיסמה זמנית: לפחות 10 תווים'; end if;
  update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now() where id = p_user;
  update app_users set must_change_password = true where id = p_user;
  insert into audit_log (actor_user_id, action, entity_type, entity_id) values (auth.uid(), 'reset_password', 'app_users', p_user::text);
end $$;

create or replace function public.set_user_locked(p_user uuid, p_locked boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.require_coordinator();
  if p_user = auth.uid() then raise exception 'אי אפשר לנעול את המשתמש שלך'; end if;
  update app_users set is_locked = p_locked where id = p_user;
  insert into audit_log (actor_user_id, action, entity_type, entity_id, after)
  values (auth.uid(), case when p_locked then 'lock_user' else 'unlock_user' end, 'app_users', p_user::text, null);
end $$;

create or replace function public.set_user_soldier(p_user uuid, p_soldier uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.require_coordinator();
  update app_users set soldier_id = p_soldier where id = p_user;
  update user_roles set gaf_id = (select gaf_id from soldiers where id = p_soldier) where user_id = p_user and role = 'gaf_commander';
end $$;

revoke execute on function public.list_users(), public.create_user(text, text, app_role, uuid), public.reset_user_password(uuid, text),
  public.set_user_locked(uuid, boolean), public.set_user_soldier(uuid, uuid) from anon, public;
grant execute on function public.list_users(), public.create_user(text, text, app_role, uuid), public.reset_user_password(uuid, text),
  public.set_user_locked(uuid, boolean), public.set_user_soldier(uuid, uuid) to authenticated;
