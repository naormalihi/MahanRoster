-- =============================================================================
-- "רענון חי" (2.65): a counter that grows on every change of the unit's data. The app reads it every
-- 15 seconds while it is on the screen; when it moved, the open screen loads its data again.
--
-- * A sequence, not a row: bumping it takes no lock, so writers never wait on each other.
-- * Row triggers on the unit's tables; an update that changes nothing does not count.
-- * Left out: logs, the notify tick, push subscriptions, staging and progress tables, view_as – they
--   change on their own (or per device) and show nothing on the screens. app_users counts only for
--   what the screens show (not the last sign-in or the tour counters).
-- =============================================================================

create sequence if not exists app.data_version_seq;

create or replace function app.bump_data_version() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform nextval('app.data_version_seq');
  return null;
end $$;

create or replace function public.data_version() returns bigint
language sql stable security definer set search_path = public, pg_temp as $$
  select last_value from app.data_version_seq
$$;
revoke execute on function public.data_version() from public, anon;
grant execute on function public.data_version() to authenticated;

do $$
declare t text;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public'
      and tablename not in ('audit_log', 'blobs', 'notify_state', 'push_subscriptions', 'feedback_quota',
                            'config_versions', 'roster_imports', 'schedule_jobs', 'view_as', 'app_users')
  loop
    execute format('drop trigger if exists live_bump_iud on public.%I', t);
    execute format('drop trigger if exists live_bump_upd on public.%I', t);
    execute format('create trigger live_bump_iud after insert or delete on public.%I
                      for each row execute function app.bump_data_version()', t);
    execute format('create trigger live_bump_upd after update on public.%I
                      for each row when (old.* is distinct from new.*) execute function app.bump_data_version()', t);
  end loop;
end $$;

drop trigger if exists live_bump_iud on public.app_users;
drop trigger if exists live_bump_upd on public.app_users;
create trigger live_bump_iud after insert or delete on public.app_users
  for each row execute function app.bump_data_version();
create trigger live_bump_upd after update on public.app_users
  for each row when ((old.username, old.is_locked, old.must_change_password, old.soldier_id, old.deleted_at)
                     is distinct from (new.username, new.is_locked, new.must_change_password, new.soldier_id, new.deleted_at))
  execute function app.bump_data_version();
