-- ת"ש 7 per soldier in a cycle, for the draft's soldiers view: who lodges at home every night
-- at some point of the cycle (the soldier's flag or its override, or an approved exemption of a
-- home-nightly type), and whether only for part of it.

create or replace function public.cycle_home_nightly(p_cycle uuid)
returns table (soldier_id uuid, partial boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform app.require_reader();
  return query
  with c as (select * from cycles where id = p_cycle),
  s as (
    select so.id,
           app.home_nightly_on(so, c.start_date) as at_start,
           app.home_nightly_on(so, c.end_date) as at_end,
           exists (select 1 from exemptions e join exemption_types t on t.id = e.exemption_type_id
                   where e.soldier_id = so.id and t.home_nightly and e.status = 'approved'
                     and e.start_date <= c.end_date and e.end_date >= c.start_date) as by_exemption,
           exists (select 1 from exemptions e join exemption_types t on t.id = e.exemption_type_id
                   where e.soldier_id = so.id and t.home_nightly and e.status = 'approved'
                     and e.start_date <= c.start_date and e.end_date >= c.end_date) as whole_exemption
    from c join cycle_soldier_snapshot sn on sn.cycle_id = c.id join soldiers so on so.id = sn.soldier_id
  )
  select s.id, not ((s.at_start and s.at_end) or s.whole_exemption)
  from s
  where s.at_start or s.at_end or s.by_exemption;
end $$;
revoke execute on function public.cycle_home_nightly(uuid) from anon, public;
grant execute on function public.cycle_home_nightly(uuid) to authenticated;
