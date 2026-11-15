-- =============================================================================
-- Version 2.1 – a personal account for every soldier, joined with an invite code.
--
-- No personal number is stored, so the account is tied to the soldier's record by a
-- one-time code: נע"ת makes codes for chosen soldiers (shown to him once, kept here only
-- as a hash), hands them out, and each soldier opens the join screen, types the code and
-- picks a username and a password. The new account has the "soldier" role in his gaf and
-- no two-step verification (that stays for role holders).
--
-- A soldier sees his own duties (published boards only), why he was given each one, and
-- his score next to the mean of the soldiers he is measured against. Nothing else of the
-- unit's data opens to him: the RPCs below answer for the caller's own record only.
-- =============================================================================

create table soldier_invites (
  id          uuid primary key default gen_random_uuid(),
  soldier_id  uuid not null references soldiers(id) on delete cascade,
  code_hash   text not null unique,              -- sha256 of the code; the code itself is not kept
  created_by  uuid references app_users(id),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  used_by     uuid references app_users(id),
  revoked_at  timestamptz
);
create index on soldier_invites (soldier_id);
alter table soldier_invites enable row level security;
create policy staff_read on soldier_invites for select to authenticated using (app.is_staff());

-- The code: 10 characters without look-alikes (no 0/O, 1/I/L), shown as XXXXX-XXXXX.
create or replace function app.invite_code() returns text
language plpgsql volatile set search_path = public, extensions, pg_temp as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  b bytea := gen_random_bytes(10);
  out text := '';
begin
  for i in 0..9 loop
    out := out || substr(alphabet, 1 + get_byte(b, i) % length(alphabet), 1);
  end loop;
  return out;
end $$;

create or replace function app.invite_hash(p_code text) returns text
language sql immutable set search_path = public, extensions, pg_temp as $$
  select encode(digest(upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')), 'sha256'), 'hex')
$$;

-- Codes for the given soldiers (active, without an account). An open code of the same
-- soldier is revoked: only the newest one works. Returns each code once.
create or replace function public.create_soldier_invites(p_soldiers uuid[], p_days int default 30)
returns table (soldier_id uuid, code text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s record;
  c text;
begin
  perform app.require_coordinator();
  if p_days is null or p_days < 1 or p_days > 365 then raise exception 'תוקף הקוד: 1–365 ימים'; end if;
  for s in
    select so.id from soldiers so
    where so.id = any (p_soldiers) and so.is_active
      and not exists (select 1 from app_users u where u.soldier_id = so.id)
  loop
    update soldier_invites i set revoked_at = now()
     where i.soldier_id = s.id and i.used_at is null and i.revoked_at is null;
    c := app.invite_code();
    insert into soldier_invites (soldier_id, code_hash, created_by, expires_at)
    values (s.id, app.invite_hash(c), auth.uid(), now() + make_interval(days => p_days));
    soldier_id := s.id;
    code := substr(c, 1, 5) || '-' || substr(c, 6, 5);
    return next;
  end loop;
  insert into audit_log (actor_user_id, action, entity_type, after)
  values (auth.uid(), 'create_invites', 'soldier_invites', jsonb_build_object('soldiers', cardinality(p_soldiers), 'days', p_days));
end $$;

create or replace function public.revoke_soldier_invites(p_soldiers uuid[]) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  perform app.require_coordinator();
  update soldier_invites set revoked_at = now()
   where soldier_id = any (p_soldiers) and used_at is null and revoked_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- Per soldier: his account (if any) and his newest code, for the soldiers screen.
create or replace function public.soldier_account_status()
returns table (soldier_id uuid, username text, is_locked boolean, invited_at timestamptz, invite_expires_at timestamptz, invite_state text)
language sql stable security definer set search_path = public, pg_temp as $$
  select so.id,
         u.username,
         u.is_locked,
         i.created_at,
         i.expires_at,
         case when i.id is null then null
              when i.used_at is not null then 'used'
              when i.revoked_at is not null then 'revoked'
              when i.expires_at <= now() then 'expired'
              else 'open' end
  from soldiers so
  left join app_users u on u.soldier_id = so.id
  left join lateral (select * from soldier_invites x where x.soldier_id = so.id order by x.created_at desc limit 1) i on true
  where app.is_staff()
$$;

-- The join screen (no account yet, so it runs as anon): code + username + password.
create or replace function public.redeem_invite(p_code text, p_username text, p_password text) returns text
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  inv soldier_invites;
  so soldiers;
  uid uuid;
  uname text := lower(trim(p_username));
begin
  select * into inv from soldier_invites where code_hash = app.invite_hash(p_code);
  if not found or inv.revoked_at is not null then raise exception 'הקוד לא תקין. בדוק אותו או בקש קוד חדש מנע"ת התורנויות'; end if;
  if inv.used_at is not null then raise exception 'הקוד כבר נוצל. אם זה לא אתה – פנה לנע"ת התורנויות'; end if;
  if inv.expires_at <= now() then raise exception 'פג תוקף הקוד. בקש קוד חדש מנע"ת התורנויות'; end if;
  select * into so from soldiers where id = inv.soldier_id;
  if not so.is_active then raise exception 'הרשומה שלך לא פעילה במערכת. פנה לנע"ת התורנויות'; end if;
  if exists (select 1 from app_users where soldier_id = so.id) then raise exception 'כבר יש לך חשבון. היכנס עם שם המשתמש שלך'; end if;
  if uname !~ '^[a-z0-9._-]{3,32}$' then raise exception 'שם משתמש: 3–32 אותיות לטיניות קטנות, ספרות, נקודה, מקף או קו תחתון'; end if;
  if length(coalesce(p_password, '')) < 10 then raise exception 'סיסמה: לפחות 10 תווים'; end if;
  if exists (select 1 from app_users where username = uname) then raise exception 'שם המשתמש תפוס. בחר שם אחר'; end if;

  uid := app.create_auth_user(uname || '@users.invalid', p_password);
  insert into app_users (id, username, soldier_id, must_change_password) values (uid, uname, so.id, false);
  insert into user_roles (user_id, role, gaf_id) values (uid, 'soldier', so.gaf_id);
  update soldier_invites set used_at = now(), used_by = uid where id = inv.id;
  insert into audit_log (actor_user_id, action, entity_type, entity_id, after)
  values (uid, 'redeem_invite', 'app_users', uid::text, jsonb_build_object('username', uname, 'soldier_id', so.id));
  return uname;
end $$;

-- ---------------------------------------------------------------------------
-- The soldier's own screen
-- ---------------------------------------------------------------------------

create or replace function app.my_soldier() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select u.soldier_id from app_users u where u.id = auth.uid() and not u.is_locked
$$;

-- His duties on published (and closed) boards, with where to report and why he got them.
create or replace function public.my_duties()
returns table (assignment_id uuid, cycle_id uuid, cycle_name text, task_name text, starts_at timestamptz, ends_at timestamptz,
               role assignment_role, status assignment_status, points numeric, explanation text,
               report_at timestamptz, report_place text, briefing_at timestamptz, briefing_place text, equipment text)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.id, c.id, c.name, t.name, sl.starts_at, sl.ends_at, a.role, a.status, a.normalized_points, a.explanation,
         sl.report_at, sl.report_place, sl.briefing_at, sl.briefing_place, sl.equipment
  from assignments a
  join slots sl on sl.id = a.slot_id
  join cycles c on c.id = sl.cycle_id and c.status in ('published', 'closed')
  join task_types t on t.id = sl.task_type_id
  where a.soldier_id = app.my_soldier()
    and a.status not in ('draft', 'dropped', 'swapped_out', 'cancelled_approved')
    and sl.cancelled_at is null
  order by sl.starts_at
$$;

-- Per published cycle: his points, and the mean of those he is measured against
-- (his fairness group in that cycle – same population, same duties open).
create or replace function public.my_scores()
returns table (cycle_id uuid, cycle_name text, start_date date, end_date date, duties int, points numeric,
               group_label text, group_size int, group_mean numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  with me as (select app.my_soldier() as id),
  pts as (
    select sn.cycle_id, sn.soldier_id, sn.fairness_group,
           coalesce(sum(a.normalized_points) filter (where a.role = 'performer'), 0) as points,
           count(a.id) filter (where a.role = 'performer')::int as duties
    from cycle_soldier_snapshot sn
    join cycles c on c.id = sn.cycle_id and c.status in ('published', 'closed')
    left join slots sl on sl.cycle_id = sn.cycle_id and sl.cancelled_at is null
    left join assignments a on a.slot_id = sl.id and a.soldier_id = sn.soldier_id
                           and a.status not in ('draft', 'dropped', 'swapped_out', 'cancelled_approved')
    group by sn.cycle_id, sn.soldier_id, sn.fairness_group
  )
  select c.id, c.name, c.start_date, c.end_date, mine.duties, mine.points,
         (select sn.fairness_label from cycle_soldier_snapshot sn where sn.cycle_id = c.id and sn.soldier_id = mine.soldier_id),
         (select count(*)::int from pts p where p.cycle_id = c.id and p.fairness_group is not distinct from mine.fairness_group),
         (select round(avg(p.points), 2) from pts p where p.cycle_id = c.id and p.fairness_group is not distinct from mine.fairness_group)
  from pts mine join cycles c on c.id = mine.cycle_id
  where mine.soldier_id = (select id from me)
  order by c.start_date desc
$$;

revoke execute on function public.create_soldier_invites(uuid[], int), public.revoke_soldier_invites(uuid[]),
  public.soldier_account_status(), public.my_duties(), public.my_scores() from anon, public;
grant execute on function public.create_soldier_invites(uuid[], int), public.revoke_soldier_invites(uuid[]),
  public.soldier_account_status(), public.my_duties(), public.my_scores() to authenticated;
revoke execute on function public.redeem_invite(text, text, text) from public;
grant execute on function public.redeem_invite(text, text, text) to anon, authenticated;
revoke execute on function app.invite_code(), app.my_soldier() from anon, public;
