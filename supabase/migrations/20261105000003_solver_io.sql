-- =============================================================================
-- The bridge between the database and the scheduling engine
--
--   snapshot_cycle(cycle)            freeze rank, populations and baseline scores
--   request_schedule(cycle, kind)    build the engine input and queue a job
--   apply_solver_result(job, result) store the engine output as draft assignments
--   publish_cycle(cycle)             draft → assigned, the board shows the cycle
--
-- The engine input matches solver/mahanroster_solver/models.py (Problem).
-- =============================================================================

create or replace function app.tz() returns text
language sql stable as $$ select coalesce(app.setting('time_zone') #>> '{}', 'Asia/Jerusalem') $$;

-- Local wall-clock time as the engine expects it: "2027-01-07T08:00".
create or replace function app.local_ts(t timestamptz) returns text
language sql stable as $$ select to_char(t at time zone app.tz(), 'YYYY-MM-DD"T"HH24:MI') $$;

-- Inside a security-definer function current_user is the owner, so the caller's API
-- role is read from the "role" setting: authenticated / service_role, or "none" for a
-- direct database session (migrations, administration).
create or replace function app.require_staff() returns void
language plpgsql stable as $$
begin
  if not (app.is_staff() or current_setting('role') in ('service_role', 'none')) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
end $$;

-- Number of 24-hour units of a duty that start on a weekend day or a holiday (eve).
create or replace function app.weekend_units(starts timestamptz, ends timestamptz) returns int
language sql stable as $$
  select count(*)::int
  from generate_series(0, ceil(extract(epoch from ends - starts) / 86400)::int - 1) i
  cross join lateral (select ((starts + i * interval '24 hours') at time zone app.tz())::date as d) u
  where extract(isodow from u.d)::int in (select jsonb_array_elements_text(app.setting('weekend_weekdays'))::int)
     or exists (select 1 from calendar_days c where c.day = u.d and c.day_type in ('holiday', 'holiday_eve'))
$$;

-- ---------------------------------------------------------------------------
-- Snapshot: the facts the cycle is calculated on, frozen once
-- ---------------------------------------------------------------------------
create or replace function public.snapshot_cycle(p_cycle uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c        cycles;
  win_from date;
  n        int;
begin
  perform app.require_staff();
  select * into c from cycles where id = p_cycle;
  if not found then raise exception 'cycle % not found', p_cycle; end if;
  win_from := c.start_date - make_interval(months => (app.setting('score_window_months') #>> '{}')::int);

  delete from cycle_soldier_snapshot where cycle_id = p_cycle;

  insert into cycle_soldier_snapshot (
    cycle_id, soldier_id, rank_id, rank_order, populations, balance_population,
    is_parent, qualifies_day_only, is_shachar, baseline_score, baseline_weekends, baseline_reserves)
  select
    p_cycle,
    s.id,
    r.id,
    r.sort_order,
    array(select distinct x from unnest(array[s.service_type::text] || coalesce(r.population_tags, '{}')) x order by x),
    s.service_type::text,
    parent.v,
    parent.v or exists (
      select 1 from exemptions e join exemption_types et on et.id = e.exemption_type_id
      where e.soldier_id = s.id and e.status = 'approved' and et.qualifies_day_only
        and e.start_date <= c.end_date and e.end_date >= c.start_date),
    s.is_shachar,
    coalesce(hist.points, 0)
      + coalesce((select sum(points) from score_adjustments sa
                  where sa.soldier_id = s.id and sa.effective_date >= win_from and sa.effective_date < c.start_date), 0)
      + case when s.opening_score_at >= win_from then coalesce(s.opening_score, 0) else 0 end,
    coalesce(hist.weekends, 0),
    coalesce(hist.reserves, 0)
  from soldiers s
  left join lateral (
    select case when s.appointment_rank_id is not null
                 and (s.appointment_rank_until is null or s.appointment_rank_until >= c.start_date)
                then s.appointment_rank_id else s.computed_rank_id end as rank_id
  ) rk on true
  left join ranks r on r.id = rk.rank_id
  cross join lateral (
    select case when s.parent_override is not null
                 and (s.parent_override_until is null or s.parent_override_until >= c.start_date)
                then s.parent_override else s.parent_status end as v
  ) parent
  left join lateral (
    select
      sum(a.normalized_points) filter (where a.status in ('done', 'reserve_activated'))  as points,
      sum(a.weekend_units)     filter (where a.status in ('done', 'reserve_activated'))  as weekends,
      count(*) filter (where a.role = 'reserve' and a.status in ('reserve_idle', 'reserve_activated', 'assigned')) as reserves
    from assignments a join slots sl on sl.id = a.slot_id
    where a.soldier_id = s.id
      and sl.starts_at >= win_from::timestamp at time zone app.tz()
      and sl.starts_at <  c.start_date::timestamp at time zone app.tz()
  ) hist on true
  where s.is_active
    and (s.release_date is null or s.release_date >= c.start_date)
    and (s.enlistment_date is null or s.enlistment_date <= c.end_date);

  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Engine input
-- ---------------------------------------------------------------------------
create or replace function public.build_solver_input(p_cycle uuid, p_kind job_kind default 'full') returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  c        cycles;
  c_from   timestamptz;
  c_to     timestamptz;
  doc      jsonb;
begin
  perform app.require_staff();
  select * into c from cycles where id = p_cycle;
  if not found then raise exception 'cycle % not found', p_cycle; end if;
  if not exists (select 1 from cycle_soldier_snapshot where cycle_id = p_cycle) then
    raise exception 'cycle % has no snapshot – run snapshot_cycle first', p_cycle;
  end if;
  c_from := c.start_date::timestamp at time zone app.tz();
  c_to   := (c.end_date + 1)::timestamp at time zone app.tz();

  doc := jsonb_build_object(
    'cycle_id',    p_cycle::text,
    'cycle_start', c.start_date,
    'cycle_end',   c.end_date,

    'task_types', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id::text, 'name', t.name, 'weight', t.weight, 'min_rest_hours', t.min_rest_hours,
        'service_restriction', t.service_restriction, 'requires_weapon', t.requires_weapon,
        'is_weekend_type', t.is_weekend_type, 'shachar_compatible', t.shachar_compatible,
        'qualifying_duty', t.qualifying_duty, 'eligible_populations', to_jsonb(t.eligible_populations),
        'rank_min', rmin.sort_order, 'rank_max', rmax.sort_order, 'gender', t.gender,
        'category_id', t.category_id::text) order by t.code)
      from task_types t
      left join ranks rmin on rmin.id = t.rank_min_id
      left join ranks rmax on rmax.id = t.rank_max_id
      where t.id in (select task_type_id from slots where cycle_id = p_cycle)), '[]'),

    'soldiers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id::text, 'gaf_id', s.gaf_id::text, 'service_type', s.service_type,
        'rank_order', coalesce(sn.rank_order, 0), 'populations', to_jsonb(sn.populations),
        'gender', s.gender, 'enlistment_date', s.enlistment_date, 'release_date', s.release_date,
        'unit_join_date', s.unit_join_date, 'range_valid_until', s.range_valid_until,
        'is_shachar', sn.is_shachar, 'qualifies_day_only', sn.qualifies_day_only,
        'balance_population', sn.balance_population, 'baseline_score', sn.baseline_score,
        'baseline_weekends', sn.baseline_weekends, 'baseline_reserves', sn.baseline_reserves,
        'load_roles', coalesce((
          select jsonb_agg(jsonb_build_object('factor', lr.factor, 'valid_from', slr.valid_from, 'valid_to', slr.valid_to))
          from soldier_load_roles slr join load_roles lr on lr.id = slr.load_role_id
          where slr.soldier_id = s.id
            and slr.valid_from <= c.end_date and (slr.valid_to is null or slr.valid_to >= c.start_date)), '[]')
        ) order by s.id)
      from cycle_soldier_snapshot sn join soldiers s on s.id = sn.soldier_id
      where sn.cycle_id = p_cycle), '[]'),

    'slots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', sl.id::text, 'task_type_id', sl.task_type_id::text,
        'starts_at', app.local_ts(sl.starts_at), 'ends_at', app.local_ts(sl.ends_at),
        'performers_needed', sl.performers_needed, 'reserves_needed', sl.reserves_needed,
        'rank_min', rmin.sort_order, 'rank_max', rmax.sort_order, 'gender', sl.gender,
        'is_penalty', sl.is_penalty_slot, 'penalty_soldier_id', pen.soldier_id::text
        ) order by sl.starts_at, sl.id)
      from slots sl
      left join ranks rmin on rmin.id = sl.rank_min_id
      left join ranks rmax on rmax.id = sl.rank_max_id
      left join penalties pen on pen.id = sl.penalty_id and pen.target_type = 'soldier'
      where sl.cycle_id = p_cycle and sl.cancelled_at is null), '[]'),

    'settings', jsonb_build_object(
      'weekend_multiplier', app.setting('weekend_multiplier'),
      'holiday_multiplier', app.setting('holiday_multiplier'),
      'night_multiplier',   app.setting('night_multiplier'),
      'night_window',       app.setting('night_window'),
      -- the engine uses Python weekdays (Monday = 0); settings use ISO (Monday = 1)
      'weekend_weekdays',   (select jsonb_agg(x::int - 1) from jsonb_array_elements_text(app.setting('weekend_weekdays')) x),
      'grace_days',         app.setting('grace_days'),
      'duty_cap_per_month', app.setting('duty_cap_per_month'),
      'weights',            app.setting('solver_weights'),
      'time_limit_seconds', app.setting('solver_time_limit_seconds'),
      'workers',            4),

    'holidays', coalesce((
      select jsonb_agg(day order by day) from calendar_days
      where day_type in ('holiday', 'holiday_eve') and day between c.start_date - 1 and c.end_date + 1), '[]'),

    'exemptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'soldier_id', e.soldier_id::text, 'start_date', e.start_date, 'end_date', e.end_date,
        'excluded_task_type_ids', case when e.kind = 'full' then null else (
            select to_jsonb(array_agg(distinct x::text)) from unnest(
              coalesce(e.excluded_task_type_ids, '{}') ||
              array(select etd.task_type_id from exemption_type_duties etd
                    where etd.exemption_type_id = e.exemption_type_id and etd.effect = 'excludes')) x) end,
        'restricted_hours', e.restricted_hours))
      from exemptions e
      where e.status = 'approved' and e.start_date <= c.end_date and e.end_date >= c.start_date
        and e.soldier_id in (select soldier_id from cycle_soldier_snapshot where cycle_id = p_cycle)), '[]'),

    'absences', coalesce((
      select jsonb_agg(jsonb_build_object(
        'soldier_id', a.soldier_id::text, 'starts_at', app.local_ts(a.starts_at), 'ends_at', app.local_ts(a.ends_at)))
      from absences a
      where a.status = 'active' and a.starts_at < c_to and a.ends_at > c_from), '[]'),

    'date_blocks', coalesce((
      select jsonb_agg(jsonb_build_object('soldier_id', b.soldier_id::text, 'date', b.day))
      from date_blocks b where b.status = 'active' and b.day between c.start_date and c.end_date), '[]'),

    'personal_constraints', coalesce((
      select jsonb_agg(jsonb_build_object(
        'soldier_id', pc.soldier_id::text, 'task_type_id', pc.task_type_id::text,
        'time_window', pc.time_window, 'valid_until', pc.valid_until))
      from personal_constraints pc where pc.valid_until is null or pc.valid_until >= c.start_date), '[]'),

    -- Kept as they are: manual locks always; in stability mode every published assignment too.
    'fixed', coalesce((
      select jsonb_agg(jsonb_build_object('slot_id', a.slot_id::text, 'soldier_id', a.soldier_id::text, 'role', a.role))
      from assignments a join slots sl on sl.id = a.slot_id
      where sl.cycle_id = p_cycle and sl.cancelled_at is null
        and a.status not in ('dropped', 'cancelled_approved', 'swapped_out')
        and (a.source = 'manual' or (p_kind = 'stability' and a.status <> 'draft'))), '[]'),

    -- Duties from other cycles that reach into this one (rest included).
    'busy', coalesce((
      select jsonb_agg(jsonb_build_object(
        'soldier_id', a.soldier_id::text,
        'starts_at', app.local_ts(sl.starts_at),
        'ends_at',   app.local_ts(sl.ends_at + make_interval(hours => t.min_rest_hours))))
      from assignments a join slots sl on sl.id = a.slot_id join task_types t on t.id = sl.task_type_id
      where sl.cycle_id <> p_cycle and sl.cancelled_at is null
        and a.status not in ('draft', 'dropped', 'cancelled_approved', 'swapped_out')
        and sl.starts_at < c_to
        and sl.ends_at + make_interval(hours => t.min_rest_hours) > c_from), '[]')
  );
  return doc;
end $$;

-- ---------------------------------------------------------------------------
-- Queue a run
-- ---------------------------------------------------------------------------
create or replace function public.request_schedule(p_cycle uuid, p_kind job_kind default 'full') returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  job_id uuid;
begin
  perform app.require_staff();
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

-- ---------------------------------------------------------------------------
-- Store the result (called by the worker with the service role)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Publish
-- ---------------------------------------------------------------------------
create or replace function public.publish_cycle(p_cycle uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  perform app.require_staff();
  update assignments a set status = case when a.role = 'performer' then 'assigned' else 'reserve_idle' end::assignment_status
  from slots sl
  where sl.id = a.slot_id and sl.cycle_id = p_cycle and a.status = 'draft';
  get diagnostics n = row_count;
  update cycles set status = 'published', published_at = now(), published_by = auth.uid() where id = p_cycle;
  return n;
end $$;

revoke execute on function public.snapshot_cycle(uuid), public.build_solver_input(uuid, job_kind),
  public.request_schedule(uuid, job_kind), public.apply_solver_result(uuid, jsonb), public.publish_cycle(uuid)
  from anon, public;
grant execute on function public.snapshot_cycle(uuid), public.build_solver_input(uuid, job_kind),
  public.request_schedule(uuid, job_kind), public.apply_solver_result(uuid, jsonb), public.publish_cycle(uuid)
  to authenticated, service_role;
