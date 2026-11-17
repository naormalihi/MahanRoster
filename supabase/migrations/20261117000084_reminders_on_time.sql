-- =============================================================================
-- Reminders on time: the database keeps the clock, not GitHub.
--
-- The day-before reminders were queued by the notify workflow on a GitHub schedule of every
-- 15 minutes. GitHub runs such schedules when it can: this month about 3 times a day, so a
-- reminder could come 8 hours late. Now pg_cron, inside the database, runs app.notify_tick()
-- every 15 minutes:
--   * queues the reminders that are due (app.queue_reminders, as before);
--   * a new notification already wakes the notify workflow at once (trigger
--     notifications_dispatch, through pg_net). One that came while the workflow was woken less
--     than a minute before waited for the next one; the tick wakes it for those too.
-- The workflow_dispatch that pushes is immediate and reliable; only the schedule was not.
-- Where pg_cron is not available (a local database), nothing is scheduled and nothing fails.
-- =============================================================================

-- wakes the notify workflow (the body of the trigger app.dispatch_notify, callable on its own)
create or replace function app.wake_notify() returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare tok text; last timestamptz;
begin
  if not exists (select 1 from push_subscriptions) then return false; end if;
  select dispatched_at into last from notify_state where id = 1;
  if last is not null and last > now() - interval '1 minute' then return false; end if;
  update notify_state set dispatched_at = now() where id = 1;
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null or to_regclass('vault.decrypted_secrets') is null then
    return false;
  end if;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'github_dispatch_token' limit 1$q$ into tok;
  if tok is null or tok = '' then return false; end if;
  execute $q$select net.http_post(
      url     := $1,
      body    := jsonb_build_object('ref', 'main'),
      params  := '{}'::jsonb,
      headers := jsonb_build_object('Authorization', 'Bearer ' || $2, 'Accept', 'application/vnd.github+json',
                                    'X-GitHub-Api-Version', '2022-11-28', 'User-Agent', 'mahanroster', 'Content-Type', 'application/json'),
      timeout_milliseconds := 10000)$q$
    using format('https://api.github.com/repos/%s/actions/workflows/%s/dispatches',
                 app.setting('github_repo') #>> '{}', app.setting('notify_workflow') #>> '{}'), tok;
  return true;
exception when others then
  return false;
end $$;
revoke execute on function app.wake_notify() from public, anon, authenticated;

-- every 15 minutes: queue due reminders; wake the workflow for anything still waiting to be pushed
create or replace function app.notify_tick() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare queued int; waiting int; woke boolean := false;
begin
  queued := app.queue_reminders();   -- its inserts wake the workflow through the trigger
  select count(*) into waiting
    from notifications n
   where n.pushed_at is null and n.created_at > now() - interval '2 days' and n.created_at < now() - interval '1 minute'
     and exists (select 1 from push_subscriptions p where p.user_id = n.recipient_user_id);
  if waiting > 0 then woke := app.wake_notify(); end if;
  return jsonb_build_object('reminders', queued, 'waiting', waiting, 'woke', woke);
end $$;
revoke execute on function app.notify_tick() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available here: reminders stay on the workflow schedule';
    return;
  end if;
  begin
    create extension if not exists pg_cron with schema pg_catalog;
  exception when others then
    raise notice 'pg_cron could not be enabled (%): reminders stay on the workflow schedule', sqlerrm;
    return;
  end;
  perform cron.schedule('mahan-notify-tick', '*/15 * * * *', 'select app.notify_tick()');
end $$;
