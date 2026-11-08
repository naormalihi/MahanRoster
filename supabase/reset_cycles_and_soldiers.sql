-- MahanRoster: start over – delete every cycle and every soldier.
-- Run in Supabase › SQL Editor. Irreversible; the tables are copied to schema reset_backup first.
-- Kept: catalog, settings, holidays, gafim, users (their soldier link is cleared), audit log.
-- When sure, remove the copy with:  drop schema reset_backup cascade;

begin;

do $$
declare
  t text;
  data_tables text[] := array[
    'cycles', 'slots', 'schedule_jobs', 'assignments', 'cycle_soldier_snapshot', 'cycle_credits',
    'potential_overrides', 'gaf_constraint_submissions', 'draft_comments', 'briefing_attendance',
    'swap_requests', 'penalties', 'appeals', 'notifications',
    'soldiers', 'soldier_gaf_history', 'soldier_load_roles', 'exemptions', 'absences', 'date_blocks',
    'personal_constraints', 'score_adjustments', 'roster_imports', 'blobs'];
begin
  if exists (select 1 from pg_namespace where nspname = 'reset_backup') then
    raise exception 'schema reset_backup already exists – drop it first (drop schema reset_backup cascade)';
  end if;
  create schema reset_backup;
  revoke all on schema reset_backup from public;
  foreach t in array data_tables || array['app_users'] loop
    execute format('create table reset_backup.%I as table public.%I', t, t);
  end loop;

  update public.app_users set soldier_id = null where soldier_id is not null;
  -- everything that hangs off cycles and soldiers, in one statement; restrict = never spill into
  -- other tables. soldiers last, by delete, since app_users still points at the table.
  execute 'truncate ' || (select string_agg(format('public.%I', x), ', ') from unnest(data_tables) x
                          where x <> 'soldiers') || ' restrict';
  delete from public.soldiers;
end $$;

commit;

select (select count(*) from cycles) as cycles_left,
       (select count(*) from soldiers) as soldiers_left,
       (select count(*) from app_users) as users_kept,
       (select count(*) from task_types) as catalog_kept;
