-- =============================================================================
-- A soldier cannot hold two duties at the same time. The engine never does it (no-overlap per
-- soldier, reserves included); a manual assignment – in the draft or after publishing – could,
-- with a reason. Now it cannot: a manual assignment whose hours overlap another live duty of
-- the same soldier (as performer or reserve) is refused.
-- =============================================================================

create or replace function app.manual_no_overlap() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s slots;
  hit record;
begin
  if new.source <> 'manual' or new.status in ('dropped', 'cancelled_approved', 'swapped_out') then return new; end if;
  select * into s from slots where id = new.slot_id;
  select x.starts_at, tt.name into hit
  from assignments a join slots x on x.id = a.slot_id join task_types tt on tt.id = x.task_type_id
  where a.soldier_id = new.soldier_id and a.id <> new.id and a.slot_id <> new.slot_id
    and a.status not in ('dropped', 'cancelled_approved', 'swapped_out') and x.cancelled_at is null
    and x.starts_at < s.ends_at and x.ends_at > s.starts_at
  order by x.starts_at limit 1;
  if found then
    raise exception 'החייל כבר משובץ באותו זמן: % (%). אי אפשר לשבץ לשתי תורנויות חופפות',
      hit.name, to_char(hit.starts_at at time zone app.tz(), 'DD/MM HH24:MI')
      using errcode = '23P01';
  end if;
  return new;
end $$;

drop trigger if exists assignments_manual_no_overlap on assignments;
create trigger assignments_manual_no_overlap before insert or update of soldier_id, slot_id on assignments
  for each row execute function app.manual_no_overlap();
