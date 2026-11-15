-- A duty belongs to the cycle its date falls in. The "new duty in the cycle" dialog defaulted to
-- tomorrow, and nothing stopped a duty dated outside its cycle (e.g. 16.11.2026 in July–December
-- 2027): it then showed in no cycle's score by date. A duty added by hand (no line in a base file)
-- through the app must start inside its cycle; base imports keep their own checks, and
-- maintenance done directly in the database is not checked.

create or replace function app.slot_in_cycle() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare c cycles;
begin
  if current_user <> 'authenticated' or new.source_line is not null or new.is_penalty_slot then return new; end if;
  select * into c from cycles where id = new.cycle_id;
  if (new.starts_at at time zone app.tz())::date not between c.start_date and c.end_date then
    raise exception 'התחלת התורנות (%) מחוץ למחזור % (% – %)',
      to_char(new.starts_at at time zone app.tz(), 'DD/MM/YYYY'), c.name,
      to_char(c.start_date, 'DD/MM/YYYY'), to_char(c.end_date, 'DD/MM/YYYY');
  end if;
  return new;
end $$;

drop trigger if exists slot_in_cycle on slots;
create trigger slot_in_cycle before insert or update of starts_at, cycle_id on slots
  for each row execute function app.slot_in_cycle();
