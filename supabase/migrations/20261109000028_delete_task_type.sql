-- Delete a duty type from the catalog – only while nothing uses it. A duty type that already
-- has slots (in any cycle), personal constraints or exemptions pointing at it stays, so past
-- cycles and points keep their meaning; it can be made inactive instead.
-- Its name aliases and exemption links go with it (on delete cascade); so does its weight history.

create or replace function public.delete_task_type(p_task uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t task_types;
  used text[] := '{}';
begin
  perform app.require_coordinator();
  select * into t from task_types where id = p_task for update;
  if not found then
    raise exception 'התורנות לא נמצאה';
  end if;

  if exists (select 1 from slots where task_type_id = p_task) then
    used := used || 'משבצות במחזור'::text;
  end if;
  if exists (select 1 from personal_constraints where task_type_id = p_task) then
    used := used || 'אילוצים אישיים'::text;
  end if;
  if exists (select 1 from exemptions where p_task = any (excluded_task_type_ids)) then
    used := used || 'פטורים'::text;
  end if;
  if cardinality(used) > 0 then
    raise exception 'התורנות "%" בשימוש (%), ולכן אי אפשר למחוק אותה. אפשר להפוך אותה ללא פעילה.',
      t.name, array_to_string(used, ', ');
  end if;

  delete from weight_history where task_type_id = p_task;
  delete from task_types where id = p_task;
end $$;

revoke execute on function public.delete_task_type(uuid) from anon, public;
grant execute on function public.delete_task_type(uuid) to authenticated;
