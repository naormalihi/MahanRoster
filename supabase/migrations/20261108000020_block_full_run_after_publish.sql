-- =============================================================================
-- No full engine run on a published cycle: it would schedule from scratch next to
-- the published assignments. (Monthly refresh will use stability mode.)
-- =============================================================================

create or replace function public.request_schedule(p_cycle uuid, p_kind job_kind default 'full') returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  job_id uuid;
begin
  perform app.require_staff();
  if p_kind = 'full' and exists (select 1 from cycles where id = p_cycle and status in ('published', 'closed')) then
    raise exception 'the cycle is published – a full run would ignore the published board; changes go through day-to-day management';
  end if;
  if exists (select 1 from schedule_jobs where cycle_id = p_cycle and status in ('queued', 'running')) then
    raise exception 'a scheduling run is already in progress for this cycle';
  end if;
  if not exists (select 1 from cycle_soldier_snapshot where cycle_id = p_cycle) then
    perform public.snapshot_cycle(p_cycle);
  end if;
  insert into schedule_jobs (cycle_id, kind, input, requested_by)
  values (p_cycle, p_kind, public.build_solver_input(p_cycle, p_kind), auth.uid())
  returning id into job_id;
  update cycles set status = 'scheduling' where id = p_cycle and status in ('slots', 'potential', 'review', 'scheduling');
  return job_id;
end $$;
