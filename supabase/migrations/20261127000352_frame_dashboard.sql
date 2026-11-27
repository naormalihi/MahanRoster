-- =============================================================================
-- "נתוני המסגרת" (2.71): the managers' dashboard for a gaf commander, on his own people only
-- (unit_kpis / unit_dashboard / dashboard_ids with p_mine, 2.70). One more list: 'all' – his people,
-- also those not active – for the exemption numbers, which count every exemption of his people.
-- =============================================================================

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
        and (not p_mine or app.commands_soldier(s.id))
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
      where s.is_active and s.gaf_id::text = arg and (not p_mine or app.commands_soldier(s.id));
  elsif p_key like 'pop:%' or p_key like 'pop0:%' then
    if p.id is null then return; end if;
    return query
      select sn.soldier_id from cycle_soldier_snapshot sn
      where sn.cycle_id = p.id and sn.service_type::text = arg
        and (not p_mine or app.commands_soldier(sn.soldier_id))
        and (p_key like 'pop:%' or (
              select coalesce(sum(a.normalized_points) filter (where app.performs(a.role, a.status)), 0)
              from assignments a join slots sl on sl.id = a.slot_id
              where a.soldier_id = sn.soldier_id and sl.cycle_id = p.id and sl.cancelled_at is null
                and a.status not in ('draft', 'dropped', 'swapped_out', 'cancelled_approved')) = 0);
  elsif p_key = 'all' then
    -- everyone (also not active): what a gaf commander's exemption and request numbers count
    return query select s.id from soldiers s where not p_mine or app.commands_soldier(s.id);
  else
    raise exception 'unknown key %', p_key;
  end if;
end $$;
