-- Delete a day type נע"ת added (code custom_…), e.g. one added by mistake. The built-in types stay.
-- Refused while calendar days are marked with it; it is taken off any multiplier that lists it,
-- unless that multiplier would be left with no condition at all.

create or replace function public.delete_day_type(p_code text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n int;
  m text;
begin
  perform app.require_coordinator();
  if p_code not like 'custom\_%' then
    raise exception 'סוגי היום המובנים לא נמחקים';
  end if;
  select count(*) into n from calendar_days where day_type = p_code;
  if n > 0 then
    raise exception 'יש % ימים בלוח החגים מסוג זה. שנה או מחק אותם קודם.', n;
  end if;
  select name into m from score_multipliers
  where p_code = any (day_types) and cardinality(day_types) = 1 and cardinality(weekdays) = 0
    and time_window is null and date_from is null and date_to is null
  limit 1;
  if m is not null then
    raise exception 'המקדם "%" מוגדר רק לפי סוג היום הזה. שנה או מחק את המקדם קודם.', m;
  end if;
  update score_multipliers set day_types = array_remove(day_types, p_code) where p_code = any (day_types);
  delete from day_types where code = p_code;
end $$;
revoke execute on function public.delete_day_type(text) from anon, public;
grant execute on function public.delete_day_type(text) to authenticated;
