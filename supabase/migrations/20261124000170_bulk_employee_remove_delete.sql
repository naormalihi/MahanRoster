-- Workforce screen, several employees at once:
--   remove_from_unit_many – "הוצאה מהיחידה" for each (inactive from a date; history kept);
--   delete_soldiers – "מחיקה לצמיתות": the employee and everything about him are deleted. One with
--     duties on a board that was published (or closed) is not deleted – the board's history stays;
--     he can be taken out of the unit instead. His account goes with him if it is an employee's
--     only; a staff account linked to him stays, unlinked.

-- "הוצאה מהיחידה" (one employee): his draft duties are deleted – first unhooked from the ones
-- paired with them or replacing them (it failed on a paired draft duty).
create or replace function public.remove_from_unit(p_soldier uuid, p_from date default current_date) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
  drafts uuid[];
begin
  perform app.require_staff();
  update soldiers set is_active = false, updated_at = now() where id = p_soldier and is_active;
  if not found then raise exception 'העובד לא נמצא או שהוא כבר לא פעיל'; end if;
  -- his duties from that day: dropped (the slot shows as missing; he gets "removed")
  update assignments a set status = 'dropped', manual_reason = coalesce(a.manual_reason, 'יצא מהיחידה')
    from slots s
   where s.id = a.slot_id and a.soldier_id = p_soldier and s.starts_at >= p_from::timestamptz
     and a.status in ('assigned', 'reserve_idle');
  get diagnostics n = row_count;
  select coalesce(array_agg(a.id), '{}') into drafts from assignments a join slots s on s.id = a.slot_id
   where a.soldier_id = p_soldier and a.status = 'draft' and s.starts_at >= p_from::timestamptz;
  update assignments set paired_assignment_id = null where paired_assignment_id = any(drafts);
  update assignments set replaced_assignment_id = null where replaced_assignment_id = any(drafts);
  delete from assignments where id = any(drafts);
  insert into audit_log (actor_user_id, action, entity_type, entity_id, after)
  values (auth.uid(), 'remove_from_unit', 'soldiers', p_soldier::text, jsonb_build_object('from', p_from, 'duties_dropped', n));
  return n;
end $$;

create or replace function public.remove_from_unit_many(p_soldiers uuid[], p_from date default current_date)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s uuid;
  removed int := 0;
  dropped int := 0;
begin
  perform app.require_staff();
  foreach s in array coalesce(p_soldiers, '{}') loop
    continue when not exists (select 1 from soldiers where id = s and is_active);
    dropped := dropped + public.remove_from_unit(s, p_from);
    removed := removed + 1;
  end loop;
  return jsonb_build_object('removed', removed, 'duties_dropped', dropped);
end $$;
revoke all on function public.remove_from_unit_many(uuid[], date) from public, anon;
grant execute on function public.remove_from_unit_many(uuid[], date) to authenticated;

create or replace function public.delete_soldiers(p_soldiers uuid[])
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ids uuid[];
  blocked jsonb;
  x uuid[];
  acc record;
  accounts int := 0;
  n int;
begin
  perform app.require_staff();
  -- on a published (or closed) board: kept
  select coalesce(jsonb_agg(jsonb_build_object('id', so.id, 'name', so.full_name) order by so.full_name), '[]')
    into blocked
    from soldiers so
   where so.id = any(p_soldiers)
     and exists (select 1 from assignments a join slots sl on sl.id = a.slot_id join cycles c on c.id = sl.cycle_id
                  where a.soldier_id = so.id and c.status in ('published', 'closed'));
  select array_agg(so.id) into ids from soldiers so
   where so.id = any(p_soldiers)
     and not exists (select 1 from jsonb_array_elements(blocked) b where (b->>'id')::uuid = so.id);
  if ids is null then
    return jsonb_build_object('deleted', 0, 'accounts', 0, 'blocked', blocked);
  end if;

  insert into audit_log (actor_user_id, action, entity_type, entity_id, before)
  values (auth.uid(), 'delete_soldiers', 'soldiers', null,
          jsonb_build_object('count', cardinality(ids),
                             'names', (select jsonb_agg(full_name order by full_name) from soldiers where id = any(ids))));

  -- their duties (not on a published board) and what hangs on them
  select coalesce(array_agg(id), '{}') into x from assignments where soldier_id = any(ids);
  update assignments set replaced_assignment_id = null where replaced_assignment_id = any(x);
  update assignments set paired_assignment_id = null where paired_assignment_id = any(x);
  delete from swap_requests
   where requested_by = any(ids) or target_soldier_id = any(ids) or assignment_id = any(x) or counter_assignment_id = any(x);
  delete from appeals where soldier_id = any(ids);
  update slots set penalty_id = null
   where penalty_id in (select id from penalties where soldier_id = any(ids) or dropped_assignment_id = any(x));
  delete from penalties where soldier_id = any(ids) or dropped_assignment_id = any(x);
  delete from assignments where id = any(x);
  -- everything else about them
  delete from cycle_soldier_snapshot where soldier_id = any(ids);
  delete from cycle_credits where soldier_id = any(ids);
  delete from potential_overrides where soldier_id = any(ids);
  delete from score_adjustments where soldier_id = any(ids);
  delete from exemptions where soldier_id = any(ids);
  delete from absences where soldier_id = any(ids);
  delete from date_blocks where soldier_id = any(ids);
  delete from personal_constraints where soldier_id = any(ids);

  -- accounts: an employee's only – deleted (or closed, when his name is on records); staff – unlinked
  for acc in
    select u.id from app_users u
     where u.soldier_id = any(ids)
       and not exists (select 1 from user_roles r where r.user_id = u.id and r.role <> 'soldier')
  loop
    begin
      delete from auth.users where id = acc.id;
    exception when foreign_key_violation then
      delete from user_roles where user_id = acc.id;
      update auth.users set encrypted_password = crypt(gen_random_uuid()::text, gen_salt('bf')),
                            email = 'deleted.' || left(acc.id::text, 8) || '@users.invalid', updated_at = now()
       where id = acc.id;
      update auth.identities set identity_data = identity_data || jsonb_build_object('email', 'deleted.' || left(acc.id::text, 8) || '@users.invalid')
       where user_id = acc.id;
      update app_users set is_locked = true, deleted_at = now(), soldier_id = null,
                           username = 'deleted.' || left(acc.id::text, 8)
       where id = acc.id;
    end;
    accounts := accounts + 1;
  end loop;
  delete from user_roles r using app_users u
   where u.id = r.user_id and u.soldier_id = any(ids) and r.role = 'soldier';
  update app_users set soldier_id = null where soldier_id = any(ids);

  delete from soldiers where id = any(ids);  -- gaf history, load roles, invite codes go with them
  get diagnostics n = row_count;
  return jsonb_build_object('deleted', n, 'accounts', accounts, 'blocked', blocked);
end $$;
revoke all on function public.delete_soldiers(uuid[]) from public, anon;
grant execute on function public.delete_soldiers(uuid[]) to authenticated;
