-- The managers' dashboard: how many users signed in lately (7 / 30 days).
create or replace function public.unit_kpis() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  c cycles;
  today date := (now() at time zone app.tz())::date;
  grace int := coalesce((app.setting('grace_days') #>> '{}')::int, 0);
  out jsonb;
begin
  perform app.require_reader();
  select * into c from cycles where end_date >= today order by start_date limit 1;

  with act as (
    select s.*, app.service_on(s.career_start_date, s.service_type, today) as svc
    from soldiers s where s.is_active and (s.release_date is null or s.release_date >= today)
  )
  select jsonb_build_object(
    'active', count(*),
    'mandatory', count(*) filter (where svc = 'mandatory'),
    'career', count(*) filter (where svc = 'career'),
    'range_expired', count(*) filter (where range_valid_until < today),
    'range_soon', count(*) filter (where range_valid_until between today and today + 30),
    'in_training', count(*) filter (where unit_join_date is not null and unit_join_date + grace > today),
    'new_in_cycle', case when c.id is null then null else
      count(*) filter (where unit_join_date is not null and unit_join_date + grace > c.start_date and unit_join_date <= c.end_date) end,
    'to_career', case when c.id is null then null else
      count(*) filter (where career_start_date between c.start_date and c.end_date) end)
  into out from act;
  -- who actually uses the system: accounts, and who signed in lately
  out := out || (select jsonb_build_object(
      'users', count(*),
      'users_7d', count(*) filter (where u.last_login_at > now() - interval '7 days'),
      'users_30d', count(*) filter (where u.last_login_at > now() - interval '30 days'))
    from app_users u where not u.is_locked and u.deleted_at is null);

  if c.id is null then return out; end if;
  return out || jsonb_build_object(
    'cycle', jsonb_build_object('id', c.id, 'name', c.name, 'start_date', c.start_date, 'end_date', c.end_date,
                                'published', c.status in ('published', 'closed'), 'status', c.status),
    'exemptions_approved', (select count(*) from exemptions e
                             where e.status = 'approved' and e.start_date <= c.end_date and e.end_date >= c.start_date),
    'exemptions_pending', (select count(*) from exemptions e
                            where e.status = 'pending' and e.start_date <= c.end_date and e.end_date >= c.start_date),
    -- call-ups: a reserve that was activated, and a special call-up duty
    'callups_reserve', (select count(*) from assignments a join slots sl on sl.id = a.slot_id
                         where sl.cycle_id = c.id and a.status = 'reserve_activated'),
    'callups_special', (select count(*) from assignments a join slots sl on sl.id = a.slot_id join task_types t on t.id = sl.task_type_id
                         where sl.cycle_id = c.id and t.is_special and a.role = 'performer'
                           and a.status not in ('draft', 'dropped', 'cancelled_approved', 'swapped_out')),
    'manual_changes', (select count(*) from assignments a join slots sl on sl.id = a.slot_id
                        where sl.cycle_id = c.id and a.source = 'manual'),
    'swaps', (select count(*) from swap_requests r join assignments a on a.id = r.assignment_id join slots sl on sl.id = a.slot_id
               where sl.cycle_id = c.id and r.status = 'approved'));
end $$;
revoke all on function public.unit_kpis() from public, anon;
grant execute on function public.unit_kpis() to authenticated;
