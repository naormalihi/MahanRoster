-- =============================================================================
-- A gaf commander sees the personal records of his own gaf only.
--
-- Until now any commander read everything in every gaf: ת"ש level, exemptions and their
-- reasons, absences, date blocks, personal constraints, appeals, penalties, other people's
-- notifications and the roster files. Now:
--   * his own gaf (his role's gaf, or the gaf of the soldier linked to his account): all of it,
--     ת"ש and exemptions included – he is their direct commander;
--   * other gafs: what everyone shares – the board, the draft (names and duties), potential and
--     dashboard figures; through soldier_directory() only name, rank, gaf and service type;
--     potential reasons and override notes are blanked;
--   * nobody's notifications but his own; the roster files and their imports: נע"ת and the
--     unit commander only.
-- The unit commander keeps reading everything; נע"ת keeps everything.
-- =============================================================================

-- the gafim a gaf commander answers for: his roles' gafim, or his own soldier's gaf
create or replace function app.my_gafs() returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(distinct g), '{}')
  from (
    select coalesce(ur.gaf_id, s.gaf_id) as g
    from user_roles ur
    join app_users u on u.id = ur.user_id
    left join soldiers s on s.id = u.soldier_id
    where ur.user_id = auth.uid() and ur.role = 'gaf_commander' and not u.is_locked
      and (ur.valid_from is null or ur.valid_from <= now())
      and (ur.valid_to is null or ur.valid_to > now())
  ) x
  where g is not null
$$;

-- may the signed-in user read this soldier's personal records?
create or replace function app.sees_soldier(p_soldier uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.is_staff()
      or (app.mfa_passed() and (
            app.has_role('unit_commander')
            or (app.has_role('gaf_commander')
                and exists (select 1 from soldiers s where s.id = p_soldier and s.gaf_id = any (app.my_gafs())))))
$$;

create or replace function app.is_unit_commander() returns boolean
language sql stable as $$ select app.has_role('unit_commander') and app.mfa_passed() $$;

grant execute on function app.my_gafs(), app.sees_soldier(uuid), app.is_unit_commander() to authenticated;

-- personal records: own gaf only
drop policy if exists commander_read on public.soldiers;
create policy commander_read on public.soldiers for select to authenticated using (app.sees_soldier(id));
do $$
declare t text;
begin
  foreach t in array array['exemptions', 'absences', 'date_blocks', 'personal_constraints', 'appeals', 'penalties',
                           'score_adjustments', 'soldier_load_roles', 'soldier_gaf_history', 'cycle_credits',
                           'potential_overrides'] loop
    execute format('drop policy if exists commander_read on public.%I', t);
    execute format('create policy commander_read on public.%I for select to authenticated using (app.sees_soldier(soldier_id))', t);
  end loop;
end $$;

-- other people's notifications: no one but נע"ת (own_read stays)
drop policy if exists commander_read on public.notifications;

-- roster files and their imports: the unit commander (נע"ת through staff_all)
drop policy if exists commander_read on public.blobs;
create policy commander_read on public.blobs for select to authenticated using (app.is_unit_commander());
drop policy if exists commander_read on public.roster_imports;
create policy commander_read on public.roster_imports for select to authenticated using (app.is_unit_commander());

-- names for everyone who reads the unit's screens (draft, board, potential): no personal details
create or replace function public.soldier_directory()
returns table (id uuid, full_name text, service_type text, gender text, is_active boolean, gaf_name text, rank_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.id, s.full_name, s.service_type::text, s.gender::text, s.is_active, g.name, r.name
  from soldiers s
  left join org_units g on g.id = s.gaf_id
  left join ranks r on r.id = s.computed_rank_id
  where app.can_read()
$$;
revoke execute on function public.soldier_directory() from public, anon;
grant execute on function public.soldier_directory() to authenticated;

-- potential: everyone's figures, but the reasons and notes only where the reader sees the soldier
alter function public.potential_matrix(uuid) rename to potential_matrix_base;
alter function public.potential_matrix_base(uuid) set schema app;
revoke execute on function app.potential_matrix_base(uuid) from public, anon, authenticated;
create or replace function public.potential_matrix(p_cycle uuid)
returns table (soldier_id uuid, category_id uuid, value numeric, best_task_type_id uuid, reasons text[],
               available_days integer, cycle_days integer, override_value numeric, override_reason text)
language sql stable security definer set search_path = public, pg_temp as $$
  select m.soldier_id, m.category_id, m.value, m.best_task_type_id,
         case when app.sees_soldier(m.soldier_id) then m.reasons end,
         m.available_days, m.cycle_days, m.override_value,
         case when app.sees_soldier(m.soldier_id) then m.override_reason end
  from app.potential_matrix_base(p_cycle) m
$$;
revoke execute on function public.potential_matrix(uuid) from public, anon;
grant execute on function public.potential_matrix(uuid) to authenticated;
