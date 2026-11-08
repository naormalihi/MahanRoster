-- MahanRoster: full reset, as a fresh install.
-- Run in Supabase › SQL Editor. Then run the db-migrate workflow, then bootstrap_after_reset.sql.
--
-- Deletes: every table, function and type of the app (public and app schemas), the
-- migration history, and every login except the coordinators (נע"ת). Keeps: the coordinator
-- logins (with their MFA), the Vault secret, extensions.
-- Before deleting, copies every table into schema reset_backup (not exposed by the API).
-- When sure, remove it with:  drop schema reset_backup cascade;

begin;

do $$
declare
  r record;
  keep uuid[];
begin
  select array_agg(distinct user_id) into keep from public.user_roles where role = 'coordinator';
  if keep is null then
    raise exception 'no coordinator login found – nothing was deleted';
  end if;

  -- 1. backup
  if exists (select 1 from pg_namespace where nspname = 'reset_backup') then
    raise exception 'schema reset_backup already exists – drop it first (drop schema reset_backup cascade)';
  end if;
  create schema reset_backup;
  revoke all on schema reset_backup from public;
  for r in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
  loop
    execute format('create table reset_backup.%I as table public.%I', r.relname, r.relname);
  end loop;

  -- 2. logins: all but the coordinators
  delete from auth.users where id <> all (keep);

  -- 3. the app itself
  drop schema if exists app cascade;
  for r in
    select c.oid, c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('v', 'm', 'r', 'p', 'S', 'f')
      and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
    order by c.relkind in ('v', 'm') desc
  loop
    if not exists (select 1 from pg_class where oid = r.oid) then continue; end if;  -- gone with an earlier cascade
    execute format('drop %s if exists %s cascade',
      case r.relkind when 'v' then 'view' when 'm' then 'materialized view' when 'S' then 'sequence'
                     when 'f' then 'foreign table' else 'table' end, r.oid::regclass);
  end loop;
  for r in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    if exists (select 1 from pg_proc where oid = r.oid) then
      execute format('drop routine %s cascade', r.oid::regprocedure);
    end if;
  end loop;
  for r in
    select t.oid from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typtype in ('e', 'd', 'c', 'r', 'm') and t.typelem = 0
      and (t.typrelid = 0 or (select relkind from pg_class where oid = t.typrelid) = 'c')
      and not exists (select 1 from pg_depend d where d.objid = t.oid and d.deptype = 'e')
  loop
    if exists (select 1 from pg_type where oid = r.oid) then
      execute format('drop type %s cascade', r.oid::regtype);
    end if;
  end loop;
end $$;

commit;

-- what is left: should be only the coordinator logins and no app tables
select (select count(*) from auth.users) as logins_left,
       (select count(*) from pg_tables where schemaname = 'public') as app_tables_left,
       (select count(*) from pg_tables where schemaname = 'reset_backup') as tables_backed_up;
