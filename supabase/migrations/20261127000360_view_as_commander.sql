-- =============================================================================
-- "צפייה כעובד" of a gaf commander (2.71.1): the viewer sees what that commander sees – his
-- "נתוני המסגרת" on his frameworks, not the viewer's.
--   * app.frame_gafs(): the frameworks the numbers are about – the viewed commander's while viewing,
--     else the signed-in gaf commander's (as my_commanded_gafs).
--   * app.in_frame(soldier): in them. dashboard_set / dashboard_ids / unit_kpis / unit_dashboard with
--     p_mine use these instead of commands_soldier (which stays the signed-in user's, for actions).
--   * view_as_current also says whether the viewed employee's account is a gaf commander, so the
--     app shows his menu and home.
-- Read only, as all of "צפייה כעובד".
-- =============================================================================

create or replace function app.frame_gafs() returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when app.viewing_as() is not null then coalesce((
      select array_agg(distinct coalesce(ur.gaf_id, s.gaf_id))
      from app_users u
      join user_roles ur on ur.user_id = u.id and ur.role = 'gaf_commander'
      left join soldiers s on s.id = u.soldier_id
      where u.soldier_id = app.viewing_as() and not u.is_locked and u.deleted_at is null
        and (ur.valid_from is null or ur.valid_from <= now()) and (ur.valid_to is null or ur.valid_to > now())
        and coalesce(ur.gaf_id, s.gaf_id) is not null), '{}')
    when app.has_role('gaf_commander') and app.mfa_passed() then app.my_gafs()
    else '{}'::uuid[]
  end
$$;

create or replace function app.in_frame(p_soldier uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from soldiers s where s.id = p_soldier and s.gaf_id = any (app.frame_gafs()))
$$;
revoke all on function app.frame_gafs(), app.in_frame(uuid) from public, anon;
grant execute on function app.frame_gafs(), app.in_frame(uuid) to authenticated;

create or replace function public.my_commanded_gafs() returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select app.frame_gafs()
$$;

create or replace function public.view_as_current() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('soldier_id', s.id, 'name', s.full_name, 'until', v.expires_at,
                            'commander', cardinality(app.frame_gafs()) > 0)
  from view_as v join soldiers s on s.id = v.soldier_id
  where v.user_id = auth.uid() and v.soldier_id = app.viewing_as()
$$;

create or replace function app.dashboard_set(p_key text, p_mine boolean default false)
returns setof uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  today date := (now() at time zone app.tz())::date;
  grace int := coalesce((app.setting('grace_days') #>> '{}')::int, 0);
  k cycles;   -- the tiles' cycle: today's, or the next one
  p cycles;   -- the load cards' cycle: the published one of today, else the latest published
  arg text := split_part(p_key, ':', 2);
begin
  select * into k from cycles where end_date >= today order by start_date limit 1;
  select * into p from cycles where status in ('published', 'closed')
   order by (current_date between start_date and end_date) desc, start_date desc limit 1;

  if p_key in ('active', 'mandatory', 'career', 'with_account', 'new_in_cycle', 'in_training', 'to_career', 'range_expired', 'range_soon') then
    return query
      select s.id from soldiers s
      where s.is_active and (s.release_date is null or s.release_date >= today)
        and (not p_mine or app.in_frame(s.id))
        and case p_key
          when 'active' then true
          when 'mandatory' then app.service_on(s.career_start_date, s.service_type, today) = 'mandatory'
          when 'career' then app.service_on(s.career_start_date, s.service_type, today) = 'career'
          when 'with_account' then exists (select 1 from app_users u join user_roles r on r.user_id = u.id and r.role = 'soldier'
                                           where u.soldier_id = s.id)
          when 'in_training' then s.unit_join_date is not null and s.unit_join_date + grace > today
          when 'new_in_cycle' then k.id is not null and s.unit_join_date is not null
                                   and s.unit_join_date + grace > k.start_date and s.unit_join_date <= k.end_date
          when 'to_career' then k.id is not null and s.career_start_date between k.start_date and k.end_date
          when 'range_expired' then s.range_valid_until < today
          when 'range_soon' then s.range_valid_until between today and today + 30
        end;
  elsif p_key like 'gaf:%' then
    return query
      select s.id from soldiers s
      where s.is_active and s.gaf_id::text = arg and (not p_mine or app.in_frame(s.id));
  elsif p_key like 'pop:%' or p_key like 'pop0:%' then
    if p.id is null then return; end if;
    return query
      select sn.soldier_id from cycle_soldier_snapshot sn
      where sn.cycle_id = p.id and sn.service_type::text = arg
        and (not p_mine or app.in_frame(sn.soldier_id))
        and (p_key like 'pop:%' or (
              select coalesce(sum(a.normalized_points) filter (where app.performs(a.role, a.status)), 0)
              from assignments a join slots sl on sl.id = a.slot_id
              where a.soldier_id = sn.soldier_id and sl.cycle_id = p.id and sl.cancelled_at is null
                and a.status not in ('draft', 'dropped', 'swapped_out', 'cancelled_approved')) = 0);
  elsif p_key = 'all' then
    -- everyone (also not active): what a gaf commander's exemption and request numbers count
    return query select s.id from soldiers s where not p_mine or app.in_frame(s.id);
  else
    raise exception 'unknown key %', p_key;
  end if;
end $$;
revoke all on function app.dashboard_set(text, boolean) from public, anon;

create or replace function public.dashboard_ids(p_key text, p_mine boolean default false) returns uuid[]
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_mine then
    if cardinality(app.frame_gafs()) = 0 then raise exception 'permission denied' using errcode = '42501'; end if;
  else
    perform app.require_reader();
  end if;
  return coalesce((select array_agg(x) from app.dashboard_set(p_key, p_mine) x), '{}');
end $$;
revoke all on function public.dashboard_ids(text, boolean) from public, anon;
grant execute on function public.dashboard_ids(text, boolean) to authenticated;

create or replace function public.unit_kpis(p_mine boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  c cycles;
  today date := (now() at time zone app.tz())::date;
  out jsonb;
  n text;
begin
  if p_mine then
    if cardinality(app.frame_gafs()) = 0 then raise exception 'permission denied' using errcode = '42501'; end if;
  else
    perform app.require_reader();
  end if;
  select * into c from cycles where end_date >= today order by start_date limit 1;

  out := '{}'::jsonb;
  foreach n in array array['active', 'mandatory', 'career', 'range_expired', 'range_soon', 'in_training'] loop
    out := out || jsonb_build_object(n, (select count(*) from app.dashboard_set(n, p_mine)));
  end loop;
  out := out || jsonb_build_object(
    'new_in_cycle', case when c.id is null then null else (select count(*) from app.dashboard_set('new_in_cycle', p_mine)) end,
    'to_career', case when c.id is null then null else (select count(*) from app.dashboard_set('to_career', p_mine)) end);
  -- who actually uses the system: accounts, and who signed in lately
  out := out || (select jsonb_build_object(
      'users', count(*),
      'users_7d', count(*) filter (where u.last_login_at > now() - interval '7 days'),
      'users_30d', count(*) filter (where u.last_login_at > now() - interval '30 days'))
    from app_users u where not u.is_locked and u.deleted_at is null
      and (not p_mine or (u.soldier_id is not null and app.in_frame(u.soldier_id))));

  if c.id is null then return out; end if;
  return out || jsonb_build_object(
    'cycle', jsonb_build_object('id', c.id, 'name', c.name, 'start_date', c.start_date, 'end_date', c.end_date,
                                'published', c.status in ('published', 'closed'), 'status', c.status),
    -- exemptions of the tiles' cycle: what אילוצים › פטורים shows for that cycle, by status
    'exemptions_approved', (select count(*) from exemptions e
                             where e.status = 'approved' and e.start_date <= c.end_date and e.end_date >= c.start_date
                               and (not p_mine or app.in_frame(e.soldier_id))),
    'exemptions_pending', (select count(*) from exemptions e
                            where e.status = 'pending' and e.start_date <= c.end_date and e.end_date >= c.start_date
                              and (not p_mine or app.in_frame(e.soldier_id))),
    'exemptions_urgent', (select count(*) from exemptions e
                           where e.status = 'pending' and e.is_urgent and e.start_date <= c.end_date and e.end_date >= c.start_date
                             and (not p_mine or app.in_frame(e.soldier_id))),
    'exemptions_by_soldiers', (select count(*) from exemptions e
                                where e.status = 'pending' and e.source = 'soldier' and e.start_date <= c.end_date and e.end_date >= c.start_date
                                  and (not p_mine or app.in_frame(e.soldier_id))),
    -- call-ups: a reserve that was activated, and a special call-up duty
    'callups_reserve', (select count(*) from assignments a join slots sl on sl.id = a.slot_id
                         where sl.cycle_id = c.id and a.status = 'reserve_activated'
                           and (not p_mine or app.in_frame(a.soldier_id))),
    'callups_special', (select count(*) from assignments a join slots sl on sl.id = a.slot_id join task_types t on t.id = sl.task_type_id
                         where sl.cycle_id = c.id and t.is_special and a.role = 'performer'
                           and a.status not in ('draft', 'dropped', 'cancelled_approved', 'swapped_out')
                           and (not p_mine or app.in_frame(a.soldier_id))),
    'manual_changes', (select count(*) from assignments a join slots sl on sl.id = a.slot_id
                        where sl.cycle_id = c.id and a.source = 'manual'
                          and (not p_mine or app.in_frame(a.soldier_id))),
    'swaps', (select count(*) from swap_requests r join assignments a on a.id = r.assignment_id join slots sl on sl.id = a.slot_id
               where sl.cycle_id = c.id and r.status = 'approved'
                 and (not p_mine or app.in_frame(a.soldier_id))));
end $$;
revoke all on function public.unit_kpis(boolean) from public, anon;
grant execute on function public.unit_kpis(boolean) to authenticated;

create or replace function public.unit_dashboard(p_mine boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c cycles;
begin
  if p_mine then
    if cardinality(app.frame_gafs()) = 0 then raise exception 'permission denied' using errcode = '42501'; end if;
  else
    perform app.require_reader();
  end if;
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
      select jsonb_agg(jsonb_build_object('gaf', g.name, 'gaf_id', g.id, 'soldiers', x.soldiers, 'duties', x.duties, 'points', x.points) order by g.name)
      from org_units g
      join lateral (
        select count(distinct s.id) as soldiers,
               count(a.id) filter (where app.performs(a.role, a.status)) as duties,
               coalesce(sum(a.normalized_points) filter (where app.performs(a.role, a.status)), 0) as points
        from soldiers s
        left join assignments a on a.soldier_id = s.id and a.status not in ('draft', 'dropped', 'swapped_out', 'cancelled_approved')
                               and a.slot_id in (select id from slots where cycle_id = c.id and cancelled_at is null)
        where s.id in (select app.dashboard_set('gaf:' || g.id, p_mine))
      ) x on true
      where g.kind = 'gaf' and x.soldiers > 0), '[]'),
    'by_population', coalesce((
      select jsonb_agg(jsonb_build_object('population', p.service_type, 'soldiers', p.n, 'mean', p.mean, 'min', p.min, 'max', p.max,
                                          'without', (select count(*) from app.dashboard_set('pop0:' || p.service_type, p_mine)))
                       order by p.service_type)
      from (
        select sn.service_type, count(*) as n, round(avg(t.points), 2) as mean, min(t.points) as min, max(t.points) as max
        from cycle_soldier_snapshot sn
        join lateral (
          select coalesce(sum(a.normalized_points) filter (where app.performs(a.role, a.status)), 0) as points
          from assignments a join slots sl on sl.id = a.slot_id
          where a.soldier_id = sn.soldier_id and sl.cycle_id = c.id and sl.cancelled_at is null
            and a.status not in ('draft', 'dropped', 'swapped_out', 'cancelled_approved')
        ) t on true
        where sn.cycle_id = c.id and (not p_mine or app.in_frame(sn.soldier_id))
        group by sn.service_type
      ) p), '[]'),
    'requests', jsonb_build_object(
      'pending', (select count(*) from exemptions e where status = 'pending' and (not p_mine or app.in_frame(e.soldier_id))),
      'urgent', (select count(*) from exemptions e where status = 'pending' and is_urgent and (not p_mine or app.in_frame(e.soldier_id))),
      'by_soldiers', (select count(*) from exemptions e where status = 'pending' and source = 'soldier' and (not p_mine or app.in_frame(e.soldier_id)))),
    'accounts', jsonb_build_object(
      'soldiers', (select count(*) from app.dashboard_set('active', p_mine)),
      'with_account', (select count(*) from app.dashboard_set('with_account', p_mine))),
    -- the rules: the unit's, not a gaf commander's
    'settings_changes', case when p_mine then '[]'::jsonb else coalesce((
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
        limit 60) q), '[]') end
  );
end $$;
revoke all on function public.unit_dashboard(boolean) from public, anon;
grant execute on function public.unit_dashboard(boolean) to authenticated;
