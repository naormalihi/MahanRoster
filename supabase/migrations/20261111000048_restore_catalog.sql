-- =============================================================================
-- Restore the duty catalog after a data reset.
--
-- On 10/11 a reset of the unit's data (soldiers, units, cycles) also deleted every
-- duty type, and with them the base's names (aliases) and the exemption links. The
-- categories stayed. Without types the base's file has nothing to map to.
--
-- When the catalog is empty, this puts back the types as they were just before the
-- reset (same ids and settings) with the base's names that pointed to them and the
-- exemption links – from the reset's own backup (schema reset_backup) when it is there,
-- else from the audit log. A database with a catalog is left as it is.
-- =============================================================================

do $$
declare n int;
begin
  if exists (select 1 from task_types) then
    return;
  end if;

  -- The reset script keeps a full copy of what it deleted: take the catalog from there,
  -- exactly as it was (types, the base's names, exemption links, weight history).
  if to_regclass('reset_backup.task_types') is not null then
    insert into task_types select * from reset_backup.task_types;
    get diagnostics n = row_count;
    raise notice 'restored % duty types from reset_backup', n;
    if n > 0 then
      update task_types t set category_id = null
       where category_id is not null and not exists (select 1 from duty_categories c where c.id = t.category_id);
      insert into task_type_aliases select * from reset_backup.task_type_aliases on conflict do nothing;
      insert into exemption_type_duties select d.* from reset_backup.exemption_type_duties d
       where exists (select 1 from exemption_types e where e.id = d.exemption_type_id) on conflict do nothing;
      -- the insert above wrote a fresh weight row per type; the backup has the real history
      delete from weight_history where task_type_id is not null;
      insert into weight_history select w.* from reset_backup.weight_history w where w.task_type_id is not null;
      perform setval(pg_get_serial_sequence('weight_history', 'id'), greatest((select max(id) from weight_history), 1));
      return;
    end if;
  end if;

  -- Otherwise from the audit log:

  -- the last state of every type deleted by the reset (no user: not from the app)
  with gone as (
    select distinct on (entity_id) before
    from audit_log
    where entity_type = 'task_types' and action = 'delete' and actor_user_id is null and before is not null
    order by entity_id, at desc
  )
  insert into task_types
  select (r).*
  from (select jsonb_populate_record(null::task_types, before) r from gone) x;
  get diagnostics n = row_count;
  raise notice 'restored % duty types', n;

  -- a category or a rank that is gone is dropped from the type, not the type itself
  update task_types t set category_id = null
   where category_id is not null and not exists (select 1 from duty_categories c where c.id = t.category_id);
  update task_types t set rank_max_id = null
   where rank_max_id is not null and not exists (select 1 from ranks r where r.id = t.rank_max_id);
  update task_types t set allowed_rank_ids = (select array_agg(x) from unnest(t.allowed_rank_ids) x where exists (select 1 from ranks r where r.id = x))
   where allowed_rank_ids is not null;

  -- the base's names: every name saved and not removed since, that points to a restored type
  insert into task_type_aliases (alias, task_type_id)
  select alias, task_type_id from (
    select distinct on (coalesce(after->>'alias', before->>'alias'))
           coalesce(after->>'alias', before->>'alias') alias,
           (after->>'task_type_id')::uuid task_type_id,
           action
    from audit_log
    where entity_type = 'task_type_aliases'
    order by coalesce(after->>'alias', before->>'alias'), at desc, id desc
  ) last
  where action in ('insert', 'update') and exists (select 1 from task_types t where t.id = last.task_type_id)
  on conflict (alias) do nothing;
  get diagnostics n = row_count;
  raise notice 'restored % base names', n;

  -- Exemption links of the spec for the restored types (the reset removed them; same
  -- rules as the catalog migrations: medical and קפ"ס exempt from everything, medical
  -- qualifies for ממלכ"ת יום, שח"ר from הגנ"ש and mandatory duties, משפחה שכולה from הגנ"ש).
  insert into exemption_type_duties (exemption_type_id, task_type_id, effect)
  select et.id, tt.id,
         case when et.name = 'רפואי' and tt.code = 'mamlachat_yom' then 'qualifies' else 'excludes' end
  from exemption_types et
  join task_types tt on
       (et.name = 'רפואי')
    or (et.name = 'קפ"ס' and tt.code <> 'hagnash')
    or (et.name = 'שח"ר' and (tt.code = 'hagnash' or tt.service_restriction = 'mandatory'))
    or (et.name = 'משפחה שכולה' and tt.code = 'hagnash')
  where not exists (select 1 from exemption_type_duties d where d.task_type_id = tt.id)
  on conflict do nothing;
end $$;
