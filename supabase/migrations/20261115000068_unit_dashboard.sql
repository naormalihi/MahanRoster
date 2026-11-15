-- =============================================================================
-- Version 2.0, stage 2.6 – the unit commander and his dashboard.
--
-- The unit commander (מפקד יחידה) sees everything in the unit, read only, like a gaf
-- commander – and a dashboard: the cycle at a glance, the load by gaf and by population,
-- open requests, and the settings changed in the last month. That last list is how the
-- rules נע"ת sets are visible to the commander: נע"ת both sets the rules and schedules, so
-- every change to them is shown here from the audit log, which nobody can delete.
-- =============================================================================

create or replace function app.is_commander() returns boolean
language sql stable as $$ select (app.has_role('gaf_commander') or app.has_role('unit_commander')) and app.mfa_passed() $$;

-- נע"ת makes unit commander accounts too.
create or replace function public.create_user(p_username text, p_password text, p_role app_role, p_soldier uuid default null)
returns uuid
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid; uname text := lower(trim(p_username));
begin
  perform app.require_coordinator();
  if uname !~ '^[a-z0-9._-]{3,32}$' then raise exception 'שם משתמש: 3–32 אותיות לטיניות קטנות, ספרות, נקודה, מקף או קו תחתון'; end if;
  if length(coalesce(p_password, '')) < 10 then raise exception 'סיסמה זמנית: לפחות 10 תווים'; end if;
  if p_role not in ('gaf_commander', 'unit_commander') then raise exception 'כאן נוצרים חשבונות של מפקדי גפים ומפקד היחידה'; end if;
  if exists (select 1 from app_users where username = uname) then raise exception 'שם המשתמש כבר קיים'; end if;
  uid := app.create_auth_user(uname || '@users.invalid', p_password);
  insert into app_users (id, username, soldier_id, must_change_password) values (uid, uname, p_soldier, true);
  insert into user_roles (user_id, role, gaf_id)
  values (uid, p_role, case when p_role = 'gaf_commander' and p_soldier is not null then (select gaf_id from soldiers where id = p_soldier) end);
  insert into audit_log (actor_user_id, action, entity_type, entity_id, after)
  values (auth.uid(), 'create_user', 'app_users', uid::text, jsonb_build_object('username', uname, 'role', p_role, 'soldier_id', p_soldier));
  return uid;
end $$;

create or replace function public.unit_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c cycles;
begin
  perform app.require_reader();
  -- the published cycle of today, else the latest published one
  select * into c from cycles
   where status in ('published', 'closed')
   order by (current_date between start_date and end_date) desc, start_date desc
   limit 1;
  return jsonb_build_object(
    'cycle', case when c.id is null then null else jsonb_build_object('id', c.id, 'name', c.name, 'start_date', c.start_date, 'end_date', c.end_date) end,
    'planning', (select jsonb_build_object('name', p.name, 'status', p.status, 'deadline', p.exemption_deadline)
                 from cycles p where p.status not in ('published', 'closed') order by p.start_date limit 1),
    'by_gaf', coalesce((
      select jsonb_agg(jsonb_build_object('gaf', g.name, 'soldiers', x.soldiers, 'duties', x.duties, 'points', x.points) order by g.name)
      from org_units g
      join lateral (
        select count(distinct s.id) as soldiers,
               count(a.id) filter (where a.role = 'performer') as duties,
               coalesce(sum(a.normalized_points) filter (where a.role = 'performer'), 0) as points
        from soldiers s
        left join assignments a on a.soldier_id = s.id and a.status not in ('draft', 'dropped', 'swapped_out', 'cancelled_approved')
                               and a.slot_id in (select id from slots where cycle_id = c.id and cancelled_at is null)
        where s.gaf_id = g.id and s.is_active
      ) x on true
      where g.kind = 'gaf'), '[]'),
    'by_population', coalesce((
      select jsonb_agg(jsonb_build_object('population', p.service_type, 'soldiers', p.n, 'mean', p.mean, 'min', p.min, 'max', p.max,
                                          'without', p.without) order by p.service_type)
      from (
        select sn.service_type, count(*) as n, round(avg(t.points), 2) as mean, min(t.points) as min, max(t.points) as max,
               count(*) filter (where t.points = 0) as without
        from cycle_soldier_snapshot sn
        join lateral (
          select coalesce(sum(a.normalized_points) filter (where a.role = 'performer'), 0) as points
          from assignments a join slots sl on sl.id = a.slot_id
          where a.soldier_id = sn.soldier_id and sl.cycle_id = c.id and sl.cancelled_at is null
            and a.status not in ('draft', 'dropped', 'swapped_out', 'cancelled_approved')
        ) t on true
        where sn.cycle_id = c.id
        group by sn.service_type
      ) p), '[]'),
    'requests', jsonb_build_object(
      'pending', (select count(*) from exemptions where status = 'pending'),
      'urgent', (select count(*) from exemptions where status = 'pending' and is_urgent),
      'by_soldiers', (select count(*) from exemptions where status = 'pending' and source = 'soldier')),
    'accounts', jsonb_build_object(
      'soldiers', (select count(*) from soldiers where is_active),
      'with_account', (select count(distinct u.soldier_id) from app_users u join user_roles r on r.user_id = u.id and r.role = 'soldier'
                       join soldiers s on s.id = u.soldier_id and s.is_active)),
    'settings_changes', coalesce((
      select jsonb_agg(x order by x->>'at' desc) from (
        select jsonb_build_object(
                 'at', l.at, 'action', l.action, 'entity', l.entity_type,
                 'name', coalesce(l.after->>'name', l.before->>'name', l.after->>'key', l.before->>'key', l.entity_id),
                 'by', (select username from app_users where id = l.actor_user_id)) as x
        from audit_log l
        where l.at > now() - interval '30 days'
          and l.entity_type in ('settings', 'task_types', 'score_multipliers', 'exemption_types', 'absence_types', 'load_roles',
                                'ranks', 'duty_categories', 'populations', 'day_types', 'calendar_days', 'exemption_type_duties')
          and l.actor_user_id is not null
        order by l.at desc
        limit 60) q), '[]')
  );
end $$;

revoke execute on function public.unit_dashboard() from anon, public;
grant execute on function public.unit_dashboard() to authenticated;
