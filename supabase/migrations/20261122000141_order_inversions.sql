-- =============================================================================
-- "שיבוץ לא לפי התור": a duty given to someone while another of his group – free that day,
-- allowed to do it, not in the duty already – stood lower in the cumulative score by more than
-- that duty is worth. Swapping the two would have brought them closer; anything less is noise
-- (the engine also weighs rest, weekends and spreading, so near-ties are not shown).
--
-- public.order_inversions(cycle): one row a duty, with the lowest such soldier. The candidate
-- checks are the manual-assignment ones (app.slot_candidates_for), so "free" means the same
-- here as in the assign window. Duties that already ended are left out – nothing to fix there.
-- =============================================================================

create or replace function public.order_inversions(p_cycle uuid)
returns table (slot_id uuid, assignment_id uuid, task_name text, starts_at timestamptz, ends_at timestamptz,
               assigned_id uuid, assigned_total numeric, skipped_id uuid, skipped_total numeric, points numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  a record;
  me numeric;
  pool text;
  best record;
begin
  perform app.require_staff();
  for a in
    select x.id as assignment_id, x.soldier_id, x.normalized_points, s.id as slot_id, s.starts_at, s.ends_at,
           coalesce(s.special_name, t.name) as task_name
    from assignments x
    join slots s on s.id = x.slot_id and s.cycle_id = p_cycle and s.cancelled_at is null
    join task_types t on t.id = s.task_type_id
    where app.performs(x.role, x.status) and x.status not in ('dropped', 'cancelled_approved', 'swapped_out')
      and s.ends_at > now() and x.normalized_points > 0
    order by s.starts_at
  loop
    select coalesce(sn.fairness_group, sn.balance_population) into pool
      from cycle_soldier_snapshot sn where sn.cycle_id = p_cycle and sn.soldier_id = a.soldier_id;
    continue when pool is null;
    best := null;
    with c as (select * from app.slot_candidates_for(a.slot_id, null))
    select (select c2.cycle_points from c c2 where c2.soldier_id = a.soldier_id) as mine,
           o.soldier_id as other, o.cycle_points as other_total
      into best
      from c o
      join cycle_soldier_snapshot sn on sn.cycle_id = p_cycle and sn.soldier_id = o.soldier_id
     where o.soldier_id <> a.soldier_id
       and coalesce(sn.fairness_group, sn.balance_population) = pool
       and cardinality(o.reasons) = 0 and o.conflicts = '[]'::jsonb and o.in_slot is null
     order by o.cycle_points, o.soldier_id
     limit 1;
    continue when best is null or best.other is null;
    me := best.mine;
    if me - best.other_total > a.normalized_points then
      slot_id := a.slot_id; assignment_id := a.assignment_id; task_name := a.task_name;
      starts_at := a.starts_at; ends_at := a.ends_at;
      assigned_id := a.soldier_id; assigned_total := round(me, 2);
      skipped_id := best.other; skipped_total := round(best.other_total, 2); points := round(a.normalized_points, 2);
      return next;
    end if;
  end loop;
end $$;

revoke execute on function public.order_inversions(uuid) from public, anon;
grant execute on function public.order_inversions(uuid) to authenticated;
