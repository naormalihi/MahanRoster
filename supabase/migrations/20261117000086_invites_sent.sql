-- =============================================================================
-- Which join codes were sent.
--
-- נע"ת hands the codes out from the codes window (WhatsApp, one soldier at a time, or a printed
-- sheet per gaf). Marking a code as sent tells, in the soldiers screen, who still waits for one:
-- "הוזמן · לא נשלח" / "נשלח" / joined / expired.
-- =============================================================================

alter table soldier_invites add column if not exists sent_at timestamptz;

create or replace function public.mark_invites_sent(p_soldiers uuid[]) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  perform app.require_staff();
  update soldier_invites i set sent_at = now()
   where i.soldier_id = any (p_soldiers) and i.sent_at is null and i.used_at is null and i.revoked_at is null
     and i.id = (select x.id from soldier_invites x where x.soldier_id = i.soldier_id order by x.created_at desc limit 1);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.mark_invites_sent(uuid[]) from public, anon;
grant execute on function public.mark_invites_sent(uuid[]) to authenticated;

drop function if exists public.soldier_account_status();
create function public.soldier_account_status()
returns table (soldier_id uuid, username text, is_locked boolean, invited_at timestamptz, invite_expires_at timestamptz,
               invite_state text, invite_sent_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select so.id,
         u.username,
         u.is_locked,
         i.created_at,
         i.expires_at,
         case when i.id is null then null
              when i.used_at is not null then 'used'
              when i.revoked_at is not null then 'revoked'
              when i.expires_at <= now() then 'expired'
              else 'open' end,
         i.sent_at
  from soldiers so
  left join app_users u on u.soldier_id = so.id
  left join lateral (select * from soldier_invites x where x.soldier_id = so.id order by x.created_at desc limit 1) i on true
  where app.is_staff()
$$;
revoke execute on function public.soldier_account_status() from public, anon;
grant execute on function public.soldier_account_status() to authenticated, service_role;
