-- =============================================================================
-- A WhatsApp message about a duty, for a soldier without an account (or one who has not
-- pressed "ראיתי"). נע"ת presses once; the app builds the text and opens the soldier's chat.
--
-- * public.duty_message(soldier, assignment, cycle): what the message needs –
--     one assignment (the "לא אישרו" card, the slot window) or all his coming duties in a cycle
--     (after publishing). Each duty with its briefing line (app.brief_text).
--   A soldier without an account gets a fresh join code in the same call (codes are kept only
--   as a hash, so an open code cannot be shown again; the new one replaces it), marked as sent.
-- * public.no_account_duties(cycle): after publishing – the soldiers with duties in the cycle
--   and no account, and whether a message went out since the cycle was published.
-- =============================================================================

create or replace function public.duty_message(p_soldier uuid default null, p_assignment uuid default null, p_cycle uuid default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  sid uuid := p_soldier;
  so soldiers;
  acct boolean;
  c text;
  duties jsonb;
begin
  perform app.require_staff();
  if p_assignment is not null then
    select a.soldier_id into sid from assignments a where a.id = p_assignment;
    if sid is null then raise exception 'השיבוץ לא נמצא'; end if;
  end if;
  if sid is null or (p_assignment is null and p_cycle is null) then raise exception 'חסר חייל או מחזור'; end if;
  select * into so from soldiers where id = sid;
  if so.id is null or not app.sees_soldier(sid) then raise exception 'החייל לא נמצא'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'assignment_id', a.id, 'task_name', coalesce(sl.special_name, t.name), 'role', a.role,
           'starts_at', sl.starts_at, 'ends_at', sl.ends_at, 'brief', app.brief_text(sl.id))
         order by sl.starts_at), '[]'::jsonb)
    into duties
  from assignments a
  join slots sl on sl.id = a.slot_id and sl.cancelled_at is null
  join task_types t on t.id = sl.task_type_id
  where a.soldier_id = sid and a.status in ('assigned', 'reserve_idle', 'reserve_activated')
    and case when p_assignment is not null then a.id = p_assignment
             else sl.cycle_id = p_cycle and sl.ends_at > now() end;

  acct := exists (select 1 from app_users u where u.soldier_id = sid and u.deleted_at is null);
  if not acct and so.is_active then
    update soldier_invites set revoked_at = now() where soldier_id = sid and used_at is null and revoked_at is null;
    c := app.invite_code();
    insert into soldier_invites (soldier_id, code_hash, created_by, expires_at, sent_at)
    values (sid, app.invite_hash(c), auth.uid(), now() + interval '30 days', now());
    c := substr(c, 1, 5) || '-' || substr(c, 6, 5);
    insert into audit_log (actor_user_id, action, entity_type, entity_id, after)
    values (auth.uid(), 'duty_message', 'soldiers', sid::text, jsonb_build_object('duties', jsonb_array_length(duties), 'invite', true));
  end if;

  return jsonb_build_object('soldier_id', sid, 'full_name', so.full_name, 'phone', so.phone,
                            'has_account', acct, 'code', c, 'duties', duties);
end $$;

create or replace function public.no_account_duties(p_cycle uuid)
returns table (soldier_id uuid, full_name text, gaf_name text, phone text, duties int, first_at timestamptz, sent boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select so.id, so.full_name, g.name, so.phone, count(*)::int, min(sl.starts_at),
         exists (select 1 from soldier_invites i
                 where i.soldier_id = so.id and i.sent_at >= coalesce(c.published_at, c.created_at))
  from assignments a
  join slots sl on sl.id = a.slot_id and sl.cancelled_at is null
  join cycles c on c.id = sl.cycle_id
  join soldiers so on so.id = a.soldier_id and so.is_active
  left join org_units g on g.id = so.gaf_id
  where app.is_staff() and sl.cycle_id = p_cycle and sl.ends_at > now()
    and a.status in ('assigned', 'reserve_idle', 'reserve_activated')
    and app.sees_soldier(so.id)
    and not exists (select 1 from app_users u where u.soldier_id = so.id and u.deleted_at is null)
  group by so.id, so.full_name, g.name, so.phone, c.published_at, c.created_at
  order by g.name nulls last, so.full_name
$$;

revoke execute on function public.duty_message(uuid, uuid, uuid), public.no_account_duties(uuid) from public, anon;
grant execute on function public.duty_message(uuid, uuid, uuid), public.no_account_duties(uuid) to authenticated, service_role;
