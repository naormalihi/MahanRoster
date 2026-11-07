-- Weight history: every change of a duty weight or a scoring multiplier is recorded
-- with its date, so it is always possible to say which values a past cycle used.
-- Points already earned are stored per assignment and do not change.

create or replace function app.log_task_weight() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' or new.weight is distinct from old.weight then
    insert into weight_history (task_type_id, value, effective_from, changed_by)
    values (new.id, new.weight, (now() at time zone app.tz())::date, auth.uid());
  end if;
  return new;
end $$;

create trigger task_types_weight_history
after insert or update of weight on task_types
for each row execute function app.log_task_weight();

create or replace function app.log_multiplier() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.key in ('weekend_multiplier', 'holiday_multiplier', 'night_multiplier')
     and (tg_op = 'INSERT' or new.value is distinct from old.value) then
    insert into weight_history (multiplier_key, value, effective_from, changed_by)
    values (new.key, (new.value #>> '{}')::numeric, (now() at time zone app.tz())::date, auth.uid());
  end if;
  return new;
end $$;

create trigger settings_multiplier_history
after insert or update of value on settings
for each row execute function app.log_multiplier();

-- Starting point: today's values.
insert into weight_history (task_type_id, value, effective_from)
select id, weight, (now() at time zone app.tz())::date from task_types
where not exists (select 1 from weight_history h where h.task_type_id = task_types.id);

insert into weight_history (multiplier_key, value, effective_from)
select key, (value #>> '{}')::numeric, (now() at time zone app.tz())::date from settings
where key in ('weekend_multiplier', 'holiday_multiplier', 'night_multiplier')
  and not exists (select 1 from weight_history h where h.multiplier_key = settings.key);
