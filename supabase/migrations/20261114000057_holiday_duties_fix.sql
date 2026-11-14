-- =============================================================================
-- Holiday duties (055), two fixes:
-- * A day counts by its holiday name too, not only by its type – a day retyped to a custom
--   type (e.g. a "סוכות" type) is still ערב סוכות.
-- * The soldiers screen shows published holiday duties from a year back to a year ahead, so
--   one already scheduled (ערב פסח of the published cycle) is marked too. The engine still
--   looks only at the year before the cycle it schedules.
-- =============================================================================

create or replace function app.holiday_duties(p_from date, p_to date)
returns table (soldier_id uuid, day date, task_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.soldier_id, d::date, t.name
  from assignments a
  join slots x on x.id = a.slot_id
  join cycles c on c.id = x.cycle_id and c.status in ('published', 'closed')
  join task_types t on t.id = x.task_type_id
  cross join lateral generate_series((x.starts_at at time zone app.tz())::date,
                                     ((x.ends_at - interval '1 microsecond') at time zone app.tz())::date,
                                     interval '1 day') d
  where x.cancelled_at is null and not x.is_penalty_slot
    and ((a.role = 'performer' and a.status in ('assigned', 'done')) or a.status = 'reserve_activated')
    and d::date between p_from and p_to
    -- a holiday day by its type, or by its name (a day retyped to a custom type still counts):
    -- the eve or the day of a rest-day holiday
    and (app.is_holiday(d::date)
         or exists (select 1 from calendar_days cd where cd.day = d::date and cd.holiday = any (app.rest_holidays())
                    and cd.holiday_kind in ('eve', 'day')))
$$;


drop function if exists public.recent_holiday_duties(date, date);
create or replace function public.recent_holiday_duties(p_since date, p_until date default current_date + 365)
returns table (soldier_id uuid, day date, task_name text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform app.require_staff();
  return query
    select distinct on (h.soldier_id) h.soldier_id, h.day, h.task_name
    from app.holiday_duties(p_since, p_until) h
    order by h.soldier_id, h.day desc;
end $$;
revoke all on function public.recent_holiday_duties(date, date) from public, anon;
grant execute on function public.recent_holiday_duties(date, date) to authenticated;
