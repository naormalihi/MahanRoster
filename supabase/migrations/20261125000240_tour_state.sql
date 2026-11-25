-- =============================================================================
-- The owl's tour opens by itself only in a user's first three sign-ins, and not again once he
-- ticked "הבנתי, אל תציג לי שוב" or went through to its last step. Kept for the user (not the
-- device), so a new phone, a private window or cleared browser data do not bring it back.
-- Opening it from the owl button is not counted.
-- =============================================================================

alter table app_users add column if not exists tour_auto_count int not null default 0;
alter table app_users add column if not exists tour_dismissed_at timestamptz;

-- whether to open it by itself now; when so, the opening is counted
create or replace function public.tour_auto_open() returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare u app_users;
begin
  select * into u from app_users where id = auth.uid() and deleted_at is null;
  if u.id is null or u.tour_dismissed_at is not null or u.tour_auto_count >= 3 then return false; end if;
  update app_users set tour_auto_count = tour_auto_count + 1 where id = u.id;
  return true;
end $$;

create or replace function public.tour_dismiss() returns void
language sql security definer set search_path = public, pg_temp as $$
  update app_users set tour_dismissed_at = coalesce(tour_dismissed_at, now()) where id = auth.uid();
$$;

revoke execute on function public.tour_auto_open(), public.tour_dismiss() from public, anon;
grant execute on function public.tour_auto_open(), public.tour_dismiss() to authenticated;
