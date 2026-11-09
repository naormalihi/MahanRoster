-- MahanRoster: clear the dynamic data before a real run from scratch.
-- Run in Supabase › SQL Editor. Irreversible; every table it changes is copied to schema
-- reset_backup first. When sure, remove the copy with:  drop schema reset_backup cascade;
--
-- Deleted (loaded or produced cycle by cycle):
--   cycles and all that hangs off them – slots, runs, assignments, snapshot, credits, potential
--   overrides, gaf constraints, draft comments, briefings, swaps, penalties, appeals, notifications;
--   soldiers and all that hangs off them – gaf history, load roles, exemptions, absences, date
--   blocks, personal constraints, score adjustments; roster / base-schedule imports and their files;
--   duty types (task types) with their name aliases, exemption links and weight history;
--   gafim (sub-units of the unit) with their name aliases.
-- Kept (system settings): settings and multipliers, populations, day types, ranks, load roles,
--   duty categories, exemption and absence types, holidays (calendar), the unit itself,
--   users (their link to a soldier or gaf is cleared), audit log.

begin;

do $$
declare
  t text;
  wipe text[] := array[
    -- cycles
    'cycles', 'slots', 'schedule_jobs', 'assignments', 'cycle_soldier_snapshot', 'cycle_credits',
    'potential_overrides', 'gaf_constraint_submissions', 'draft_comments', 'briefing_attendance',
    'swap_requests', 'penalties', 'appeals', 'notifications',
    -- soldiers
    'soldier_gaf_history', 'soldier_load_roles', 'exemptions', 'absences', 'date_blocks',
    'personal_constraints', 'score_adjustments', 'roster_imports', 'blobs',
    -- duty types
    'task_type_aliases', 'exemption_type_duties',
    -- gafim
    'gaf_aliases'];
  partly text[] := array['soldiers', 'task_types', 'weight_history', 'org_units', 'app_users', 'user_roles'];
begin
  if exists (select 1 from pg_namespace where nspname = 'reset_backup') then
    raise exception 'schema reset_backup already exists – drop it first (drop schema reset_backup cascade)';
  end if;
  create schema reset_backup;
  revoke all on schema reset_backup from public;
  foreach t in array wipe || partly loop
    execute format('create table reset_backup.%I as table public.%I', t, t);
  end loop;

  -- links from what stays to what goes
  update public.app_users set soldier_id = null where soldier_id is not null;
  update public.user_roles set gaf_id = null where gaf_id is not null;
  update public.org_units set commander_user_id = null where kind = 'gaf' and commander_user_id is not null;

  -- one statement for the leaf tables; restrict = never spill into a table not listed
  execute 'truncate ' || (select string_agg(format('public.%I', x), ', ') from unnest(wipe) x) || ' restrict';
  -- tables that other kept tables point at: delete, not truncate
  delete from public.soldiers;
  delete from public.weight_history where task_type_id is not null;  -- multiplier history stays
  delete from public.task_types;
  delete from public.org_units where kind <> 'unit';
end $$;

commit;

select (select count(*) from cycles)     as cycles_left,
       (select count(*) from soldiers)   as soldiers_left,
       (select count(*) from task_types) as duty_types_left,
       (select count(*) from org_units where kind <> 'unit') as gafim_left,
       (select count(*) from app_users)  as users_kept,
       (select count(*) from settings)   as settings_kept;
