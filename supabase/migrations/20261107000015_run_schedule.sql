-- =============================================================================
-- Running the engine from the app.
--
-- request_schedule() queues a job (as before). A trigger then asks GitHub to start
-- the "solve" workflow (workflow_dispatch), which runs the worker against this
-- database and writes the result back. The call goes out through pg_net with a
-- GitHub token kept in Supabase Vault under the name 'github_dispatch_token'
-- (fine-grained, this repository only, permission "Actions: read and write").
-- Without the token or pg_net nothing is sent, and the job waits until the
-- workflow is started by hand from GitHub.
-- =============================================================================

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
end $$;

insert into settings (key, value) values
  ('github_repo',     '"naormalihi/MahanRoster"'),
  ('github_workflow', '"solve.yml"')
on conflict (key) do nothing;

-- Sends the dispatch; returns 'sent', 'no_token' or 'unavailable' and records it on the job.
create or replace function app.dispatch_worker(p_job uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  tok    text;
  req    bigint;
  outcome text;
begin
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null
     or to_regclass('vault.decrypted_secrets') is null then
    outcome := 'unavailable';
  else
    execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'github_dispatch_token' limit 1$q$ into tok;
    if tok is null or tok = '' then
      outcome := 'no_token';
    else
      execute $q$select net.http_post(
          url     := $1,
          body    := jsonb_build_object('ref', 'main', 'inputs', jsonb_build_object('job_id', $2)),
          params  := '{}'::jsonb,
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || $3,
            'Accept', 'application/vnd.github+json',
            'X-GitHub-Api-Version', '2022-11-28',
            'User-Agent', 'mahanroster',
            'Content-Type', 'application/json'),
          timeout_milliseconds := 10000)$q$
        into req
        using format('https://api.github.com/repos/%s/actions/workflows/%s/dispatches',
                     app.setting('github_repo') #>> '{}', app.setting('github_workflow') #>> '{}'),
              p_job::text, tok;
      outcome := 'sent';
    end if;
  end if;
  update schedule_jobs
     set params = params || jsonb_build_object('dispatch', outcome, 'dispatch_request', req, 'dispatched_at', now())
   where id = p_job;
  return outcome;
end $$;
revoke execute on function app.dispatch_worker(uuid) from anon, public, authenticated;

create or replace function app.on_job_queued() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.dispatch_worker(new.id);
  return null;
end $$;

drop trigger if exists schedule_jobs_dispatch on schedule_jobs;
create trigger schedule_jobs_dispatch after insert on schedule_jobs
  for each row when (new.status = 'queued') execute function app.on_job_queued();

-- Send the start request again (e.g. after adding the token).
create or replace function public.redispatch_schedule(p_job uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.require_staff();
  if not exists (select 1 from schedule_jobs where id = p_job and status = 'queued') then
    raise exception 'job % is not waiting', p_job;
  end if;
  return app.dispatch_worker(p_job);
end $$;

-- What GitHub answered to the start request (204 = started), if pg_net kept the response.
create or replace function public.schedule_dispatch_response(p_job uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  req bigint;
  out jsonb;
begin
  perform app.require_staff();
  select (params ->> 'dispatch_request')::bigint into req from schedule_jobs where id = p_job;
  if req is null or to_regclass('net._http_response') is null then return null; end if;
  execute $q$select jsonb_build_object('status_code', status_code, 'error', error_msg,
                                        'body', left(content::text, 300))
            from net._http_response where id = $1$q$ into out using req;
  return out;
end $$;

-- Stop waiting for a job (it never started, or the run died).
create or replace function public.cancel_schedule_job(p_job uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.require_staff();
  update schedule_jobs set status = 'failed', error = 'בוטל על ידי נע"ת', finished_at = now()
   where id = p_job and status in ('queued', 'running');
  update cycles c set status = 'slots'
   where c.id = (select cycle_id from schedule_jobs where id = p_job) and c.status = 'scheduling'
     and not exists (select 1 from assignments a join slots s on s.id = a.slot_id where s.cycle_id = c.id);
end $$;

-- Is the automatic start configured? (token present and pg_net installed)
create or replace function public.dispatch_configured() returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare n int;
begin
  perform app.require_staff();
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null
     or to_regclass('vault.decrypted_secrets') is null then
    return false;
  end if;
  execute $q$select count(*) from vault.decrypted_secrets where name = 'github_dispatch_token' and decrypted_secret <> ''$q$ into n;
  return n > 0;
end $$;

revoke execute on function public.redispatch_schedule(uuid), public.schedule_dispatch_response(uuid),
  public.cancel_schedule_job(uuid), public.dispatch_configured() from anon, public;
grant execute on function public.redispatch_schedule(uuid), public.schedule_dispatch_response(uuid),
  public.cancel_schedule_job(uuid), public.dispatch_configured() to authenticated, service_role;
