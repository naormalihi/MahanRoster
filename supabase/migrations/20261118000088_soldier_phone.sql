-- A soldier's mobile number, so "send in WhatsApp" opens his own chat.
-- Stored as 9725XXXXXXXX (the form wa.me takes). It comes from the HR file or is typed by נע"ת.
-- Who reads it: whoever reads the soldier's row – staff, a gaf commander for his own gaf, the unit
-- commander (row-level security on soldiers). Not in soldier_directory, not on the board, not in
-- the engine's input. The audit log records that it changed, never the number itself.
alter table soldiers add column if not exists phone text
  check (phone ~ '^9725[0-9]{8}$');
comment on column soldiers.phone is 'Mobile number as 9725XXXXXXXX; the audit log keeps only its last two digits.';

-- the audit trigger: as before, with the phone masked ("•••67")
create or replace function app.audit_mask(r jsonb) returns jsonb
language sql immutable as $$
  select case when r ? 'phone' and r ->> 'phone' is not null
              then jsonb_set(r, '{phone}', to_jsonb('•••' || right(r ->> 'phone', 2)))
              else r end
$$;

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
    case when tg_op in ('UPDATE', 'DELETE') then app.audit_mask(to_jsonb(old)) end,
    case when tg_op in ('INSERT', 'UPDATE') then app.audit_mask(to_jsonb(new)) end
  );
  return null;
end $$;
