-- Fix: a new engine run failed to save when a manual or published row was paired with an engine
-- draft of the previous run (assignments_paired_assignment_id_fkey). Unpair before deleting.

create or replace function public.apply_solver_result(p_job uuid, p_result jsonb) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  j        schedule_jobs;
  n        int;
begin
  perform app.require_staff();
  select * into j from schedule_jobs where id = p_job for update;
  if not found then raise exception 'job % not found', p_job; end if;
  if j.status = 'done' then raise exception 'job % was already applied', p_job; end if;

  if (p_result ->> 'status') not in ('OPTIMAL', 'FEASIBLE') then
    update schedule_jobs set status = 'failed', result = p_result, finished_at = now(),
           error = 'engine status ' || (p_result ->> 'status') where id = p_job;
    return 0;
  end if;

  -- A new run replaces the previous draft of the engine; manual and published rows stay.
  -- A row that stays may be paired with an engine performer that goes (a manual reserve next to
  -- the engine's performer): unpair it first – it is paired again below.
  update assignments res set paired_assignment_id = null
  from assignments gone join slots sl on sl.id = gone.slot_id
  where res.paired_assignment_id = gone.id
    and sl.cycle_id = j.cycle_id and gone.status = 'draft' and gone.source = 'solver';
  delete from assignments a using slots sl
  where sl.id = a.slot_id and sl.cycle_id = j.cycle_id and a.status = 'draft' and a.source = 'solver';

  insert into assignments (slot_id, soldier_id, gaf_id, role, status, is_penalty, points,
                           factor_at_time, normalized_points, weekend_units, explanation, source,
                           received_via, received_at)
  select sl.id, s.id, s.gaf_id, (r ->> 'role')::assignment_role, 'draft', sl.is_penalty_slot,
         (r ->> 'points')::numeric,
         case when (r ->> 'normalized_points')::numeric > 0
              then round((r ->> 'points')::numeric / (r ->> 'normalized_points')::numeric, 2) else 1 end,
         (r ->> 'normalized_points')::numeric,
         case when r ->> 'role' = 'performer' and not sl.is_penalty_slot
              then app.weekend_units(sl.starts_at, sl.ends_at) else 0 end,
         r ->> 'explanation', 'solver', 'system', now()
  from jsonb_array_elements(p_result -> 'assignments') r
  join slots sl on sl.id = (r ->> 'slot_id')::uuid and sl.cycle_id = j.cycle_id
  join soldiers s on s.id = (r ->> 'soldier_id')::uuid
  where not exists (   -- fixed rows are already in the table
    select 1 from assignments a
    where a.slot_id = sl.id and a.soldier_id = s.id
      and a.status not in ('dropped', 'cancelled_approved', 'swapped_out'));
  get diagnostics n = row_count;

  -- Pair each reserve with a performer of the same slot, same gaf first.
  update assignments res set paired_assignment_id = (
    select p.id from assignments p
    where p.slot_id = res.slot_id and p.role = 'performer'
      and p.status not in ('dropped', 'cancelled_approved', 'swapped_out')
    order by (p.gaf_id = res.gaf_id) desc, p.created_at
    limit 1)
  from slots sl
  where sl.id = res.slot_id and sl.cycle_id = j.cycle_id and res.role = 'reserve' and res.paired_assignment_id is null;

  update schedule_jobs set status = 'done', result = p_result, progress = 100, finished_at = now() where id = p_job;
  update cycles set status = 'review' where id = j.cycle_id and status = 'scheduling';
  return n;
end $$;
