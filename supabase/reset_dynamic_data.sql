-- MahanRoster: clear the dynamic data before a real run from scratch.
-- Run in Supabase › SQL Editor. Irreversible; every table it changes is copied to schema
-- reset_backup first. When sure, remove the copy with:  drop schema reset_backup cascade;
--
-- Deleted (loaded or produced cycle by cycle):
--   cycles and all that hangs off them – slots, runs, assignments, snapshot, credits, potential
--   overrides, gaf constraints, draft comments, briefings, swaps, penalties, appeals, notifications;
--   soldiers and all that hangs off them – gaf history, load roles, exemptions, absences, date
--   blocks, personal constraints, score adjustments, invite codes; roster / base-schedule imports
--   and their files; gafim (sub-units of the unit) with their name aliases;
--   soldiers' accounts (role "soldier" only): after the reset every soldier gets a new invite code;
--   staff accounts that were linked to a soldier (staff who do duties) keep their staff role and
--   lose the soldier role with the link;
--   the daily counters of "הצעה לשיפור" (feedback_quota);
--   the unit key check: the first roster load after the reset sets the key (a new one, or the same).
-- Kept (system settings): settings and multipliers, populations, day types, ranks, load roles,
--   the duty catalog – duty categories, duty types, the base's names for them (aliases), their
--   exemption links and weight history –, exemption and absence types, holidays (calendar),
--   the unit itself, the accounts of נע"ת, commanders and viewers (their link to a soldier or gaf is
--   cleared) with their look (light/dark) and push subscriptions, "אנשי קשר לחיילים" (staff –
--   a phone taken from a soldier card falls back to none), the messages of "הצעות ומשוב" (about the
--   app, not the unit; a sender whose account goes stays by name only), the notification schedule,
--   audit log – which gets one record of the reset, with the rows removed per table.
-- The catalog is set up once and serves every cycle; a base file maps onto it, so it stays.

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
    'personal_constraints', 'score_adjustments', 'roster_imports', 'blobs', 'soldier_invites',
    -- gafim
    'gaf_aliases',
    -- counters
    'feedback_quota'];
  partly text[] := array['soldiers', 'org_units', 'app_users', 'user_roles', 'settings'];
  removed jsonb := '{}';
  n bigint;
begin
  if exists (select 1 from pg_namespace where nspname = 'reset_backup') then
    raise exception 'schema reset_backup already exists – drop it first (drop schema reset_backup cascade)';
  end if;
  create schema reset_backup;
  revoke all on schema reset_backup from public;
  foreach t in array wipe || partly loop
    execute format('create table reset_backup.%I as table public.%I', t, t);
  end loop;
  foreach t in array wipe loop
    execute format('select count(*) from public.%I', t) into n;
    removed := removed || jsonb_build_object(t, n);
  end loop;
  removed := removed || jsonb_build_object('soldiers', (select count(*) from public.soldiers),
                                           'gafim', (select count(*) from public.org_units where kind <> 'unit'));

  -- soldiers' accounts (no role but "soldier"): each soldier opens a new one with a new invite code
  -- (their sign-in records go with them; the copy above keeps app_users and user_roles)
  with gone as (
    delete from auth.users au
     where exists (select 1 from public.user_roles r where r.user_id = au.id and r.role = 'soldier')
       and not exists (select 1 from public.user_roles r where r.user_id = au.id and r.role <> 'soldier')
    returning 1)
  select count(*) into n from gone;
  removed := removed || jsonb_build_object('soldier_accounts', n);

  -- links from what stays to what goes (unlinking an account also drops its soldier role,
  -- app.sync_soldier_role – staff who did duties stay staff)
  update public.app_users set soldier_id = null where soldier_id is not null;
  delete from public.user_roles r where r.role = 'soldier'
     and exists (select 1 from public.user_roles o where o.user_id = r.user_id and o.role <> 'soldier');
  update public.user_roles set gaf_id = null where gaf_id is not null;
  update public.org_units set commander_user_id = null where kind = 'gaf' and commander_user_id is not null;
  -- the first roster load after the reset sets the unit key again
  delete from public.settings where key = 'unit_key_check';

  -- one statement for the leaf tables; restrict = never spill into a table not listed
  execute 'truncate ' || (select string_agg(format('public.%I', x), ', ') from unnest(wipe) x) || ' restrict';
  -- tables that other kept tables point at: delete, not truncate
  delete from public.soldiers;
  delete from public.org_units where kind <> 'unit';

  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, after)
  values (auth.uid(), 'reset_dynamic_data', 'database', null,
          jsonb_build_object('removed', removed, 'backup_schema', 'reset_backup'));
end $$;

commit;

select (select count(*) from cycles)     as cycles_left,
       (select count(*) from soldiers)   as soldiers_left,
       (select count(*) from task_types) as duty_types_kept,
       (select count(*) from org_units where kind <> 'unit') as gafim_left,
       (select count(*) from app_users)  as users_kept,
       (select count(*) from user_roles where role = 'soldier') as soldier_roles_left,
       (select count(*) from reset_backup.app_users) - (select count(*) from app_users) as soldier_accounts_removed,
       (select count(*) from settings)   as settings_kept;
