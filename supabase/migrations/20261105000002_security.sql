-- =============================================================================
-- Security for version 1.0
--
--   coordinator  נע"ת התורנויות – everything
--   deputy       ממלא מקום – everything, only inside the delegation window,
--                and may not grant roles
--   viewer       shared view account – the published board only
--   (gaf_commander, gaf_rep, unit_commander, soldier: defined now, used in 2.0)
--
-- Every table has RLS on. Anonymous callers get nothing. RLS is not forced, so the
-- table owner (used by the board view and security-definer functions) is exempt.
-- =============================================================================

alter table app_users
  add constraint app_users_auth_fk foreign key (id) references auth.users(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- Role helpers (security definer so policies can read user_roles under RLS)
-- ---------------------------------------------------------------------------
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
  )
$$;

create or replace function app.is_staff() returns boolean
language sql stable as $$ select app.has_role('coordinator') or app.has_role('deputy') $$;

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
  )
$$;

grant usage on schema app to authenticated, service_role;
grant execute on all functions in schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS: staff can do everything on operational tables
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public'
      and tablename not in ('audit_log', 'app_users', 'user_roles')
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy staff_all on public.%I for all to authenticated using (app.is_staff()) with check (app.is_staff())', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- Users: staff see everyone; each user sees their own row.
alter table app_users enable row level security;
create policy staff_read on app_users for select to authenticated using (app.is_staff());
create policy self_read  on app_users for select to authenticated using (id = auth.uid());
create policy coordinator_write on app_users for all to authenticated
  using (app.has_role('coordinator')) with check (app.has_role('coordinator'));
revoke all on app_users from anon;

-- Roles: only the coordinator grants or removes roles (a deputy cannot extend itself).
alter table user_roles enable row level security;
create policy staff_read on user_roles for select to authenticated using (app.is_staff());
create policy self_read  on user_roles for select to authenticated using (user_id = auth.uid());
create policy coordinator_write on user_roles for all to authenticated
  using (app.has_role('coordinator')) with check (app.has_role('coordinator'));
revoke all on user_roles from anon;

-- Audit log: staff read; nobody writes directly; nothing is ever changed or deleted.
alter table audit_log enable row level security;
create policy staff_read on audit_log for select to authenticated using (app.is_staff());
revoke all on audit_log from anon, authenticated;
grant select on audit_log to authenticated;

create or replace function app.audit_log_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;
create trigger audit_log_no_update before update or delete on audit_log
  for each row execute function app.audit_log_immutable();
create trigger audit_log_no_truncate before truncate on audit_log
  for each statement execute function app.audit_log_immutable();

-- ---------------------------------------------------------------------------
-- Audit trigger on the tables whose changes matter
-- ---------------------------------------------------------------------------
create or replace function app.audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  rec jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into audit_log (actor_user_id, on_behalf_of, action, entity_type, entity_id, before, after)
  values (
    auth.uid(),
    nullif(rec ->> 'on_behalf_of', '')::uuid,
    lower(tg_op),
    tg_table_name,
    coalesce(rec ->> 'id', rec ->> 'key', rec ->> 'assignment_id'),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'settings', 'org_units', 'ranks', 'task_types', 'load_roles', 'exemption_types',
    'soldiers', 'soldier_load_roles', 'app_users', 'user_roles',
    'cycles', 'slots', 'assignments', 'score_adjustments',
    'exemptions', 'date_blocks', 'absences', 'personal_constraints',
    'penalties', 'appeals', 'swap_requests', 'gaf_constraint_submissions', 'briefing_attendance'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function app.audit()',
      t || '_audit', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- The published board – the only thing the shared view account can read
-- ---------------------------------------------------------------------------
-- The view runs with its owner's rights (it reads the base tables past RLS) and
-- filters itself with app.can_view_board(), so the viewer role needs no access
-- to any table. It exposes no exemptions, scores, penalties or explanations.
create view published_board with (security_barrier = true) as
select
  s.id                                              as slot_id,
  c.id                                              as cycle_id,
  s.starts_at,
  s.ends_at,
  tt.name                                           as task_name,
  dc.name                                           as category_name,
  tt.color,
  coalesce(array_agg(so.full_name order by so.full_name) filter (where a.role = 'performer'), '{}') as performers,
  coalesce(array_agg(so.full_name order by so.full_name) filter (where a.role = 'reserve'),   '{}') as reserves,
  coalesce(array_agg(distinct g.name) filter (where a.role = 'performer'), '{}')                   as gafim,
  s.report_at,
  s.report_place,
  s.briefing_at,
  s.briefing_place,
  greatest(s.updated_at, max(a.updated_at))         as updated_at,
  greatest(s.updated_at, max(a.updated_at)) > c.published_at as changed_after_publish
from slots s
join cycles c          on c.id = s.cycle_id and c.status in ('published', 'closed')
join task_types tt     on tt.id = s.task_type_id
left join duty_categories dc on dc.id = tt.category_id
left join assignments a on a.slot_id = s.id
                       and a.status not in ('draft', 'dropped', 'cancelled_approved', 'swapped_out')
left join soldiers so  on so.id = a.soldier_id
left join org_units g  on g.id = a.gaf_id
where s.cancelled_at is null
  and app.can_view_board()
group by s.id, c.id, tt.name, dc.name, tt.color;

revoke all on published_board from anon;
grant select on published_board to authenticated;

-- ---------------------------------------------------------------------------
-- Small self-service RPCs available to every signed-in user
-- ---------------------------------------------------------------------------
create or replace function public.password_changed() returns void
language sql security definer set search_path = public, pg_temp as $$
  update app_users set must_change_password = false where id = auth.uid()
$$;

create or replace function public.touch_last_login() returns void
language sql security definer set search_path = public, pg_temp as $$
  update app_users set last_login_at = now() where id = auth.uid()
$$;

revoke execute on function public.password_changed(), public.touch_last_login() from anon, public;
grant execute on function public.password_changed(), public.touch_last_login() to authenticated;
