-- =============================================================================
-- A database role for the scheduling engine that can do only the engine's work.
--
-- The solve workflow connected as the database owner, so a fault in it (or anything run with
-- the same secret) could read or change every table. mahan_solver can only take queued jobs,
-- report their progress, and hand the result to apply_solver_result, which checks it and writes
-- the draft with the owner's rights, as before. It cannot read soldiers, accounts or the log.
--
-- The role is created without a password. To use it (once, in the Supabase SQL editor):
--   alter role mahan_solver with login password '<a long random password>';
-- then add the secret SOLVER_DB_URL (the Session pooler string with user mahan_solver.<ref>).
-- Until that secret exists, the workflow keeps using SUPABASE_DB_URL.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'mahan_solver') then
    create role mahan_solver nologin;
  end if;
end $$;

grant usage on schema public to mahan_solver;
grant select (id, status, input, params, created_at), update (status, started_at, finished_at, progress, params, error)
  on public.schedule_jobs to mahan_solver;
drop policy if exists solver_jobs on public.schedule_jobs;
create policy solver_jobs on public.schedule_jobs for all to mahan_solver using (true) with check (true);
grant execute on function public.apply_solver_result(uuid, jsonb) to mahan_solver;
