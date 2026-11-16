-- =============================================================================
-- A soldier taken off a duty is not proposed for it again.
--
-- Taken off = the row on that slot is 'dropped': removed with a reason after publishing,
-- replaced by an activated reserve, or released by an exemption. Until now the engine only
-- dropped such rows from its input, so a run for the duties waiting to be staffed could put
-- the same soldier straight back (removed as "לא יכול", proposed again a minute later).
--
-- The input gains 'excluded': (slot, soldier) pairs the engine treats as not eligible
-- ("הוסר מהתורנות הזו"). A soldier who was put back on the slot by hand since is not excluded.
-- =============================================================================

alter function public.build_solver_input(uuid, job_kind) rename to build_solver_input_base;
alter function public.build_solver_input_base(uuid, job_kind) set schema app;
revoke execute on function app.build_solver_input_base(uuid, job_kind) from anon, public, authenticated;

create or replace function public.build_solver_input(p_cycle uuid, p_kind job_kind default 'full') returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return app.build_solver_input_base(p_cycle, p_kind) || jsonb_build_object(
    'excluded', coalesce((
      select jsonb_agg(distinct jsonb_build_object('slot_id', d.slot_id::text, 'soldier_id', d.soldier_id::text))
      from assignments d join slots sl on sl.id = d.slot_id
      where sl.cycle_id = p_cycle and sl.cancelled_at is null
        and d.status = 'dropped'
        and not exists (select 1 from assignments x where x.slot_id = d.slot_id and x.soldier_id = d.soldier_id
                          and x.status not in ('dropped', 'cancelled_approved', 'swapped_out'))), '[]'));
end $$;
revoke execute on function public.build_solver_input(uuid, job_kind) from anon, public;
grant execute on function public.build_solver_input(uuid, job_kind) to authenticated;
